import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { NavigationDataService } from './package/navigation-data-service.js';
import { NavigationPackageRepository } from './package/package-repository.js';
import { validateNavigationPackage } from './package/package-validator.js';
import { buildNavigationChain } from './computation/navigation/navigation-chain.js';
import { NavMeshBuilder, NavMeshStore } from './computation/navigation/index.js';
import { createNavigationHttpService } from './server/navigation-http-service.js';

const valueAfter = (argv, index) => {
  if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new Error(`missing value for ${argv[index]}`);
  return argv[index + 1];
};

export const parseCliArgs = (argv = []) => {
  const result = { command: argv[0] ?? 'help', dryRun: true, enableExecution: false };
  const hasGoalAction = result.command === 'nav-goal' && argv[1] && !argv[1].startsWith('--');
  if (hasGoalAction) result.action = argv[1];
  for (let index = hasGoalAction ? 2 : 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') { result.dryRun = true; result.enableExecution = false; }
    else if (argument === '--enable-execution') { result.dryRun = false; result.enableExecution = true; }
    else if (argument === '--package') { result.packageId = valueAfter(argv, index); index += 1; }
    else if (argument === '--map') { result.mapId = valueAfter(argv, index); index += 1; }
    else if (argument === '--file') { result.file = valueAfter(argv, index); index += 1; }
    else if (argument === '--goal-id') { result.goalId = valueAfter(argv, index); index += 1; }
    else if (argument === '--priority') { result.priority = Number(valueAfter(argv, index)); index += 1; }
    else if (argument === '--revision') { result.revision = Number(valueAfter(argv, index)); index += 1; }
    else if (argument === '--host') { result.host = valueAfter(argv, index); index += 1; }
    else if (argument === '--port') { result.port = Number(valueAfter(argv, index)); index += 1; }
    else throw new Error(`unknown option: ${argument}`);
  }
  return result;
};

export const runCli = async (argv = process.argv.slice(2), dependencies = {}) => {
  const options = parseCliArgs(argv);
  const noDependencies = Object.keys(dependencies).length === 0;
  if (Object.keys(dependencies).length === 0 && ['nav-serve'].includes(options.command)
    || Object.keys(dependencies).length === 0 && options.command === 'nav-chain' && !options.file
    || Object.keys(dependencies).length === 0 && options.command === 'nav-check' && !options.file
    || Object.keys(dependencies).length === 0 && options.command === 'nav-map-build' && !options.file) {
    return { command: options.command, status: 'not-configured', dryRun: options.dryRun, enableExecution: options.enableExecution, message: 'AASC-HIE command requires configured application dependencies.' };
  }
  if (noDependencies && options.command === 'nav-goal') {
    return { command: options.command, status: 'not-configured', dryRun: options.dryRun, enableExecution: options.enableExecution, message: 'nav-goal requires a configured active goal controller.' };
  }
  if (options.command === 'nav-goal') {
    const controller = dependencies.activeGoal ?? dependencies.runtime?.activeGoal;
    if (!controller) throw new Error('activeGoal controller is required for nav-goal');
    if (options.action === 'set') {
      if (!options.goalId) throw new Error('--goal-id is required for nav-goal set');
      return controller.set(options.goalId, { source: 'cli', priority: options.priority });
    }
    if (options.action === 'get') return controller.get();
    if (options.action === 'clear') return controller.clear();
    throw new Error('nav-goal action must be set, get, or clear');
  }
  if (options.command === 'nav-map-build') {
    if (!options.mapId || !options.file) throw new Error('--map and --file are required for nav-map-build');
    const input = JSON.parse(await readFile(options.file, 'utf8'));
    const builder = dependencies.navMeshBuilder ?? new NavMeshBuilder(input.builderOptions);
    const store = dependencies.navMeshStore ?? new NavMeshStore({ rootDir: input.rootDir });
    return builder.buildAndStore(store, options.mapId, input);
  }
  if (options.command === 'nav-check') {
    if (!dependencies.packageService && options.file) {
      const navigationPackage = await new NavigationPackageRepository().load(options.file);
      return validateNavigationPackage(navigationPackage);
    }
    if (!dependencies.packageService) throw new Error('packageService or --file is required for nav-check');
    return dependencies.packageService.validate(options.packageId, options.revision ?? 0);
  }
  if (options.command === 'nav-chain') {
    if (options.file) {
      const navigationPackage = await new NavigationPackageRepository().load(options.file);
      const goal = navigationPackage.goals.find((candidate) => candidate.id === options.goalId);
      if (!goal) throw new Error('goal not found: ' + String(options.goalId));
      const flow = navigationPackage.flows.find((candidate) => candidate.id === goal.flowId);
      const chainGoal = flow && !(goal.steps?.length) ? { ...goal, steps: flow.steps } : goal;
      return buildNavigationChain(
        { stateVersion: navigationPackage.revision ?? 0, gameTime: 0 },
        chainGoal,
        { plan: { status: 'complete' }, navigator: { id: goal.delegate ?? goal.kind, mode: goal.kind } },
      );
    }
    if (!dependencies.runtime?.getChain) throw new Error('runtime.getChain is required for nav-chain');
    return dependencies.runtime.getChain(options);
  }
  if (options.command === 'nav-serve') {
    const repository = dependencies.repository ?? new NavigationPackageRepository();
    const packageService = dependencies.packageService ?? new NavigationDataService({ repository });
    const service = createNavigationHttpService({ ...dependencies, packageService, execution: { enabled: options.enableExecution } });
    const server = createServer(service.handler);
    await new Promise((resolve) => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
    return { server, service, options };
  }
  return { command: 'help', dryRun: options.dryRun, enableExecution: options.enableExecution };
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runCli().then((value) => { if (value?.server) console.log(`AASC-HIE server listening on ${value.server.address().port}`); else console.log(JSON.stringify(value)); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NavigationDataService } from '../package/navigation-data-service.js';
import { GoalManager } from '../computation/goal-manager.js';
import { ProgressStore } from '../computation/progress-store.js';
import { ActiveGoalController } from './active-goal.js';
import { GameTaskBridge } from './game-task-bridge.js';
import { NavigationGapQueue } from './navigation-gap-queue.js';

const gameRootDefault = fileURLToPath(new URL('../../../aasc-game/', import.meta.url));
const packagePath = fileURLToPath(new URL('../../data/packages/pig-game.nav.md', import.meta.url));
const expectedSteps = ['capture', 'review', 'solve', 'execute', 'victory'];

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

/** 关卡目标只驱动固定的捕获、复核、求解及执行器，不执行模型提供的命令。 */
export class PigNavigation {
  constructor({ level, windowId, display = ':1', gameRoot = gameRootDefault, sessionDir, bridge, activate, gapQueue = new NavigationGapQueue(), processRunner = runProcess, allowExecution = true } = {}) {
    if (!Number.isSafeInteger(level) || level < 1) throw new Error('invalid level');
    if (!/^0x[0-9a-f]+$/i.test(windowId ?? '')) throw new Error('invalid windowId');
    if (!/^:[0-9]+(?:\.[0-9]+)?$/.test(display)) throw new Error('invalid display');
    this.level = level;
    this.windowId = windowId;
    this.display = display;
    this.gameRoot = resolve(gameRoot);
    this.evidenceRoot = join(this.gameRoot, 'docs/references/pig-game/play-runs');
    this.sessionDir = sessionDir ? resolve(sessionDir) : undefined;
    this.bridge = bridge ?? new GameTaskBridge({ enabled: true, gameRoot: this.gameRoot });
    this.activate = activate;
    this.processRunner = processRunner;
    this.allowExecution = allowExecution;
    this.gapQueue = gapQueue;
    this.busy = false;
  }

  async initialize() {
    if (this.manager) return;
    await mkdir(this.evidenceRoot, { recursive: true });
    const base = await realpath(this.evidenceRoot);
    if (this.sessionDir) {
      const actual = await realpath(this.sessionDir);
      const part = relative(base, actual);
      if (dirname(actual) !== base || !part.startsWith(`nav-level-${this.level}-`) || part.includes('/')) throw new Error('invalid session directory');
      this.sessionDir = actual;
    } else {
      this.sessionDir = await mkdtemp(join(base, `nav-level-${this.level}-`));
    }
    const service = new NavigationDataService();
    const navigationPackage = await service.load(packagePath);
    this.goal = navigationPackage.goals.find(item => item.id === 'pig-level');
    if (!this.goal || JSON.stringify(this.goal.steps?.map(item => item.id)) !== JSON.stringify(expectedSteps)) throw new Error('invalid pig navigation goal');
    this.activeGoal = new ActiveGoalController();
    this.activeGoal.set(this.goal.id, { source: 'pig-navigation', metadata: { level: this.level } });
    this.manager = new GoalManager({ package: navigationPackage, progressStore: new ProgressStore({ filePath: join(this.sessionDir, 'progress.json') }) });
  }

  async status(reason) {
    await this.initialize();
    const evaluation = await this.manager.evaluate({}, this.goal);
    const next = await this.manager.next({}, this.goal);
    const captureRoot = join(this.sessionDir, 'captures');
    const captures = await readdir(captureRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const evidence = captures.length === 1 ? join(captureRoot, captures[0]) : undefined;
    const executionResult = join(this.sessionDir, 'execution', 'result.json');
    const feedback = await exists(executionResult) ? await readJson(executionResult) : undefined;
    if (reason) this.gapQueue.report({ type: 'navigation-gap', goalId: `pig-level-${this.level}`,
      sourceLayer: 'muscle-memory', reason, requiresIntelligence: true, evidence: { directory: evidence ?? this.sessionDir } });
    return { goal: this.activeGoal.get(), level: this.level, sessionDir: this.sessionDir, next: next?.id ?? null,
      completed: evaluation.completed, ...(reason ? { reason } : {}), evidence, gaps: this.gapQueue.snapshot(), ...(feedback ? { feedback } : {}) };
  }

  async advance({ reviewedLayout } = {}) {
    if (this.busy) throw new Error('pig navigation already running');
    this.busy = true;
    try {
      await this.initialize();
      const probes = await readdir(join(this.sessionDir, 'probes')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      if (probes.length) return await this.status('本会话已发起试探，必须重新采集现场');
      const steps = Object.fromEntries(this.goal.steps.map(step => [step.id, step]));
      const done = async name => (await this.manager.progressStore.get(steps[name])).completed;
      const mark = async (name, data = {}) => {
        const progress = await this.manager.record(steps[name], { completed: true, data });
        for (const gap of this.gapQueue.list()) this.gapQueue.resolve(gap.id, { step: name });
        return progress;
      };
      if (!(await done('capture'))) {
        if (typeof this.activate !== 'function') throw new Error('window activation is not configured');
        const captures = join(this.sessionDir, 'captures');
        await mkdir(captures, { recursive: true });
        await this.activate();
        const result = await this.bridge.run({ startLevel: this.level, windowId: this.windowId, display: this.display,
          maxLevels: 1, inspectOnly: true, outputRoot: captures });
        const names = await readdir(captures);
        if (names.length !== 1 || !/^level-[0-9]+-run-\d{8}-\d{6}-\d+$/.test(names[0])) throw new Error('capture evidence missing or ambiguous');
        const dir = join(captures, names[0]);
        const feedback = await readJson(join(dir, 'result.json'));
        if (feedback.status !== 'inspection_only' || feedback.level !== this.level || feedback.clicks !== 0 || feedback.confirmed !== 0) throw new Error('capture not verified');
        const image = await readFile(join(dir, 'original.png'));
        await mark('capture', { sha256: createHash('sha256').update(image).digest('hex'), exitCode: result.code });
      }
      let state = await this.status();
      const image = join(state.evidence, 'original.png');
      const captureRecord = await this.manager.progressStore.get(steps.capture);
      if (captureRecord.data?.sha256 !== createHash('sha256').update(await readFile(image)).digest('hex')) throw new Error('首屏证据已改变');
      const layout = join(this.sessionDir, 'reviewed-layout.json');
      if (!(await done('review'))) {
        if (reviewedLayout && await exists(layout)) {
          const [existing, proposed] = await Promise.all([readFile(layout), readFile(resolve(reviewedLayout))]);
          if (!existing.equals(proposed)) {
            if (await exists(join(this.sessionDir, 'plan.json'))) throw new Error('已有计划，不能替换布局');
            await rename(layout, join(this.sessionDir, `reviewed-layout-rejected-${randomUUID()}.json`));
          }
        }
        if (!(await exists(layout))) {
          if (reviewedLayout) {
            await copyFile(resolve(reviewedLayout), layout, constants.COPYFILE_EXCL);
          } else if (await exists(join(this.gameRoot, 'scripts/pig-nav-middle.py'))) {
            // 历史布局仅在棋盘像素一致且有实机胜利证据时复用，仍须求解重放。
            const middleResult = join(this.sessionDir, 'middle-review.json');
            await this.processRunner('python3', ['scripts/pig-nav-middle.py', '--evidence', state.evidence,
              '--level', String(this.level), '--archive', this.evidenceRoot, '--output', middleResult], { cwd: this.gameRoot });
            const middle = await readJson(middleResult);
            if (middle.status === 'local_cage') {
              // 笼外阶段由已有求解器逐批重放和核对；一旦开始，异常必须先重新采集，绝不重放。
              if (!this.allowExecution) return { ...await this.status('本地铁笼阶段执行未启用'), executionDisabled: true };
              const marker = join(this.sessionDir, 'execution-started.json');
              if (await exists(marker)) return { ...await this.status('上次本地阶段可能已改变棋盘，需核实现场后新建会话'), executionUncertain: true };
              await writeFile(marker, JSON.stringify({ level: this.level, kind: 'local_cage' }) + '\n', { flag: 'wx' });
              const output = join(this.sessionDir, 'execution');
              try {
                if (typeof this.activate !== 'function') throw new Error('window activation is not configured');
                await this.activate();
                await this.processRunner('python3', ['scripts/pig-nav-cage.py', '--evidence', state.evidence,
                  '--image-sha256', captureRecord.data.sha256, '--level', String(this.level),
                  '--window-id', this.windowId, '--display', this.display, '--output', output], { cwd: this.gameRoot });
                const feedback = await readJson(join(output, 'result.json'));
                if (feedback.status !== 'victory' || !(await exists(join(output, 'victory.png')))) throw new Error('胜利未得到截图确认');
              } catch (error) {
                return { ...await this.status('本地阶段执行未确认，需重新采集现场：' + error.message), executionUncertain: true };
              }
              await mark('review', { source: 'local_cage' });
              await mark('solve', { source: 'local_cage' });
              await mark('execute', { result: join(output, 'result.json') });
              await mark('victory', { screenshot: join(output, 'victory.png') });
              return await this.status();
            }
            if (middle.status !== 'reviewed' || !middle.layout) return await this.status(middle.reason || '中层无法确认布局');
            await writeFile(layout, JSON.stringify(middle.layout) + '\n', { flag: 'wx' });
          } else return await this.status('当前布局和机制尚未复核');
        }
        // 求解脚本核对首屏摘要、复核标志及机制；成功以前不记录复核完成。
      }
      const plan = join(this.sessionDir, 'plan.json');
      const reviewed = await readJson(layout);
      if (reviewed.stage_mode === 'conservative_cage') {
        if (!(await done('solve'))) {
          await this.processRunner('python3', ['scripts/pig-nav-reviewed-cage.py', '--layout', layout,
            '--image', image, '--level', String(this.level), '--output', plan], { cwd: this.gameRoot });
          const result = await readJson(plan);
          if (result.status !== 'partial' || result.navigation?.stage !== 'conservative_cage'
              || result.navigation?.strategy !== 'auto' || result.navigation?.replayed !== true) throw new Error('保守阶段未通过独立重放');
          await mark('review', { layout });
          await mark('solve', { sha256: createHash('sha256').update(await readFile(plan)).digest('hex') });
        }
        const savedPlan = await this.manager.progressStore.get(steps.solve);
        if (savedPlan.data?.sha256 !== createHash('sha256').update(await readFile(plan)).digest('hex')) throw new Error('求解计划已改变');
        const marker = join(this.sessionDir, 'execution-started.json');
        const output = join(this.sessionDir, 'execution');
        if (await exists(marker)) {
          const result = await exists(join(output, 'result.json')) ? await readJson(join(output, 'result.json')) : null;
          if (result?.status === 'stage_complete') return { ...await this.status('本地阶段已完成，需重新采集剩余现场'), stageComplete: true };
          return { ...await this.status('上次本地阶段可能已改变棋盘，需核实现场后新建会话'), executionUncertain: true };
        }
        if (!this.allowExecution) return await this.status('执行未启用');
        await writeFile(marker, JSON.stringify({ level: this.level, kind: 'conservative_cage' }) + '\n', { flag: 'wx' });
        try {
          if (typeof this.activate !== 'function') throw new Error('window activation is not configured');
          await this.activate();
          await this.processRunner('python3', ['scripts/pig-nav-reviewed-cage.py', '--layout', layout, '--image', image,
            '--plan', plan, '--level', String(this.level), '--window-id', this.windowId,
            '--display', this.display, '--output', output, '--execute'], { cwd: this.gameRoot });
          const result = await readJson(join(output, 'result.json'));
          if (result.status !== 'stage_complete') throw new Error('本地阶段未确认完成');
          return { ...await this.status('本地阶段已完成，需重新采集剩余现场'), stageComplete: true };
        } catch (error) {
          return { ...await this.status('本地阶段执行未确认，需重新采集现场：' + error.message), executionUncertain: true };
        }
      }
      if (!(await done('solve'))) {
        await this.processRunner('python3', ['scripts/pig-nav-plan.py', '--layout', layout, '--image', image,
          '--level', String(this.level), '--output', plan], { cwd: this.gameRoot });
        const result = await readJson(plan);
        const bytes = await readFile(plan);
        if (result.status !== 'solved' || result.navigation?.strategy !== 'auto' || result.navigation?.replayed !== true) throw new Error('完整计划未通过验证');
        await mark('review', { layout });
        await mark('solve', { sha256: createHash('sha256').update(bytes).digest('hex') });
      }
      if (!this.allowExecution) return await this.status('执行未启用');
      const plannedBombs = (await readJson(plan)).bombs;
      if (plannedBombs && Object.keys(plannedBombs).length) {
        return await this.status('炸弹猪的实机画面核对尚未实现，禁止执行');
      }
      if (!(await done('execute'))) {
        const savedPlan = await this.manager.progressStore.get(steps.solve);
        if (savedPlan.data?.sha256 !== createHash('sha256').update(await readFile(plan)).digest('hex')) throw new Error('求解计划已改变');
        const marker = join(this.sessionDir, 'execution-started.json');
        if (await exists(marker)) return await this.status('上次执行可能已改变棋盘，需核实现场后新建会话');
        await writeFile(marker, JSON.stringify({ level: this.level }) + '\n', { flag: 'wx' });
        if (typeof this.activate !== 'function') throw new Error('window activation is not configured');
        await this.activate();
        const output = join(this.sessionDir, 'execution');
        await this.processRunner('python3', ['scripts/pig-nav-execute.py', '--plan', plan, '--layout', layout, '--image', image,
          '--level', String(this.level), '--window-id', this.windowId, '--display', this.display, '--output', output], { cwd: this.gameRoot });
        const feedback = await readJson(join(output, 'result.json'));
        if (feedback.status !== 'victory' || !(await exists(join(output, 'victory.png')))) throw new Error('胜利未得到截图确认');
        await mark('execute', { result: join(output, 'result.json') });
        await mark('victory', { screenshot: join(output, 'victory.png') });
      }
      state = await this.status();
      return state;
    } catch (error) {
      if (!this.manager) throw error;
      return await this.status(error.message);
    } finally {
      this.busy = false;
    }
  }
}

function runProcess(command, args, { cwd }) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { text = (text + chunk).slice(-4000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 900000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveResult({ code, text });
      else reject(new Error(`游戏任务失败 (${code ?? signal})：${text.trim()}`));
    });
  });
}

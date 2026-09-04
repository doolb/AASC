import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { AdbClient } from './adb/adb-client.js';
import { GameFlowLoader } from './flow/game-flow-loader.js';
import { ProgressStore } from './runtime/progress-store.js';
import { TargetAutomationLoop } from './runtime/target-automation-loop.js';
import { RecordStore } from './runtime/record-store.js';
import { OpenCvImageMatcher } from './vision/image-matcher.js';
import { OcrClient } from './vision/ocr-client.js';
import { captureTemplate, inspectFlow, recordPath } from './tools/capture-tool.js';
import {
    checkNavigationPackage,
    resolveNavigationPackageChain,
} from './tools/navigation-check.js';
import { createNavigationHttpService } from './server/navigation-http-service.js';
import { loadLocalYoloDetector } from './vision/local-yolo.js';
export class CliUsageError extends Error {
}
const parseInteger = (value, option, fallback) => {
    if (value === undefined) {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new CliUsageError(`--${option} must be a non-negative integer`);
    }
    return parsed;
};
const parseOcrShortSide = (value) => {
    if (value === undefined) {
        return undefined;
    }
    const parsed = Number(value);
    if (parsed !== 0 && (!Number.isInteger(parsed) || parsed < 256 || parsed > 2048)) {
        throw new CliUsageError('--ocr-short-side must be 0 or an integer from 256 to 2048');
    }
    return parsed;
};
const optionalString = (values, name) => {
    const value = values[name];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};
const requireString = (values, name) => {
    const value = values[name];
    if (typeof value !== 'string' || !value.trim()) {
        throw new CliUsageError(`missing --${name}`);
    }
    return value.trim();
};
const parseMatcher = (value) => {
    if (value === undefined || value === 'template' || value === 'orb') {
        return value ?? 'template';
    }
    throw new CliUsageError(`--matcher must be template or orb: ${value}`);
};
const parseRegion = (value) => {
    if (value === undefined) {
        return undefined;
    }
    const parts = value.split(',');
    if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
        throw new CliUsageError('--region must be x,y,width,height');
    }
    const [x, y, width, height] = parts.map((part) => Number(part));
    if (width <= 0 || height <= 0) {
        throw new CliUsageError('--region width and height must be positive');
    }
    return { x, y, width, height };
};
const parseArguments = (args) => {
    if (args.length === 0) {
        throw new CliUsageError('missing command: start, capture, record, inspect, nav-check or nav-chain');
    }
    try {
        const parsed = parseArgs({
            args: args.slice(1),
            allowPositionals: true,
            strict: true,
            options: {
                device: { type: 'string' },
                game: { type: 'string' },
                target: { type: 'string' },
                feature: { type: 'string' },
                flow: { type: 'string' },
                'flows-root': { type: 'string' },
                'flow-root': { type: 'string' },
                'progress-root': { type: 'string' },
                interval: { type: 'string' },
                matcher: { type: 'string' },
                'dry-run': { type: 'boolean' },
                once: { type: 'boolean' },
                'max-transitions': { type: 'string' },
                'ocr-url': { type: 'string' },
                'ocr-short-side': { type: 'string' },
                name: { type: 'string' },
                region: { type: 'string' },
                'record-file': { type: 'string' },
                file: { type: 'string' },
                'goal-id': { type: 'string' },
                state: { type: 'string' },
                port: { type: 'string' },
                'navmesh-root': { type: 'string' },
                'yolo-models': { type: 'string' },
            },
        });
        const command = args[0];
        if (parsed.positionals.length > 0) {
            throw new CliUsageError(`unexpected positional argument: ${parsed.positionals[0]}`);
        }
        return { command, values: parsed.values };
    }
    catch (error) {
        if (error instanceof CliUsageError) {
            throw error;
        }
        throw new CliUsageError(error instanceof Error ? error.message : String(error));
    }
};
/** 将命令行参数解析为可测试的类型化配置，不在解析阶段访问设备。 */
export const parseCli = (args) => {
    const { command, values } = parseArguments(args);
    const flowsRoot = resolve(typeof values['flows-root'] === 'string' ? values['flows-root'] : 'flows');
    if (command === 'start') {
        const device = values.device;
        const game = values.game;
        const target = values.target;
        if (typeof device !== 'string' || !device.trim()
            || typeof game !== 'string' || !game.trim()
            || typeof target !== 'string' || !target.trim()) {
            throw new CliUsageError('start requires --device, --game and --target');
        }
        return {
            command,
            device: device.trim(),
            game: game.trim(),
            target: target.trim(),
            flowsRoot,
            progressRoot: resolve(typeof values['progress-root'] === 'string' ? values['progress-root'] : 'progress'),
            interval: parseInteger(typeof values.interval === 'string' ? values.interval : undefined, 'interval', 500),
            matcher: parseMatcher(typeof values.matcher === 'string' ? values.matcher : undefined),
            dryRun: values['dry-run'] === true,
            once: values.once === true,
            maxTransitions: parseInteger(typeof values['max-transitions'] === 'string' ? values['max-transitions'] : undefined, 'max-transitions', 100),
            ocrUrl: optionalString(values, 'ocr-url'),
            ocrShortSide: parseOcrShortSide(typeof values['ocr-short-side'] === 'string' ? values['ocr-short-side'] : undefined),
        };
    }
    if (command === 'capture') {
        const device = values.device;
        const game = values.game;
        const feature = values.feature;
        const flow = values.flow;
        const name = values.name;
        const flowRoot = optionalString(values, 'flow-root');
        if (typeof device !== 'string' || !device.trim()
            || typeof flow !== 'string' || !flow.trim()
            || typeof name !== 'string' || !name.trim()) {
            throw new CliUsageError('capture requires --device, --flow, and --name');
        }
        if (!flowRoot && (typeof game !== 'string' || !game.trim()
            || typeof feature !== 'string' || !feature.trim())) {
            throw new CliUsageError('capture requires --game and --feature unless --flow-root is provided');
        }
        return {
            command,
            device: device.trim(),
            game: typeof game === 'string' && game.trim() ? game.trim() : undefined,
            feature: typeof feature === 'string' && feature.trim() ? feature.trim() : undefined,
            flow: flow.trim(),
            name: name.trim(),
            flowsRoot,
            flowRoot: flowRoot ? resolve(flowRoot) : undefined,
            region: parseRegion(typeof values.region === 'string' ? values.region : undefined),
        };
    }
    if (command === 'inspect') {
        const device = values.device;
        const game = values.game;
        const feature = values.feature;
        const flow = values.flow;
        if (typeof device !== 'string' || !device.trim()
            || typeof game !== 'string' || !game.trim()
            || typeof feature !== 'string' || !feature.trim()
            || typeof flow !== 'string' || !flow.trim()) {
            throw new CliUsageError('inspect requires --device, --game, --feature and --flow');
        }
        return {
            command,
            device: device.trim(),
            game: game.trim(),
            feature: feature.trim(),
            flow: flow.trim(),
            flowsRoot,
            matcher: parseMatcher(typeof values.matcher === 'string' ? values.matcher : undefined),
        };
    }
    if (command === 'record') {
        const recordFile = values['record-file'] ?? values.file;
        return {
            command,
            recordFile: typeof recordFile === 'string' && recordFile.trim()
                ? resolve(recordFile.trim())
                : resolve('logs/record.jsonl'),
        };
    }
    if (command === 'nav-check') {
        return {
            command,
            file: resolve(requireString(values, 'file')),
        };
    }
    if (command === 'nav-chain') {
        const stateText = optionalString(values, 'state');
        let state = {};
        if (stateText) {
            try {
                state = JSON.parse(stateText);
            }
            catch (error) {
                throw new CliUsageError('--state must be valid JSON');
            }
            if (typeof state !== 'object' || state === null || Array.isArray(state)) {
                throw new CliUsageError('--state must be a JSON object');
            }
        }
        return {
            command,
            file: resolve(requireString(values, 'file')),
            goalId: requireString(values, 'goal-id'),
            state,
        };
    }
    if (command === 'nav-serve') {
        const port = parseInteger(
            typeof values.port === 'string' ? values.port : undefined,
            'port',
            8787,
        );
        if (port > 65535) {
            throw new CliUsageError('--port must be between 0 and 65535');
        }
        return {
            command,
            port,
            navmeshRoot: resolve(
                typeof values['navmesh-root'] === 'string' ? values['navmesh-root'] : 'navmesh',
            ),
            yoloModels: optionalString(values, 'yolo-models'),
        };
    }
    throw new CliUsageError(`unknown command: ${command}`);
};
const createAutomationOptions = (options, signal) => ({
    intervalMs: options.interval,
    matcher: options.matcher,
    dryRun: options.dryRun,
    once: options.once,
    maxTransitions: options.maxTransitions,
    signal,
});
export const runCli = async (options) => {
    if (options.command === 'record') {
        const paths = await recordPath(new RecordStore(options.recordFile));
        for (const path of paths) {
            console.log(path);
        }
        return;
    }
    if (options.command === 'nav-check') {
        const report = await checkNavigationPackage(options.file);
        console.log(JSON.stringify(report));
        return;
    }
    if (options.command === 'nav-chain') {
        const report = await checkNavigationPackage(options.file);
        const chain = await resolveNavigationPackageChain(options.file, options.goalId, options.state);
        console.log(JSON.stringify({
            packageId: report.packageId,
            diagnostics: report.diagnostics,
            staticGraph: report.staticGraph,
            runtimeChain: chain,
        }));
        return;
    }
    if (options.command === 'nav-serve') {
        const yoloDetector = options.yoloModels
            ? await loadLocalYoloDetector(options.yoloModels)
            : undefined;
        const server = createNavigationHttpService({
            navMeshRoot: options.navmeshRoot,
            yoloDetector,
        });
        const controller = new AbortController();
        const onInterrupt = () => {
            controller.abort();
            server.close();
        };
        process.once('SIGINT', onInterrupt);
        try {
            await new Promise((resolvePromise, reject) => {
                server.once('error', reject);
                server.listen(options.port, '0.0.0.0', () => {
                    const address = server.address();
                    const boundPort = typeof address === 'object' && address ? address.port : options.port;
                    console.log(JSON.stringify({ service: 'navigation', port: boundPort }));
                    resolvePromise();
                });
            });
            await new Promise((resolvePromise) => {
                if (controller.signal.aborted) {
                    resolvePromise();
                    return;
                }
                server.once('close', resolvePromise);
            });
        }
        finally {
            process.off('SIGINT', onInterrupt);
            if (server.listening) server.close();
        }
        return;
    }
    const adb = new AdbClient({ serial: options.device });
    await adb.assertConnected();
    if (options.command === 'capture') {
        if (!options.flowRoot && (!options.game || !options.feature)) {
            throw new CliUsageError('capture requires a flow root');
        }
        const output = await captureTemplate({
            adb,
            flowsRoot: options.flowRoot
                ?? join(options.flowsRoot, options.game, options.feature, 'flow'),
            flowId: options.flow,
            name: options.name,
            region: options.region,
        });
        console.log(output);
        return;
    }
    const loader = new GameFlowLoader({ flowsRoot: options.flowsRoot, gameId: options.game });
    const matcher = new OpenCvImageMatcher();
    if (options.command === 'inspect') {
        const report = await inspectFlow({
            adb,
            loader,
            matcher,
            flowId: options.flow,
            method: options.matcher,
        });
        console.log(JSON.stringify(report));
        return;
    }
    const target = await loader.loadTarget(options.target);
    const ocrClient = new OcrClient({
        baseUrl: options.ocrUrl,
        shortSide: options.ocrShortSide,
    });
    const controller = new AbortController();
    const onInterrupt = () => controller.abort();
    process.once('SIGINT', onInterrupt);
    try {
        await new TargetAutomationLoop({
            adb,
            gameId: options.game,
            repository: loader,
            target,
            progressStore: new ProgressStore({ rootDir: options.progressRoot }),
            matcher,
            ocrClient,
            options: createAutomationOptions(options, controller.signal),
            logger: (result) => console.log(JSON.stringify(result)),
        }).run();
    }
    finally {
        process.off('SIGINT', onInterrupt);
    }
};
export const main = async (args = process.argv.slice(2)) => {
    try {
        await runCli(parseCli(args));
        return 0;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        return error instanceof CliUsageError ? 2 : 1;
    }
};
const currentFile = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFile && currentFile === resolve(fileURLToPath(import.meta.url))) {
    main().then((exitCode) => {
        process.exitCode = exitCode;
    }).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

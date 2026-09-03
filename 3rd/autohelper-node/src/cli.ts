import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { AdbClient } from './adb/adb-client.js';
import { FlowLoader } from './flow/flow-loader.js';
import type { AutomationOptions, MatchMethod, Rect } from './types.js';
import { AutomationLoop } from './runtime/automation-loop.js';
import { RecordStore } from './runtime/record-store.js';
import { OpenCvImageMatcher } from './vision/image-matcher.js';
import { OcrClient } from './vision/ocr-client.js';
import { captureTemplate, inspectFlow, recordPath } from './tools/capture-tool.js';

export class CliUsageError extends Error {}

type CommonCliOptions = {
  flowsRoot: string;
};

export type StartCliOptions = CommonCliOptions & {
  command: 'start';
  device: string;
  flow: string;
  interval: number;
  matcher: MatchMethod;
  dryRun: boolean;
  once: boolean;
  maxTransitions: number;
  ocrUrl?: string;
  ocrShortSide?: number;
};

export type CaptureCliOptions = CommonCliOptions & {
  command: 'capture';
  device: string;
  flow: string;
  name: string;
  region?: Rect;
};

export type InspectCliOptions = CommonCliOptions & {
  command: 'inspect';
  device: string;
  flow: string;
  matcher: MatchMethod;
};

export type RecordCliOptions = {
  command: 'record';
  recordFile: string;
};

export type CliOptions = StartCliOptions | CaptureCliOptions | InspectCliOptions | RecordCliOptions;

type ParsedValues = Record<string, string | boolean | undefined>;

const parseInteger = (value: string | undefined, option: string, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliUsageError(`--${option} must be a non-negative integer`);
  }
  return parsed;
};

const parseOcrShortSide = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (parsed !== 0 && (!Number.isInteger(parsed) || parsed < 256 || parsed > 2048)) {
    throw new CliUsageError('--ocr-short-side must be 0 or an integer from 256 to 2048');
  }
  return parsed;
};

const optionalString = (values: ParsedValues, name: string): string | undefined => {
  const value = values[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const requireString = (values: ParsedValues, name: string): string => {
  const value = values[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new CliUsageError(`missing --${name}`);
  }
  return value.trim();
};

const parseMatcher = (value: string | undefined): MatchMethod => {
  if (value === undefined || value === 'template' || value === 'orb') {
    return value ?? 'template';
  }
  throw new CliUsageError(`--matcher must be template or orb: ${value}`);
};

const parseRegion = (value: string | undefined): Rect | undefined => {
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

const parseArguments = (args: string[]): { command: string; values: ParsedValues } => {
  if (args.length === 0) {
    throw new CliUsageError('missing command: start, capture, record or inspect');
  }

  try {
    const parsed = parseArgs({
      args: args.slice(1),
      allowPositionals: true,
      strict: true,
      options: {
        device: { type: 'string' },
        flow: { type: 'string' },
        'flows-root': { type: 'string' },
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
      },
    });
    const command = args[0];
    if (parsed.positionals.length > 0) {
      throw new CliUsageError(`unexpected positional argument: ${parsed.positionals[0]}`);
    }
    return { command, values: parsed.values as ParsedValues };
  } catch (error: unknown) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
};

/** 将命令行参数解析为可测试的类型化配置，不在解析阶段访问设备。 */
export const parseCli = (args: string[]): CliOptions => {
  const { command, values } = parseArguments(args);
  const flowsRoot = resolve(typeof values['flows-root'] === 'string' ? values['flows-root'] : 'flows');

  if (command === 'start') {
    const device = values.device;
    const flow = values.flow;
    if (typeof device !== 'string' || !device.trim() || typeof flow !== 'string' || !flow.trim()) {
      throw new CliUsageError('start requires --device and --flow');
    }
    return {
      command,
      device: device.trim(),
      flow: flow.trim(),
      flowsRoot,
      interval: parseInteger(typeof values.interval === 'string' ? values.interval : undefined, 'interval', 500),
      matcher: parseMatcher(typeof values.matcher === 'string' ? values.matcher : undefined),
      dryRun: values['dry-run'] === true,
      once: values.once === true,
      maxTransitions: parseInteger(
        typeof values['max-transitions'] === 'string' ? values['max-transitions'] : undefined,
        'max-transitions',
        100,
      ),
      ocrUrl: optionalString(values, 'ocr-url'),
      ocrShortSide: parseOcrShortSide(
        typeof values['ocr-short-side'] === 'string' ? values['ocr-short-side'] : undefined,
      ),
    };
  }

  if (command === 'capture') {
    const device = values.device;
    const flow = values.flow;
    const name = values.name;
    if (typeof device !== 'string' || !device.trim()
      || typeof flow !== 'string' || !flow.trim()
      || typeof name !== 'string' || !name.trim()) {
      throw new CliUsageError('capture requires --device, --flow and --name');
    }
    return {
      command,
      device: device.trim(),
      flow: flow.trim(),
      name: name.trim(),
      flowsRoot,
      region: parseRegion(typeof values.region === 'string' ? values.region : undefined),
    };
  }

  if (command === 'inspect') {
    const device = values.device;
    const flow = values.flow;
    if (typeof device !== 'string' || !device.trim() || typeof flow !== 'string' || !flow.trim()) {
      throw new CliUsageError('inspect requires --device and --flow');
    }
    return {
      command,
      device: device.trim(),
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

  throw new CliUsageError(`unknown command: ${command}`);
};

const createAutomationOptions = (
  options: StartCliOptions,
  signal: AbortSignal,
): Partial<AutomationOptions> => ({
  intervalMs: options.interval,
  matcher: options.matcher,
  dryRun: options.dryRun,
  once: options.once,
  maxTransitions: options.maxTransitions,
  signal,
});

export const runCli = async (options: CliOptions): Promise<void> => {
  if (options.command === 'record') {
    const paths = await recordPath(new RecordStore(options.recordFile));
    for (const path of paths) {
      console.log(path);
    }
    return;
  }

  const adb = new AdbClient({ serial: options.device });
  await adb.assertConnected();

  if (options.command === 'capture') {
    const output = await captureTemplate({
      adb,
      flowsRoot: options.flowsRoot,
      flowId: options.flow,
      name: options.name,
      region: options.region,
    });
    console.log(output);
    return;
  }

  const loader = new FlowLoader({ flowsRoot: options.flowsRoot });
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

  await loader.load(options.flow);
  const ocrClient = new OcrClient({
    baseUrl: options.ocrUrl,
    shortSide: options.ocrShortSide,
  });
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort();
  process.once('SIGINT', onInterrupt);
  try {
    await new AutomationLoop({
      adb,
      loader,
      matcher,
      ocrClient,
      options: createAutomationOptions(options, controller.signal),
      logger: (result) => console.log(JSON.stringify(result)),
    }).run();
  } finally {
    process.off('SIGINT', onInterrupt);
  }
};

export const main = async (args: string[] = process.argv.slice(2)): Promise<number> => {
  try {
    await runCli(parseCli(args));
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return error instanceof CliUsageError ? 2 : 1;
  }
};

const currentFile = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFile && currentFile === resolve(fileURLToPath(import.meta.url))) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

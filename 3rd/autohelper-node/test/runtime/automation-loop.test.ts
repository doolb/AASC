import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type {
  AdbClientLike,
  FlowContext,
  ImageDescriptor,
  LoadedTemplate,
  MatchResult,
  OcrResult,
} from '../../src/types.js';
import { AutomationLoop } from '../../src/runtime/automation-loop.js';

const screenshot = (): Buffer => {
  const image = new PNG({ width: 100, height: 100 });
  image.data.fill(0);
  for (let offset = 3; offset < image.data.length; offset += 4) {
    image.data[offset] = 255;
  }
  return PNG.sync.write(image);
};

const descriptor = (name: string, options: Partial<ImageDescriptor> = {}): ImageDescriptor => ({
  name,
  flowId: 'launch',
  filePath: `/tmp/${name}.png`,
  queue: 0,
  threshold: 0.9,
  clickPoint: { x: 0.5, y: 0.5 },
  centerClick: false,
  delayMs: 0,
  loop: true,
  wait: false,
  defaultCandidate: false,
  ...options,
});

const matched = (): MatchResult => ({
  score: 0.99,
  rect: { x: 0, y: 0, width: 100, height: 100 },
  matched: true,
  method: 'template',
});

const context = (flowId: string, image: ImageDescriptor): FlowContext => {
  const flowImage = { ...image, flowId, filePath: `/tmp/${flowId}/${image.name}.png` };
  const template: LoadedTemplate = { descriptor: flowImage, buffer: Buffer.from('template') };
  return {
    id: flowId,
    directory: `/tmp/${flowId}`,
    descriptors: [flowImage],
    templates: [template],
  };
};

class FakeAdb implements AdbClientLike {
  public readonly taps: Array<{ x: number; y: number }> = [];

  public async assertConnected(): Promise<void> {}

  public async screenshot(): Promise<Buffer> {
    return screenshot();
  }

  public async tap(x: number, y: number): Promise<void> {
    this.taps.push({ x, y });
  }
}

class FakeLoader {
  public currentId: string;
  private activeContext: FlowContext;

  public constructor(private readonly contexts: Record<string, FlowContext>, initialId: string) {
    this.currentId = initialId;
    this.activeContext = contexts[initialId];
  }

  public current(): FlowContext {
    return this.activeContext;
  }

  public async switchTo(flowId: string): Promise<FlowContext> {
    this.activeContext = this.contexts[flowId];
    this.currentId = flowId;
    return this.activeContext;
  }
}

const createLoop = (
  adb: FakeAdb,
  loader: FakeLoader,
  options: Partial<NonNullable<ConstructorParameters<typeof AutomationLoop>[0]['options']>> = {},
): AutomationLoop => new AutomationLoop({
  adb,
  loader,
  matcher: { matchAll: async () => loader.current().templates.map(() => matched()) },
  options,
  sleep: async () => {},
});

describe('AutomationLoop', () => {
  it('clicks a matched action and switches to its goto flow', async () => {
    const adb = new FakeAdb();
    const loader = new FakeLoader({
      launch: context('launch', descriptor('enter', { gotoFlow: 'home' })),
      home: context('home', descriptor('daily')),
    }, 'launch');
    const loop = createLoop(adb, loader, { intervalMs: 0 });

    const result = await loop.tick();

    expect(adb.taps).toEqual([{ x: 50, y: 50 }]);
    expect(loader.currentId).toBe('home');
    expect(result.gotoFlow).toBe('home');
  });

  it('does not click or goto for a wait action', async () => {
    const adb = new FakeAdb();
    const loader = new FakeLoader({
      launch: context('launch', descriptor('wait', { wait: true, gotoFlow: 'home' })),
      home: context('home', descriptor('daily')),
    }, 'launch');
    const loop = createLoop(adb, loader);

    const result = await loop.tick();

    expect(adb.taps).toEqual([]);
    expect(loader.currentId).toBe('launch');
    expect(result.reason).toBe('wait');
  });

  it('dry-run reports a tap without sending it', async () => {
    const adb = new FakeAdb();
    const loader = new FakeLoader({ launch: context('launch', descriptor('button')) }, 'launch');
    const loop = createLoop(adb, loader, { intervalMs: 0, dryRun: true });

    const result = await loop.tick();

    expect(adb.taps).toEqual([]);
    expect(result.reason).toBe('dry-run');
  });

  it('records the destination Flow after a successful goto', async () => {
    const adb = new FakeAdb();
    const loader = new FakeLoader({
      launch: context('launch', descriptor('enter', { gotoFlow: 'home' })),
      home: context('home', descriptor('daily')),
    }, 'launch');
    const records: Array<Record<string, unknown>> = [];
    const loop = new AutomationLoop({
      adb,
      loader,
      matcher: { matchAll: async () => [matched()] },
      options: { intervalMs: 0 },
      sleep: async () => {},
      recordStore: { append: async (entry) => { records.push(entry); } },
    });

    await loop.tick();

    expect(records[0]?.gotoFlow).toBe('home');
  });

  it('stops when transition limit is reached', async () => {
    const adb = new FakeAdb();
    const loader = new FakeLoader({
      a: context('a', descriptor('to-b', { gotoFlow: 'b' })),
      b: context('b', descriptor('to-a', { gotoFlow: 'a' })),
    }, 'a');
    const loop = createLoop(adb, loader, { intervalMs: 0, maxTransitions: 2 });

    await expect(loop.run()).rejects.toThrow('maximum flow transitions exceeded');
  });

  it('requests OCR once per tick and filters OCR-constrained actions', async () => {
    const adb = new FakeAdb();
    const ocrAction = descriptor('ocr-button', { ocrText: '放弃福利', queue: 10 });
    const fallbackAction = descriptor('fallback');
    const flowImages = [ocrAction, fallbackAction].map((image) => ({
      ...image,
      filePath: `/tmp/launch/${image.name}.png`,
    }));
    const loader = new FakeLoader({
      launch: {
        id: 'launch',
        directory: '/tmp/launch',
        descriptors: flowImages,
        templates: flowImages.map((image) => ({ descriptor: image, buffer: Buffer.from('template') })),
      },
    }, 'launch');
    const ocrResult: OcrResult = {
      boxes: [{ text: '确认：放弃福利', points: [] }],
    };
    let ocrCalls = 0;
    const loop = new AutomationLoop({
      adb,
      loader,
      matcher: { matchAll: async () => [matched(), matched()] },
      ocrClient: {
        recognize: async () => {
          ocrCalls += 1;
          return ocrResult;
        },
      },
      options: { intervalMs: 0 },
      sleep: async () => {},
    });

    const result = await loop.tick();

    expect(ocrCalls).toBe(1);
    expect(result.actionName).toBe('ocr-button');
    expect(adb.taps).toEqual([{ x: 50, y: 50 }]);
  });

  it('skips the tick without clicking when OCR is unavailable', async () => {
    const adb = new FakeAdb();
    const loader = new FakeLoader({
      launch: context('launch', descriptor('ocr-button', { ocrText: '放弃福利' })),
    }, 'launch');
    const loop = new AutomationLoop({
      adb,
      loader,
      matcher: { matchAll: async () => [matched()] },
      ocrClient: {
        recognize: async () => {
          throw new Error('OCR service unavailable');
        },
      },
      options: { intervalMs: 0 },
      sleep: async () => {},
    });

    const result = await loop.tick();

    expect(result.reason).toBe('ocr-error');
    expect(adb.taps).toEqual([]);
  });
});

import { decodeImage } from '../vision/image-decoder.js';
import type { ImageMatcher } from '../vision/image-matcher.js';
import { resolveClickPoint, selectAction } from './action-selector.js';
import type { RecordEntry, RecordStore } from './record-store.js';
import type {
  AdbClientLike,
  AutomationOptions,
  FlowContext,
  MatchCandidate,
  MatchResult,
  Point,
  SelectedAction,
} from '../types.js';

type FlowLoaderLike = {
  current(): FlowContext;
  switchTo(flowId: string): Promise<FlowContext>;
};

type SelectorLike = {
  selectAction(candidates: MatchCandidate[], allMatches: Map<string, MatchResult>): SelectedAction | null;
  resolveClickPoint: typeof resolveClickPoint;
};

type Sleep = (milliseconds: number) => Promise<void>;

export type AutomationLoopOptions = {
  adb: AdbClientLike;
  loader: FlowLoaderLike;
  matcher: Pick<ImageMatcher, 'matchAll'>;
  selector?: SelectorLike;
  options?: Partial<AutomationOptions>;
  sleep?: Sleep;
  recordStore?: Pick<RecordStore, 'append'>;
  logger?: (result: TickResult) => void;
};

export type TickReason = 'no-match' | 'cooldown' | 'wait' | 'dry-run' | 'clicked';

export type TickResult = {
  flowId: string;
  actionName?: string;
  clicked: boolean;
  point?: Point;
  gotoFlow?: string;
  reason: TickReason;
};

type ResolvedOptions = {
  intervalMs: number;
  matcher: AutomationOptions['matcher'];
  dryRun: boolean;
  once: boolean;
  maxTransitions: number;
  signal?: AbortSignal;
};

const defaultSelector: SelectorLike = {
  selectAction,
  resolveClickPoint,
};

const defaultSleep: Sleep = async (milliseconds) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const resolveOptions = (options: Partial<AutomationOptions> = {}): ResolvedOptions => ({
  intervalMs: options.intervalMs ?? 500,
  matcher: options.matcher ?? 'template',
  dryRun: options.dryRun ?? false,
  once: options.once ?? false,
  maxTransitions: options.maxTransitions ?? 100,
  signal: options.signal,
});

export class AutomationLoop {
  private readonly options: ResolvedOptions;
  private readonly selector: SelectorLike;
  private readonly sleep: Sleep;
  private readonly recordStore?: Pick<RecordStore, 'append'>;
  private readonly logger?: (result: TickResult) => void;
  private transitionCount = 0;
  private suppressedActionName: string | undefined;

  public constructor(private readonly dependencies: AutomationLoopOptions) {
    this.options = resolveOptions(dependencies.options);
    this.selector = dependencies.selector ?? defaultSelector;
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.recordStore = dependencies.recordStore;
    this.logger = dependencies.logger;
    if (!Number.isInteger(this.options.intervalMs) || this.options.intervalMs < 0) {
      throw new Error('invalid automation interval');
    }
    if (!Number.isInteger(this.options.maxTransitions) || this.options.maxTransitions < 0) {
      throw new Error('invalid maximum flow transitions');
    }
  }

  public async run(): Promise<void> {
    try {
      await this.dependencies.adb.assertConnected();
      while (!this.options.signal?.aborted) {
        await this.tick();
        if (this.options.once) {
          return;
        }
        if (!this.options.signal?.aborted) {
          await this.sleep(this.options.intervalMs);
        }
      }
    } catch (error: unknown) {
      let flowId = 'unknown';
      try {
        flowId = this.dependencies.loader.current().id;
      } catch {
        // 如果 Flow 尚未加载，保留 unknown 作为上下文。
      }
      throw new Error(`automation loop failed in flow ${flowId}: ${errorMessage(error)}`, { cause: error });
    }
  }

  public async tick(): Promise<TickResult> {
    let flowId = 'unknown';
    try {
      const context = this.dependencies.loader.current();
      flowId = context.id;
      const frame = await this.dependencies.adb.screenshot();
      const matches = await this.dependencies.matcher.matchAll(
        frame,
        context.templates,
        this.options.matcher,
      );
      const allMatches = new Map<string, MatchResult>();
      const candidates: MatchCandidate[] = context.templates.map((template, index) => {
        const match = matches[index] ?? unmatched(this.options.matcher);
        allMatches.set(template.descriptor.name, match);
        return { descriptor: template.descriptor, match };
      });

      const suppressed = this.suppressedActionName
        ? candidates.find((candidate) => candidate.descriptor.name === this.suppressedActionName)
        : undefined;
      const availableCandidates = candidates.filter((candidate) => (
        candidate.descriptor.name !== this.suppressedActionName
      ));
      const action = this.selector.selectAction(availableCandidates, allMatches);
      if (!action) {
        if (!suppressed?.match.matched) {
          this.suppressedActionName = undefined;
        }
        return this.emit({ flowId, clicked: false, reason: suppressed ? 'cooldown' : 'no-match' });
      }

      this.suppressedActionName = undefined;
      if (action.descriptor.wait) {
        const result = { flowId, actionName: action.descriptor.name, clicked: false, reason: 'wait' as const };
        await this.record(result);
        return this.emit(result);
      }

      const decodedFrame = decodeImage(frame, 'adb-screenshot.png');
      const point = this.selector.resolveClickPoint(
        action.descriptor,
        action.match.rect as NonNullable<typeof action.match.rect>,
        { width: decodedFrame.width, height: decodedFrame.height },
      );

      if (this.options.dryRun) {
        const result = {
          flowId,
          actionName: action.descriptor.name,
          clicked: false,
          point,
          reason: 'dry-run' as const,
        };
        await this.record(result);
        if (action.descriptor.delayMs > 0) {
          await this.sleep(action.descriptor.delayMs);
        }
        return this.emit(result);
      }

      await this.dependencies.adb.tap(point.x, point.y);
      const result: TickResult = {
        flowId,
        actionName: action.descriptor.name,
        clicked: true,
        point,
        reason: 'clicked',
      };
      if (action.descriptor.delayMs > 0) {
        await this.sleep(action.descriptor.delayMs);
      }
      this.suppressedActionName = action.descriptor.loop ? undefined : action.descriptor.name;

      if (action.descriptor.gotoFlow) {
        if (this.transitionCount >= this.options.maxTransitions) {
          throw new Error('maximum flow transitions exceeded');
        }
        this.transitionCount += 1;
        await this.dependencies.loader.switchTo(action.descriptor.gotoFlow);
        result.gotoFlow = action.descriptor.gotoFlow;
        this.suppressedActionName = undefined;
      }
      await this.record(result);
      return this.emit(result);
    } catch (error: unknown) {
      throw new Error(`automation tick failed in flow ${flowId}: ${errorMessage(error)}`, { cause: error });
    }
  }

  private async record(result: TickResult): Promise<void> {
    if (!this.recordStore || !result.actionName) {
      return;
    }
    const entry: RecordEntry = {
      timestamp: new Date().toISOString(),
      flowId: result.flowId,
      imageName: result.actionName,
      clicked: result.clicked,
      reason: result.reason,
      point: result.point,
      gotoFlow: result.gotoFlow,
    };
    await this.recordStore.append(entry);
  }

  private emit(result: TickResult): TickResult {
    this.logger?.(result);
    return result;
  }
}

const unmatched = (method: AutomationOptions['matcher']): MatchResult => ({
  score: 0,
  rect: null,
  matched: false,
  method,
});

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

import { decodeImage } from '../vision/image-decoder.js';
import { resolveClickPoint, satisfiesOcr, selectAction } from './action-selector.js';
const defaultSelector = {
    selectAction,
    resolveClickPoint,
};
const defaultSleep = async (milliseconds) => {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
};
const resolveOptions = (options = {}) => ({
    intervalMs: options.intervalMs ?? 500,
    matcher: options.matcher ?? 'template',
    dryRun: options.dryRun ?? false,
    once: options.once ?? false,
    maxTransitions: options.maxTransitions ?? 100,
    signal: options.signal,
});
export class AutomationLoop {
    dependencies;
    options;
    selector;
    sleep;
    recordStore;
    logger;
    transitionCount = 0;
    suppressedActionName;
    constructor(dependencies) {
        this.dependencies = dependencies;
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
    async run() {
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
        }
        catch (error) {
            let flowId = 'unknown';
            try {
                flowId = this.dependencies.loader.current().id;
            }
            catch {
                // 如果 Flow 尚未加载，保留 unknown 作为上下文。
            }
            throw new Error(`automation loop failed in flow ${flowId}: ${errorMessage(error)}`, { cause: error });
        }
    }
    async tick() {
        let flowId = 'unknown';
        try {
            flowId = this.dependencies.loader.current().id;
            const frame = await this.dependencies.adb.screenshot();
            return await this.tickFrame(frame);
        }
        catch (error) {
            if (error instanceof Error && error.message.startsWith('automation tick failed in flow ')) {
                throw error;
            }
            throw new Error(`automation tick failed in flow ${flowId}: ${errorMessage(error)}`, { cause: error });
        }
    }
    /** 使用调用方已经取得的截图执行一轮，供目标协调器共享同一帧画面。 */
    async tickFrame(frame, suppliedOcrResult) {
        let flowId = 'unknown';
        try {
            const context = this.dependencies.loader.current();
            flowId = context.id;
            const requiresOcr = context.templates.some((template) => Boolean(template.descriptor.ocrText));
            let ocrResult = suppliedOcrResult;
            if (requiresOcr && !ocrResult) {
                if (!this.dependencies.ocrClient) {
                    return this.emit({ flowId, clicked: false, reason: 'ocr-error' });
                }
                try {
                    ocrResult = await this.dependencies.ocrClient.recognize(frame);
                }
                catch {
                    return this.emit({ flowId, clicked: false, reason: 'ocr-error' });
                }
            }
            const matches = await this.dependencies.matcher.matchAll(frame, context.templates, this.options.matcher);
            const allMatches = new Map();
            const candidates = context.templates.map((template, index) => {
                const match = matches[index] ?? unmatched(this.options.matcher);
                allMatches.set(template.descriptor.name, match);
                return { descriptor: template.descriptor, match };
            });
            const suppressed = this.suppressedActionName
                ? candidates.find((candidate) => candidate.descriptor.name === this.suppressedActionName)
                : undefined;
            const suppressedVisible = Boolean(suppressed?.match.matched && satisfiesOcr(suppressed.descriptor, ocrResult));
            const availableCandidates = candidates.filter((candidate) => (candidate.descriptor.name !== this.suppressedActionName));
            const action = this.selector.selectAction(availableCandidates, allMatches, ocrResult);
            if (!action) {
                if (!suppressedVisible) {
                    this.suppressedActionName = undefined;
                }
                return this.emit({
                    flowId,
                    clicked: false,
                    reason: suppressedVisible ? 'cooldown' : 'no-match',
                });
            }
            this.suppressedActionName = undefined;
            if (action.descriptor.wait) {
                const result = { flowId, actionName: action.descriptor.name, clicked: false, reason: 'wait' };
                await this.record(result);
                return this.emit(result);
            }
            const decodedFrame = decodeImage(frame, 'adb-screenshot.png');
            const point = this.selector.resolveClickPoint(action.descriptor, action.match.rect, { width: decodedFrame.width, height: decodedFrame.height });
            if (this.options.dryRun) {
                const result = {
                    flowId,
                    actionName: action.descriptor.name,
                    clicked: false,
                    point,
                    reason: 'dry-run',
                };
                await this.record(result);
                if (action.descriptor.delayMs > 0) {
                    await this.sleep(action.descriptor.delayMs);
                }
                return this.emit(result);
            }
            await this.dependencies.adb.tap(point.x, point.y);
            const result = {
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
        }
        catch (error) {
            throw new Error(`automation tick failed in flow ${flowId}: ${errorMessage(error)}`, { cause: error });
        }
    }
    async record(result) {
        if (!this.recordStore || !result.actionName) {
            return;
        }
        const entry = {
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
    emit(result) {
        this.logger?.(result);
        return result;
    }
}
const unmatched = (method) => ({
    score: 0,
    rect: null,
    matched: false,
    method,
});
const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

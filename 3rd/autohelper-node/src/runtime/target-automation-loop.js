import { AutomationLoop } from './automation-loop.js';
import { locateState, selectStateMatch } from './state-locator.js';
const resolveOptions = (options = {}) => ({
    intervalMs: options.intervalMs ?? 500,
    matcher: options.matcher ?? 'template',
    dryRun: options.dryRun ?? false,
    once: options.once ?? false,
    signal: options.signal,
});
const defaultSleep = async (milliseconds) => {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
};
const hasOcrCondition = (states) => states.some((state) => (state.markers.some((template) => Boolean(template.descriptor.ocrText))
    || state.matchTemplates.some((template) => Boolean(template.descriptor.ocrText))));
const completedSubgoals = (progress) => new Set(Object.values(progress.subgoals)
    .filter((subgoal) => subgoal.status === 'completed')
    .map((subgoal) => subgoal.id));
const subgoalCount = (progress) => Object.keys(progress.subgoals).length;
export class TargetAutomationLoop {
    dependencies;
    options;
    sleep;
    actionLoop;
    states = [];
    progress;
    initialized = false;
    bootstrapping = false;
    constructor(dependencies) {
        this.dependencies = dependencies;
        this.options = resolveOptions(dependencies.options);
        this.sleep = dependencies.sleep ?? defaultSleep;
        this.actionLoop = new AutomationLoop({
            adb: dependencies.adb,
            loader: dependencies.repository,
            matcher: dependencies.matcher,
            ocrClient: dependencies.ocrClient,
            options: {
                ...dependencies.options,
                once: false,
            },
            sleep: this.sleep,
            recordStore: dependencies.recordStore,
        });
        if (!Number.isInteger(this.options.intervalMs) || this.options.intervalMs < 0) {
            throw new Error('invalid automation interval');
        }
    }
    async run() {
        try {
            await this.dependencies.adb.assertConnected();
            await this.ensureInitialized();
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
            throw new Error(`target automation loop failed for ${this.dependencies.target.id}: ${errorMessage(error)}`, {
                cause: error,
            });
        }
    }
    async tick() {
        let flowId = 'unknown';
        try {
            await this.ensureInitialized();
            const progress = this.progress;
            flowId = this.dependencies.repository.current().id;
            if (progress.status === 'completed') {
                return this.emit({
                    targetId: this.dependencies.target.id,
                    flowId,
                    clicked: false,
                    targetCompleted: true,
                    reason: 'target-reached',
                });
            }
            const frame = await this.dependencies.adb.screenshot();
            const ocrResult = await this.recognizeStateText(frame);
            if (ocrResult.error) {
                return this.emit({
                    targetId: this.dependencies.target.id,
                    flowId,
                    clicked: false,
                    reason: 'ocr-error',
                });
            }
            const located = await locateState(frame, this.states, {
                matcher: this.dependencies.matcher,
                method: this.options.matcher,
            }, ocrResult.value);
            if (located.state) {
                const state = located.state;
                if (this.bootstrapping) {
                    if (state.id === this.dependencies.target.bootstrapDoneState) {
                        this.bootstrapping = false;
                        this.states = await this.dependencies.repository.listStates(this.dependencies.target.feature);
                        await this.dependencies.repository.loadFlow(this.dependencies.target.feature, this.dependencies.target.entryFlow);
                        return this.emit({
                            targetId: this.dependencies.target.id,
                            flowId: this.dependencies.repository.current().id,
                            stateId: state.id,
                            clicked: false,
                            reason: 'flow-switched',
                        });
                    }
                    const actionResult = await this.actionLoop.tickFrame(frame, ocrResult.value);
                    return this.emit(this.withState(actionResult, state.id));
                }
                let progressChanged = progress.currentState !== state.id;
                progress.currentState = state.id;
                const activeSubgoal = progress.activeSubgoalId
                    ? progress.subgoals[progress.activeSubgoalId]
                    : undefined;
                if (activeSubgoal?.doneState === state.id) {
                    this.dependencies.progressStore.markSubgoalCompleted(progress, activeSubgoal.id);
                    progressChanged = true;
                }
                if (this.isTargetComplete(state, progress)) {
                    progress.status = 'completed';
                    progressChanged = true;
                    if (progressChanged) {
                        await this.saveProgress(progress);
                    }
                    return this.emit({
                        targetId: this.dependencies.target.id,
                        flowId: this.dependencies.repository.current().id,
                        stateId: state.id,
                        clicked: false,
                        targetCompleted: true,
                        reason: 'target-reached',
                    });
                }
                if (progressChanged) {
                    await this.saveProgress(progress);
                }
                let switchedFlow = false;
                if (!this.dependencies.target.resultState || this.dependencies.target.resultState === state.id) {
                    const matchTemplates = state.matchTemplates;
                    if (matchTemplates.length > 0) {
                        const matches = await this.dependencies.matcher.matchAll(frame, matchTemplates, this.options.matcher);
                        const match = selectStateMatch(state, matches, completedSubgoals(progress), ocrResult.value);
                        if (match?.descriptor.matchId && match.descriptor.gotoFlow) {
                            this.dependencies.progressStore.upsertSubgoal(progress, {
                                id: match.descriptor.matchId,
                                text: match.descriptor.matchId,
                                flowId: match.descriptor.gotoFlow,
                                doneState: match.descriptor.doneState,
                            });
                            progress.activeSubgoalId = match.descriptor.matchId;
                            await this.saveProgress(progress);
                            if (this.dependencies.repository.current().id !== match.descriptor.gotoFlow) {
                                await this.dependencies.repository.switchTo(match.descriptor.gotoFlow);
                                switchedFlow = true;
                            }
                        }
                    }
                }
                flowId = this.dependencies.repository.current().id;
                if (switchedFlow) {
                    return this.emit({
                        targetId: this.dependencies.target.id,
                        flowId,
                        stateId: state.id,
                        clicked: false,
                        reason: 'flow-switched',
                    });
                }
                const actionResult = await this.actionLoop.tickFrame(frame, ocrResult.value);
                return this.emit(this.withState(actionResult, state.id));
            }
            const actionResult = await this.actionLoop.tickFrame(frame, ocrResult.value);
            if (actionResult.reason === 'no-match' || actionResult.reason === 'cooldown') {
                return this.emit({
                    ...actionResult,
                    targetId: this.dependencies.target.id,
                    reason: located.reason === 'ambiguous' ? 'ambiguous-state' : 'unknown-state',
                });
            }
            return this.emit({
                ...actionResult,
                targetId: this.dependencies.target.id,
            });
        }
        catch (error) {
            throw new Error(`target tick failed in flow ${flowId}: ${errorMessage(error)}`, { cause: error });
        }
    }
    async ensureInitialized() {
        if (this.initialized) {
            return;
        }
        this.progress = await this.dependencies.progressStore.load(this.dependencies.gameId, this.dependencies.target);
        const target = this.dependencies.target;
        const hasBootstrap = Boolean(target.bootstrapFeature || target.bootstrapFlow || target.bootstrapDoneState);
        if (hasBootstrap) {
            const bootstrapRoot = target.bootstrapRoot ?? target.bootstrapFeature;
            if (!bootstrapRoot || !target.bootstrapFlow || !target.bootstrapDoneState) {
                throw new Error('bootstrap requires feature, flow and done state');
            }
            this.bootstrapping = true;
            if (target.bootstrapRoot) {
                if (!this.dependencies.repository.listExternalStates || !this.dependencies.repository.loadExternalFlow) {
                    throw new Error('repository does not support provider bootstrap roots');
                }
                this.states = await this.dependencies.repository.listExternalStates(bootstrapRoot);
                await this.dependencies.repository.loadExternalFlow(bootstrapRoot, target.bootstrapFlow);
            }
            else {
                this.states = await this.dependencies.repository.listStates(bootstrapRoot);
                await this.dependencies.repository.loadFlow(bootstrapRoot, target.bootstrapFlow);
            }
            const hasLaunch = Boolean(target.bootstrapPackage || target.bootstrapActivity || target.bootstrapDisplay !== undefined);
            if (hasLaunch) {
                if (!target.bootstrapPackage || !target.bootstrapActivity || target.bootstrapDisplay === undefined) {
                    throw new Error('bootstrap launch requires package, activity and display');
                }
                if (!this.options.dryRun) {
                    if (!this.dependencies.adb.startActivity) {
                        throw new Error('ADB client does not support starting an activity');
                    }
                    await this.dependencies.adb.startActivity(target.bootstrapPackage, target.bootstrapActivity, target.bootstrapDisplay);
                }
            }
        }
        else {
            this.states = await this.dependencies.repository.listStates(target.feature);
            await this.dependencies.repository.loadFlow(target.feature, target.entryFlow);
        }
        this.initialized = true;
    }
    async recognizeStateText(frame) {
        if (!hasOcrCondition(this.states)) {
            return { error: false };
        }
        if (!this.dependencies.ocrClient) {
            return { error: true };
        }
        try {
            return { value: await this.dependencies.ocrClient.recognize(frame), error: false };
        }
        catch {
            return { error: true };
        }
    }
    isTargetComplete(state, progress) {
        const target = this.dependencies.target;
        if (target.completion === 'state') {
            return Boolean(target.doneState && target.doneState === state.id);
        }
        if (this.dependencies.progressStore.hasPendingSubgoals(progress)) {
            return false;
        }
        if (target.doneState && target.doneState !== state.id) {
            return false;
        }
        return subgoalCount(progress) > 0 || Boolean(target.doneState && target.doneState === state.id);
    }
    async saveProgress(progress) {
        await this.dependencies.progressStore.save(progress, this.dependencies.gameId, this.dependencies.target);
    }
    withState(result, stateId) {
        return {
            ...result,
            targetId: this.dependencies.target.id,
            stateId,
        };
    }
    emit(result) {
        this.dependencies.logger?.(result);
        return result;
    }
}
const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

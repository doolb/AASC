import { decodeImage } from '../vision/image-decoder.js';
import { resolveClickPoint, selectAction, satisfiesOcr, } from '../runtime/action-selector.js';
import { Navigator } from './navigator.js';
const unmatched = (method) => ({
    score: 0,
    rect: null,
    matched: false,
    method,
});
const isMatched = (match) => (match.matched && match.rect !== null);
const scoreMatches = (matches) => (matches.reduce((score, match) => Math.min(score, match.score), 1));
const stateMatches = (state, matches, ocrResult) => state.markers.every((template, index) => (isMatched(matches[index] ?? unmatched('template'))
    && satisfiesOcr(template.descriptor, ocrResult)));
const noInstruction = (confidence, reason, state) => ({
    mode: 'none',
    confidence,
    reason,
    state,
});
const selectTemplates = (context, actionName) => {
    if (!actionName) {
        return context.templates;
    }
    return context.templates.filter((template) => (template.descriptor.name === actionName
        || template.descriptor.matchId === actionName));
};
export class UiNavigator extends Navigator {
    states;
    repository;
    matcher;
    ocrClient;
    method;
    now;
    constructor(options) {
        super('ui', 'ui');
        this.states = [...options.states];
        this.repository = options.repository;
        this.matcher = options.matcher;
        this.ocrClient = options.ocrClient;
        this.method = options.method ?? 'template';
        this.now = options.now ?? (() => new Date().toISOString());
    }
    async getCurrentState(frame) {
        try {
            const ocrResult = this.ocrClient
                ? await this.ocrClient.recognize(frame)
                : undefined;
            const matchedStates = await this.findStates(frame, ocrResult);
            const uiIds = matchedStates.map((match) => match.state.id);
            const topmost = uiIds[uiIds.length - 1];
            const confidence = matchedStates.length > 0
                ? matchedStates.reduce((score, match) => Math.min(score, match.score), 1)
                : 0;
            return {
                navigatorId: this.id,
                mode: this.mode,
                id: topmost,
                status: matchedStates.length > 0 ? 'confirmed' : 'unknown',
                confidence,
                observedAt: this.now(),
                data: {
                    uis: uiIds,
                    topmost,
                    stateScores: Object.fromEntries(matchedStates.map((match) => [match.state.id, match.score])),
                },
            };
        }
        catch (error) {
            return {
                navigatorId: this.id,
                mode: this.mode,
                status: 'error',
                confidence: 0,
                observedAt: this.now(),
                data: {
                    error: error instanceof Error ? error.message : String(error),
                },
            };
        }
    }
    async generateInstruction(frame, target) {
        const state = await this.getCurrentState(frame);
        if (state.status !== 'confirmed') {
            return noInstruction(state.confidence, 'ui-state-not-confirmed', state);
        }
        const context = this.repository.current();
        if (target.flowId && context.id !== target.flowId) {
            return {
                mode: 'ui',
                action: 'switch-flow',
                flowId: target.flowId,
                confidence: state.confidence,
                reason: 'target-flow-is-not-active',
            };
        }
        const templates = selectTemplates(context, target.actionName);
        if (templates.length === 0) {
            return noInstruction(state.confidence, 'ui-action-is-not-in-current-flow', state);
        }
        const matches = await this.matcher.matchAll(frame, templates, this.method);
        const allMatches = new Map();
        templates.forEach((template, index) => {
            allMatches.set(template.descriptor.name, matches[index] ?? unmatched(this.method));
        });
        const selected = selectAction(templates.map((template, index) => ({
            descriptor: template.descriptor,
            match: matches[index] ?? unmatched(this.method),
        })), allMatches);
        if (!selected || !selected.match.rect) {
            return noInstruction(state.confidence, 'ui-action-not-matched', state);
        }
        if (selected.descriptor.wait) {
            return {
                mode: 'ui',
                action: 'wait',
                durationMs: selected.descriptor.delayMs,
                confidence: selected.match.score,
                reason: 'current-ui-action-requires-wait',
                stateId: state.id,
                actionName: selected.descriptor.name,
            };
        }
        const image = decodeImage(frame, 'adb-screenshot.png');
        return {
            mode: 'ui',
            action: 'tap',
            point: resolveClickPoint(selected.descriptor, selected.match.rect, image),
            confidence: selected.match.score,
            stateId: state.id,
            actionName: selected.descriptor.name,
            gotoFlow: selected.descriptor.gotoFlow,
        };
    }
    async findStates(frame, ocrResult) {
        const matchedStates = [];
        for (const state of this.states) {
            const matches = await this.matcher.matchAll(frame, state.markers, this.method);
            if (stateMatches(state, matches, ocrResult)) {
                matchedStates.push({ state, score: scoreMatches(matches) });
            }
        }
        return matchedStates;
    }
}

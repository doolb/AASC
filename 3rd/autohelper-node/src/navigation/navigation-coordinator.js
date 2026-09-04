const modeForGoal = (goal) => {
    if (goal.navigationMode) return goal.navigationMode;
    if (goal.kind === 'ui' || goal.kind === 'spatial-3d' || goal.kind === 'combat') {
        return goal.kind;
    }
    return undefined;
};

const isAction = (instruction) => instruction.mode !== 'none';

const noInstruction = (reason = 'no-navigator-instruction') => ({
    mode: 'none',
    confidence: 0,
    reason,
});

export class NavigationCoordinator {
    constructor(options) {
        this.navigators = [...options.navigators];
        this.now = options.now ?? (() => new Date().toISOString());
        const ids = new Set();
        for (const navigator of this.navigators) {
            if (ids.has(navigator.id)) {
                throw new Error('navigator is already registered: ' + navigator.id);
            }
            ids.add(navigator.id);
        }
    }

    async observe(frame) {
        return await Promise.all(this.navigators.map(async (navigator) => {
            try {
                return await navigator.getCurrentState(frame);
            }
            catch (error) {
                return {
                    navigatorId: navigator.id,
                    mode: navigator.mode,
                    status: 'error',
                    confidence: 0,
                    observedAt: this.now(),
                    data: { error: error instanceof Error ? error.message : String(error) },
                };
            }
        }));
    }

    async plan(frame, goals = []) {
        const states = await this.observe(frame);
        const orderedGoals = [...goals].sort((left, right) => (
            (right.priority ?? 0) - (left.priority ?? 0)
                || left.id.localeCompare(right.id)
        ));
        const candidates = [];
        for (const goal of orderedGoals) {
            const targetMode = modeForGoal(goal);
            const eligible = this.navigators.filter((navigator) => (
                (!goal.delegate || navigator.id === goal.delegate || navigator.mode === goal.delegate)
                && (!targetMode || navigator.mode === targetMode
                    || navigator.id === goal.delegate)
            ));
            for (const navigator of eligible) {
                let instruction;
                try {
                    instruction = await navigator.generateInstruction(frame, goal);
                }
                catch (error) {
                    instruction = noInstruction('navigator-planning-failed');
                }
                candidates.push({
                    goalId: goal.id,
                    navigatorId: navigator.id,
                    priority: goal.priority ?? 0,
                    instruction,
                });
            }
        }
        const selected = candidates.find((candidate) => isAction(candidate.instruction))
            ?? candidates[0];
        return {
            states,
            goalId: selected?.goalId,
            navigatorId: selected?.navigatorId,
            instruction: selected?.instruction ?? noInstruction(),
            candidates,
        };
    }
}

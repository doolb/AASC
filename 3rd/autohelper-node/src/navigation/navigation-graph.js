const navigatorForKind = (kind) => {
    if (kind === 'ui' || kind === 'spatial-3d' || kind === 'combat') {
        return kind;
    }
    return undefined;
};

const goalNodeId = (goalId) => 'goal:' + goalId;
const stepNodeId = (flowId, stepId) => 'flow:' + flowId + ':' + stepId;
const goalStepNodeId = (goalId, stepId) => 'goal:' + goalId + ':' + stepId;

const asPath = (value) => value.split('.').filter(Boolean);

const readStateValue = (state, path) => {
    if (Object.prototype.hasOwnProperty.call(state, path)) {
        return { found: true, value: state[path] };
    }
    let current = state;
    for (const part of asPath(path)) {
        if (typeof current !== 'object' || current === null
            || !Object.prototype.hasOwnProperty.call(current, part)) {
            return { found: false };
        }
        current = current[part];
    }
    return { found: true, value: current };
};

const parseLiteral = (text) => {
    const value = text.trim();
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))) {
        return value.slice(1, -1);
    }
    const number = Number(value);
    return Number.isNaN(number) ? value : number;
};

const compareExpression = (expression, state) => {
    const match = expression.trim().match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (!match) {
        const result = readStateValue(state, expression.trim());
        return result.found ? Boolean(result.value) : 'unknown';
    }
    const left = readStateValue(state, match[1].trim());
    if (!left.found) return 'unknown';
    const right = parseLiteral(match[3]);
    switch (match[2]) {
        case '==': return left.value === right;
        case '!=': return left.value !== right;
        case '>=': return typeof left.value === 'number' && typeof right === 'number'
            ? left.value >= right : 'unknown';
        case '<=': return typeof left.value === 'number' && typeof right === 'number'
            ? left.value <= right : 'unknown';
        case '>': return typeof left.value === 'number' && typeof right === 'number'
            ? left.value > right : 'unknown';
        case '<': return typeof left.value === 'number' && typeof right === 'number'
            ? left.value < right : 'unknown';
        default: return 'unknown';
    }
};

export const evaluatePredicate = (expression, state = {}) => {
    if (!expression || !expression.trim()) {
        return true;
    }
    const orParts = expression.split(/\s*\|\|\s*/);
    let hasUnknown = false;
    for (const orPart of orParts) {
        const andParts = orPart.split(/\s*&&\s*/);
        let andResult = true;
        for (const part of andParts) {
            const negated = part.trim().startsWith('!');
            const result = compareExpression(negated ? part.trim().slice(1) : part, state);
            if (result === 'unknown') {
                hasUnknown = true;
                andResult = false;
            } else if ((negated && result) || (!negated && !result)) {
                andResult = false;
                break;
            }
        }
        if (andResult) return true;
    }
    return hasUnknown ? 'unknown' : false;
};

const addEdge = (edges, from, to, kind = 'sequence', when) => {
    edges.push({ from, to, kind, ...(when ? { when } : {}) });
};

const compileFlow = (flow, nodes, edges) => {
    const steps = flow.steps ?? [];
    const stepIds = new Set(steps.map((step) => step.id));
    steps.forEach((step) => {
        nodes.push({
            id: stepNodeId(flow.id, step.id),
            kind: step.kind,
            flowId: flow.id,
            stepId: step.id,
            navigator: flow.navigator ?? step.delegate,
            action: step.action,
            delegate: step.delegate,
            until: step.until,
            success: step.success,
            terminal: Boolean(step.terminal) || step.kind === 'terminal',
        });
    });
    const resolveTarget = (target) => {
        if (!target) return undefined;
        if (target.startsWith('flow:')) return target;
        return stepIds.has(target) ? stepNodeId(flow.id, target) : target;
    };
    steps.forEach((step, index) => {
        const from = stepNodeId(flow.id, step.id);
        if (step.branches?.length) {
            for (const branch of step.branches) {
                const target = resolveTarget(branch.goto);
                if (target) addEdge(edges, from, target, 'branch', branch.when);
            }
        }
        if (step.goto) {
            const target = resolveTarget(step.goto);
            if (target) addEdge(edges, from, target, step.kind === 'repeat-until' ? 'repeat' : 'sequence');
        }
        if (step.next?.length) {
            for (const next of step.next) {
                const target = resolveTarget(next);
                if (target) addEdge(edges, from, target, 'sequence');
            }
        }
        if (!step.goto && !step.branches?.length && !step.next?.length
            && !step.terminal && step.kind !== 'terminal') {
            const next = steps[index + 1];
            if (next) addEdge(edges, from, stepNodeId(flow.id, next.id));
        }
    });
};

const compileGoal = (goal, nodes, edges, flowStarts) => {
    const rootId = goalNodeId(goal.id);
    nodes.push({
        id: rootId,
        kind: 'goal',
        goalId: goal.id,
        scenarioId: goal.scenarioId,
        navigator: goal.delegate ?? goal.navigationMode ?? navigatorForKind(goal.kind),
        success: goal.success,
        terminal: false,
    });
    const subgoals = goal.steps ?? [];
    let previous = rootId;
    for (const subgoal of subgoals) {
        const id = goalStepNodeId(goal.id, subgoal.id);
        nodes.push({
            id,
            kind: 'goal-step',
            goalId: subgoal.id,
            parentGoalId: goal.id,
            navigator: subgoal.delegate ?? subgoal.navigationMode ?? navigatorForKind(subgoal.kind),
            success: subgoal.success,
            terminal: false,
        });
        addEdge(edges, previous, id);
        previous = id;
    }
    if (goal.flowId) {
        const start = flowStarts.get(goal.flowId);
        if (start) addEdge(edges, previous, start, 'delegate');
    }
};

export const compileNavigationGraph = (navigationPackage) => {
    const nodes = [];
    const edges = [];
    const flowStarts = new Map();
    for (const flow of navigationPackage.flows ?? []) {
        const firstStep = flow.start ?? flow.steps?.[0]?.id;
        if (firstStep) flowStarts.set(flow.id, stepNodeId(flow.id, firstStep));
    }
    for (const flow of navigationPackage.flows ?? []) {
        compileFlow(flow, nodes, edges);
    }
    for (const goal of navigationPackage.goals ?? []) {
        compileGoal(goal, nodes, edges, flowStarts);
    }
    return {
        packageId: navigationPackage.metadata.id,
        nodes,
        edges,
        roots: (navigationPackage.goals ?? []).map((goal) => goalNodeId(goal.id)),
    };
};

const chooseEdge = (node, edges, state) => {
    if (node.kind === 'choice' || node.kind === 'repeat-until') {
        const conditional = edges.filter((edge) => edge.when || edge.kind === 'branch' || edge.kind === 'repeat');
        if (node.kind === 'repeat-until') {
            const until = evaluatePredicate(node.until, state);
            if (until === 'unknown') return { edge: undefined, uncertain: true };
            const preferredKind = until ? 'sequence' : 'repeat';
            const preferred = edges.find((edge) => edge.kind === preferredKind)
                ?? edges.find((edge) => until && edge.kind !== 'repeat');
            return { edge: preferred, uncertain: !preferred };
        }
        let uncertain = false;
        for (const edge of conditional) {
            const result = evaluatePredicate(edge.when, state);
            if (result === true) return { edge, uncertain: false };
            if (result === 'unknown') uncertain = true;
        }
        const fallback = edges.find((edge) => !edge.when);
        return { edge: fallback, uncertain: !fallback && uncertain };
    }
    const edge = edges.find((candidate) => {
        const result = evaluatePredicate(candidate.when, state);
        return result === true;
    }) ?? edges.find((candidate) => !candidate.when);
    return { edge, uncertain: !edge && edges.some((candidate) => candidate.when) };
};

export const resolveNavigationChain = (
    graph,
    goalId,
    state = {},
    options = {},
) => {
    const start = goalNodeId(goalId);
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    if (!nodeById.has(start)) {
        return {
            goalId,
            status: 'blocked',
            terminal: false,
            nodeIds: [],
            nodes: [],
            reason: 'goal-not-found',
        };
    }
    const outgoing = new Map();
    for (const edge of graph.edges) {
        const list = outgoing.get(edge.from) ?? [];
        list.push(edge);
        outgoing.set(edge.from, list);
    }
    const nodeIds = [];
    const nodes = [];
    const visited = new Set();
    let currentId = start;
    let status = 'complete';
    let reason;
    let terminal = false;
    let unmet = false;
    const maxNodes = options.maxNodes ?? 100;
    while (currentId && nodeIds.length < maxNodes) {
        if (visited.has(currentId)) {
            status = 'partial';
            reason = 'runtime-cycle';
            break;
        }
        visited.add(currentId);
        const node = nodeById.get(currentId);
        if (!node) {
            status = 'blocked';
            reason = 'missing-node:' + currentId;
            break;
        }
        nodeIds.push(currentId);
        nodes.push(node);
        if (node.success) {
            const success = evaluatePredicate(node.success, state);
            if (success !== true) {
                unmet = true;
            }
        }
        if (node.terminal) {
            terminal = true;
            break;
        }
        const next = chooseEdge(node, outgoing.get(currentId) ?? [], state);
        if (next.uncertain) {
            status = 'partial';
            reason = 'branch-state-unknown';
            break;
        }
        currentId = next.edge?.to;
        if (!currentId) break;
    }
    if (nodeIds.length >= maxNodes && currentId) {
        status = 'partial';
        reason = 'chain-limit-reached';
    } else if (unmet && status === 'complete') {
        status = 'partial';
        reason ??= 'goal-state-not-satisfied';
    }
    return { goalId, status, terminal, nodeIds, nodes, reason };
};

import { compileNavigationGraph } from './navigation-graph.js';

const builtInNavigators = new Set(['ui', 'spatial-3d', 'combat']);

const diagnostic = (severity, code, message, nodeId) => ({
    severity,
    code,
    message,
    ...(nodeId ? { nodeId } : {}),
});

const allReferencedTargets = (graph) => {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const diagnostics = [];
    for (const edge of graph.edges) {
        if (!nodeIds.has(edge.to)) {
            diagnostics.push(diagnostic(
                'error',
                'missing-reference',
                'edge target does not exist: ' + edge.to,
                edge.from,
            ));
        }
    }
    return diagnostics;
};

const reachableNodes = (graph) => {
    const byFrom = new Map();
    for (const edge of graph.edges) {
        const list = byFrom.get(edge.from) ?? [];
        list.push(edge.to);
        byFrom.set(edge.from, list);
    }
    const visited = new Set();
    const queue = [...graph.roots];
    while (queue.length) {
        const current = queue.shift();
        if (!current || visited.has(current)) continue;
        visited.add(current);
        queue.push(...(byFrom.get(current) ?? []));
    }
    return visited;
};

const validateDelegates = (navigationPackage, graph) => {
    const valid = new Set([
        ...builtInNavigators,
        ...(navigationPackage.scenarios ?? []).flatMap((scenario) => scenario.navigators ?? []),
        ...graph.nodes.map((node) => node.navigator).filter(Boolean),
    ]);
    return graph.nodes
        .filter((node) => node.delegate && !valid.has(node.delegate))
        .map((node) => diagnostic(
            'error',
            'missing-delegate',
            'delegate does not exist: ' + node.delegate,
            node.id,
        ));
};

const validateCycles = (graph) => {
    const byFrom = new Map();
    for (const edge of graph.edges) {
        const list = byFrom.get(edge.from) ?? [];
        list.push(edge);
        byFrom.set(edge.from, list);
    }
    const diagnostics = [];
    const visiting = new Set();
    const visited = new Set();
    const visit = (nodeId, path) => {
        if (visiting.has(nodeId)) {
            const node = graph.nodes.find((candidate) => candidate.id === nodeId);
            if (!node || (node.kind !== 'repeat-until'
                && !path.some((item) => item.kind === 'choice' || item.kind === 'repeat-until'))) {
                diagnostics.push(diagnostic(
                    'error',
                    'unconditional-cycle',
                    'unconditional navigation cycle detected',
                    nodeId,
                ));
            }
            return;
        }
        if (visited.has(nodeId)) return;
        visiting.add(nodeId);
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        const nextPath = node ? [...path, node] : path;
        for (const edge of byFrom.get(nodeId) ?? []) {
            visit(edge.to, nextPath);
        }
        visiting.delete(nodeId);
        visited.add(nodeId);
    };
    for (const root of graph.roots) visit(root, []);
    return diagnostics;
};

export const validateNavigationPackage = (navigationPackage) => {
    const graph = compileNavigationGraph(navigationPackage);
    const diagnostics = [
        ...allReferencedTargets(graph),
        ...validateDelegates(navigationPackage, graph),
        ...validateCycles(graph),
    ];
    const reachable = reachableNodes(graph);
    for (const node of graph.nodes) {
        if (!reachable.has(node.id)) {
            diagnostics.push(diagnostic(
                'warning',
                'unreachable-node',
                'node is not reachable from a goal: ' + node.id,
                node.id,
            ));
        }
    }
    return diagnostics;
};

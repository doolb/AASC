import { Buffer } from 'node:buffer';
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const FENCE = String.fromCharCode(96).repeat(3);
const NAVIGATION_BLOCK = new RegExp(FENCE + 'navigation-json[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?' + FENCE, 'gi');
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\((data:[^)]+)\)/gi;
const isObject = (value) => (typeof value === 'object' && value !== null && !Array.isArray(value));
const errorAt = (sourcePath, message) => (new Error(sourcePath + ': ' + message));
const requiredString = (value, field, sourcePath) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw errorAt(sourcePath, field + ' is required');
    }
    const result = value.trim();
    if (!ID_PATTERN.test(result)) {
        throw errorAt(sourcePath, 'invalid ' + field + ': ' + result);
    }
    return result;
};
const optionalString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const arrayField = (object, field, sourcePath) => {
    const value = object[field];
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw errorAt(sourcePath, field + ' must be an array');
    }
    return value;
};
const scenarioIdFor = (object, headingScenario) => (optionalString(object.scenarioId) ?? optionalString(object.scenario) ?? headingScenario);
const jsonObject = (value, field, sourcePath) => {
    if (!isObject(value)) {
        throw errorAt(sourcePath, field + ' must be an object');
    }
    return value;
};
const parseMetadata = (block, sourcePath) => {
    const metadataValue = block.metadata;
    const metadata = metadataValue === undefined
        ? {}
        : jsonObject(metadataValue, 'metadata', sourcePath);
    const id = optionalString(metadata.id) ?? optionalString(block.packageId);
    if (!id) {
        return undefined;
    }
    return {
        id: requiredString(id, 'package metadata.id', sourcePath),
        name: optionalString(metadata.name),
        version: optionalString(metadata.version),
    };
};
const parseScenario = (value, headingScenario, sourcePath) => {
    const object = jsonObject(value, 'scenario', sourcePath);
    const id = requiredString(scenarioIdFor(object, headingScenario), 'scenario.id', sourcePath);
    const priority = typeof object.priority === 'number' ? object.priority : undefined;
    return {
        id,
        title: optionalString(object.title),
        priority,
        enabled: typeof object.enabled === 'boolean' ? object.enabled : undefined,
        navigators: Array.isArray(object.navigators)
            ? object.navigators.filter((item) => typeof item === 'string')
            : undefined,
    };
};
const parseGoal = (value, headingScenario, sourcePath) => {
    const object = jsonObject(value, 'goal', sourcePath);
    const id = requiredString(object.id, 'goal.id', sourcePath);
    const kind = requiredString(object.kind ?? 'compound', 'goal.kind', sourcePath);
    const goal = {
        id,
        kind,
        title: optionalString(object.title),
        navigationMode: optionalString(object.navigationMode),
        actionName: optionalString(object.actionName),
        flowId: optionalString(object.flowId),
        success: optionalString(object.success),
        priority: typeof object.priority === 'number' ? object.priority : undefined,
        required: typeof object.required === 'boolean' ? object.required : undefined,
        parent: optionalString(object.parent),
        delegate: optionalString(object.delegate),
        metadata: isObject(object.metadata)
            ? Object.fromEntries(Object.entries(object.metadata)
                .filter((entry) => typeof entry[1] === 'string'))
            : undefined,
        steps: Array.isArray(object.steps)
            ? object.steps.map((step) => parseGoal(step, headingScenario, sourcePath))
            : undefined,
        scenarioId: scenarioIdFor(object, headingScenario),
    };
    return goal;
};
const parseState = (value, headingScenario, sourcePath) => {
    const object = jsonObject(value, 'state', sourcePath);
    const uis = Array.isArray(object.uis)
        ? object.uis.map((item) => requiredString(item, 'state.uis item', sourcePath))
        : undefined;
    const topmost = optionalString(object.topmost);
    if (topmost && uis && !uis.includes(topmost)) {
        throw errorAt(sourcePath, 'state.topmost must be included in state.uis');
    }
    return {
        id: requiredString(object.id, 'state.id', sourcePath),
        scenarioId: scenarioIdFor(object, headingScenario),
        uis,
        topmost,
        markers: Array.isArray(object.markers)
            ? object.markers.map((item) => requiredString(item, 'state.markers item', sourcePath))
            : undefined,
        facts: isObject(object.facts) ? object.facts : undefined,
    };
};
const parseBranch = (value, sourcePath) => {
    const object = jsonObject(value, 'flow branch', sourcePath);
    return {
        when: optionalString(object.when),
        goto: requiredString(object.goto, 'flow branch.goto', sourcePath),
    };
};
const parseStep = (value, flowId, index, sourcePath) => {
    const object = jsonObject(value, 'flow step', sourcePath);
    const kind = requiredString(object.kind ?? 'action', 'flow step.kind', sourcePath);
    return {
        id: optionalString(object.id) ?? flowId + ':step-' + index,
        kind,
        action: optionalString(object.action),
        goto: optionalString(object.goto),
        branches: Array.isArray(object.branches)
            ? object.branches.map((branch) => parseBranch(branch, sourcePath))
            : undefined,
        until: optionalString(object.until),
        delegate: optionalString(object.delegate),
        goalId: optionalString(object.goalId),
        state: optionalString(object.state),
        success: optionalString(object.success),
        next: Array.isArray(object.next)
            ? object.next.map((item) => requiredString(item, 'flow step.next item', sourcePath))
            : undefined,
        terminal: typeof object.terminal === 'boolean' ? object.terminal : undefined,
    };
};
const parseFlow = (value, headingScenario, sourcePath) => {
    const object = jsonObject(value, 'flow', sourcePath);
    const id = requiredString(object.id, 'flow.id', sourcePath);
    const rawSteps = arrayField(object, 'steps', sourcePath);
    return {
        id,
        scenarioId: scenarioIdFor(object, headingScenario),
        navigator: optionalString(object.navigator),
        start: optionalString(object.start),
        steps: rawSteps.map((step, index) => parseStep(step, id, index, sourcePath)),
    };
};
const parseNavMesh = (value, headingScenario, sourcePath) => {
    const object = jsonObject(value, 'navmesh', sourcePath);
    return {
        id: requiredString(object.id, 'navmesh.id', sourcePath),
        file: requiredString(object.file, 'navmesh.file', sourcePath),
        scenarioId: scenarioIdFor(object, headingScenario),
    };
};
const decodeBase64Asset = (value, sourcePath) => {
    const match = value.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
    if (!match) {
        throw errorAt(sourcePath, 'invalid base64 image asset');
    }
    const dataBase64 = match[2].replace(/\s/g, '');
    if (!dataBase64 || dataBase64.length % 4 !== 0) {
        throw errorAt(sourcePath, 'invalid base64 image asset');
    }
    const decoded = Buffer.from(dataBase64, 'base64');
    if (decoded.length === 0 || decoded.toString('base64') !== dataBase64) {
        throw errorAt(sourcePath, 'invalid base64 image asset');
    }
    return { mimeType: match[1], dataBase64 };
};
const parseMarkdownAssets = (contents, sourcePath) => {
    const assets = [];
    for (const match of contents.matchAll(MARKDOWN_IMAGE)) {
        const alt = match[1].trim();
        const dataUri = match[2];
        const id = alt || 'image-' + (assets.length + 1);
        const decoded = decodeBase64Asset(dataUri, sourcePath);
        assets.push({ id, alt: alt || undefined, dataUri, ...decoded });
    }
    return assets;
};
const scenarioHeadingBefore = (contents, offset) => {
    const headings = [...contents.slice(0, offset).matchAll(/^#{1,6}[ \t]+Scenario:[ \t]*([A-Za-z0-9._:-]+)[ \t]*$/gim)];
    return headings.length > 0 ? headings[headings.length - 1]?.[1] : undefined;
};
const assertUnique = (values, field, sourcePath) => {
    const seen = new Set();
    for (const value of values) {
        if (seen.has(value.id)) {
            throw errorAt(sourcePath, 'duplicate ' + field + ' id: ' + value.id);
        }
        seen.add(value.id);
    }
};
export const parseNavigationPackage = (contents, sourcePath) => {
    const blocks = [...contents.matchAll(NAVIGATION_BLOCK)];
    if (blocks.length === 0) {
        throw errorAt(sourcePath, 'navigation-json block is required');
    }
    let metadata;
    const scenarios = [];
    const goals = [];
    const states = [];
    const flows = [];
    const navmeshes = [];
    const assets = parseMarkdownAssets(contents, sourcePath);
    for (const blockMatch of blocks) {
        const blockSource = blockMatch[1] ?? '';
        let value;
        try {
            value = JSON.parse(blockSource);
        }
        catch (error) {
            throw errorAt(sourcePath, 'invalid navigation-json block: ' + (error instanceof Error ? error.message : String(error)));
        }
        const block = jsonObject(value, 'navigation-json block', sourcePath);
        const headingScenario = scenarioHeadingBefore(contents, blockMatch.index ?? 0);
        const blockMetadata = parseMetadata(block, sourcePath);
        if (blockMetadata) {
            if (metadata && metadata.id !== blockMetadata.id) {
                throw errorAt(sourcePath, 'navigation package metadata.id differs between blocks');
            }
            metadata ??= blockMetadata;
        }
        scenarios.push(...arrayField(block, 'scenarios', sourcePath)
            .map((item) => parseScenario(item, headingScenario, sourcePath)));
        goals.push(...arrayField(block, 'goals', sourcePath)
            .map((item) => parseGoal(item, headingScenario, sourcePath)));
        states.push(...arrayField(block, 'states', sourcePath)
            .map((item) => parseState(item, headingScenario, sourcePath)));
        flows.push(...arrayField(block, 'flows', sourcePath)
            .map((item) => parseFlow(item, headingScenario, sourcePath)));
        navmeshes.push(...arrayField(block, 'navmeshes', sourcePath)
            .map((item) => parseNavMesh(item, headingScenario, sourcePath)));
    }
    if (!metadata) {
        throw errorAt(sourcePath, 'package metadata.id is required');
    }
    assertUnique(scenarios, 'scenario', sourcePath);
    assertUnique(goals, 'goal', sourcePath);
    assertUnique(states, 'state', sourcePath);
    assertUnique(flows, 'flow', sourcePath);
    assertUnique(navmeshes, 'navmesh', sourcePath);
    assertUnique(assets, 'asset', sourcePath);
    return {
        sourcePath,
        metadata,
        scenarios,
        goals,
        states,
        flows,
        navmeshes,
        assets,
    };
};

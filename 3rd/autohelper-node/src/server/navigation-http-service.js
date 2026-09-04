import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { NavMeshRevisionConflict, NavMeshStore } from '../navigation/navmesh-store.js';
import { compileNavigationGraph, resolveNavigationChain } from '../navigation/navigation-graph.js';
import { parseNavigationPackage } from '../navigation/package-parser.js';
import { validateNavigationPackage } from '../navigation/package-validator.js';

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const isObject = (value) => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const sendJson = (response, status, body) => {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
    });
    response.end(payload);
};

const readBody = (request, maxBytes) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on('data', (chunk) => {
        if (rejected) return;
        size += chunk.length;
        if (size > maxBytes) {
            rejected = true;
            reject(new HttpError(413, 'request body is too large'));
            request.destroy();
            return;
        }
        chunks.push(Buffer.from(chunk));
    });
    request.once('error', reject);
    request.once('end', () => {
        if (rejected) return;
        const content = Buffer.concat(chunks).toString('utf8');
        if (!content.trim()) {
            resolve({});
            return;
        }
        try {
            resolve(JSON.parse(content));
        }
        catch (error) {
            reject(new HttpError(400, 'request body must be valid JSON'));
        }
    });
});

const requireObjectBody = (body) => {
    if (!isObject(body)) {
        throw new HttpError(400, 'request body must be a JSON object');
    }
    return body;
};

const requireString = (value, field) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new HttpError(400, field + ' is required');
    }
    return value.trim();
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const packageResponse = (navigationPackage) => ({
    packageId: navigationPackage.metadata.id,
    metadata: navigationPackage.metadata,
    scenarios: navigationPackage.scenarios,
    goals: navigationPackage.goals,
    states: navigationPackage.states,
    flows: navigationPackage.flows,
    navmeshes: navigationPackage.navmeshes,
    assets: navigationPackage.assets,
});

const decodeImageBase64 = (value) => {
    const source = requireString(value, 'imageBase64');
    const comma = source.indexOf(',');
    const data = source.startsWith('data:') && comma >= 0
        ? source.slice(comma + 1)
        : source;
    if (!data || !/^[A-Za-z0-9+/=\r\n]+$/.test(data)) {
        throw new HttpError(400, 'imageBase64 is invalid');
    }
    const normalized = data.replace(/\s/g, '');
    const frame = Buffer.from(normalized, 'base64');
    if (frame.length === 0) {
        throw new HttpError(400, 'imageBase64 is invalid');
    }
    return frame;
};

const navigationPackageFromBody = (body) => {
    const markdown = typeof body.markdown === 'string'
        ? body.markdown
        : typeof body.markdownBase64 === 'string'
            ? Buffer.from(body.markdownBase64, 'base64').toString('utf8')
            : undefined;
    if (markdown === undefined) {
        throw new HttpError(400, 'markdown or markdownBase64 is required');
    }
    return parseNavigationPackage(markdown, body.sourcePath ?? 'http-upload.nav.md');
};

const updatePackageData = (navigationPackage, body) => {
    const section = requireString(body.section, 'section');
    const allowed = new Set(['scenarios', 'goals', 'states', 'flows', 'navmeshes', 'assets']);
    if (!allowed.has(section)) {
        throw new HttpError(400, 'unsupported package data section: ' + section);
    }
    if (body.value === undefined || body.value === null) {
        throw new HttpError(400, 'value is required');
    }
    const updated = clone(navigationPackage);
    const values = Array.isArray(body.value) ? body.value : [body.value];
    updated[section].push(...clone(values));
    const ids = new Set();
    for (const value of updated[section]) {
        if (!value || typeof value.id !== 'string' || !value.id.trim()) {
            throw new HttpError(400, section + ' entries require an id');
        }
        if (ids.has(value.id)) {
            throw new HttpError(409, 'duplicate ' + section + ' id: ' + value.id);
        }
        ids.add(value.id);
    }
    return updated;
};

export const createNavigationHttpService = (options = {}) => {
    const navMeshStore = options.navMeshStore
        ?? new NavMeshStore({ rootDir: options.navMeshRoot ?? 'navmesh' });
    const maxBodyBytes = options.maxBodyBytes ?? 20 * 1024 * 1024;
    const packages = new Map();
    const sessions = new Map();
    const mapObservations = new Map();

    const findPackage = (packageId) => {
        const navigationPackage = packages.get(packageId);
        if (!navigationPackage) {
            throw new HttpError(404, 'navigation package not found: ' + packageId);
        }
        return navigationPackage;
    };

    const findSession = (sessionId) => {
        const session = sessions.get(sessionId);
        if (!session) {
            throw new HttpError(404, 'navigation session not found: ' + sessionId);
        }
        return session;
    };

    const route = async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
        if (parts[0] !== 'api' || parts[1] !== 'v1') {
            throw new HttpError(404, 'route not found');
        }
        const body = request.method === 'GET' ? {} : requireObjectBody(await readBody(request, maxBodyBytes));

        if (request.method === 'POST' && parts.length === 3 && parts[2] === 'packages') {
            const navigationPackage = navigationPackageFromBody(body);
            packages.set(navigationPackage.metadata.id, navigationPackage);
            return sendJson(response, 201, packageResponse(navigationPackage));
        }

        if (parts[2] === 'packages' && parts[3]) {
            const navigationPackage = findPackage(parts[3]);
            if (request.method === 'GET' && parts[4] === 'graph') {
                return sendJson(response, 200, compileNavigationGraph(navigationPackage));
            }
            if (request.method === 'GET' && parts[4] === 'validate') {
                return sendJson(response, 200, validateNavigationPackage(navigationPackage));
            }
            if (request.method === 'POST' && parts[4] === 'data') {
                const updated = updatePackageData(navigationPackage, body);
                packages.set(parts[3], updated);
                return sendJson(response, 200, packageResponse(updated));
            }
            throw new HttpError(404, 'package route not found');
        }

        if (request.method === 'POST' && parts.length === 3 && parts[2] === 'sessions') {
            const packageId = requireString(body.packageId, 'packageId');
            findPackage(packageId);
            const session = {
                sessionId: randomUUID(),
                packageId,
                goalId: typeof body.goalId === 'string' ? body.goalId : undefined,
                state: isObject(body.state) ? clone(body.state) : {},
                observations: [],
                executionResults: [],
            };
            sessions.set(session.sessionId, session);
            return sendJson(response, 201, clone(session));
        }

        if (parts[2] === 'sessions' && parts[3]) {
            const session = findSession(parts[3]);
            const navigationPackage = findPackage(session.packageId);
            if (request.method === 'GET' && parts[4] === 'state') {
                return sendJson(response, 200, clone(session));
            }
            if (request.method === 'GET' && parts[4] === 'chain') {
                const goalId = url.searchParams.get('goalId') ?? session.goalId;
                if (!goalId) throw new HttpError(400, 'goalId is required');
                let state = session.state;
                const stateText = url.searchParams.get('state');
                if (stateText) {
                    try {
                        state = JSON.parse(stateText);
                    }
                    catch {
                        throw new HttpError(400, 'state must be valid JSON');
                    }
                }
                const graph = compileNavigationGraph(navigationPackage);
                return sendJson(response, 200, {
                    sessionId: session.sessionId,
                    packageId: session.packageId,
                    chain: resolveNavigationChain(graph, goalId, isObject(state) ? state : {}),
                });
            }
            if (request.method === 'POST' && parts[4] === 'observe') {
                if (body.imageBase64 !== undefined) decodeImageBase64(body.imageBase64);
                if (isObject(body.state)) session.state = clone(body.state);
                session.observations.push(clone({
                    ...body,
                    imageBase64: body.imageBase64 ? '[stored externally]' : undefined,
                }));
                const goalId = typeof body.goalId === 'string' ? body.goalId : session.goalId;
                const graph = goalId
                    ? compileNavigationGraph(navigationPackage)
                    : undefined;
                return sendJson(response, 200, {
                    sessionId: session.sessionId,
                    state: clone(session.state),
                    chain: graph && goalId
                        ? resolveNavigationChain(graph, goalId, session.state)
                        : undefined,
                    instruction: null,
                });
            }
            if (request.method === 'POST' && parts[4] === 'goal') {
                session.goalId = requireString(body.goalId, 'goalId');
                return sendJson(response, 200, clone(session));
            }
            if (request.method === 'POST' && parts[4] === 'execution-result') {
                session.executionResults.push(clone(body));
                return sendJson(response, 200, { accepted: true });
            }
            throw new HttpError(404, 'session route not found');
        }

        if (parts[2] === 'maps' && parts[3]) {
            const mapId = parts[3];
            if (request.method === 'POST' && parts[4] === 'tiles') {
                const expectedRevision = body.expectedRevision;
                const tile = body.tile;
                const map = await navMeshStore.upsertTile(mapId, tile, expectedRevision);
                return sendJson(response, 200, map);
            }
            if (request.method === 'GET' && parts[4] === undefined) {
                return sendJson(response, 200, await navMeshStore.load(mapId));
            }
            if (request.method === 'POST' && parts[4] === 'observations') {
                const values = mapObservations.get(mapId) ?? [];
                values.push(clone(body));
                mapObservations.set(mapId, values);
                return sendJson(response, 200, {
                    mapId,
                    observationCount: values.length,
                    observation: clone(body),
                });
            }
            throw new HttpError(404, 'map route not found');
        }

        if (request.method === 'POST' && parts.length === 4
            && parts[2] === 'vision' && parts[3] === 'yolo') {
            if (!options.yoloDetector) {
                throw new HttpError(503, 'local YOLO detector is not configured');
            }
            const frame = decodeImageBase64(body.imageBase64);
            const detectOptions = {};
            for (const key of ['modelId', 'confidenceThreshold', 'iouThreshold']) {
                if (body[key] !== undefined) detectOptions[key] = body[key];
            }
            const detections = await options.yoloDetector.detect(frame, detectOptions);
            return sendJson(response, 200, { detections });
        }
        if (request.method === 'GET' && parts.length === 5
            && parts[2] === 'vision' && parts[3] === 'yolo' && parts[4] === 'models') {
            if (!options.yoloDetector?.listModels) {
                return sendJson(response, 200, { models: [] });
            }
            return sendJson(response, 200, { models: options.yoloDetector.listModels() });
        }
        throw new HttpError(404, 'route not found');
    };

    return createServer((request, response) => {
        route(request, response).catch((error) => {
            if (response.headersSent) {
                response.destroy();
                return;
            }
            if (error instanceof NavMeshRevisionConflict) {
                sendJson(response, 409, { error: error.message, code: error.code });
                return;
            }
            const status = error instanceof HttpError ? error.status : 500;
            sendJson(response, status, {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    });
};

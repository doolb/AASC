import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { parseImageDescriptor } from './filename-parser.js';
import { parseTargetDefinition } from './target-parser.js';
import { FlowLoader } from './flow-loader.js';
import { TemplateCache } from '../vision/template-cache.js';
const IMAGE_EXTENSIONS = new Set(['.png', '.bmp']);
const TEXT_EXTENSION = '.txt';
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const TARGET_PERIODS = ['daily', 'weekly', 'version'];
const assertSafeId = (value, field) => {
    if (!SAFE_ID_PATTERN.test(value) || value === '.' || value === '..') {
        throw new Error(`invalid ${field}: ${value}`);
    }
};
const isFileNotFoundError = (error) => (Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'));
const imageFiles = (entries) => (entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort());
export class GameFlowLoader {
    flowsRoot;
    gameRoot;
    loadTemplate;
    templateCache;
    featureLoaders = new Map();
    externalLoaders = new Map();
    stateCache = new Map();
    externalStateCache = new Map();
    activeLoader;
    constructor(options) {
        assertSafeId(options.gameId, 'game id');
        this.flowsRoot = resolve(options.flowsRoot);
        this.gameRoot = resolve(this.flowsRoot, options.gameId);
        if (dirname(this.gameRoot) !== this.flowsRoot) {
            throw new Error(`invalid game id: ${options.gameId}`);
        }
        this.loadTemplate = options.loadTemplate;
        this.templateCache = new TemplateCache(options.loadTemplate);
    }
    async loadFlow(featureId, flowId) {
        const loader = this.featureLoader(featureId);
        const context = await loader.load(flowId);
        this.activeLoader = loader;
        return context;
    }
    async loadExternalFlow(rootId, flowId) {
        const loader = this.externalLoader(rootId);
        const context = await loader.load(flowId);
        this.activeLoader = loader;
        return context;
    }
    async switchTo(flowId) {
        if (!this.activeLoader) {
            throw new Error('no active feature');
        }
        return this.activeLoader.switchTo(flowId);
    }
    current() {
        if (!this.activeLoader) {
            throw new Error('no active feature');
        }
        return this.activeLoader.current();
    }
    async listStates(featureId) {
        const cached = this.stateCache.get(featureId);
        if (cached) {
            return cached;
        }
        const loading = this.loadStates(featureId).catch((error) => {
            this.stateCache.delete(featureId);
            throw error;
        });
        this.stateCache.set(featureId, loading);
        return loading;
    }
    async listExternalStates(rootId) {
        assertSafeId(rootId, 'provider root id');
        const cached = this.externalStateCache.get(rootId);
        if (cached) {
            return cached;
        }
        const loading = this.loadStatesFromRoot(this.resolveExternalRoot(rootId)).catch((error) => {
            this.externalStateCache.delete(rootId);
            throw error;
        });
        this.externalStateCache.set(rootId, loading);
        return loading;
    }
    async listTargets() {
        const targetRoot = resolve(this.gameRoot, 'targets');
        const targets = [];
        for (const period of TARGET_PERIODS) {
            const directory = resolve(targetRoot, period);
            if (dirname(directory) !== targetRoot) {
                throw new Error(`invalid target directory: ${period}`);
            }
            let entries;
            try {
                entries = await readdir(directory, { withFileTypes: true });
            }
            catch (error) {
                if (isFileNotFoundError(error)) {
                    continue;
                }
                throw new Error(`failed to read target directory: ${directory}`, { cause: error });
            }
            for (const fileName of entries
                .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === TEXT_EXTENSION)
                .map((entry) => entry.name)
                .sort()) {
                const filePath = join(directory, fileName);
                const contents = await readFile(filePath, 'utf8');
                targets.push(parseTargetDefinition(filePath, contents));
            }
        }
        return targets;
    }
    async loadTarget(targetId) {
        assertSafeId(targetId, 'target id');
        const targets = await this.listTargets();
        const matches = targets.filter((target) => target.id === targetId && target.enabled);
        if (matches.length === 0) {
            throw new Error(`target not found: ${targetId}`);
        }
        if (matches.length > 1) {
            throw new Error(`duplicate target id: ${targetId}`);
        }
        return matches[0];
    }
    featureLoader(featureId) {
        assertSafeId(featureId, 'feature id');
        const existing = this.featureLoaders.get(featureId);
        if (existing) {
            return existing;
        }
        const featureRoot = this.resolveFeatureRoot(featureId);
        const loader = new FlowLoader({
            flowsRoot: join(featureRoot, 'flow'),
            loadTemplate: this.loadTemplate,
        });
        this.featureLoaders.set(featureId, loader);
        return loader;
    }
    externalLoader(rootId) {
        assertSafeId(rootId, 'provider root id');
        const existing = this.externalLoaders.get(rootId);
        if (existing) {
            return existing;
        }
        const loader = new FlowLoader({
            flowsRoot: join(this.resolveExternalRoot(rootId), 'flow'),
            loadTemplate: this.loadTemplate,
        });
        this.externalLoaders.set(rootId, loader);
        return loader;
    }
    async loadStates(featureId) {
        return this.loadStatesFromRoot(this.resolveFeatureRoot(featureId));
    }
    async loadStatesFromRoot(featureRoot) {
        const stateRoot = join(featureRoot, 'state');
        let entries;
        try {
            entries = await readdir(stateRoot, { withFileTypes: true });
        }
        catch (error) {
            if (isFileNotFoundError(error)) {
                return [];
            }
            throw new Error(`failed to read state directory: ${stateRoot}`, { cause: error });
        }
        const states = [];
        for (const stateId of entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort()) {
            assertSafeId(stateId, 'state id');
            const directory = resolve(stateRoot, stateId);
            const stateEntries = await readdir(directory, { withFileTypes: true });
            const markers = await this.loadTemplates(imageFiles(stateEntries).map((fileName) => join(directory, fileName)), stateId);
            const matchTemplates = await this.loadMatchTemplates(directory, stateId);
            if (markers.length === 0) {
                continue;
            }
            states.push({ id: stateId, directory, markers, matchTemplates });
        }
        return states;
    }
    async loadMatchTemplates(directory, stateId) {
        const matchDirectory = join(directory, 'match');
        let entries;
        try {
            entries = await readdir(matchDirectory, { withFileTypes: true });
        }
        catch (error) {
            if (isFileNotFoundError(error)) {
                return [];
            }
            throw new Error(`failed to read match directory: ${matchDirectory}`, { cause: error });
        }
        const paths = imageFiles(entries).map((fileName) => join(matchDirectory, fileName));
        const templates = await this.loadTemplates(paths, stateId);
        for (const template of templates) {
            if (!template.descriptor.matchId) {
                throw new Error(`match image requires match@id: ${template.descriptor.filePath}`);
            }
            if (!template.descriptor.gotoFlow) {
                throw new Error(`match image requires goto@flow: ${template.descriptor.filePath}`);
            }
        }
        return templates;
    }
    async loadTemplates(paths, flowId) {
        const descriptors = paths.map((filePath) => parseImageDescriptor(flowId, filePath));
        return Promise.all(descriptors.map((descriptor) => this.templateCache.load(descriptor)));
    }
    resolveFeatureRoot(featureId) {
        const featureRoot = resolve(this.gameRoot, featureId);
        if (dirname(featureRoot) !== this.gameRoot) {
            throw new Error(`invalid feature id: ${featureId}`);
        }
        return featureRoot;
    }
    resolveExternalRoot(rootId) {
        const root = resolve(this.flowsRoot, rootId);
        if (dirname(root) !== resolve(this.flowsRoot)) {
            throw new Error(`invalid provider root id: ${rootId}`);
        }
        return root;
    }
}

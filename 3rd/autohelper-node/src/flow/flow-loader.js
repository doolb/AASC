import { readdir, stat } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { parseImageDescriptor } from './filename-parser.js';
import { TemplateCache } from '../vision/template-cache.js';
const IMAGE_EXTENSIONS = new Set(['.png', '.bmp']);
const FLOW_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
function isSafeFlowId(flowId) {
    return FLOW_ID_PATTERN.test(flowId) && flowId !== '.' && flowId !== '..';
}
export class FlowLoader {
    flowsRoot;
    parseDescriptor;
    templateCache;
    activeContext = null;
    constructor(options) {
        this.flowsRoot = resolve(options.flowsRoot);
        this.parseDescriptor = options.parseDescriptor ?? parseImageDescriptor;
        this.templateCache = new TemplateCache(options.loadTemplate);
    }
    listFlowIds() {
        try {
            return readdirSync(this.flowsRoot, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && isSafeFlowId(entry.name))
                .map((entry) => entry.name)
                .sort();
        }
        catch (error) {
            if (isFileNotFoundError(error)) {
                return [];
            }
            throw error;
        }
    }
    async load(flowId) {
        const directory = this.resolveFlowDirectory(flowId);
        await this.assertFlowDirectory(flowId, directory);
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch (error) {
            throw new Error(`failed to read flow: ${flowId}`, { cause: error });
        }
        const imagePaths = entries
            .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
            .map((entry) => resolve(directory, entry.name))
            .sort();
        const descriptors = imagePaths.map((filePath) => this.parseDescriptor(flowId, filePath));
        const templates = await Promise.all(descriptors.map((descriptor) => this.templateCache.load(descriptor)));
        const context = { id: flowId, directory, descriptors, templates };
        this.activeContext = context;
        return context;
    }
    async switchTo(flowId) {
        return this.load(flowId);
    }
    current() {
        if (!this.activeContext) {
            throw new Error('no active flow');
        }
        return this.activeContext;
    }
    resolveFlowDirectory(flowId) {
        if (!isSafeFlowId(flowId)) {
            throw new Error(`invalid flow id: ${flowId}`);
        }
        const directory = resolve(this.flowsRoot, flowId);
        if (dirname(directory) !== this.flowsRoot) {
            throw new Error(`invalid flow id: ${flowId}`);
        }
        return directory;
    }
    async assertFlowDirectory(flowId, directory) {
        try {
            const details = await stat(directory);
            if (!details.isDirectory()) {
                throw new Error(`flow not found: ${flowId}`);
            }
        }
        catch (error) {
            if (isFileNotFoundError(error)) {
                throw new Error(`flow not found: ${flowId}`);
            }
            if (error instanceof Error && error.message === `flow not found: ${flowId}`) {
                throw error;
            }
            throw new Error(`failed to inspect flow: ${flowId}`, { cause: error });
        }
    }
}
function isFileNotFoundError(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

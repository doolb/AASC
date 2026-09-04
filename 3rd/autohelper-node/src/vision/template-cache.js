import { readFile } from 'node:fs/promises';
export class TemplateCache {
    loader;
    cache = new Map();
    constructor(loader = async (descriptor) => ({
        descriptor,
        buffer: await readFile(descriptor.filePath),
    })) {
        this.loader = loader;
    }
    load(descriptor) {
        const existing = this.cache.get(descriptor.filePath);
        if (existing) {
            return existing;
        }
        const loading = this.loader(descriptor).catch((error) => {
            this.cache.delete(descriptor.filePath);
            throw error;
        });
        this.cache.set(descriptor.filePath, loading);
        return loading;
    }
    clear() {
        this.cache.clear();
    }
}

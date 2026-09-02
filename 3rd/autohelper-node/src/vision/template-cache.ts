import { readFile } from 'node:fs/promises';
import type { ImageDescriptor, LoadedTemplate } from '../types.js';

export type TemplateLoader = (descriptor: ImageDescriptor) => Promise<LoadedTemplate>;

export class TemplateCache {
  private readonly cache = new Map<string, Promise<LoadedTemplate>>();

  public constructor(private readonly loader: TemplateLoader = async (descriptor) => ({
    descriptor,
    buffer: await readFile(descriptor.filePath),
  })) {}

  public load(descriptor: ImageDescriptor): Promise<LoadedTemplate> {
    const existing = this.cache.get(descriptor.filePath);
    if (existing) {
      return existing;
    }

    const loading = this.loader(descriptor).catch((error: unknown) => {
      this.cache.delete(descriptor.filePath);
      throw error;
    });
    this.cache.set(descriptor.filePath, loading);
    return loading;
  }

  public clear(): void {
    this.cache.clear();
  }
}

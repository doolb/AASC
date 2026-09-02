import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseImageDescriptor } from '../../src/flow/filename-parser.js';
import { FlowLoader } from '../../src/flow/flow-loader.js';
import type { ImageDescriptor, LoadedTemplate } from '../../src/types.js';

const temporaryDirectories: string[] = [];

async function makeFlowsRoot(files: Record<string, string[]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'autohelper-flow-'));
  temporaryDirectories.push(root);
  for (const [flowId, flowFiles] of Object.entries(files)) {
    const directory = join(root, flowId);
    await mkdir(directory, { recursive: true });
    for (const fileName of flowFiles) {
      await writeFile(join(directory, fileName), Buffer.from(fileName));
    }
  }
  return root;
}

function makeLoader(flowsRoot: string, loaded: string[] = []): FlowLoader {
  const loadTemplate = async (descriptor: ImageDescriptor): Promise<LoadedTemplate> => {
    loaded.push(descriptor.name);
    return { descriptor, buffer: Buffer.from(descriptor.name) };
  };
  return new FlowLoader({ flowsRoot, parseDescriptor: parseImageDescriptor, loadTemplate });
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe('FlowLoader', () => {
  it('loads only image files from the active flow directory', async () => {
    const root = await makeFlowsRoot({
      launch: ['a@0.9.png', 'notes.txt'],
      home: ['b@0.8.png'],
    });
    const loader = makeLoader(root);

    const context = await loader.load('launch');

    expect(context.id).toBe('launch');
    expect(context.descriptors.map((item) => item.name)).toEqual(['a@0.9']);
    expect(loader.listFlowIds()).toEqual(['home', 'launch']);
  });

  it('switches flow and rejects a missing target', async () => {
    const root = await makeFlowsRoot({
      launch: ['a@0.9,goto@home.png'],
      home: ['b@0.8.png'],
    });
    const loader = makeLoader(root);

    await expect(loader.switchTo('home')).resolves.toMatchObject({ id: 'home' });
    await expect(loader.switchTo('missing')).rejects.toThrow('flow not found: missing');
  });

  it('rejects flow ids that are not direct child directories', async () => {
    const root = await makeFlowsRoot({ launch: ['a@0.9.png'] });
    const loader = makeLoader(root);

    await expect(loader.load('../home')).rejects.toThrow('invalid flow id');
  });

  it('loads a template once per file path within a flow cache', async () => {
    const root = await makeFlowsRoot({ launch: ['a@0.9.png'] });
    const loaded: string[] = [];
    const loader = makeLoader(root, loaded);

    await loader.load('launch');
    await loader.load('launch');

    expect(loaded).toEqual(['a@0.9']);
  });
});

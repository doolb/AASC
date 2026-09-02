import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdbClientLike } from '../../src/types.js';
import { cropPng, captureTemplate } from '../../src/tools/capture-tool.js';

const roots: string[] = [];

const createPng = (width = 4, height = 3): Buffer => {
  const image = new PNG({ width, height });
  image.data.fill(120);
  for (let offset = 3; offset < image.data.length; offset += 4) {
    image.data[offset] = 255;
  }
  return PNG.sync.write(image);
};

class FakeAdb implements AdbClientLike {
  public async assertConnected(): Promise<void> {}

  public async screenshot(): Promise<Buffer> {
    return createPng();
  }

  public async tap(): Promise<void> {}
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});

describe('capture tool', () => {
  it('writes a captured screenshot into the selected flow directory', async () => {
    const flowsRoot = await mkdtemp(join(tmpdir(), 'autohelper-capture-'));
    roots.push(flowsRoot);

    const output = await captureTemplate({
      adb: new FakeAdb(),
      flowsRoot,
      flowId: 'launch',
      name: 'close-popup@0.88',
    });

    expect(output).toBe(join(flowsRoot, 'launch', 'close-popup@0.88.png'));
    expect((await readFile(output)).subarray(0, 8)).toEqual(createPng().subarray(0, 8));
  });

  it('rejects a capture name that would escape the flow directory', async () => {
    const flowsRoot = await mkdtemp(join(tmpdir(), 'autohelper-capture-'));
    roots.push(flowsRoot);

    await expect(captureTemplate({
      adb: new FakeAdb(),
      flowsRoot,
      flowId: 'launch',
      name: '../outside@0.9',
    })).rejects.toThrow('invalid image name');
  });

  it('crops a PNG with a region inside the source image', async () => {
    const cropped = await cropPng(createPng(8, 6), { x: 2, y: 1, width: 3, height: 4 });
    const decoded = PNG.sync.read(cropped);

    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 3, height: 4 });
  });
});

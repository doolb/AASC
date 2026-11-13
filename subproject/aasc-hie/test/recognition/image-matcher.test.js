import { PNG } from 'pngjs';
import { describe, expect, it, vi } from 'vitest';
import { OpenCvImageMatcher } from '../../src/recognition/image-matcher.js';

const descriptor = (filePath) => ({ filePath, threshold: 0.95 });

const createPattern = (width, height, seed = 20) => {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (width * y + x) * 4;
      image.data[offset] = (x * 37 + y * 13 + seed) % 255;
      image.data[offset + 1] = (x * 17 + y * 61 + seed + 20) % 255;
      image.data[offset + 2] = (x * 73 + y * 29 + seed + 60) % 255;
      image.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(image);
};

const fixture = (template = createPattern(5, 4)) => {
  const templateImage = PNG.sync.read(template);
  const frameImage = new PNG({ width: 16, height: 12, colorType: 6 });
  frameImage.data.fill(18);
  for (let offset = 3; offset < frameImage.data.length; offset += 4) frameImage.data[offset] = 255;
  const origin = { x: 7, y: 5 };
  for (let y = 0; y < templateImage.height; y += 1) {
    for (let x = 0; x < templateImage.width; x += 1) {
      const source = (templateImage.width * y + x) * 4;
      const target = (frameImage.width * (origin.y + y) + origin.x + x) * 4;
      frameImage.data[target] = templateImage.data[source];
      frameImage.data[target + 1] = templateImage.data[source + 1];
      frameImage.data[target + 2] = templateImage.data[source + 2];
      frameImage.data[target + 3] = 255;
    }
  }
  return { frame: PNG.sync.write(frameImage), template, origin };
};

describe('OpenCvImageMatcher', () => {
  it('matches a PNG template and returns its screen rectangle', async () => {
    const { frame, template, origin } = fixture();
    const result = await new OpenCvImageMatcher().match(frame, {
      descriptor: descriptor('/tmp/button.png'),
      buffer: template,
    });

    expect(result).toMatchObject({ method: 'template', matched: true });
    expect(result.score).toBeGreaterThan(0.99);
    expect(result.rect).toEqual({ x: origin.x, y: origin.y, width: 5, height: 4 });
  });

  it('does not return a rectangle below the configured threshold', async () => {
    const { template } = fixture();
    const solid = new PNG({ width: 16, height: 12 });
    solid.data.fill(18);
    for (let offset = 3; offset < solid.data.length; offset += 4) solid.data[offset] = 255;

    const result = await new OpenCvImageMatcher().match(PNG.sync.write(solid), {
      descriptor: descriptor('/tmp/button.png'),
      buffer: template,
    });

    expect(result).toMatchObject({ matched: false, rect: null, method: 'template' });
  });

  it('disposes fulfilled cached Mats when the cache is cleared', async () => {
    const { frame, template } = fixture();
    const matcher = new OpenCvImageMatcher();
    await matcher.match(frame, { descriptor: descriptor('/tmp/button.png'), buffer: template });
    const entry = [...matcher.templateCache.values()][0];
    const deleteSpy = vi.spyOn(entry.mat, 'delete');

    matcher.clear();

    expect(deleteSpy).toHaveBeenCalledOnce();
    expect(matcher.templateCache.size).toBe(0);
  });

  it('does not reuse stale template bytes when the file path is unchanged', async () => {
    const first = fixture(createPattern(5, 4, 20));
    const second = fixture(createPattern(5, 4, 140));
    const matcher = new OpenCvImageMatcher();
    const sameDescriptor = descriptor('/tmp/shared-template.png');

    await matcher.match(first.frame, { descriptor: sameDescriptor, buffer: first.template });
    const result = await matcher.match(second.frame, { descriptor: sameDescriptor, buffer: second.template });

    expect(result.matched).toBe(true);
    expect(result.rect).toEqual({ x: second.origin.x, y: second.origin.y, width: 5, height: 4 });
  });

  it('disposes a Mat that finishes loading after clear', async () => {
    const { template } = fixture();
    const mats = [];
    class FakeMat {
      constructor() {
        this.data = { set: vi.fn() };
        this.delete = vi.fn();
        this.cols = 5;
        this.rows = 4;
        mats.push(this);
      }
    }
    const fakeCv = {
      Mat: FakeMat,
      CV_8UC4: 0,
      COLOR_RGBA2GRAY: 0,
      cvtColor: vi.fn(),
    };
    const matcher = new OpenCvImageMatcher();
    const pending = matcher.loadTemplateMat(fakeCv, {
      descriptor: descriptor('/tmp/pending.png'),
      buffer: template,
    });

    matcher.clear();

    await expect(pending).rejects.toThrow('cleared while loading');
    expect(mats.at(-1).delete).toHaveBeenCalledOnce();
  });
});

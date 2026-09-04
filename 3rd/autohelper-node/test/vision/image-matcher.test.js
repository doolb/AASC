import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { OpenCvImageMatcher } from '../../src/vision/image-matcher.js';
const createDescriptor = (filePath) => ({
    name: 'button@0.95',
    flowId: 'home',
    filePath,
    queue: 0,
    threshold: 0.95,
    clickPoint: { x: 0.5, y: 0.5 },
    centerClick: false,
    delayMs: 0,
    loop: false,
    wait: false,
    defaultCandidate: false,
});
const createPattern = (width, height) => {
    const image = new PNG({ width, height });
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (width * y + x) * 4;
            image.data[offset] = (x * 37 + y * 13 + 20) % 255;
            image.data[offset + 1] = (x * 17 + y * 61 + 40) % 255;
            image.data[offset + 2] = (x * 73 + y * 29 + 80) % 255;
            image.data[offset + 3] = 255;
        }
    }
    return PNG.sync.write(image);
};
const embedPattern = () => {
    const templateImage = PNG.sync.read(createPattern(5, 4));
    const frameImage = new PNG({ width: 16, height: 12, colorType: 6 });
    frameImage.data.fill(18);
    for (let offset = 3; offset < frameImage.data.length; offset += 4) {
        frameImage.data[offset] = 255;
    }
    const origin = { x: 7, y: 5 };
    for (let y = 0; y < templateImage.height; y += 1) {
        for (let x = 0; x < templateImage.width; x += 1) {
            const sourceOffset = (templateImage.width * y + x) * 4;
            const targetOffset = (frameImage.width * (origin.y + y) + origin.x + x) * 4;
            frameImage.data[targetOffset] = templateImage.data[sourceOffset];
            frameImage.data[targetOffset + 1] = templateImage.data[sourceOffset + 1];
            frameImage.data[targetOffset + 2] = templateImage.data[sourceOffset + 2];
            frameImage.data[targetOffset + 3] = 255;
        }
    }
    return {
        frame: PNG.sync.write(frameImage),
        template: PNG.sync.write(templateImage),
    };
};
const createSolidImage = (width, height, value) => {
    const image = new PNG({ width, height });
    image.data.fill(value);
    for (let offset = 3; offset < image.data.length; offset += 4) {
        image.data[offset] = 255;
    }
    return PNG.sync.write(image);
};
describe('OpenCvImageMatcher', () => {
    it('matches a PNG template and returns its screen rectangle', async () => {
        const { frame, template } = embedPattern();
        const loadedTemplate = {
            descriptor: createDescriptor('/tmp/button.png'),
            buffer: template,
        };
        const result = await new OpenCvImageMatcher().match(frame, loadedTemplate);
        expect(result.method).toBe('template');
        expect(result.matched).toBe(true);
        expect(result.score).toBeGreaterThan(0.99);
        expect(result.rect).toEqual({ x: 7, y: 5, width: 5, height: 4 });
    });
    it('does not expose a click rectangle when the score is below threshold', async () => {
        const { template } = embedPattern();
        const loadedTemplate = {
            descriptor: createDescriptor('/tmp/button.png'),
            buffer: template,
        };
        const result = await new OpenCvImageMatcher().match(createSolidImage(16, 12, 18), loadedTemplate);
        expect(result.matched).toBe(false);
        expect(result.rect).toBeNull();
    });
    it('keeps ORB as an optional matcher and handles featureless images safely', async () => {
        const { frame, template } = embedPattern();
        const loadedTemplate = {
            descriptor: createDescriptor('/tmp/button.png'),
            buffer: template,
        };
        const result = await new OpenCvImageMatcher().match(frame, loadedTemplate, 'orb');
        expect(result.method).toBe('orb');
        expect(result.matched).toBe(false);
        expect(result.rect).toBeNull();
    });
});

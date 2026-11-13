import bmp from 'bmp-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { decodeImage } from '../../src/recognition/image-decoder.js';

const rgba = (width, height) => {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 10;
    data[index + 1] = 20;
    data[index + 2] = 30;
    data[index + 3] = 255;
  }
  return data;
};

describe('decodeImage', () => {
  it('decodes PNG bytes into an RGBA image', () => {
    const png = new PNG({ width: 2, height: 1 });
    png.data.set(rgba(2, 1));

    expect(decodeImage(PNG.sync.write(png), 'frame.PNG')).toEqual({
      width: 2,
      height: 1,
      data: expect.any(Uint8Array),
    });
    expect([...decodeImage(PNG.sync.write(png), 'frame.png').data]).toEqual([...rgba(2, 1)]);
  });

  it('decodes BMP bytes into an RGBA image', () => {
    const buffer = bmp.encode({ width: 2, height: 1, data: rgba(2, 1) }).data;

    expect(decodeImage(buffer, 'frame.bmp')).toMatchObject({
      width: 2,
      height: 1,
      data: expect.any(Uint8Array),
    });
  });

  it('rejects unsupported extensions and malformed image bytes', () => {
    expect(() => decodeImage(Buffer.from('image'), 'frame.jpg')).toThrow('unsupported image extension');
    expect(() => decodeImage(Buffer.from('image'), 'frame.png')).toThrow('failed to decode image frame.png');
  });
});

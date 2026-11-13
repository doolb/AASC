import { extname } from 'node:path';
import bmp from 'bmp-js';
import { PNG } from 'pngjs';

const asBuffer = (value) => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error('image buffer must be a Buffer or Uint8Array');
};

/** Decode PNG or BMP bytes into the shared RGBA image shape. */
export const decodeImage = (buffer, filePath = 'image.png') => {
  const extension = extname(filePath).toLowerCase();
  const bytes = asBuffer(buffer);
  try {
    if (extension === '.png') {
      const image = PNG.sync.read(bytes);
      return { width: image.width, height: image.height, data: image.data };
    }
    if (extension === '.bmp') {
      const image = bmp.decode(bytes);
      return { width: image.width, height: image.height, data: image.data };
    }
  } catch (error) {
    throw new Error(`failed to decode image ${filePath}`, { cause: error });
  }
  throw new Error(`unsupported image extension: ${extension || '(none)'}`);
};

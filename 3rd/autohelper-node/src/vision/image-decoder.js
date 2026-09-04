import { extname } from 'node:path';
import bmp from 'bmp-js';
import { PNG } from 'pngjs';
/**
 * 将流程图片或 ADB 截图解码为 RGBA 像素。
 *
 * OpenCV.js 是预编译 WASM 模块，Node 环境没有浏览器的 canvas，因此图片文件
 * 解码单独由纯 JavaScript 解码器负责，避免再次引入本机编译依赖。
 */
export const decodeImage = (buffer, filePath) => {
    const extension = extname(filePath).toLowerCase();
    try {
        if (extension === '.png') {
            const image = PNG.sync.read(buffer);
            return {
                width: image.width,
                height: image.height,
                data: image.data,
            };
        }
        if (extension === '.bmp') {
            const image = bmp.decode(buffer);
            return {
                width: image.width,
                height: image.height,
                data: image.data,
            };
        }
    }
    catch (error) {
        throw new Error(`failed to decode image ${filePath}`, { cause: error });
    }
    throw new Error(`unsupported image extension: ${extension || '(none)'}`);
};

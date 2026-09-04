import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { parseImageDescriptor } from '../flow/filename-parser.js';
import { decodeImage } from '../vision/image-decoder.js';
const FLOW_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const assertSafeFlowId = (flowId) => {
    if (!FLOW_ID_PATTERN.test(flowId) || flowId === '.' || flowId === '..') {
        throw new Error(`invalid flow id: ${flowId}`);
    }
};
const resolveFlowDirectory = (flowsRoot, flowId) => {
    assertSafeFlowId(flowId);
    const root = resolve(flowsRoot);
    const directory = resolve(root, flowId);
    if (dirname(directory) !== root) {
        throw new Error(`invalid flow id: ${flowId}`);
    }
    return directory;
};
const assertSafeImageName = (name) => {
    if (!name || name !== basename(name) || /[\\/]/.test(name) || name === '.' || name === '..') {
        throw new Error(`invalid image name: ${name}`);
    }
    if (extname(name).toLowerCase() === '.png' || extname(name).toLowerCase() === '.bmp') {
        throw new Error(`invalid image name: ${name}`);
    }
};
/** 从设备截图生成当前 Flow 的 PNG 模板。 */
export const captureTemplate = async (options) => {
    validateCaptureName(options.flowId, options.name);
    const flowDirectory = resolveFlowDirectory(options.flowsRoot, options.flowId);
    const screenshot = await options.adb.screenshot();
    const output = options.region ? await cropPng(screenshot, options.region) : screenshot;
    const outputPath = resolve(flowDirectory, `${options.name}.png`);
    try {
        await mkdir(flowDirectory, { recursive: true });
        await writeFile(outputPath, output);
    }
    catch (error) {
        throw new Error(`failed to write captured template: ${outputPath}`, { cause: error });
    }
    return outputPath;
};
/** 在 PNG 字节层裁剪截图，避免为单次模板生成额外初始化 OpenCV。 */
export const cropPng = async (buffer, region) => {
    const source = decodeImage(buffer, 'capture.png');
    if (!Number.isInteger(region.x) || !Number.isInteger(region.y)
        || !Number.isInteger(region.width) || !Number.isInteger(region.height)
        || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
        || region.x + region.width > source.width || region.y + region.height > source.height) {
        throw new Error('capture region is outside screenshot bounds');
    }
    const cropped = new PNG({ width: region.width, height: region.height });
    for (let y = 0; y < region.height; y += 1) {
        const sourceStart = ((region.y + y) * source.width + region.x) * 4;
        const targetStart = y * region.width * 4;
        cropped.data.set(source.data.subarray(sourceStart, sourceStart + region.width * 4), targetStart);
    }
    return PNG.sync.write(cropped);
};
/** 将录制文件转换为可读的 Flow/图片路径序列。 */
export const recordPath = async (store) => {
    const entries = await store.read();
    return entries.map((entry) => `${entry.flowId}/${entry.imageName}`);
};
/** 只识别指定 Flow，不执行任何点击。 */
export const inspectFlow = async (options) => {
    const context = await options.loader.switchTo(options.flowId);
    const frame = await options.adb.screenshot();
    const image = decodeImage(frame, 'adb-screenshot.png');
    const matches = await options.matcher.matchAll(frame, context.templates, options.method ?? 'template');
    return {
        flowId: context.id,
        width: image.width,
        height: image.height,
        matches: context.templates.map((template, index) => ({
            imageName: template.descriptor.name,
            match: matches[index],
        })),
    };
};
// 保证工具层使用同一个文件名 DSL，避免 capture 生成运行时无法解析的名称。
export const validateCaptureName = (flowId, name) => {
    assertSafeFlowId(flowId);
    assertSafeImageName(name);
    parseImageDescriptor(flowId, `${name}.png`);
};

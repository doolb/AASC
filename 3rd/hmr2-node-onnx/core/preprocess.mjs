import sharp from 'sharp';
import bmp from 'bmp-js';
import { createHash } from 'node:crypto';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { ServiceError, requireService } from './errors.mjs';
import { validateBBox } from './protocol.mjs';

// .src/framework/hmr2-node-onnx-project-service.md：对应原NumPy2/ViTDet的每步dtype。
const F = Math.fround;
const MEAN = [0.485, 0.456, 0.406].map((value) => value * 255);
const STD = [0.229, 0.224, 0.225].map((value) => value * 255);

export function boxGeometry(box) {
  const [x0, y0, x1, y1] = box.map(F);
  const center = [F(F(x1 + x0) / 2), F(F(y1 + y0) / 2)];
  const scale = [F(F(x1 - x0) / 200), F(F(y1 - y0) / 200)];
  const width = F(scale[0] * 200);
  const height = F(scale[1] * 200);
  // 原函数先比较float32 h/w；逐步乘/除不得代数合并。
  const expanded = F(height / width) < F(256 / 192)
    ? [width, Math.max(F(F(width * 256) / 192), height)]
    : [Math.max(F(F(height * 192) / 256), width), height];
  const boxSize = Math.max(...expanded);
  const factor = F(F(F(boxSize * 1) / 256) / 2);
  const blurApplied = factor > F(1.1);
  const sigma = blurApplied ? F(F(factor - 1) / 2) : 0;
  const radius = blurApplied ? Math.floor(4 * sigma + 0.5) : 0;
  const half = F(boxSize * 0.5);
  const sourcePoints = [center[0], center[1], center[0], F(center[1] + half), F(center[0] + half), center[1]];
  requireService([...center, ...scale, boxSize, factor, sigma, ...sourcePoints].every(Number.isFinite) &&
    width > 0 && height > 0 && boxSize > 0, 400, 'invalid_bbox', 'bbox在float32量化后退化或非有限');
  return { center, scale, expanded, boxSize, factor, blurApplied, sigma, radius, sourcePoints };
}

// NumPy小数组pairwise sum的8路归约；Math.exp仍可能与NumPy SIMD exp相差最后几bit。
function pairwiseSum(values, start = 0, count = values.length) {
  if (count < 8) {
    let total = -0;
    for (let i = 0; i < count; i += 1) total += values[start + i];
    return total;
  }
  if (count > 128) {
    const half = Math.floor(Math.floor(count / 2) / 8) * 8;
    return pairwiseSum(values, start, half) + pairwiseSum(values, start + half, count - half);
  }
  const lanes = Array.from(values.slice(start, start + 8));
  let i = 8;
  for (; i + 8 <= count; i += 8) {
    for (let lane = 0; lane < 8; lane += 1) lanes[lane] += values[start + i + lane];
  }
  let total = ((lanes[0] + lanes[1]) + (lanes[2] + lanes[3])) + ((lanes[4] + lanes[5]) + (lanes[6] + lanes[7]));
  for (; i < count; i += 1) total += values[start + i];
  return total;
}

export function gaussianKernel(sigma) {
  requireService(Number.isFinite(sigma) && sigma > 0, 400, 'invalid_sigma', 'Gaussian sigma必须有限正数');
  const sigma32 = F(sigma);
  const radius = Math.floor(4 * sigma32 + 0.5);
  const coefficient = F(-0.5 / F(sigma32 * sigma32));
  const weights = Float64Array.from({ length: radius * 2 + 1 }, (_, index) => {
    const x = index - radius;
    return Math.exp(coefficient * (x * x));
  });
  const total = pairwiseSum(weights);
  for (let i = 0; i < weights.length; i += 1) weights[i] /= total;
  return { radius, weights };
}

async function filterAxis(input, width, height, kernel, axis) {
  const { radius, weights } = kernel;
  const output = new Float64Array(input.length);
  const row = width * 3;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = y * row + x * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = input[base + channel] * weights[radius];
        // SciPy对称核：中心先，再从外向内的左右配对；nearest是索引clamp。
        for (let offset = -radius; offset < 0; offset += 1) {
          const leftY = axis === 0 ? Math.max(0, y + offset) : y;
          const rightY = axis === 0 ? Math.min(height - 1, y - offset) : y;
          const leftX = axis === 1 ? Math.max(0, x + offset) : x;
          const rightX = axis === 1 ? Math.min(width - 1, x - offset) : x;
          sum += (input[leftY * row + leftX * 3 + channel] + input[rightY * row + rightX * 3 + channel]) * weights[radius + offset];
        }
        output[base + channel] = sum;
      }
    }
    if ((y & 15) === 15) await yieldImmediate(); // 保持忙态/health可被事件循环及时处理。
  }
  return output;
}

export async function gaussianNearest(input, width, height, sigma) {
  const kernel = gaussianKernel(sigma);
  const doubles = Float64Array.from(input);
  if (kernel.radius === 0) return doubles; // 仍返回float64，不能改走无blur的uint8 warp。
  const vertical = await filterAxis(doubles, width, height, kernel, 0);
  return filterAxis(vertical, width, height, kernel, 1);
}

function imageFormat(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 2 && bytes.toString('ascii', 0, 2) === 'BM') return 'bmp';
  throw new ServiceError(400, 'invalid_image', '仅支持经验证的PNG/JPEG/WebP/BMP原图');
}

function checkSize(width, height, maxPixels) {
  requireService(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0,
    400, 'invalid_image', '图像尺寸无效');
  requireService(width * height <= maxPixels, 413, 'image_too_large', '图像像素超过限制');
  // OpenCV remap的short坐标限制；主动报错，不用另一resize偷偷改变输入。
  requireService(width < 32767 && height < 32767, 400, 'invalid_image', '图像边长超过OpenCV仿射限制');
}

function decodeBmp(bytes, maxPixels) {
  requireService(bytes.length >= 54 && bytes.readUInt32LE(14) === 40,
    400, 'invalid_image', 'BMP仅支持完整40-byte标准DIB，不接受扩展头');
  const width = bytes.readInt32LE(18);
  const height = Math.abs(bytes.readInt32LE(22));
  checkSize(width, height, maxPixels);
  const bits = bytes.readUInt16LE(28);
  const offset = bytes.readUInt32LE(10);
  const compression = bytes.readUInt32LE(30);
  requireService(bytes.readUInt16LE(26) === 1 && [1, 4, 8, 16, 24, 32].includes(bits) && compression === 0,
    400, 'invalid_image', 'BMP仅支持未压缩标准位图');
  const paletteColors = bytes.readUInt32LE(46);
  const paletteLimit = bits <= 8 ? 2 ** bits : 0;
  requireService(bits <= 8 ? paletteColors <= paletteLimit : paletteColors === 0,
    400, 'invalid_image', 'BMP调色板数量超过位深范围或非索引图包含调色板');
  const paletteCount = bits <= 8 ? (paletteColors || paletteLimit) : 0;
  // bmp-js不使用bfOffBits定位像素；只接受其真正读取的紧邻头/调色板起点。
  const expectedPixelOffset = 54 + paletteCount * 4;
  requireService(offset === expectedPixelOffset,
    400, 'invalid_image', 'BMP像素起点与标准头和调色板不一致，不接受gap或扩展布局');
  const rowBytes = Math.ceil(width * bits / 32) * 4;
  requireService(expectedPixelOffset + rowBytes * height <= bytes.length,
    400, 'invalid_image', 'BMP像素数据或完整行padding被截断');
  const result = bmp.decode(bytes); // 调色板及行长度已限额；输出ABGR，不合成alpha背景。
  requireService(result.width === width && result.height === height && result.data.length === width * height * 4,
    400, 'invalid_image', 'BMP解码尺寸不一致');
  const bgr = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    bgr[pixel * 3] = result.data[pixel * 4 + 1];
    bgr[pixel * 3 + 1] = result.data[pixel * 4 + 2];
    bgr[pixel * 3 + 2] = result.data[pixel * 4 + 3];
  }
  return { bgr, width, height, orientation: 1, format: 'bmp', originalSize: [width, height] };
}

export async function decodeImage(bytes, { maxImageBytes = 16 * 1024 * 1024, maxPixels = 40_000_000 } = {}) {
  requireService((Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) && bytes.byteLength > 0,
    400, 'invalid_image', '图片必须是非空原图字节');
  requireService(bytes.byteLength <= maxImageBytes, 413, 'image_too_large', '图片字节超过限制');
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const format = imageFormat(raw);
  try {
    if (format === 'bmp') return decodeBmp(raw, maxPixels);
    const image = sharp(raw, { autoOrient: true, ignoreIcc: true, animated: false, page: 0, pages: 1,
      limitInputPixels: maxPixels, failOn: 'warning' });
    const metadata = await image.metadata();
    checkSize(metadata.width, metadata.height, maxPixels);
    const orientation = metadata.orientation ?? 1;
    const expectedSize = [metadata.width, metadata.height];
    if ([5, 6, 7, 8].includes(orientation)) expectedSize.reverse();
    const isCmyk = metadata.space === 'cmyk';
    // 显式保留CMYK working/output空间，否则Vips先转sRGB再转回，原字节已被色彩管理改变。
    const pipeline = isCmyk ? image.pipelineColourspace('cmyk').removeAlpha().toColourspace('cmyk')
      : image.removeAlpha().toColourspace('srgb');
    const { data, info } = await pipeline.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    const channels = isCmyk ? 4 : 3;
    requireService(info.channels === channels && info.width === expectedSize[0] && info.height === expectedSize[1] &&
      data.length === info.width * info.height * channels, 400, 'invalid_image', 'EXIF定向或解码尺寸不一致');
    const bgr = new Uint8Array(info.width * info.height * 3);
    for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = data[pixel * channels + (2 - channel)];
        const black = isCmyk ? data[pixel * 4 + 3] : 0;
        // OpenCV的整数CMYK转换以256移位，不是精确除255；K=0深色会有1LSB差，必须保留。
        bgr[pixel * 3 + channel] = isCmyk ? 255 - black - Math.floor(value * (255 - black) / 256) : value;
      }
    }
    return { bgr, width: info.width, height: info.height, orientation, format, originalSize: [metadata.width, metadata.height], sourceDepth: metadata.depth };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (/pixel limit/i.test(error.message ?? '')) throw new ServiceError(413, 'image_too_large', '图像像素超过限制');
    throw new ServiceError(400, 'invalid_image', '图片无法解码或格式未通过验证');
  }
}

export async function loadOpenCv() {
  const imported = await import('@techstark/opencv-js');
  const candidate = imported.default;
  const cv = candidate instanceof Promise ? await candidate : candidate;
  if (!cv.Mat) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ServiceError(503, 'preprocessor_unavailable', 'OpenCV初始化超时')), 30_000);
      cv.onRuntimeInitialized = () => { clearTimeout(timer); resolve(); };
      cv.onAbort = () => { clearTimeout(timer); reject(new ServiceError(503, 'preprocessor_unavailable', 'OpenCV初始化失败')); };
    });
  }
  requireService(typeof cv.warpAffine === 'function' && typeof cv.getAffineTransform === 'function' &&
    typeof cv.CV_64FC3 === 'number', 503, 'preprocessor_unavailable', 'OpenCV缺少float64仿射接口');
  return { cv }; // wrapper不被旧Emscripten Module.then反复promise assimilate。
}

export async function createPreprocessor(options = {}) {
  const { cv } = await loadOpenCv();
  const limits = { maxBlurPixels: 12_000_000, maxBlurRadius: 64, ...options };
  return async function prepareImage(bytes, bbox, { stages = false } = {}) {
    const decoded = await decodeImage(bytes, limits);
    const { boxXYXY, bboxSource } = validateBBox(bbox, decoded.width, decoded.height);
    const geometry = boxGeometry(boxXYXY);
    if (geometry.blurApplied) {
      requireService(decoded.width * decoded.height <= limits.maxBlurPixels && geometry.radius <= limits.maxBlurRadius,
        413, 'preprocess_too_large', 'float64整图Gaussian超过资源预算；请缩小原图或选择人物框');
    }
    const filtered = geometry.blurApplied ? await gaussianNearest(decoded.bgr, decoded.width, decoded.height, geometry.sigma) : decoded.bgr;
    let source;
    let destination;
    let sourcePoints;
    let destinationPoints;
    let matrix;
    try {
      source = new cv.Mat(decoded.height, decoded.width, geometry.blurApplied ? cv.CV_64FC3 : cv.CV_8UC3);
      if (geometry.blurApplied) source.data64F.set(filtered);
      else source.data.set(filtered);
      sourcePoints = cv.matFromArray(3, 1, cv.CV_32FC2, geometry.sourcePoints);
      destinationPoints = cv.matFromArray(3, 1, cv.CV_32FC2, [128, 128, 128, 256, 256, 128]);
      matrix = cv.getAffineTransform(sourcePoints, destinationPoints);
      destination = new cv.Mat();
      cv.warpAffine(source, destination, matrix, new cv.Size(256, 256), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
      const crop = geometry.blurApplied ? destination.data64F : destination.data;
      requireService(crop.length === 256 * 256 * 3, 500, 'preprocess_failed', 'OpenCV crop维度不一致');
      const image = new Float32Array(3 * 256 * 192);
      for (let channel = 0; channel < 3; channel += 1) {
        for (let y = 0; y < 256; y += 1) {
          for (let x = 0; x < 192; x += 1) {
            const pixel = F(crop[(y * 256 + x + 32) * 3 + (2 - channel)]);
            image[(channel * 256 + y) * 192 + x] = F((pixel - MEAN[channel]) / STD[channel]);
          }
        }
      }
      const inputs = { img: image, box_center: Float32Array.from(geometry.center),
        box_size: Float32Array.of(geometry.boxSize), img_size: Float32Array.of(decoded.width, decoded.height) };
      const metadata = { imageSize: [decoded.width, decoded.height], boxXYXY, bboxSource,
        inputTensorSha256: createHash('sha256').update(Buffer.from(image.buffer)).digest('hex'),
        preprocessing: { decoder: decoded.format === 'bmp' ? 'bmp-js 0.1.0' : `sharp ${sharp.versions.sharp}`,
          opencv: cv.getBuildInformation().split('\n').find((line) => /General configuration/.test(line))?.trim() ?? 'OpenCV WASM 4.12',
          format: decoded.format, orientation: decoded.orientation, originalSize: decoded.originalSize,
          gaussian: geometry.blurApplied, sigma: geometry.sigma, radius: geometry.radius, warpDtype: geometry.blurApplied ? 'float64' : 'uint8' } };
      const debug = stages ? { decodedBgr: decoded.bgr, geometry, matrix: Float64Array.from(matrix.data64F),
        warpBgr: geometry.blurApplied ? Float64Array.from(crop) : Uint8Array.from(crop) } : undefined;
      return { inputs, metadata, stages: debug };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(500, 'preprocess_failed', '原图仿射预处理失败；不会改用resize替代');
    } finally {
      for (const mat of [matrix, destinationPoints, sourcePoints, destination, source]) mat?.delete();
    }
  };
}

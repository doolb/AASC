import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import bmp from 'bmp-js';
import { boxGeometry, gaussianKernel, gaussianNearest, decodeImage, createPreprocessor } from './preprocess.mjs';

// 映射.src/framework/hmr2-node-onnx-project-service.md；仅CPU像素/几何，不加载HMR模型。
test('bbox保留float32除200再乘200、aspect与半径0的float64分支', () => {
  const small = boxGeometry([0, 0, 300, 450]);
  assert.equal(small.boxSize, 450);
  assert.equal(small.blurApplied, false);
  const single = boxGeometry([0, 0, 450, 580]);
  assert.equal(single.boxSize, 600);
  assert.equal(single.blurApplied, true);
  assert.equal(single.radius, 0);
  assert.deepEqual(single.sourcePoints, [225, 290, 225, 590, 525, 290]);
  assert.throws(() => boxGeometry([0, 0, 1e-50, 1e-50]), /退化/);
});

test('nearest Gaussian系数对称归一、sigma32、竖后横，半径0保留Double', async () => {
  const { weights, radius } = gaussianKernel(0.8);
  assert.equal(radius, 3);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-15);
  assert.deepEqual([...weights], [...weights].reverse());
  const input = Uint8Array.from([10, 20, 30, 40, 50, 60]);
  const zero = await gaussianNearest(input, 2, 1, 0.08);
  assert.ok(zero instanceof Float64Array);
  assert.deepEqual([...zero], [...input]);
  const blurred = await gaussianNearest(input, 2, 1, 0.8);
  assert.ok(blurred[0] > 10 && blurred[0] < 25);
  assert.ok(Math.abs(blurred[0] + blurred[3] - 50) < 1e-12);
  assert.deepEqual([...input], [10, 20, 30, 40, 50, 60]);
});

test('PNG丢alpha不flatten、灰度扩3ch，字节/像素/魔数边界先验证', async () => {
  const png = await sharp(Buffer.from([20, 80, 150, 0]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
  const decoded = await decodeImage(png);
  assert.deepEqual([...decoded.bgr], [150, 80, 20]);
  const gray = await sharp(Buffer.from([37]), { raw: { width: 1, height: 1, channels: 1 } }).png().toBuffer();
  assert.deepEqual([...(await decodeImage(gray)).bgr], [37, 37, 37]);
  await assert.rejects(decodeImage(png, { maxImageBytes: 1 }), /字节/);
  await assert.rejects(decodeImage(Buffer.from('not an image')), /仅支持/);
  const large = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  await assert.rejects(decodeImage(large, { maxPixels: 1 }), /像素/);
});

test('BMP标准未压缩ABGR解码成原BGR，截断拒绝', async () => {
  const encoded = bmp.encode({ width: 1, height: 1, data: Buffer.from([255, 150, 80, 20]) }).data;
  assert.deepEqual([...(await decodeImage(encoded)).bgr], [150, 80, 20]);
  await assert.rejects(decodeImage(encoded.subarray(0, 54)), /截断/);
});

test('真实OpenCV WASM uint8/float64仿射、RGB规范化与256x192固定输入', async () => {
  const prepare = await createPreprocessor();
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 80, b: 150 } } }).png().toBuffer();
  const result = await prepare(png, undefined, { stages: true });
  assert.equal(result.inputs.img.length, 3 * 256 * 192);
  assert.ok(result.stages.warpBgr instanceof Uint8Array);
  assert.deepEqual(result.metadata.imageSize, [16, 16]);
  assert.equal(result.metadata.bboxSource, 'full_image_fallback');
  assert.equal(result.metadata.inputTensorSha256.length, 64);
  const index = 128 * 192 + 96;
  assert.equal(result.inputs.img[index], Math.fround((20 - 255 * 0.485) / (255 * 0.229)));
  const big = await sharp({ create: { width: 640, height: 640, channels: 3, background: { r: 20, g: 80, b: 150 } } }).png().toBuffer();
  const floating = await prepare(big, [0, 0, 450, 580], { stages: true });
  assert.equal(floating.metadata.preprocessing.gaussian, true);
  assert.equal(floating.metadata.preprocessing.radius, 0);
  assert.ok(floating.stages.warpBgr instanceof Float64Array);
  assert.ok(floating.inputs.img.every(Number.isFinite));
  await assert.rejects(prepare(png, null), /bbox/);
});

// BMP安全门fixture仅数十至千余字节；按真实bfOffBits构造，不依赖编码器隐藏palette布局。
function tinyIndexedBitmap({ bits, paletteColors = 0, topDown = false, width = 3, height = 2 }) {
  assert.ok([1, 4, 8].includes(bits));
  const paletteCount = paletteColors || 2 ** bits;
  const rowBytes = Math.ceil(width * bits / 32) * 4;
  const offset = 54 + paletteCount * 4;
  const bytes = Buffer.alloc(offset + rowBytes * height);
  bytes.write('BM', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(offset, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(topDown ? -height : height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(bits, 28);
  bytes.writeUInt32LE(rowBytes * height, 34);
  bytes.writeUInt32LE(paletteColors, 46);
  const palette = Array.from({ length: paletteCount }, (_, index) => [
    (7 + index * 67) % 256, (80 + index * 29) % 256, (150 + index * 11) % 256,
  ]);
  for (let index = 0; index < paletteCount; index += 1) {
    bytes.set(palette[index], 54 + index * 4); // RGBQUAD存BGR及一个保留字节。
  }
  const expectedBgr = [];
  for (let y = 0; y < height; y += 1) {
    const fileRow = topDown ? y : height - 1 - y;
    const row = offset + fileRow * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const index = (x + y) % paletteCount;
      expectedBgr.push(...palette[index]);
      if (bits === 1) bytes[row + Math.floor(x / 8)] |= index << (7 - x % 8);
      if (bits === 4) bytes[row + Math.floor(x / 2)] |= index << (x % 2 === 0 ? 4 : 0);
      if (bits === 8) bytes[row + x] = index;
    }
  }
  return { bytes, width, height, expectedBgr, offset, rowBytes };
}

function invalidBitmap(cause) {
  return cause?.name === 'ServiceError' && cause.status === 400 && cause.code === 'invalid_image';
}

test('BMP 1/4/8位合法完整与部分palette、top-down及行padding正确解码', async (t) => {
  const cases = [
    { bits: 1, paletteColors: 0 },
    { bits: 4, paletteColors: 4 },
    { bits: 4, paletteColors: 0, topDown: true },
    { bits: 8, paletteColors: 3 },
    { bits: 8, paletteColors: 0, topDown: true },
  ];
  for (const options of cases) {
    await t.test(`${options.bits}bit/colors=${options.paletteColors}/topDown=${!!options.topDown}`, async () => {
      const f = tinyIndexedBitmap(options);
      const decoded = await decodeImage(f.bytes);
      assert.deepEqual([...decoded.bgr], f.expectedBgr);
      assert.deepEqual([decoded.width, decoded.height], [f.width, f.height]);
      assert.equal(decoded.format, 'bmp');
      assert.equal(decoded.orientation, 1);
    });
  }
});

test('BMP扩展DIB、pixel gap及越界palette字段在decoder前拒400', async (t) => {
  const standard = bmp.encode({ width: 1, height: 1, data: Buffer.from([255, 150, 80, 20]) }).data;
  for (const dibSize of [108, 124]) {
    await t.test(`拒绝DIB=${dibSize}`, async () => {
      const offset = 14 + dibSize;
      const extended = Buffer.alloc(offset + 4);
      standard.copy(extended, 0, 0, 54);
      standard.copy(extended, offset, 54);
      extended.writeUInt32LE(dibSize, 14);
      extended.writeUInt32LE(offset, 10);
      extended.writeUInt32LE(extended.length, 2);
      await assert.rejects(decodeImage(extended), invalidBitmap);
    });
  }
  await t.test('拒绝合法bfOffBits带4字节gap而非静默读gap颜色', async () => {
    const gap = Buffer.alloc(standard.length + 4);
    standard.copy(gap, 0, 0, 54);
    gap.set([1, 2, 3, 4], 54);
    standard.copy(gap, 58, 54);
    gap.writeUInt32LE(58, 10);
    gap.writeUInt32LE(gap.length, 2);
    await assert.rejects(decodeImage(gap), invalidBitmap);
  });
  for (const bits of [1, 4, 8]) {
    await t.test(`拒绝${bits}bit的超范围paletteColors`, async () => {
      const f = tinyIndexedBitmap({ bits });
      f.bytes.writeUInt32LE(2 ** bits + 1, 46);
      await assert.rejects(decodeImage(f.bytes), invalidBitmap);
    });
  }
  await t.test('拒绝uint32巨paletteColors而不建立巨数组', async () => {
    const f = tinyIndexedBitmap({ bits: 8, paletteColors: 3 });
    f.bytes.writeUInt32LE(0xffffffff, 46);
    await assert.rejects(decodeImage(f.bytes), invalidBitmap);
  });
  await t.test('非索引24位必须paletteColors=0', async () => {
    const extraPalette = Buffer.from(standard);
    extraPalette.writeUInt32LE(1, 46);
    await assert.rejects(decodeImage(extraPalette), invalidBitmap);
  });
});

test('BMP palette真实起点与完整rowStride、planes及compression门禁', async (t) => {
  await t.test('palette存在但bfOffBits指向54拒绝', async () => {
    const f = tinyIndexedBitmap({ bits: 8, paletteColors: 3 });
    f.bytes.writeUInt32LE(54, 10);
    await assert.rejects(decodeImage(f.bytes), invalidBitmap);
  });
  await t.test('仅截去行padding也必须拒绝', async () => {
    const f = tinyIndexedBitmap({ bits: 1 });
    await assert.rejects(decodeImage(f.bytes.subarray(0, f.bytes.length - 1)), invalidBitmap);
  });
  await t.test('错误planes拒绝', async () => {
    const f = tinyIndexedBitmap({ bits: 4, paletteColors: 4 });
    f.bytes.writeUInt16LE(2, 26);
    await assert.rejects(decodeImage(f.bytes), invalidBitmap);
  });
  await t.test('压缩palette布局拒绝', async () => {
    const f = tinyIndexedBitmap({ bits: 8, paletteColors: 3 });
    f.bytes.writeUInt32LE(1, 30);
    await assert.rejects(decodeImage(f.bytes), invalidBitmap);
  });
});

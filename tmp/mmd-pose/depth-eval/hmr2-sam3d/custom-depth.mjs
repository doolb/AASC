// 自选图深度直接在浏览器推理；模型输出只代表当前图像可见表面的相对顺序。
let sessionPromise;
let configPromise;

async function resources() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import('/ort/ort.wasm.min.mjs');
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = new URL('/ort/', location.href).href;
      const session = await ort.InferenceSession.create('/_depth/rigid-projection/model_quantized.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, session };
    })().catch((error) => { sessionPromise = null; throw error; });
  }
  if (!configPromise) configPromise = fetch('/_depth/rigid-projection/preprocessor_config.json').then((response) => {
    if (!response.ok) throw new Error('深度预处理配置不可用');
    return response.json();
  }).catch((error) => { configPromise = null; throw error; });
  return { ...await sessionPromise, config: await configPromise };
}

export async function inferDepth(image) {
  const { ort, session, config } = await resources();
  const started = performance.now();
  const scale = Math.abs(1 - 518 / image.width) < Math.abs(1 - 518 / image.height) ? 518 / image.width : 518 / image.height;
  const width = Math.max(14, Math.round(image.width * scale / 14) * 14);
  const height = Math.max(14, Math.round(image.height * scale / 14) * 14);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const plane = width * height;
  const values = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    for (let channel = 0; channel < 3; channel++) values[channel * plane + i] = (rgba[i * 4 + channel] / 255 - config.image_mean[channel]) / config.image_std[channel];
  }
  const input = new ort.Tensor('float32', values, [1, 3, height, width]);
  let outputs;
  try {
    outputs = await session.run({ [session.inputNames[0]]: input });
    const output = outputs[session.outputNames[0]];
    const data = output.data;
    const dims = output.dims;
    if (dims.length !== 3 || dims[0] !== 1 || !Array.from(data).every(Number.isFinite)) throw new Error('深度模型输出无效');
    const sorted = Array.from(data).sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.05)];
    const high = sorted[Math.floor(sorted.length * 0.95)];
    const range = Math.max(high - low, 1e-6);
    canvas.width = dims[2];
    canvas.height = dims[1];
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < data.length; i++) {
      const value = Math.max(0, Math.min(1, (data[i] - low) / range));
      pixels.data.set([255 * value, 200 * value, 255 * (1 - value), 255], i * 4);
    }
    context.putImageData(pixels, 0, 0);
    return { src: canvas.toDataURL('image/png'), ms: performance.now() - started };
  } finally {
    input.dispose();
    if (outputs) for (const output of Object.values(outputs)) output.dispose();
  }
}

import vm from 'node:vm';
import { decodeImage } from './image-decoder.js';
import { normalizeObservation } from './observation-normalizer.js';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const activePixel = (r, g, b, color) => {
  if (color === 'green') return g > r * 1.15 && g > b * 1.1 && g > 45;
  if (color === 'blue') return b > r * 1.15 && b > g * 1.03 && b > 35;
  if (color === 'red') return r > g * 1.15 && r > b * 1.15 && r > 45;
  return Math.max(r, g, b) - Math.min(r, g, b) > 25;
};

/** Measure a colored HUD bar using decoded RGBA pixels and a configured ROI. */
export const measureColorBarRatio = (image, roi, options = {}) => {
  if (!image?.data || !Number.isInteger(image.width) || !Number.isInteger(image.height)) return 0;
  const x0 = Math.max(0, Math.floor(number(roi?.x)));
  const y0 = Math.max(0, Math.floor(number(roi?.y)));
  const x1 = Math.min(image.width, x0 + Math.max(0, Math.floor(number(roi?.width))));
  const y1 = Math.min(image.height, y0 + Math.max(0, Math.floor(number(roi?.height))));
  let total = 0;
  let active = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const offset = (y * image.width + x) * 4;
    total += 1;
    if (activePixel(image.data[offset], image.data[offset + 1], image.data[offset + 2], options.color ?? 'green')) active += 1;
  }
  return total ? active / total : 0;
};

const decodeFrame = (frame) => {
  if (frame?.image?.data) return clone(frame.image);
  if (!frame?.buffer || !frame?.width || !frame?.height) return { width: frame?.width, height: frame?.height };
  try { return decodeImage(frame.buffer, 'script-frame.png'); } catch { return { width: frame.width, height: frame.height }; }
};

/** Run trusted, timeout-limited package JavaScript in a restricted VM context. */
export class ScriptRecognitionAdapter {
  constructor(options = {}) {
    this.timeoutMs = Math.max(1, Number(options.timeoutMs ?? 50));
    this.helpers = { measureColorBarRatio, ...(options.helpers ?? {}) };
    this.scripts = new Map();
    for (const [id, source] of Object.entries(options.scripts ?? {})) this.register(id, source);
  }

  register(id, source) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('recognition script id is required');
    if (typeof source !== 'string' || !source.trim()) throw new Error(`recognition script source is required: ${id}`);
    const context = vm.createContext(Object.create(null));
    const factory = new vm.Script(`(${source})`, { filename: `recognition:${id}` });
    const module = factory.runInContext(context, { timeout: this.timeoutMs });
    const observe = typeof module === 'function' ? module : module?.observe;
    const postprocess = module?.postprocess;
    if (typeof observe !== 'function' && typeof postprocess !== 'function') {
      throw new Error(`recognition script must export observe() or postprocess(): ${id}`);
    }
    context.module = module;
    this.scripts.set(id, { context, observe, postprocess });
    return this;
  }

  async observe(frame, context = {}) {
    const scriptId = context.scriptId ?? context.recognitionScriptId;
    const registered = this.scripts.get(scriptId);
    if (!registered) throw new Error(`recognition script is not configured: ${scriptId}`);
    registered.context.input = { frame: decodeFrame(frame), metadata: { observedAt: frame?.observedAt, source: frame?.source }, context: clone(context.scriptContext ?? {}) };
    registered.context.helpers = this.helpers;
    registered.context.result = undefined;
    if (typeof registered.observe !== 'function') throw new Error(`recognition script has no observe(): ${scriptId}`);
    new vm.Script('result = module.observe(input, helpers)', { filename: `recognition:${scriptId}:observe` })
      .runInContext(registered.context, { timeout: this.timeoutMs });
    return normalizeObservation(registered.context.result ?? {});
  }

  async postprocess(frame, match, context = {}, scriptId = context.postprocessScriptId) {
    const registered = this.scripts.get(scriptId);
    if (!registered) throw new Error(`recognition postprocess script is not configured: ${scriptId}`);
    if (typeof registered.postprocess !== 'function') throw new Error(`recognition script has no postprocess(): ${scriptId}`);
    registered.context.input = {
      frame: decodeFrame(frame),
      match: clone(match ?? {}),
      metadata: { observedAt: frame?.observedAt, source: frame?.source },
      context: clone(context.scriptContext ?? {}),
    };
    registered.context.helpers = this.helpers;
    registered.context.result = undefined;
    new vm.Script('result = module.postprocess(input, helpers)', { filename: `recognition:${scriptId}:postprocess` })
      .runInContext(registered.context, { timeout: this.timeoutMs });
    return normalizeObservation(registered.context.result ?? {});
  }
}

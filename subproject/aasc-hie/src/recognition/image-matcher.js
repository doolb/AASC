import { decodeImage } from './image-decoder.js';
import { getOpenCv } from './opencv-runtime.js';

const noMatch = (method) => ({ score: 0, rect: null, matched: false, method });

const toGrayMat = (cv, image) => {
  const rgba = new cv.Mat(image.height, image.width, cv.CV_8UC4);
  rgba.data.set(image.data);
  const gray = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    return gray;
  } catch (error) {
    gray.delete();
    throw new Error('failed to convert image to grayscale', { cause: error });
  } finally {
    rgba.delete();
  }
};

const thresholdFor = (template) => {
  const value = template?.descriptor?.threshold ?? template?.threshold ?? 0.8;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('image match threshold must be between 0 and 1');
  }
  return value;
};

const templateMatch = (cv, frame, template, threshold) => {
  if (template.cols > frame.cols || template.rows > frame.rows) return noMatch('template');
  const result = new cv.Mat();
  try {
    cv.matchTemplate(frame, template, result, cv.TM_CCOEFF_NORMED);
    const extrema = cv.minMaxLoc(result);
    const score = Number(extrema.maxVal);
    const rect = {
      x: Number(extrema.maxLoc.x),
      y: Number(extrema.maxLoc.y),
      width: template.cols,
      height: template.rows,
    };
    const matched = Number.isFinite(score) && score >= threshold;
    return { score, rect: matched ? rect : null, matched, method: 'template' };
  } catch (error) {
    throw new Error('OpenCV template matching failed', { cause: error });
  } finally {
    result.delete();
  }
};

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const orbMatch = (cv, frame, template, threshold) => {
  const orb = new cv.ORB(500);
  const emptyMask = new cv.Mat();
  const frameKeypoints = new cv.KeyPointVector();
  const templateKeypoints = new cv.KeyPointVector();
  const frameDescriptors = new cv.Mat();
  const templateDescriptors = new cv.Mat();
  const matches = new cv.DMatchVector();
  try {
    orb.detectAndCompute(frame, emptyMask, frameKeypoints, frameDescriptors);
    orb.detectAndCompute(template, emptyMask, templateKeypoints, templateDescriptors);
    if (frameDescriptors.rows === 0 || templateDescriptors.rows === 0) return noMatch('orb');
    const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    matcher.match(templateDescriptors, frameDescriptors, matches);
    const good = [];
    for (let index = 0; index < matches.size(); index += 1) {
      const match = matches.get(index);
      if (match.distance > 80) continue;
      const source = templateKeypoints.get(match.queryIdx).pt;
      const target = frameKeypoints.get(match.trainIdx).pt;
      good.push({ distance: Number(match.distance), x: target.x - source.x, y: target.y - source.y });
    }
    if (!good.length) return noMatch('orb');
    const score = Math.max(0, 1 - (good.reduce((sum, item) => sum + item.distance, 0) / good.length) / 256);
    const rect = {
      x: Math.round(median(good.map((item) => item.x))),
      y: Math.round(median(good.map((item) => item.y))),
      width: template.cols,
      height: template.rows,
    };
    return { score, rect: score >= threshold ? rect : null, matched: score >= threshold, method: 'orb' };
  } catch (error) {
    throw new Error('OpenCV ORB matching failed', { cause: error });
  } finally {
    matches.delete();
    templateDescriptors.delete();
    frameDescriptors.delete();
    templateKeypoints.delete();
    frameKeypoints.delete();
    emptyMask.delete();
    orb.delete();
  }
};

export class OpenCvImageMatcher {
  templateCache = new Map();

  async match(frameBuffer, template, method = 'template') {
    const cv = await getOpenCv();
    const frame = toGrayMat(cv, decodeImage(frameBuffer, 'frame.png'));
    try {
      return await this.matchWithFrameMat(cv, frame, template, method);
    } finally {
      frame.delete();
    }
  }

  async matchAll(frameBuffer, templates, method = 'template') {
    const cv = await getOpenCv();
    const frame = toGrayMat(cv, decodeImage(frameBuffer, 'frame.png'));
    try {
      return await Promise.all(templates.map((template) => this.matchWithFrameMat(cv, frame, template, method)));
    } finally {
      frame.delete();
    }
  }

  clear() {
    for (const entry of this.templateCache.values()) {
      entry.disposed = true;
      if (entry.mat && typeof entry.mat.delete === 'function') {
        entry.mat.delete();
        entry.mat = null;
      }
    }
    this.templateCache.clear();
  }

  async matchWithFrameMat(cv, frame, template, method) {
    const templateMat = await this.loadTemplateMat(cv, template);
    const threshold = thresholdFor(template);
    return method === 'orb'
      ? orbMatch(cv, frame, templateMat, threshold)
      : templateMatch(cv, frame, templateMat, threshold);
  }

  loadTemplateMat(cv, template) {
    const filePath = template?.descriptor?.filePath ?? template?.filePath ?? 'template.png';
    const bytes = Buffer.from(template.buffer);
    const cacheKey = `${filePath}:${bytes.toString('base64')}`;
    const existing = this.templateCache.get(cacheKey);
    if (existing) return existing.promise;
    const entry = { mat: null, disposed: false, promise: null };
    entry.promise = Promise.resolve()
      .then(() => toGrayMat(cv, decodeImage(bytes, filePath)))
      .then((mat) => {
        entry.mat = mat;
        if (entry.disposed) {
          mat.delete();
          entry.mat = null;
          throw new Error('OpenCV template cache entry was cleared while loading');
        }
        return mat;
      })
      .catch((error) => {
        if (this.templateCache.get(cacheKey) === entry) this.templateCache.delete(cacheKey);
        throw error;
      });
    this.templateCache.set(cacheKey, entry);
    return entry.promise;
  }
}

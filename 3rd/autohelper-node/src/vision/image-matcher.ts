import type { LoadedTemplate, MatchMethod, MatchResult, Rect } from '../types.js';
import { decodeImage, type DecodedImage } from './image-decoder.js';
import { getOpenCv, type OpenCvApi } from './opencv-runtime.js';

type OpenCvMat = InstanceType<OpenCvApi['Mat']>;

type MatchExtrema = {
  maxVal: number;
  maxLoc: { x: number; y: number };
};

const noMatch = (method: MatchMethod): MatchResult => ({
  score: 0,
  rect: null,
  matched: false,
  method,
});

const toGrayMat = (cv: OpenCvApi, image: DecodedImage): OpenCvMat => {
  const rgba = new cv.Mat(image.height, image.width, cv.CV_8UC4);
  // OpenCV.js 5 的运行时统一通过 data 暴露连续像素，类型声明中的
  // data8U 在 Emscripten 实例上并不会实际生成。
  rgba.data.set(image.data);
  const gray = new cv.Mat();

  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    return gray;
  } catch (error: unknown) {
    gray.delete();
    throw new Error('failed to convert image to grayscale', { cause: error });
  } finally {
    rgba.delete();
  }
};

const templateMatch = (
  cv: OpenCvApi,
  frame: OpenCvMat,
  template: OpenCvMat,
  threshold: number,
): MatchResult => {
  if (template.cols > frame.cols || template.rows > frame.rows) {
    return noMatch('template');
  }

  const result = new cv.Mat();
  try {
    cv.matchTemplate(frame, template, result, cv.TM_CCOEFF_NORMED);
    const extrema = (cv.minMaxLoc as unknown as (source: OpenCvMat) => MatchExtrema)(result);
    const score = Number(extrema.maxVal);
    const rect: Rect = {
      x: Number(extrema.maxLoc.x),
      y: Number(extrema.maxLoc.y),
      width: template.cols,
      height: template.rows,
    };
    const matched = Number.isFinite(score) && score >= threshold;
    return {
      score,
      rect: matched ? rect : null,
      matched,
      method: 'template',
    };
  } catch (error: unknown) {
    throw new Error('OpenCV template matching failed', { cause: error });
  } finally {
    result.delete();
  }
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

/**
 * ORB 只作为可选的尺度/轻微变化匹配器。
 * 这里用高质量特征的中位移量估算模板左上角，模板匹配仍是默认方式。
 */
const orbMatch = (
  cv: OpenCvApi,
  frame: OpenCvMat,
  template: OpenCvMat,
  threshold: number,
): MatchResult => {
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

    if (frameDescriptors.rows === 0 || templateDescriptors.rows === 0) {
      return noMatch('orb');
    }

    const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    matcher.match(templateDescriptors, frameDescriptors, matches);
    const goodMatches: Array<{ distance: number; x: number; y: number }> = [];

    for (let index = 0; index < matches.size(); index += 1) {
      const match = matches.get(index);
      if (match.distance > 80) {
        continue;
      }
      const source = templateKeypoints.get(match.queryIdx).pt;
      const target = frameKeypoints.get(match.trainIdx).pt;
      goodMatches.push({
        distance: Number(match.distance),
        x: Number(target.x) - Number(source.x),
        y: Number(target.y) - Number(source.y),
      });
    }

    if (goodMatches.length === 0) {
      return noMatch('orb');
    }

    const averageDistance = goodMatches.reduce((sum, match) => sum + match.distance, 0)
      / goodMatches.length;
    const score = Math.max(0, 1 - (averageDistance / 256));
    const rect: Rect = {
      x: Math.round(median(goodMatches.map((match) => match.x))),
      y: Math.round(median(goodMatches.map((match) => match.y))),
      width: template.cols,
      height: template.rows,
    };
    const matched = score >= threshold;
    return {
      score,
      rect: matched ? rect : null,
      matched,
      method: 'orb',
    };
  } catch (error: unknown) {
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

export type ImageMatcher = {
  match(frameBuffer: Buffer, template: LoadedTemplate, method?: MatchMethod): Promise<MatchResult>;
  matchAll(
    frameBuffer: Buffer,
    templates: LoadedTemplate[],
    method?: MatchMethod,
  ): Promise<MatchResult[]>;
};

export class OpenCvImageMatcher implements ImageMatcher {
  private readonly templateCache = new Map<string, Promise<OpenCvMat>>();

  public async match(
    frameBuffer: Buffer,
    template: LoadedTemplate,
    method: MatchMethod = 'template',
  ): Promise<MatchResult> {
    const cv = await getOpenCv();
    const frameImage = decodeImage(frameBuffer, 'adb-screenshot.png');
    const frameMat = toGrayMat(cv, frameImage);

    try {
      return await this.matchWithFrameMat(cv, frameMat, template, method);
    } finally {
      frameMat.delete();
    }
  }

  public async matchAll(
    frameBuffer: Buffer,
    templates: LoadedTemplate[],
    method: MatchMethod = 'template',
  ): Promise<MatchResult[]> {
    const cv = await getOpenCv();
    const frameImage = decodeImage(frameBuffer, 'adb-screenshot.png');
    const frameMat = toGrayMat(cv, frameImage);

    try {
      return await Promise.all(templates.map(async (template) => (
        await this.matchWithFrameMat(cv, frameMat, template, method)
      )));
    } finally {
      frameMat.delete();
    }
  }

  public clear(): void {
    this.templateCache.clear();
  }

  private async matchWithFrameMat(
    cv: OpenCvApi,
    frameMat: OpenCvMat,
    template: LoadedTemplate,
    method: MatchMethod,
  ): Promise<MatchResult> {
    const templateMat = await this.loadTemplateMat(cv, template);
    if (method === 'orb') {
      return orbMatch(cv, frameMat, templateMat, template.descriptor.threshold);
    }
    return templateMatch(cv, frameMat, templateMat, template.descriptor.threshold);
  }

  private loadTemplateMat(cv: OpenCvApi, template: LoadedTemplate): Promise<OpenCvMat> {
    const cacheKey = template.descriptor.filePath;
    const existing = this.templateCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const loading = Promise.resolve().then(() => {
      const image = decodeImage(template.buffer, template.descriptor.filePath);
      return toGrayMat(cv, image);
    }).catch((error: unknown) => {
      this.templateCache.delete(cacheKey);
      throw error;
    });
    this.templateCache.set(cacheKey, loading);
    return loading;
  }
}

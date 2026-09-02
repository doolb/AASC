import { basename, extname } from 'node:path';
import type { ImageDescriptor, Point } from '../types.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.bmp']);
const FLOW_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function parseFiniteNumber(value: string, field: string, filePath: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${field} in image filename: ${filePath}`);
  }
  return parsed;
}

function parsePoint(value: string, field: string, filePath: string): Point {
  const parts = value.split('&');
  if (parts.length !== 2) {
    throw new Error(`invalid ${field} in image filename: ${filePath}`);
  }

  const point = {
    x: parseFiniteNumber(parts[0], `${field}.x`, filePath),
    y: parseFiniteNumber(parts[1], `${field}.y`, filePath),
  };
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new Error(`invalid ${field} range in image filename: ${filePath}`);
  }
  return point;
}

function validateGotoFlow(flowId: string, filePath: string): string {
  if (!FLOW_ID_PATTERN.test(flowId) || flowId === '.' || flowId === '..') {
    throw new Error(`invalid goto flow id in image filename: ${filePath}`);
  }
  return flowId;
}

function parseQueue(key: string): number | null {
  const match = key.match(/^~?(\d+)$/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return key.startsWith('~') ? -value : value;
}

function parseStem(filePath: string): string {
  const fileName = basename(filePath);
  const extension = extname(fileName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported image extension in image filename: ${filePath}`);
  }
  return fileName.slice(0, -extension.length);
}

export function parseImageDescriptor(flowId: string, filePath: string): ImageDescriptor {
  const stem = parseStem(filePath);
  const descriptor: ImageDescriptor = {
    name: stem,
    flowId,
    filePath,
    queue: 0,
    threshold: 0.9,
    clickPoint: { x: 0.5, y: 0.5 },
    centerClick: false,
    delayMs: 0,
    loop: false,
    wait: false,
    defaultCandidate: false,
  };

  for (const token of stem.split(',')) {
    if (!token) {
      continue;
    }

    const separator = token.indexOf('@');
    const key = separator === -1 ? token : token.slice(0, separator);
    const value = separator === -1 ? '' : token.slice(separator + 1);
    const queue = parseQueue(key);
    if (queue !== null) {
      descriptor.queue = queue;
      if (value) {
        descriptor.threshold = parseFiniteNumber(value, 'threshold', filePath);
      }
      continue;
    }

    switch (key) {
      case 'select':
        if (!value) {
          throw new Error(`missing select image in image filename: ${filePath}`);
        }
        descriptor.selectImage = value.replaceAll('&', '@').replaceAll('_', ',');
        break;
      case 'loop':
        descriptor.loop = true;
        break;
      case 'clickpoint_ab':
        descriptor.centerClick = true;
        descriptor.clickPoint = parsePoint(value, 'clickpoint_ab', filePath);
        break;
      case 'clickpoint':
        descriptor.clickPoint = parsePoint(value, 'clickpoint', filePath);
        break;
      case 'wait':
        descriptor.wait = true;
        break;
      case 'default':
        descriptor.defaultCandidate = true;
        break;
      case 'delay': {
        const delay = parseFiniteNumber(value, 'delay', filePath);
        if (!Number.isInteger(delay) || delay < 0) {
          throw new Error(`invalid delay in image filename: ${filePath}`);
        }
        descriptor.delayMs = delay;
        break;
      }
      case 'goto':
        descriptor.gotoFlow = validateGotoFlow(value, filePath);
        break;
      default:
        if (value) {
          descriptor.threshold = parseFiniteNumber(value, 'threshold', filePath);
        }
        break;
    }
  }

  if (descriptor.threshold < 0 || descriptor.threshold > 1) {
    throw new Error(`invalid threshold range in image filename: ${filePath}`);
  }
  return descriptor;
}

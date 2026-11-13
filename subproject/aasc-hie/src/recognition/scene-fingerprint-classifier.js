import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decodeImage } from './image-decoder.js';

const imageOf = (frame) => frame?.image?.data
  ? frame.image
  : (frame?.data && frame.width && frame.height ? frame : decodeImage(frame?.buffer, 'frame.png'));

/** Compact RGB grid matcher for known game screens. It abstains on weak matches. */
export class SceneFingerprintClassifier {
  constructor(options = {}) {
    this.manifestPath = options.manifestPath;
    this.fingerprintPath = options.fingerprintPath;
    this.columns = Math.max(8, Number(options.columns ?? 48));
    this.rows = Math.max(8, Number(options.rows ?? 24));
    this.maxDistance = Number(options.maxDistance ?? 0.2);
    this.minMargin = Number(options.minMargin ?? 0.003);
    this.references = [];
    this.buttonProfiles = [];
    this.loadPromise = null;
    if (!this.manifestPath) throw new Error('scene fingerprint manifestPath is required');
  }

  async load() {
    if (this.loadPromise) return await this.loadPromise;
    this.loadPromise = (async () => {
      const references = [];
      if (this.fingerprintPath) {
        const index = JSON.parse(await readFile(resolve(this.fingerprintPath), 'utf8'));
        if (index.columns !== this.columns || index.rows !== this.rows || !Array.isArray(index.samples)) {
          throw new Error('scene fingerprint index dimensions do not match classifier configuration');
        }
        if (this.manifestPath && index.sourceReviewedManifestSha256) {
          const manifest = (await readFile(resolve(this.manifestPath), 'utf8')).split(/\r?\n/).filter(Boolean)
            .map((line) => JSON.parse(line)).filter((record) => record.annotationStatus?.startsWith('screen-reviewed'));
          const reviewedText = `${manifest.map((record) => JSON.stringify(record)).join('\n')}\n`;
          const reviewedHash = createHash('sha256').update(reviewedText).digest('hex');
          if (reviewedHash !== index.sourceReviewedManifestSha256) throw new Error('fingerprint index is stale; run npm run hok:index after reviewing dataset labels');
        }
        for (const sample of index.samples) {
          if (!sample.record?.sceneId || !sample.featureBase64) continue;
          references.push({ record: sample.record, feature: new Uint8Array(Buffer.from(sample.featureBase64, 'base64')) });
        }
        this.buttonProfiles = (index.buttonProfiles ?? []).map((profile) => ({
          ...profile,
          states: (profile.states ?? []).map((sample) => ({
            ...sample,
            feature: new Uint8Array(Buffer.from(sample.featureBase64 ?? '', 'base64')),
          })),
        }));
        this.references = references;
        return references.length;
      }
      const manifestPath = resolve(this.manifestPath);
      const text = await readFile(manifestPath, 'utf8');
      const records = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const root = dirname(manifestPath);
      for (const record of records) {
        if (!record.sceneId || !record.path
          || (record.annotationStatus && !record.annotationStatus.startsWith('screen-reviewed'))) continue;
        const buffer = await readFile(resolve(root, record.path));
        const image = decodeImage(buffer, record.path);
        references.push({ record, feature: this.feature(image) });
      }
      this.references = references;
      return references.length;
    })();
    return await this.loadPromise;
  }

  feature(frame) {
    const image = imageOf(frame);
    const { width, height, data } = image;
    if (!width || !height || !data) throw new Error('scene fingerprint requires a decoded image');
    const values = new Uint8Array(this.columns * this.rows * 3);
    let offset = 0;
    for (let row = 0; row < this.rows; row += 1) {
      const y = Math.min(height - 1, Math.floor((row + 0.5) * height / this.rows));
      for (let column = 0; column < this.columns; column += 1) {
        const x = Math.min(width - 1, Math.floor((column + 0.5) * width / this.columns));
        const source = (y * width + x) * 4;
        values[offset++] = data[source];
        values[offset++] = data[source + 1];
        values[offset++] = data[source + 2];
      }
    }
    return values;
  }

  async classify(frame) {
    await this.load();
    if (!this.references.length) return { matched: false, reason: 'empty-dataset' };
    const feature = this.feature(frame);
    const byScene = new Map();
    for (const reference of this.references) {
      let total = 0;
      for (let index = 0; index < feature.length; index += 1) {
        total += Math.abs(feature[index] - reference.feature[index]);
      }
      const distance = total / (feature.length * 255);
      const current = byScene.get(reference.record.sceneId);
      if (!current || distance < current.distance) byScene.set(reference.record.sceneId, { ...reference, distance });
    }
    const ranked = [...byScene.values()].sort((left, right) => left.distance - right.distance);
    const best = ranked[0];
    const next = ranked[1];
    const margin = next ? next.distance - best.distance : 1;
    const accepted = best.distance <= this.maxDistance
      && (margin >= this.minMargin || best.distance <= this.maxDistance * 0.25);
    return {
      matched: accepted,
      ...(accepted ? { sceneId: best.record.sceneId, labelZh: best.record.labelZh, sampleId: best.record.id } : {}),
      distance: Number(best.distance.toFixed(5)),
      similarity: Number(Math.max(0, 1 - best.distance).toFixed(4)),
      margin: Number(margin.toFixed(5)),
      reason: accepted ? 'dataset-fingerprint' : (best.distance > this.maxDistance ? 'distance-too-large' : 'ambiguous-match'),
      sample: best.record,
    };
  }
}

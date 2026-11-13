import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { decodeImage } from '../src/recognition/image-decoder.js';
import { SceneFingerprintClassifier } from '../src/recognition/scene-fingerprint-classifier.js';
import { parseNavigationPackage } from '../src/package/package-parser.js';

const root = resolve(import.meta.dirname, '..');
const datasetRoot = resolve(root, 'data/datasets/honor-of-kings');
const manifestPath = resolve(datasetRoot, 'manifest.jsonl');
const outputPath = resolve(datasetRoot, 'fingerprints-48x24.json');
const packagePath = resolve(root, 'data/packages/honor-of-kings.nav.md');
const manifest = await readFile(manifestPath);
const records = manifest.toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const reviewedRecords = records.filter((record) => record.annotationStatus?.startsWith('screen-reviewed'));
const navigationPackage = parseNavigationPackage(await readFile(packagePath, 'utf8'), packagePath);
const classifier = new SceneFingerprintClassifier({ manifestPath, columns: 48, rows: 24 });
const samples = [];
const imagesById = new Map();
const recordById = new Map(reviewedRecords.map((record) => [record.id, record]));
for (const record of reviewedRecords) {
  if (!record.sceneId || !record.path) continue;
  const buffer = await readFile(resolve(datasetRoot, record.path));
  const image = decodeImage(buffer, record.path);
  imagesById.set(record.id, image);
  const feature = classifier.feature(image);
  samples.push({ record, featureBase64: Buffer.from(feature).toString('base64') });
}
const roiFeature = (image, bounds, columns = 8, rows = 6) => {
  const values = new Uint8Array(columns * rows * 3);
  let offset = 0;
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = Math.min(image.width - 1, Math.floor(bounds.x + (column + 0.5) * bounds.width / columns));
    const y = Math.min(image.height - 1, Math.floor(bounds.y + (row + 0.5) * bounds.height / rows));
    const source = (y * image.width + x) * 4;
    values[offset++] = image.data[source];
    values[offset++] = image.data[source + 1];
    values[offset++] = image.data[source + 2];
  }
  return values;
};
const buttonProfiles = [];
for (const profile of navigationPackage.stateRecognition.buttonAppearanceSamples ?? []) {
  const states = [];
  for (const sample of profile.states ?? []) {
    const record = recordById.get(sample.sampleId);
    if (!record) throw new Error(`button reference frame not found: ${sample.sampleId}`);
    let image = imagesById.get(record.id);
    if (!image) {
      image = decodeImage(await readFile(resolve(datasetRoot, record.path)), record.path);
      imagesById.set(record.id, image);
    }
    states.push({ state: sample.state, sampleId: sample.sampleId,
      featureBase64: Buffer.from(roiFeature(image, sample.bounds ?? profile.bounds, profile.columns ?? 8, profile.rows ?? 6)).toString('base64') });
  }
  buttonProfiles.push({ ...profile, columns: profile.columns ?? 8, rows: profile.rows ?? 6, states });
}
const index = {
  schemaVersion: 1,
  columns: 48,
  rows: 24,
  sourceReviewedManifestSha256: createHash('sha256').update(`${reviewedRecords.map((record) => JSON.stringify(record)).join('\n')}\n`).digest('hex'),
  generatedAt: new Date().toISOString(),
  samples,
  buttonProfiles,
};
await writeFile(outputPath, `${JSON.stringify(index)}\n`);
console.log(JSON.stringify({ path: outputPath, sampleCount: samples.length, bytes: Buffer.byteLength(JSON.stringify(index)) }));

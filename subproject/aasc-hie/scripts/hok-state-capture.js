import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { AdbClient } from '../src/execution/adb-client.js';

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const serial = argument('--serial');
if (!serial) throw new Error('--serial is required');
const count = Math.max(1, Number(argument('--count') ?? 1));
const intervalMs = Math.max(0, Number(argument('--interval-ms') ?? 2000));
const sceneId = argument('--scene-id') ?? 'pending-review';
const labelZh = argument('--label-zh') ?? '待人工标注';
const repoRoot = resolve(import.meta.dirname, '..');
const datasetRoot = resolve(repoRoot, 'data/datasets/honor-of-kings');
const frameDirectory = resolve(datasetRoot, 'frames');
const manifestPath = resolve(datasetRoot, 'manifest.jsonl');
await mkdir(frameDirectory, { recursive: true });
const adb = new AdbClient({ serial });
await adb.assertConnected();

for (let index = 0; index < count; index += 1) {
  const observedAt = Date.now();
  const buffer = await adb.screenshot();
  const stamp = new Date(observedAt).toISOString().replace(/[:.]/g, '-');
  const id = `capture-${stamp}-${String(index + 1).padStart(3, '0')}`;
  const path = resolve(frameDirectory, `${id}.png`);
  await writeFile(path, buffer);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const record = {
    id,
    path: `frames/${basename(path)}`,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    width,
    height,
    orientation: width > height ? 'landscape' : 'portrait',
    sceneId,
    labelZh,
    uis: [],
    buttons: [],
    capturedAt: new Date(observedAt).toISOString(),
    source: `adb:${serial}`,
    annotationStatus: 'pending-review'
  };
  await appendFile(manifestPath, `${JSON.stringify(record)}\n`);
  console.log(JSON.stringify({ id, path: record.path, width, height, annotationStatus: record.annotationStatus }));
  if (index + 1 < count && intervalMs) await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
}

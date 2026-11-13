import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AdbClient } from '../src/execution/adb-client.js';
import { parseNavigationPackage } from '../src/package/package-parser.js';
import { AdbVideoFrameSource, GameStateRecognizer } from '../src/recognition/index.js';
import { OcrClient } from '../src/recognition/ocr-client.js';

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const flag = (name) => process.argv.includes(name);
const repoRoot = resolve(import.meta.dirname, '..');
const packagePath = resolve(repoRoot, 'data/packages/honor-of-kings.nav.md');
const navigationPackage = parseNavigationPackage(await readFile(packagePath, 'utf8'), packagePath);
const file = argument('--file');
const serial = argument('--serial');
const watch = flag('--watch');
if (Boolean(file) === Boolean(serial)) throw new Error('provide exactly one of --file or --serial');
if (file && watch) throw new Error('--watch requires --serial');
const recognizer = new GameStateRecognizer({ navigationPackage, packageRoot: repoRoot,
  ...(flag('--ocr') ? { ocrClient: new OcrClient({ baseUrl: process.env.AASC_URL }) } : {}) });

if (!watch) {
  const frame = file
    ? { buffer: await readFile(resolve(file)), observedAt: Date.now(), source: `file:${file}` }
    : { buffer: await new AdbClient({ serial }).screenshot(), observedAt: Date.now(), source: `adb:${serial}` };
  console.log(JSON.stringify(await recognizer.observe(frame), null, 2));
} else {
  const fps = Number(argument('--fps') ?? 2);
  const maxFrames = Number(argument('--max-frames') ?? 0);
  let count = 0;
  let stopping = false;
  let source;
  process.once('SIGINT', () => { stopping = true; source?.close(); });
  process.once('SIGTERM', () => { stopping = true; source?.close(); });
  while (!stopping && (!maxFrames || count < maxFrames)) {
    source = new AdbVideoFrameSource({ serial, fps });
    try {
      while (!stopping && (!maxFrames || count < maxFrames)) {
        const frame = await source.next();
        console.log(JSON.stringify(await recognizer.observe(frame)));
        count += 1;
      }
    } catch (error) {
      if (!stopping) {
        console.error(`screen stream ended; reconnecting: ${error.message}`);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
      }
    } finally {
      source.close();
    }
  }
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createDoubaoBrowserLauncher } = require('./chat2api-doubao-browser-launcher');

test('首次采用旧受管profile作为统一目录，后续账号变化不切换目录或重启', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-profile-adopt-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const legacy = path.join(rootDir, 'browser-profiles', 'doubao', '1234567890abcdef12345678');
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'keep.txt'), 'preserve');
  let closes = 0;
  const browser = { connected: true, disconnect() {}, targets: () => [],
    close: async () => { closes++; },
    target: () => ({ createCDPSession: async () => ({ send: async () => ({ arguments: [`--user-data-dir=${legacy}`] }), detach: async () => {} }) }) };
  const launcher = createDoubaoBrowserLauncher({ rootDir, probe: async () => ({}), connect: async () => browser,
    spawnBrowser: () => { throw new Error('不应启动新浏览器'); } });
  const config = { mode: 'browser-fetch', accountId: '', browserExecutable: 'vivaldi', debugPort: 9224 };
  await launcher.open(config, 'first'); await launcher.open(config, 'second');
  assert.equal(closes, 0); assert.equal(launcher.profilePath(), legacy);
  const stored = JSON.parse(await fs.readFile(path.join(rootDir, 'browser-profiles', 'shared-browser-profile.json'), 'utf8'));
  assert.equal(stored.directory, legacy);
  assert.equal(await fs.readFile(path.join(legacy, 'keep.txt'), 'utf8'), 'preserve');
  await launcher.close();
});

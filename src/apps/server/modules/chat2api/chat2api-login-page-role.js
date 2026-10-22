'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { writePrivateJSON } = require('./chat2api-doubao-browser-launcher');
const loginPages = new WeakSet();
const markerPath = rootDir => path.join(rootDir, 'browser-profiles', 'remote-login-page.json');
const readMarker = async rootDir => {
  try { return JSON.parse(await fs.readFile(markerPath(rootDir), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const targetId = async page => {
  const cdp = await page.createCDPSession();
  try { return (await cdp.send('Target.getTargetInfo')).targetInfo.targetId; }
  finally { await cdp.detach(); }
};
/** 同一网站环境只按标签身份保护，不依赖URL猜测其用途。 */
const registerLoginPage = async (browser, page, rootDir) => {
  loginPages.add(page);
  const record = { endpoint: browser.wsEndpoint(), targetId: await targetId(page) };
  await fs.mkdir(path.dirname(markerPath(rootDir)), { recursive: true, mode: 0o700 });
  await writePrivateJSON(markerPath(rootDir), record);
  return async () => {
    loginPages.delete(page);
    const current = await readMarker(rootDir);
    if (current?.endpoint === record.endpoint && current?.targetId === record.targetId) await fs.unlink(markerPath(rootDir)).catch(() => {});
  };
};
const restoreLoginPage = async (browser, rootDir) => {
  if (!rootDir) return null;
  const record = await readMarker(rootDir);
  if (!record || record.endpoint !== browser.wsEndpoint()) return null;
  for (const page of await browser.pages()) {
    if (await targetId(page).catch(() => '') !== record.targetId) continue;
    loginPages.add(page);
    return page;
  }
  return null;
};
module.exports = { registerLoginPage, restoreLoginPage, isLoginPage: page => loginPages.has(page) };

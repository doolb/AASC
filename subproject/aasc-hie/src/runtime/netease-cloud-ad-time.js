import { PNG } from 'pngjs';

const APP = 'com.netease.android.cloudgame';
const STORES = new Set(['com.sec.android.app.samsungapps', 'com.sec.android.app.samsungapps.una3']);
const INSTALLERS = new Set(['com.google.android.packageinstaller', 'com.android.packageinstaller', 'com.samsung.android.packageinstaller']);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (value) => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** 将无障碍节点转换为可点击的文字和边界，不依赖页面固定位置。 */
export function parseUiText(xml) {
  return [...String(xml).matchAll(/<node\b[^>]*>/g)].flatMap(([node]) => {
    const attr = (name) => node.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? '';
    const text = decode(attr('text') || attr('content-desc'));
    const bounds = attr('bounds').match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (!text || !bounds || attr('enabled') === 'false') return [];
    const [, x1, y1, x2, y2] = bounds.map(Number);
    return x2 > x1 && y2 > y1 ? [{ text, x1, y1, x2, y2, selected: attr('selected') === 'true', source: 'ui' }] : [];
  });
}

const locate = (entries, pattern) => entries.find((item) => pattern.test(item.text));
const amount = (entries) => {
  const joined = entries.map((item) => item.text).join(' ');
  const match = joined.match(/(\d+)\s*[s秒]\s*手游时长/i);
  return match ? Number(match[1]) : null;
};
const minuteBalance = (entries) => {
  const entry = locate(entries, /手游免费时长/);
  if (!entry) return null;
  const candidates = entries.filter((item) => /^\d+\s*分钟$/.test(item.text.replace(/\s/g, '')) && item.x1 < entry.x2 && Math.abs(item.y1 - entry.y1) < 220).sort((a, b) => Math.abs(a.y1 - entry.y1) - Math.abs(b.y1 - entry.y1));
  if (!candidates.length) return null;
  return Number(candidates[0].text.match(/\d+/)[0]);
};

/** 以明确证据区分状态；不将第三方广告文字作为网易到账证明。 */
export function classifyAdScreen(entries, foreground, phase = 'entry') {
  if (INSTALLERS.has(foreground)) return { state: 'installer', target: locate(entries, /^取消$/) };
  if (STORES.has(foreground)) return { state: 'store' };
  if (foreground !== APP) return { state: 'unknown-package' };
  if (locate(entries, /运行\s*\d{1,2}:\d{2}/) && locate(entries, /^继续玩$/)) return { state: 'game-running' };
  const exhausted = locate(entries, /今日次数已用完/);
  const reward = amount(entries);
  if (exhausted) return { state: 'exhausted', reward };
  if (locate(entries, /未观看完成|无法获得奖励/)) return { state: 'failed' };
  if (locate(entries, /恭喜你成功抽中/) && reward !== null) return { state: 'reward', reward, target: locate(entries, /继续观看/) };
  if (locate(entries, /奖励已领取|提前获得奖励|已完成浏览\s*\d+\s*秒/)) {
    const exit = locate(entries, /跳过|^关闭$|^×$|^✕$/);
    const offset = exit?.text.indexOf('跳过') ?? -1;
    const target = offset > 0 ? { ...exit, x1: exit.x1 + (exit.x2 - exit.x1) * offset / exit.text.length } : exit;
    return { state: 'ad-complete', target };
  }
  if (locate(entries, /确定要退出|确认.*退出/)) return { state: 'exit-prompt', target: locate(entries, /去领取奖励|继续观看/) };
  if (locate(entries, /去浏览\s*\d+\s*秒|去体验\s*\d+\s*秒|更快拿奖/)) return { state: 'browse-prompt', target: locate(entries, /我要加速|我要更快拿奖/) };
  if (locate(entries, /奖励将于|秒后发放|(?:\d+\s*)?(?:s|秒)\s*内必得奖励/i)) return { state: 'countdown' };
  if (phase === 'ad-watching') {
    const close = entries.find((item) => item.region === 'ad-bottom' && /^关闭$/.test(item.text.trim()));
    if (close) return { state: 'ad-close', target: close };
  }
  if (phase === 'refresh-welfare') {
    const target = locate(entries, /^福利$/);
    return target ? { state: 'refresh-welfare', target } : { state: 'unknown' };
  }
  if (phase === 'refresh-mine') {
    const mine = locate(entries, /^我的$/);
    if (mine?.selected || (locate(entries, /手游免费时长/) && minuteBalance(entries) !== null)) return { state: 'refreshed', balance: minuteBalance(entries) };
    return mine ? { state: 'refresh-mine', target: mine } : { state: 'unknown' };
  }
  if (phase === 'entry') {
    const entry = locate(entries, /看视频得时长/);
    if (entry) return { state: 'mine', target: entry, balance: minuteBalance(entries) };
    const mine = locate(entries, /^我的$/);
    if (mine && !mine.selected) return { state: 'navigation', target: mine };
  }
  return { state: 'unknown' };
}

const center = (box) => ({ x: Math.round((box.x1 + box.x2) / 2), y: Math.round((box.y1 + box.y2) / 2) });
const regions = {
  entry: [[0, 0, 1, 0.48], [0, 0.80, 1, 1]],
  'refresh-welfare': [[0, 0, 1, 0.48], [0, 0.80, 1, 1]],
  'refresh-mine': [[0, 0, 1, 0.48], [0, 0.80, 1, 1]],
  ad: [[0, 0, 1, 0.14, 'ad-top'], [0.60, 0.84, 1, 1, 'ad-bottom'], [0.08, 0.14, 0.92, 0.84, 'ad-dialog']],
};
regions['ad-watching'] = regions.ad;

/** 仅在节点无法识别时分区域 OCR，坐标转换回设备原图。 */
export async function recognizeRegions(image, ocr, phase, enough = () => false) {
  const png = PNG.sync.read(image);
  const entries = [];
  for (const [left, top, right, bottom, region] of regions[phase] ?? regions.ad) {
    const x = Math.floor(left * png.width); const y = Math.floor(top * png.height);
    const width = Math.ceil(right * png.width) - x; const height = Math.ceil(bottom * png.height) - y;
    const crop = new PNG({ width, height });
    PNG.bitblt(png, crop, x, y, width, height, 0, 0);
    const result = await ocr.read(PNG.sync.write(crop));
    const scaleX = width / (result.imageWidth || width); const scaleY = height / (result.imageHeight || height);
    for (const box of result.boxes ?? []) {
      if (!box.points?.length || (Number.isFinite(box.score) && box.score < 0.75)) continue;
      const xs = box.points.map((p) => p.x * scaleX + x); const ys = box.points.map((p) => p.y * scaleY + y);
      entries.push({ text: box.text, x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys), source: 'ocr', ...(region ? { region } : {}) });
    }
    if (enough(entries)) break;
  }
  return entries;
}

export class NeteaseCloudAdTime {
  constructor({ adb, ocr, dryRun = true, maxRewards = 50, timeoutMs = 600000, sleep = wait, now = Date.now } = {}) {
    if (!adb || !ocr) throw new Error('ADB and OCR clients are required');
    if (!Number.isInteger(maxRewards) || maxRewards < 1 || maxRewards > 50) throw new Error('maxRewards must be an integer from 1 to 50');
    this.adb = adb; this.ocr = ocr; this.dryRun = dryRun; this.maxRewards = maxRewards;
    this.timeoutMs = timeoutMs; this.sleep = sleep; this.now = now;
  }

  async observe(phase) {
    const foreground = await this.adb.foregroundPackage();
    let entries;
    try { entries = parseUiText(await this.adb.uiHierarchy()); }
    catch {
      // 切屏动画可能使节点采集暂时失败；重试后改用新截图，绝不复用旧节点。
      await this.sleep(1500);
      try { entries = parseUiText(await this.adb.uiHierarchy()); }
      catch { entries = []; }
    }
    if (foreground === APP && phase === 'startup' && entries.length === 0) return { state: 'loading' };
    const effectivePhase = phase === 'startup' ? 'entry' : phase;
    let state = classifyAdScreen(entries, foreground, effectivePhase);
    const incomplete = (value) => value.state === 'unknown' || (['installer', 'exit-prompt', 'browse-prompt', 'ad-complete', 'navigation', 'mine', 'refresh-welfare', 'refresh-mine'].includes(value.state) && !value.target) || (value.state === 'reward' && !value.target) || (['mine', 'refreshed'].includes(value.state) && value.balance === null);
    if (incomplete(state)) {
      const image = await this.adb.screenshot();
      const visual = await recognizeRegions(image, this.ocr, effectivePhase, (items) => !incomplete(classifyAdScreen([...entries, ...items], foreground, effectivePhase)));
      const combined = [...entries, ...visual];
      state = classifyAdScreen(combined, foreground, effectivePhase);
    }
    return state;
  }

  async run() {
    const result = { status: 'stopped', reason: null, rewards: [], startBalanceMinutes: null, endBalanceMinutes: null, events: [] };
    const start = this.now(); let phase = 'entry'; let previous = ''; let stateRepeats = 0; let freshAd = false; let awaitingAd = false; let watchedCountdown = false; let startupRetries = 0; let closeRetries = 0; let stopReason = null;
    const record = (state) => { result.events.push({ state: state.state, at: this.now() }); };
    const tap = async (target) => { if (!target) return false; const point = center(target); if (!this.dryRun) await this.adb.tap(point.x, point.y); return true; };
    try {
      await this.adb.assertConnected();
      if ((await this.adb.foregroundPackage()) !== APP) {
        if (this.dryRun) return { ...result, reason: 'app-not-foreground' };
        await this.adb.launch(APP); phase = 'startup'; await this.sleep(5000);
      }
      while (this.now() - start < this.timeoutMs) {
        const observedPhase = phase === 'ad' && watchedCountdown ? 'ad-watching' : phase;
        const state = await this.observe(observedPhase); record(state);
        if (phase === 'startup' && ['loading', 'unknown'].includes(state.state) && startupRetries < 3) { startupRetries += 1; await this.sleep(5000); continue; }
        if (phase === 'startup') phase = 'entry';
        if (state.state === 'countdown' && phase === 'ad') watchedCountdown = true;
        if (awaitingAd && ['countdown', 'browse-prompt', 'ad-complete', 'store', 'installer', 'exit-prompt'].includes(state.state)) { awaitingAd = false; freshAd = true; }
        stateRepeats = state.state === previous ? stateRepeats + 1 : 0; previous = state.state;
        if (stateRepeats > 10) { result.reason = 'state-not-progressing'; break; }
        if (this.dryRun) return { ...result, status: 'dry-run', reason: state.state, observation: state };
        if (state.state === 'unknown-package' || state.state === 'unknown') { result.reason = state.state; break; }
        if (state.state === 'game-running') { result.reason = 'game-running'; break; }
        if (state.state === 'failed') { result.reason = 'ad-incomplete'; break; }
        if (state.state === 'installer') {
          if (!await tap(state.target)) { result.reason = 'installer-cancel-not-found'; break; }
          await this.sleep(1000); continue;
        }
        if (state.state === 'store') { await this.sleep(17000); await this.adb.back(); await this.sleep(2000); continue; }
        if (state.state === 'countdown') {
          if (state.target) { await tap(state.target); await this.sleep(2000); continue; }
          await this.sleep(6000); continue;
        }
        if (state.state === 'ad-close') {
          // 仅在本轮看到倒计时后识别底部关闭文字，并重新采集确认位置，防止操作过期画面。
          const confirmed = await this.observe('ad-watching'); record(confirmed);
          if (confirmed.state !== 'ad-close' || !confirmed.target) { await this.sleep(2000); continue; }
          await tap(confirmed.target); watchedCountdown = false; await this.sleep(3000); continue;
        }
        if (state.state === 'ad-complete') {
          if (!state.target) {
            if (++closeRetries > 3) { result.reason = 'ad-complete-target-not-found'; break; }
            await this.sleep(5000); continue;
          }
          const confirmed = await this.observe(observedPhase); record(confirmed);
          if (confirmed.state !== 'ad-complete' || !confirmed.target) { await this.sleep(2000); continue; }
          closeRetries = 0; await tap(confirmed.target); await this.sleep(3000); continue;
        }
        if (state.state === 'browse-prompt' || state.state === 'exit-prompt') {
          if (!await tap(state.target)) { result.reason = `${state.state}-target-not-found`; break; }
          await this.sleep(3000); continue;
        }
        if (state.state === 'navigation') { await tap(state.target); await this.sleep(3000); continue; }
        if (state.state === 'refresh-welfare') { await tap(state.target); phase = 'refresh-mine'; await this.sleep(3000); continue; }
        if (state.state === 'refresh-mine') { await tap(state.target); await this.sleep(3000); continue; }
        if (state.state === 'refreshed') {
          result.endBalanceMinutes = state.balance;
          const delta = state.balance - result.startBalanceMinutes;
          const earned = result.rewards.reduce((sum, value) => sum + value, 0) / 60;
          const verified = state.balance !== null && result.startBalanceMinutes !== null && Math.abs(delta - earned) <= 1;
          result.status = verified ? 'completed' : 'stopped';
          result.reason = verified ? stopReason : 'balance-unconfirmed'; break;
        }
        if (state.state === 'mine') {
          if (state.balance === null) { result.reason = 'starting-balance-unavailable'; break; }
          result.startBalanceMinutes = state.balance; await tap(state.target); phase = 'ad'; freshAd = true; await this.sleep(5000); continue;
        }
        if (state.state === 'reward' || state.state === 'exhausted') {
          if (awaitingAd && state.state === 'reward') { await this.sleep(3000); continue; }
          if (state.reward !== null && freshAd) { result.rewards.push(state.reward); freshAd = false; }
          if (state.state === 'exhausted' || result.rewards.length >= this.maxRewards) {
            stopReason = state.state === 'exhausted' ? 'daily-limit' : 'reward-limit';
            if (result.startBalanceMinutes === null) { result.status = 'completed'; result.reason = stopReason; break; }
            await this.adb.back(); phase = 'refresh-welfare'; await this.sleep(3000); continue;
          }
          if (!freshAd && result.rewards.length === 0) { result.reason = 'existing-result-unconfirmed'; break; }
          if (!await tap(state.target)) { result.reason = 'continue-target-not-found'; break; }
          awaitingAd = true; watchedCountdown = false; await this.sleep(5000); continue;
        }
      }
      result.reason ??= 'timeout';
      return result;
    } catch (error) { result.reason = 'error'; result.error = error.message; return result; }
  }
}

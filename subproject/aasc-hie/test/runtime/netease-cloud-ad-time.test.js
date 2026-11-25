import { describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import { classifyAdScreen, NeteaseCloudAdTime, parseUiText, recognizeRegions } from '../../src/runtime/netease-cloud-ad-time.js';
const item = (text) => ({ text, x1: 10, y1: 10, x2: 50, y2: 30 });
const app = 'com.netease.android.cloudgame';
const target = item('按钮');

describe('网易云广告状态', () => {
  it('从节点提取文字并阻止干扰运行中的云游戏', () => {
    const entries = parseUiText('<node text="运行 00:12:00" bounds="[1,2][100,40]" enabled="true" /><node text="继续玩" bounds="[20,50][80,80]" />');
    expect(entries[0]).toMatchObject({ text: '运行 00:12:00', x1: 1, y2: 40 });
    expect(classifyAdScreen(entries, app)).toEqual({ state: 'game-running' });
  });
  it('区分结果、次数耗尽、安装界面与不可信页面', () => {
    expect(classifyAdScreen([item('恭喜你成功抽中'), item('120s手游时长'), item('继续观看')], app, 'ad')).toMatchObject({ state: 'reward', reward: 120 });
    expect(classifyAdScreen([item('今日次数已用完'), item('60s手游时长')], app, 'ad')).toMatchObject({ state: 'exhausted', reward: 60 });
    expect(classifyAdScreen([item('取消')], 'com.google.android.packageinstaller', 'ad').state).toBe('installer');
    expect(classifyAdScreen([item('奖励已领取')], 'unknown.vendor', 'ad').state).toBe('unknown-package');
  });
  it('只在观看倒计时后识别底部关闭，不把广告关闭当作网易到账', () => {
    const timer = { ...item('60S内必得奖励 10S'), region: 'ad-bottom' };
    const close = { ...item('关闭'), region: 'ad-bottom' };
    expect(classifyAdScreen([timer], app, 'ad')).toMatchObject({ state: 'countdown' });
    expect(classifyAdScreen([close], app, 'ad').state).toBe('unknown');
    expect(classifyAdScreen([close], app, 'ad-watching')).toMatchObject({ state: 'ad-close', target: close });
    expect(classifyAdScreen([{ ...close, region: 'ad-dialog' }], app, 'ad-watching').state).toBe('unknown');
  });
  it('广告识别依次裁剪上下边缘，命中后不扫描中部', async () => {
    const png = new PNG({ width: 100, height: 200 });
    const sizes = [];
    const read = vi.fn(async (data) => {
      const crop = PNG.sync.read(data); sizes.push([crop.width, crop.height]);
      return { imageWidth: crop.width, imageHeight: crop.height, boxes: sizes.length === 2 ? [{ text: '60S内必得奖励 10S', score: 0.99, points: [{ x: 2, y: 3 }, { x: 30, y: 12 }] }] : [] };
    });
    const found = await recognizeRegions(PNG.sync.write(png), { read }, 'ad', (items) => items.length > 0);
    expect(sizes).toEqual([[100, 29], [40, 32]]);
    expect(found[0]).toMatchObject({ region: 'ad-bottom', x1: 62, y1: 171 });
  });
  it('只对必要区域调用 OCR 并换算坐标', async () => {
    const png = new PNG({ width: 100, height: 200 });
    const read = vi.fn(async (data) => { const region = PNG.sync.read(data); expect(region.width).toBe(100); expect(region.height).toBe(96); return { imageWidth: 100, imageHeight: 96, boxes: [{ text: '看视频得时长', score: 0.99, points: [{ x: 5, y: 6 }, { x: 30, y: 16 }] }] }; });
    const result = await recognizeRegions(PNG.sync.write(png), { read }, 'entry', (entries) => entries.length > 0);
    expect(read).toHaveBeenCalledTimes(1); expect(result[0]).toMatchObject({ x1: 5, y1: 6, x2: 30, y2: 16 });
  });
  it('节点足够时不调用 OCR', async () => {
    const adb = { foregroundPackage: async () => app, uiHierarchy: async () => '<node text="我的" bounds="[1,2][100,40]" />' };
    const ocr = { read: vi.fn() };
    expect((await new NeteaseCloudAdTime({ adb, ocr }).observe('entry')).state).toBe('navigation'); expect(ocr.read).not.toHaveBeenCalled();
  });
  it('节点采集失败时重试，仍失败则使用新截图 OCR', async () => {
    const png = new PNG({ width: 100, height: 200 });
    const adb = { foregroundPackage: async () => app, uiHierarchy: vi.fn().mockRejectedValue(new Error('busy')), screenshot: vi.fn().mockResolvedValue(PNG.sync.write(png)) };
    const ocr = { read: vi.fn().mockResolvedValue({ imageWidth: 100, imageHeight: 96, boxes: [{ text: '我的', score: 0.99, points: [{ x: 5, y: 5 }, { x: 30, y: 20 }] }] }) };
    const controller = new NeteaseCloudAdTime({ adb, ocr, sleep: async () => {} });
    expect((await controller.observe('entry')).state).toBe('navigation');
    expect(adb.uiHierarchy).toHaveBeenCalledTimes(2); expect(adb.screenshot).toHaveBeenCalledTimes(1);
  });
  it('连续领取后刷新余额核验', async () => {
    const states = [{ state: 'mine', target, balance: 10 }, { state: 'browse-prompt', target }, { state: 'reward', reward: 60, target }, { state: 'countdown' }, { state: 'exhausted', reward: 60 }, { state: 'refresh-welfare', target }, { state: 'refresh-mine', target }, { state: 'refreshed', balance: 12 }];
    const adb = { assertConnected: vi.fn(), foregroundPackage: async () => app, tap: vi.fn(), back: vi.fn() };
    const controller = new NeteaseCloudAdTime({ adb, ocr: {}, dryRun: false, sleep: async () => {} });
    controller.observe = vi.fn(async () => states.shift() ?? { state: 'unknown' });
    expect(await controller.run()).toMatchObject({ status: 'completed', reason: 'daily-limit', rewards: [60, 60], startBalanceMinutes: 10, endBalanceMinutes: 12 });
    expect(adb.back).toHaveBeenCalledTimes(1);
  });
  it('发现已有云游戏时不点击、不退出', async () => {
    const adb = { assertConnected: vi.fn(), foregroundPackage: async () => app, tap: vi.fn(), back: vi.fn() };
    const controller = new NeteaseCloudAdTime({ adb, ocr: {}, dryRun: false });
    controller.observe = async () => ({ state: 'game-running' });
    expect(await controller.run()).toMatchObject({ reason: 'game-running' });
    expect(adb.tap).not.toHaveBeenCalled(); expect(adb.back).not.toHaveBeenCalled();
  });
  it('启动加载有限次重试，广告关闭需重新确认', async () => {
    const close = { ...target, text: '关闭', region: 'ad-bottom' };
    const states = [{ state: 'loading' }, { state: 'navigation', target }, { state: 'mine', target, balance: 10 }, { state: 'countdown' }, { state: 'ad-close', target: close }, { state: 'ad-close', target: close }, { state: 'reward', reward: 60, target }, { state: 'refresh-welfare', target }, { state: 'refresh-mine', target }, { state: 'refreshed', balance: 11 }];
    const adb = { assertConnected: vi.fn(), foregroundPackage: async () => 'other', launch: vi.fn(), tap: vi.fn(), back: vi.fn() };
    const controller = new NeteaseCloudAdTime({ adb, ocr: {}, dryRun: false, maxRewards: 1, sleep: async () => {} });
    controller.observe = vi.fn(async () => states.shift() ?? { state: 'unknown' });
    expect(await controller.run()).toMatchObject({ status: 'completed', rewards: [60] });
    expect(controller.observe.mock.calls.filter(([phase]) => phase === 'ad-watching')).toHaveLength(2);
    expect(adb.tap).toHaveBeenCalledTimes(5);
  });
  it('提前领奖但无关闭按钮时重新采集，确认后才点击', async () => {
    const close = { ...target, text: '关闭', region: 'ad-bottom' };
    const states = [{ state: 'mine', target, balance: 10 }, { state: 'ad-complete' }, { state: 'ad-complete', target: close }, { state: 'ad-complete', target: close }, { state: 'reward', reward: 60, target }, { state: 'refresh-welfare', target }, { state: 'refresh-mine', target }, { state: 'refreshed', balance: 11 }];
    const adb = { assertConnected: vi.fn(), foregroundPackage: async () => app, tap: vi.fn(), back: vi.fn() };
    const controller = new NeteaseCloudAdTime({ adb, ocr: {}, dryRun: false, maxRewards: 1, sleep: async () => {} });
    controller.observe = async () => states.shift() ?? { state: 'unknown' };
    expect(await controller.run()).toMatchObject({ status: 'completed', rewards: [60] });
    expect(adb.tap).toHaveBeenCalledTimes(4);
  });
  it('等待广告切换，不将同一奖励弹窗重复计数', async () => {
    const reward = { state: 'reward', reward: 120, target };
    const states = [{ state: 'mine', target, balance: 10 }, { state: 'browse-prompt', target }, reward, reward, { state: 'countdown' }, { state: 'exhausted', reward: 60 }, { state: 'refresh-welfare', target }, { state: 'refresh-mine', target }, { state: 'refreshed', balance: 13 }];
    const adb = { assertConnected: vi.fn(), foregroundPackage: async () => app, tap: vi.fn(), back: vi.fn() };
    const controller = new NeteaseCloudAdTime({ adb, ocr: {}, dryRun: false, sleep: async () => {} });
    controller.observe = async () => states.shift() ?? { state: 'unknown' };
    expect(await controller.run()).toMatchObject({ status: 'completed', rewards: [120, 60] });
    expect(adb.tap).toHaveBeenCalledTimes(5);
  });
  it('未知页面、余额不符和设备断线分别停止', async () => {
    const adb = { assertConnected: vi.fn(), foregroundPackage: async () => app, tap: vi.fn(), back: vi.fn() };
    const controller = new NeteaseCloudAdTime({ adb, ocr: {}, dryRun: false, sleep: async () => {} });
    controller.observe = async () => ({ state: 'unknown-package' });
    expect(await controller.run()).toMatchObject({ status: 'stopped', reason: 'unknown-package' });
    adb.assertConnected.mockRejectedValueOnce(new Error('断线'));
    expect(await controller.run()).toMatchObject({ status: 'stopped', reason: 'error', error: '断线' });
    const states = [{ state: 'mine', target, balance: 10 }, { state: 'exhausted', reward: 60 }, { state: 'refresh-welfare', target }, { state: 'refresh-mine', target }, { state: 'refreshed', balance: 20 }];
    controller.observe = async () => states.shift();
    expect(await controller.run()).toMatchObject({ status: 'stopped', reason: 'balance-unconfirmed' });
  });
});

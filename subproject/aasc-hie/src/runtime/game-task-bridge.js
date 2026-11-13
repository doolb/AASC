import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultGameRoot = fileURLToPath(new URL('../../../aasc-game/', import.meta.url));

async function readEvidence(directory, name) {
  try {
    const value = JSON.parse(await readFile(join(directory, name), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`invalid game evidence ${name}: ${error.message}`);
  }
}

/** 将游戏脚本已保存的证据映射为 HIE 可消费的数据，不直接操作设备。 */
export class GameTaskBridge {
  constructor(options = {}) {
    this.gameRoot = resolve(options.gameRoot ?? defaultGameRoot);
    this.enabled = options.enabled === true;
    this.spawn = options.spawn ?? spawn;
    this.gapQueue = options.gapQueue;
    this.running = false;
  }

  async snapshot(directory, options = {}) {
    const root = resolve(directory);
    const [level, plan, result] = await Promise.all([
      readEvidence(root, 'level.json'), readEvidence(root, 'plan.json'), readEvidence(root, 'result.json'),
    ]);
    const incomplete = result && result.status !== 'victory';
    const gap = incomplete ? {
      type: 'navigation-gap', sourceLayer: 'muscle-memory',
      goalId: `pig-level-${result.level ?? level?.level ?? 'unknown'}`,
      reason: result.reason ?? result.status, requiresIntelligence: true,
      evidence: { directory: root, screenshot: result.screenshot, clicks: result.clicks, confirmed: result.confirmed },
    } : undefined;
    if (gap && options.report === true) this.gapQueue?.report(gap);
    return {
      observation: level ? { source: 'pig-game', level: level.level, layout: level } : undefined,
      plans: plan ? [{ sourceLayer: 'muscle-memory', status: plan.status, data: plan }] : [],
      feedback: result,
      gaps: gap ? [gap] : [],
      evidence: { directory: root },
    };
  }

  /** 把关卡快照和缺口送入现有分层协调器；决策结果仍须经既有执行边界。 */
  async decide(directory, coordinator, context = {}) {
    if (typeof coordinator?.decide !== 'function') throw new Error('autonomy coordinator required');
    const snapshot = await this.snapshot(directory);
    const decision = await coordinator.decide({
      ...context,
      worldState: { ...(context.worldState ?? {}), gameTask: snapshot.observation },
      gaps: [...(context.gaps ?? []), ...snapshot.gaps],
      gameTask: snapshot,
    });
    return { snapshot, decision };
  }

  async run(options = {}) {
    if (!this.enabled) throw new Error('game execution disabled');
    if (this.running) throw new Error('game task already running');
    if (!Number.isSafeInteger(options.startLevel) || options.startLevel < 1) throw new Error('invalid startLevel');
    if (!/^0x[0-9a-f]+$/i.test(options.windowId ?? '')) throw new Error('invalid windowId');
    const maxLevels = options.maxLevels ?? 100;
    if (!Number.isSafeInteger(maxLevels) || maxLevels < 1 || maxLevels > 1000) throw new Error('invalid maxLevels');
    const display = options.display ?? ':1';
    if (!/^:[0-9]+(?:\.[0-9]+)?$/.test(display)) throw new Error('invalid display');
    const args = ['scripts/auto-pig-levels.py', '--start-level', String(options.startLevel),
      '--window-id', options.windowId, '--display', display, '--max-levels', String(maxLevels)];
    if (options.duckAuto === true) args.push('--duck-auto');
    this.running = true;
    try {
      return await new Promise((resolveResult, reject) => {
        const child = this.spawn('python3', args, { cwd: this.gameRoot, stdio: 'inherit', shell: false });
        child.once('error', reject);
        child.once('close', (code, signal) => resolveResult({ code, signal, success: code === 0 }));
      });
    } finally {
      this.running = false;
    }
  }
}

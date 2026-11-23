import { readFile, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { GameTaskBridge } from '../../aasc-hie/src/runtime/game-task-bridge.js';
import { PigNavigation } from '../../aasc-hie/src/runtime/pig-navigation.js';
import { ScriptMaintenance } from '../../aasc-hie/src/runtime/script-maintenance.js';
import { createConfiguredAgent } from './configured-agent.js';
import { PigSessionStore } from './pig-session-store.js';

const defaultGameRoot = fileURLToPath(new URL('../../aasc-game/', import.meta.url));
const activateScript = fileURLToPath(new URL('./activate-pig-window.py', import.meta.url));
const execFileAsync = promisify(execFile);
const description = '游戏工具输入为 JSON 对象。action=run 推进导航目标；snapshot 读取截图和候选；review 提交 layout（完整网格、猪、机制），绑定截图后自动求解；probe 提交 source_sha256、point=[x,y]、hypothesis、expectation，对棋盘内目标试探一次并返回前后对比及新截图。plan-only 禁止试探。list_scripts/read_script 可读取脚本；更新默认禁用，须由可信宿主按用户确认显式授权。未知机制必须结合观察，完整路线仍需经过求解与独立重放。';

/** 游戏目标由可信宿主限定；模型不能选择窗口、关卡、显示器或命令行。 */
export function createPigAgent(config, { startLevel, windowId, display = ':1', gameRoot = defaultGameRoot, bridge, navigation, sessionDir, reviewedLayout, allowExecution = true, newConversation = false, maintenance, fetchImpl, probeRunner = execFileAsync, activate = async () => execFileAsync('python3', [activateScript, display, windowId], { timeout: 10000 }) } = {}) {
  if (!Number.isSafeInteger(startLevel) || startLevel < 1) throw new Error('无效关卡');
  if (!/^0x[0-9a-f]+$/i.test(windowId ?? '')) throw new Error('无效窗口 ID');
  if (!/^:[0-9]+(?:\.[0-9]+)?$/.test(display)) throw new Error('无效显示器');
  gameRoot = resolve(gameRoot);
  bridge ??= new GameTaskBridge({ gameRoot, enabled: true });
  navigation ??= new PigNavigation({ level: startLevel, windowId, display, gameRoot, sessionDir, bridge, activate, allowExecution });
  const sessionStore = typeof navigation.initialize === 'function' ? new PigSessionStore({
    getDirectory: async () => { await navigation.initialize(); return navigation.sessionDir; },
    evidenceRoot: join(gameRoot, 'docs/references/pig-game/play-runs'), api: config.api, newConversation,
  }) : undefined;
  if (!maintenance) {
    const scripts = new ScriptMaintenance();
    maintenance = { list: () => scripts.list(), read: name => scripts.read(name),
      async update() { throw new Error('脚本更新未启用：须先获得用户确认并由可信宿主授权'); } };
  }
  let latest = null;
  let lastImageHash = null;
  let probes = 0;
  let probeUncertain = false;
  let lastProbePoint = null;
  let activeReviewedLayout = reviewedLayout;
  const tool = { async execute(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('游戏工具参数无效');
    switch (input.action) {
      case 'run': {
        // 试探后采集失败时，重新建立导航并观察，绝不重放上次点击。
        const recovering = probeUncertain;
        if (probeUncertain) {
          navigation = new PigNavigation({ level: startLevel, windowId, display, gameRoot, bridge, activate, allowExecution });
        }
        let state = await navigation.advance(recovering ? {} : { reviewedLayout: activeReviewedLayout });
        if (state.reason === '本会话已发起试探，必须重新采集现场') {
          navigation = new PigNavigation({ level: startLevel, windowId, display, gameRoot, bridge, activate, allowExecution });
          state = await navigation.advance();
        }
        if (state.stageComplete) {
          // 已确认阶段完成后先重新采集，再由中层判断剩余布局；旧截图绑定的复核布局不得复用。
          const previousStage = state.sessionDir;
          activeReviewedLayout = undefined;
          navigation = new PigNavigation({ level: startLevel, windowId, display, gameRoot, bridge, activate, allowExecution });
          state = { ...await navigation.advance(), previousStage };
        }
        latest = state.evidence ?? null;
        if (probeUncertain && !latest) throw new Error('上次试探结果不确定，重新采集仍未成功');
        probeUncertain = false;
        probes = 0;
        return { navigation: state, ...(latest ? await snapshot() : { evidence: null }) };
      }
      case 'snapshot':
        if (!latest) throw new Error('本次尚无游戏证据');
        return { navigation: await navigation.status(), ...await snapshot() };
      case 'review': {
        if (!latest || probeUncertain) throw new Error('没有可复核的当前画面');
        if (!input.layout || typeof input.layout !== 'object' || Array.isArray(input.layout) || JSON.stringify(input.layout).length > 500000) throw new Error('布局无效');
        const state = await navigation.status();
        if ((await readdir(join(state.sessionDir, 'probes')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).length) throw new Error('本会话已试探，必须重新采集');
        const screenshot = await readFile(join(latest, 'original.png'));
        const sha256 = createHash('sha256').update(screenshot).digest('hex');
        if (input.source_sha256 !== sha256) throw new Error('布局对应的截图已过期');
        const path = join(await mkdtemp(join(state.sessionDir, 'proposal-')), 'layout.json');
        const layout = { ...input.layout, level: startLevel, source_sha256: sha256, reviewed: true, mechanicsReviewed: true };
        await writeFile(path, JSON.stringify(layout, null, 2) + '\n', { flag: 'wx' });
        const next = await navigation.advance({ reviewedLayout: path });
        latest = next.evidence ?? latest;
        return { navigation: next, ...(await snapshot()) };
      }
      case 'probe': {
        if (!allowExecution) throw new Error('plan-only 不允许实机试探');
        if (!latest || probeUncertain) throw new Error('没有可试探的当前画面');
        if (probes >= 8) throw new Error('已达到本次调查的试探次数上限');
        if (!Array.isArray(input.point) || input.point.length !== 2 || !input.point.every(Number.isFinite)
            || typeof input.hypothesis !== 'string' || !input.hypothesis.trim() || input.hypothesis.length > 1000
            || typeof input.expectation !== 'string' || !input.expectation.trim() || input.expectation.length > 1000) throw new Error('试探参数无效');
        const screenshot = await readFile(join(latest, 'original.png'));
        if (input.source_sha256 !== createHash('sha256').update(screenshot).digest('hex')) throw new Error('试探对应的截图已过期');
        // 连续点击同一位置容易将无效试探误当成规则验证；要求先调查其他证据。
        if (lastProbePoint && Math.hypot(input.point[0] - lastProbePoint[0], input.point[1] - lastProbePoint[1]) < 4) {
          return { navigation: await navigation.status(), ...(await snapshot()),
            probe: { status: 'refused', reason: '连续相同位置试探已拒绝，请检查前后截图并调查其他证据', remaining: 8 - probes } };
        }
        const state = await navigation.status();
        if ((await readdir(join(state.sessionDir, 'probes')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).length) throw new Error('本会话已试探，必须重新采集');
        const probeRoot = join(state.sessionDir, 'probes');
        await mkdir(probeRoot, { recursive: true });
        const output = await mkdtemp(join(probeRoot, 'probe-'));
        const request = join(output, 'request.json');
        await writeFile(request, JSON.stringify({ point: input.point, hypothesis: input.hypothesis, expectation: input.expectation }) + '\n', { flag: 'wx' });
        // 一旦启动试探，任何异常都意味着现场可能已改变，不能复用旧导航状态。
        probeUncertain = true;
        activeReviewedLayout = undefined;
        lastProbePoint = [...input.point];
        probes++;
        let observation;
        try {
          await activate();
          await probeRunner('python3', ['scripts/pig-nav-probe.py', '--layout', join(latest, 'level.json'), '--image', join(latest, 'original.png'),
            '--request', request, '--level', String(startLevel), '--window-id', windowId, '--display', display, '--output', output], { cwd: gameRoot, timeout: 90000 });
          observation = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
          if (observation.status !== 'observed') throw new Error('试探结果不完整');
        } catch (error) {
          // 不能推断点击是否发生：保存错误并重新观察，而不是重复上次操作。
          observation = { status: 'uncertain', reason: String(error.stderr || error.message).slice(-1500) };
        }
        navigation = new PigNavigation({ level: startLevel, windowId, display, gameRoot, bridge, activate, allowExecution });
        const next = await navigation.advance();
        latest = next.evidence ?? null;
        if (!latest) throw new Error('试探后重新采集失败');
        probeUncertain = false;
        const result = { navigation: next, ...(await snapshot()), probe: { ...observation, evidence: output, remaining: 8 - probes } };
        try {
          const comparison = await readFile(join(output, 'comparison.png'));
          if (comparison.length <= 2_000_000) result.imageDataUrl = `data:image/png;base64,${comparison.toString('base64')}`;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return result;
      }
      case 'list_scripts': return { scripts: await maintenance.list() };
      case 'read_script': return await maintenance.read(input.name);
      case 'update_script': {
        return await maintenance.update(input);
      }
      default: throw new Error('未知游戏工具操作');
    }
  } };
  async function snapshot() {
    const data = await bridge.snapshot(latest);
    const layout = data.observation?.layout;
    const summary = layout ? { level: layout.level, status: layout.status, board: layout.board, count: layout.count,
      pigs: layout.pigs?.map(({ id, center, bbox, direction, confidence }) => ({ id, center, bbox, direction, confidence })),
      unknown_directions: layout.unknown_directions, warnings: layout.warnings, other_entities: layout.other_entities } : undefined;
    const result = { evidence: latest, observation: summary, plans: data.plans, feedback: data.feedback, gaps: data.gaps };
    for (const name of ['original.png', 'result.png', 'interrupted.png']) {
      try {
        const image = await readFile(join(latest, name));
        if (image.length <= 2_000_000) {
          const hash = createHash('sha256').update(image).digest('hex');
          result.source_sha256 = hash;
          if (hash !== lastImageHash) {
            result.imageDataUrl = `data:image/png;base64,${image.toString('base64')}`;
            lastImageHash = hash;
          }
          break;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return result;
  }
  const gameRole = { name: '游戏', persona: '猪游戏命令：[游戏,run]、[游戏,snapshot]、[游戏,probe,截图SHA256,x,y,"假设","预期"]、[游戏,review,截图SHA256,"布局JSON"]、[游戏,list_scripts]、[游戏,read_script,文件名]。字段内双引号用两个双引号转义。脚本更新须经用户确认并由可信宿主显式授权。单步试探后观察前后图；不使用底部道具，不编造结果。', permissions: ['hie_game'] };
  const mainRole = { name: '游戏主管', persona: '自主推进猪关卡直至获胜。先由中层处理；遇到缺口时根据真实截图决定下一步，使用游戏角色的方括号命令执行调查或复核。脚本修改须事先获得用户确认。probe 填写截图摘要、棋盘坐标、假设和预期；工具执行后核对结果再继续。未知规则不得当作事实，不使用底部道具。', permissions: [] };
  const gameConfig = { ...config, roles: [mainRole, gameRole], defaultRole: mainRole.name, commandRoles: [gameRole.name] };
  const directDecision = ({ role, task, args }) => {
    if (role !== gameRole.name) return null;
    const single = new Set(['run', 'snapshot', 'list_scripts']);
    let input;
    if (single.has(task) && args.length === 0) input = { action: task };
    else if (task === 'probe' && args.length === 5 && args[1].trim() && args[2].trim()) input = { action: task, source_sha256: args[0], point: [Number(args[1]), Number(args[2])], hypothesis: args[3], expectation: args[4] };
    else if (task === 'review' && args.length === 2) {
      try { input = { action: task, source_sha256: args[0], layout: JSON.parse(args[1]) }; }
      catch (_) { throw new Error('布局参数不是有效 JSON'); }
    } else if (task === 'read_script' && args.length === 1) input = { action: task, name: args[0] };
    else if (task === 'update_script' && args.length === 3) input = { action: task, name: args[0], sha256: args[1], content: args[2] };
    else throw new Error('游戏命令或参数无效');
    return { tool: 'hie_game', input };
  };
  const agent = createConfiguredAgent(gameConfig, { tools: { hie_game: tool }, fetchImpl, toolDescriptions: { hie_game: description }, maxModelTurns: 8, shareDecisionSession: true, sessionStore, directDecision });
  // 直接使用受限角色的固定 run 操作，不经过模型选择器。
  agent.runMiddle = () => agent.run('游戏', 'run');
  agent.inspectSession = async () => sessionStore ? sessionStore.inspect() : { uncertain: false };
  agent.gapStatus = async (fingerprint) => {
    if (!sessionStore) return null;
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('缺口指纹无效');
    const path = join((await sessionStore.attach()) + '.gaps', fingerprint);
    try {
      const text = await readFile(path, 'utf8');
      if (text.trim() === 'requested') return 'requested';
      return JSON.parse(text).status ?? null;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  agent.claimGap = async (fingerprint) => {
    if (!sessionStore) return true;
    const statePath = await sessionStore.attach();
    const directory = statePath + '.gaps';
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(join(directory, fingerprint), 'requested\n', { flag: 'wx', mode: 0o600 });
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  };
  agent.finishGap = async (fingerprint, status) => {
    if (!sessionStore) return;
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || !['requested', 'progress', 'failed', 'unresolved', 'request_failed', 'uncertain'].includes(status)) throw new Error('缺口状态无效');
    const statePath = await sessionStore.attach();
    const directory = statePath + '.gaps';
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, fingerprint), JSON.stringify({ status, updatedAt: Date.now() }) + '\n', { mode: 0o600 });
  };
  return agent;
}

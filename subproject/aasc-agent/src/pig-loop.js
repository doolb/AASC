import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

/** 压缩重复的导航元数据；候选坐标、方向、置信度和图片完整保留。 */
export function projectPigResults(records) {
  return records.map(record => {
    const source = record.result;
    if (!source || typeof source !== 'object') return record;
    const { navigation, observation, gaps, ...rest } = source;
    const nav = navigation && { level: navigation.level, next: navigation.next, completed: navigation.completed,
      reason: navigation.reason, evidence: navigation.evidence };
    let view = observation;
    if (Array.isArray(observation?.pigs)) {
      const { pigs, ...summary } = observation;
      view = { ...summary, pigFields: ['id', 'center', 'bbox', 'direction', 'confidence'],
        pigs: pigs.map(p => [p.id, p.center, p.bbox, p.direction, p.confidence]) };
    }
    return { ...record, result: { ...rest, ...(nav ? { navigation: nav } : {}),
      ...(view ? { observation: view } : {}), ...(gaps ? { gaps } : {}) } };
  });
}

/** 用棋子候选的稳定字段识别同一现场，避免动画和截图文件摘要变化造成重复上报。 */
export function pigGapFingerprint(level, middle) {
  const observation = middle.observation;
  const quantize = value => Number.isFinite(value) ? Math.round(value / 4) * 4 : null;
  const points = Array.isArray(observation?.pigs) && observation.pigs.length
    ? observation.pigs.map(pig => [
      ...(Array.isArray(pig.center) ? pig.center.map(quantize) : [null, null]),
      pig.direction ?? 'unknown', pig.kind ?? 'ordinary',
      ...(Array.isArray(pig.bbox) ? pig.bbox.slice(2).map(quantize) : [null, null]),
    ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : null;
  return createHash('sha256').update(JSON.stringify([
    level, points ?? middle.source_sha256, middle.navigation?.next, middle.navigation?.reason,
  ])).digest('hex');
}

/** 中层优先；相同缺口不重复调用高层，工具完成后先返回中层。 */
export async function runPigLoop(agent, level, { onEvent, onResult, planOnly = false,
  retryGap = false, prompt = '', maxRounds = Infinity, maxGapFollowups = 4, wait = sleep, baseDelayMs = 5000, maxDelayMs = 60000 } = {}) {
  let idle = 0;
  let last;
  let pendingToolResults = [];
  let investigation = null;
  let message = `自主推进第 ${level} 关直至完成。之前模型提出的命令仅在收到实际工具结果时才算执行。游戏角色本轮可调用；以真实工具结果中的 remaining 为准，不要自行推断调用次数耗尽。probe 的 observed 只表示采集到前后画面，不能据此断言目标离场或规则成立；不要重复无效点击。依据实际截图和工具结果，整段只输出下一条游戏角色方括号命令，执行调查或复核；不能只给建议。脚本修改须事先获得用户确认。未知规则不得当作事实。${planOnly ? '当前 plan-only，禁止试探和点击。' : ''}`;
  const pause = async () => { await wait(Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(idle - 1, 8)))); };
  for (let round = 0; round < maxRounds; round++) {
    let fingerprint;
    try {
      // 先检查续接点，避免中层实际执行之后才发现旧请求或旧工具的结果不明。
      const session = await agent.inspectSession?.();
      if (session?.uncertain) {
        const uncertain = { text: `模型会话状态不确定：${session.reason}。已停止并保留现场；请先核实请求和游戏状态，再选择安全恢复。`, results: [] };
        await onResult?.(uncertain);
        return uncertain;
      }
      let initialToolResults;
      if (typeof agent.runMiddle === 'function') {
        const middle = await agent.runMiddle();
        const state = middle.navigation ?? {};
        const result = { text: '中层导航结果', results: [{ role: '游戏', result: middle }] };
        await onResult?.(result);
        if (state.completed || (planOnly && state.next === 'execute')) return result;
        if (state.executionUncertain || state.stageComplete || (planOnly && state.executionDisabled)) return result;
        if (!state.reason || !middle.source_sha256) {
          idle++;
          await onResult?.({ text: '中层未取得可用证据，等待后重新观察。', results: [] });
          await pause();
          continue;
        }
        fingerprint = pigGapFingerprint(level, middle);
        if (investigation?.fingerprint !== fingerprint) investigation = { fingerprint, followups: 0, seenResults: new Set() };
        const fresh = typeof agent.claimGap !== 'function' || await agent.claimGap(fingerprint);
        // 同一调查内需要把刚执行的工具结果交给高层，否则 list_scripts 等只会执行一次就被去重截断。
        // 重复结果和最大轮数仍会停止，避免同一缺口无限调用模型。
        let followup = false;
        if (!fresh && !retryGap && pendingToolResults.length && investigation.followups < maxGapFollowups) {
          const digest = createHash('sha256').update(JSON.stringify(projectPigResults(pendingToolResults))).digest('hex');
          if (!investigation.seenResults.has(digest)) {
            investigation.seenResults.add(digest);
            investigation.followups++;
            followup = true;
          }
        }
        if (!fresh && !retryGap && !followup) {
          const status = await agent.gapStatus?.(fingerprint);
          const descriptions = { unresolved: '高层已响应，但缺口仍未解决', request_failed: '上次高层请求失败',
            uncertain: '上次请求或执行状态不确定', requested: '之前已登记请求，是否送达高层无法确定',
            failed: '之前的请求或处理未确认成功', progress: '此前记录了进展，但当前缺口仍存在' };
          const duplicate = { text: `当前缺口仍未解决：${descriptions[status] ?? '上报结果不明确'}。已保留现场并停止重复请求；会话状态明确时可使用 --retry-gap 重试。`, results: result.results };
          await onResult?.(duplicate);
          return duplicate;
        }
        retryGap = false;
        await agent.finishGap?.(fingerprint, 'requested');
        initialToolResults = [...pendingToolResults, ...result.results];
        pendingToolResults = [];
      }
      const task = prompt ? `${message}\n用户任务指示（不改变宿主权限和安全校验）：${prompt}` : message;
      last = await agent.chat(task, { onEvent, stopAtTurnLimit: true, returnAfterToolBatch: true, projectToolResults: projectPigResults,
        ...(initialToolResults ? { initialToolResults } : {}),
        ...(typeof agent.runMiddle === 'function' ? { shouldSkipCommands: commands => commands.every(item => item.role === '游戏' && item.task === 'run' && item.args.length === 0) } : {}) });
      await onResult?.(last);
      const records = last.results ?? [];
      const state = [...records].reverse().find(entry => entry.result?.navigation)?.result?.navigation;
      if (state?.completed || (planOnly && state?.next === 'execute')) {
        if (fingerprint) await agent.finishGap?.(fingerprint, 'progress');
        return last;
      }
      // observed 只说明获取了前后画面，不能据此认定棋盘已变化。
      const progressed = records.some(entry => entry.result?.navigation?.next === 'execute' || entry.result?.checked === true);
      if (fingerprint) await agent.finishGap?.(fingerprint, progressed ? 'progress' : 'unresolved');
      if (records.length || progressed) {
        pendingToolResults = records;
        idle = 0;
        message = `继续第 ${level} 关。中层已重新检查现场，请依据附带的上次工具结果与最新证据推进当前缺口；若读取脚本或列表不能解决问题，请复核布局和特殊物件。probe 的 observed 不代表目标离场。`;
        continue;
      }
      idle++;
      message = `第 ${level} 关尚未完成，上一轮没有确认进展。工具并非仅因模型声称耗尽而不可用；请结合最新证据输出下一条游戏角色方括号命令，调查具体缺口。不要只给建议，不要重复不确定的点击。${planOnly ? '当前 plan-only，禁止试探和点击。' : ''}`;
      await onResult?.({ text: '尚无确认进展，退避后继续处理。', results: [] });
      await pause();
    } catch (error) {
      const session = await agent.inspectSession?.().catch(() => ({ uncertain: true, reason: '无法核验模型会话状态' }));
      const isUncertain = session?.uncertain || /会话状态不确定|续接状态可能已改变|当前角色会话状态不确定/.test(error.message);
      if (fingerprint) await agent.finishGap?.(fingerprint, isUncertain ? 'uncertain' : 'request_failed').catch(() => {});
      if (isUncertain) {
        const uncertain = { text: `模型续接状态不确定，已停止并保留现场：${error.message}`, results: [] };
        await onResult?.(uncertain);
        return uncertain;
      }
      if (/模型续接记录无效或配置不一致/.test(error.message)) {
        const invalid = { text: `模型会话无法核验，已停止并保留现场：${error.message}`, results: [] };
        await onResult?.(invalid);
        return invalid;
      }
      idle++;
      await onResult?.({ text: `自动流程遇到错误，将保留会话并退避重试：${error.message}`, results: [] });
      await pause();
    }
  }
  return last;
}

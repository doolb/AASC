import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { createPigAgent } from './pig-host.js';
import { runPigLoop } from './pig-loop.js';

try {
  const { values } = parseArgs({ options: { level: { type: 'string' }, window: { type: 'string' }, display: { type: 'string', default: ':1' }, session: { type: 'string' }, layout: { type: 'string' }, prompt: { type: 'string' }, 'plan-only': { type: 'boolean', default: false }, 'new-conversation': { type: 'boolean', default: false }, 'retry-gap': { type: 'boolean', default: false } }, strict: true });
  if (!/^[1-9][0-9]*$/.test(values.level ?? '')) throw new Error('须指定 --level 和 --window');
  if (values.prompt !== undefined && (!values.prompt.trim() || values.prompt.length > 4000)) throw new Error('提示词须为 1～4000 个字符');
  const level = Number(values.level);
  const config = await loadConfig(process.env.AASC_AGENT_CONFIG || undefined);
  const agent = createPigAgent(config, { startLevel: level, windowId: values.window, display: values.display, sessionDir: values.session, reviewedLayout: values.layout, allowExecution: !values['plan-only'], newConversation: values['new-conversation'] });
  await runPigLoop(agent, level, {
    planOnly: values['plan-only'],
    retryGap: values['retry-gap'],
    prompt: values.prompt,
    onEvent: event => console.error(`[${event.role}] ${event.type}${event.tool ? ': ' + event.tool : ''}`),
    onResult: result => {
      console.log(result.text);
      for (const entry of result.results) {
        const { imageDataUrl, ...safe } = entry.result ?? {};
        if (Array.isArray(safe.observation?.pigs)) {
          safe.observation = { ...safe.observation, pigs: `${safe.observation.pigs.length} 个候选，详情见证据目录` };
        }
        console.log(JSON.stringify(safe));
      }
    },
  });
} catch (error) {
  console.error('游戏任务失败：' + error.message);
  process.exitCode = 1;
}

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Agent } from './agent.js';
import { runTui } from './tui.js';
import { loadConfig } from './config.js';
import { createConfiguredAgent } from './configured-agent.js';

// 演示只回显文本，不连接模型、设备或其他外部服务。
function createDemoAgent() {
  return new Agent({
    roles: [
      { name: '助手', persona: '通用助手（演示）', permissions: [] },
      { name: '讲解', persona: '讲解助手（演示）', permissions: [] },
    ],
    tools: {},
    model: {
      async respond({ message, role }) { return `${role ? role.name + '：' : ''}演示回复：${message}`; },
      resetSession() {},
    },
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('用法：npm start 读取 config.json；--demo 为本地演示；AASC_AGENT_MODULE 可指定宿主模块。');
    return;
  }
  if (args.length > 1 || (args.length && args[0] !== '--demo')) throw new Error('未知参数，请使用 --help 查看用法');
  let agent;
  if (args[0] === '--demo') {
    console.log('演示模式：仅本地回显，不连接模型或设备。');
    agent = createDemoAgent();
  } else {
    const modulePath = process.env.AASC_AGENT_MODULE;
    if (modulePath) {
      // 宿主模块为本地可信配置；导入后明确校验其导出的 Agent 接口。
      const loaded = await import(pathToFileURL(resolve(modulePath)).href);
      const provider = loaded.createAgent ?? loaded.default;
      agent = typeof provider === 'function' ? await provider() : provider;
    } else {
      const config = await loadConfig(process.env.AASC_AGENT_CONFIG || undefined);
      agent = createConfiguredAgent(config);
    }
  }
  await runTui({ agent });
}

try {
  await main();
} catch (error) {
  console.error('启动失败：' + (error?.message ?? error));
  process.exitCode = 1;
}

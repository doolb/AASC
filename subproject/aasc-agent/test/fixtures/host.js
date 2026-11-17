import { Agent } from '../../src/agent.js';

export async function createAgent() {
  return new Agent({
    roles: [{ name: '宿主', permissions: ['echo'] }],
    commandRoles: ['宿主'],
    tools: { echo: { async execute(input) { return `宿主结果:${input}`; } } },
    model: {
      async respond({ message, toolResults }) {
        if (toolResults.length) return '宿主处理完成';
        const csvText = `"${message.replace(/"/g, '""')}"`;
        return { text: '宿主收到请求', commands: [`[宿主,${csvText}]`] };
      },
      async decide({ task }) { return { tool: 'echo', input: task }; },
    },
  });
}

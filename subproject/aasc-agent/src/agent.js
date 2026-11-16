import { parseCommand } from './command.js';

/** 运行时只执行预先注册的能力，不接受模型传入可执行函数。 */
export class Agent {
  constructor({ roles, tools, model, maxDelegationDepth = 4 }) {
    this.roles = new Map(roles.map(role => [role.name, { ...role, permissions: new Set(role.permissions) }]));
    this.tools = new Map(Object.entries(tools));
    this.model = model;
    this.maxDelegationDepth = maxDelegationDepth;
  }

  async runCommand(text, options = {}) {
    const command = parseCommand(text, options);
    return await this.run(command.role, command.task, command.args);
  }

  async run(roleName, task, args = [], depth = 0) {
    const role = this.roles.get(roleName);
    if (!role) throw new Error('未知角色: ' + roleName);
    if (depth > this.maxDelegationDepth) throw new Error('委派层数超限');
    const decision = await this.model.decide({ role: { name: role.name, persona: role.persona }, task, args });
    if (!decision || typeof decision.tool !== 'string') throw new Error('模型返回无效决策');
    if (!role.permissions.has(decision.tool)) throw new Error('角色无权使用能力: ' + decision.tool);
    if (decision.tool === 'delegate') {
      if (typeof decision.role !== 'string' || typeof decision.task !== 'string' || !decision.task.trim()) throw new Error('委派参数无效');
      return await this.run(decision.role, decision.task, Array.isArray(decision.args) ? decision.args : [], depth + 1);
    }
    const tool = this.tools.get(decision.tool);
    if (!tool || typeof tool.execute !== 'function') throw new Error('能力未注册: ' + decision.tool);
    return await tool.execute(decision.input, { role: role.name });
  }
}

/** HIE 由宿主显式注入，未连接时绝不模拟设备已执行。 */
export function createHieTool(adapter) {
  return { async execute(input, context) {
    if (typeof adapter?.execute !== 'function') throw new Error('HIE 适配器未连接');
    return await adapter.execute(input, context);
  } };
}

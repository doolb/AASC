import { parseCommand } from './command.js';

/** 运行时只执行预先注册的能力，不接受模型传入可执行函数。 */
export class Agent {
  constructor({ roles, tools, model, maxDelegationDepth = 4, commandRoles = [], maxModelTurns = 4, defaultRole = null }) {
    this.roles = new Map(roles.map(role => [role.name, { ...role, permissions: new Set(role.permissions) }]));
    this.tools = new Map(Object.entries(tools));
    this.model = model;
    this.maxDelegationDepth = maxDelegationDepth;
    this.commandRoles = new Set(commandRoles);
    if (defaultRole != null && !this.roles.has(defaultRole)) throw new Error('默认角色未注册');
    this.defaultRole = defaultRole;
    if (!Number.isInteger(maxModelTurns) || maxModelTurns < 1) throw new Error('模型调用轮次无效');
    this.maxModelTurns = maxModelTurns;
  }

  /** 只暴露角色展示信息，调用权限仍由宿主和执行流程管理。 */
  listRoles() {
    return [...this.roles.values()].map(role => ({ name: role.name, persona: role.persona }));
  }

  /** 显式清除当前角色的续接点，不删除网页或持久记录。 */
  async resetChat({ role = null } = {}) {
    const name = role ?? this.defaultRole;
    const selected = name == null ? null : this.roles.get(name);
    if (name != null && !selected) throw new Error('未知角色: ' + String(name));
    if (typeof this.model?.resetSession !== 'function') throw new Error('当前模型不支持新建会话');
    await this.model.resetSession(selected ? { name: selected.name, persona: selected.persona } : null);
  }

  /** 人说的话只交给模型；仅模型明确返回的命令才进入本地执行流程。 */
  async chat(message, options = {}) {
    if (typeof message !== 'string' || !message.trim()) throw new Error('消息不能为空');
    if (typeof this.model?.respond !== 'function') throw new Error('未配置可对话的模型');
    const roleName = options.role ?? this.defaultRole;
    const selected = roleName == null ? null : this.roles.get(roleName);
    if (roleName != null && !selected) throw new Error('未知角色: ' + String(roleName));
    const role = selected ? { name: selected.name, persona: selected.persona } : null;
    const roles = [...this.commandRoles].map(name => this.roles.get(name))
      .filter(Boolean).map(role => ({ name: role.name, persona: role.persona }));
    const results = [];
    const texts = [];
    let toolResults = [];
    let previousReply = null;
    let received = false;
    try {
      for (let turn = 0; turn < this.maxModelTurns; turn++) {
        const answer = await this.model.respond({ message, role, roles, toolResults, previousReply });
        received = true;
        if (typeof answer === 'string') {
          if (!answer && !texts.length) throw new Error('模型返回空回复');
          if (answer) texts.push(answer);
          return { text: texts.join('\n'), results };
        }
        if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new Error('模型返回无效回复');
        if (answer.text != null && typeof answer.text !== 'string') throw new Error('模型回复文本无效');
        const commands = answer.commands ?? [];
        if (!Array.isArray(commands) || commands.length > 8) throw new Error('模型命令列表无效');
        // 先验证本轮所有命令，防止非法命令造成同一批任务部分执行。
        const parsed = commands.map(command => {
          const item = parseCommand(command);
          if (!this.commandRoles.has(item.role) || !this.roles.has(item.role)) throw new Error('模型无权调用角色: ' + item.role);
          return item;
        });
        if (!answer.text && !parsed.length) throw new Error('模型返回空回复');
        if (answer.text) texts.push(answer.text);
        if (!parsed.length) return { text: texts.join('\n'), results };
        if (turn === this.maxModelTurns - 1) throw new Error('模型调用轮次超限');
        toolResults = [];
        for (const item of parsed) {
          const result = await this.run(item.role, item.task, item.args, 0, options.onEvent);
          const record = { role: item.role, result };
          results.push(record);
          toolResults.push(record);
        }
        previousReply = { text: answer.text ?? '', commands: [...commands] };
      }
      throw new Error('模型调用轮次超限');
    } catch (error) {
      // 模型已请求本地动作但执行或反馈失败时，不再假定远端会话与本地状态一致。
      if (received && typeof this.model.markSessionUncertain === 'function') {
        try { await this.model.markSessionUncertain(role); } catch (_) { /* 保留原始错误。 */ }
      }
      throw error;
    }
  }

  async runCommand(text, options = {}) {
    const command = parseCommand(text, options);
    return await this.run(command.role, command.task, command.args, 0, options.onEvent);
  }

  async run(roleName, task, args = [], depth = 0, onEvent) {
    // 观察器只接收状态，不获得可修改的权限集合或模型决策对象；观察失败不影响任务。
    const emit = (type, details = {}) => {
      if (typeof onEvent !== 'function') return;
      try {
        const result = onEvent({ type, role: roleName, depth, ...details });
        if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
      } catch (_) { /* 状态展示失败不能改变任务结果。 */ }
    };
    emit('run:start');
    try {
      const role = this.roles.get(roleName);
      if (!role) throw new Error('未知角色: ' + roleName);
      if (depth > this.maxDelegationDepth) throw new Error('委派层数超限');
      const decision = await this.model.decide({ role: { name: role.name, persona: role.persona }, task, args });
      if (!decision || typeof decision.tool !== 'string') throw new Error('模型返回无效决策');
      emit('decision', { tool: decision.tool });
      if (!role.permissions.has(decision.tool)) throw new Error('角色无权使用能力: ' + decision.tool);
      let result;
      if (decision.tool === 'delegate') {
        if (typeof decision.role !== 'string' || typeof decision.task !== 'string' || !decision.task.trim()) throw new Error('委派参数无效');
        emit('delegate', { target: decision.role });
        result = await this.run(decision.role, decision.task, Array.isArray(decision.args) ? decision.args : [], depth + 1, onEvent);
      } else {
        const tool = this.tools.get(decision.tool);
        if (!tool || typeof tool.execute !== 'function') throw new Error('能力未注册: ' + decision.tool);
        emit('tool:start', { tool: decision.tool });
        result = await tool.execute(decision.input, { role: role.name });
        emit('tool:complete', { tool: decision.tool });
      }
      emit('run:complete');
      return result;
    } catch (error) {
      emit('run:error');
      throw error;
    }
  }
}

/** HIE 由宿主显式注入，未连接时绝不模拟设备已执行。 */
export function createHieTool(adapter) {
  return { async execute(input, context) {
    if (typeof adapter?.execute !== 'function') throw new Error('HIE 适配器未连接');
    return await adapter.execute(input, context);
  } };
}

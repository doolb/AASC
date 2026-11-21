import { parseCommand } from './command.js';

/** Responses 兼容模型；每个聊天角色独立保存续接 ID。 */
export class ResponsesModel {
  constructor({ api, roles, fetchImpl = globalThis.fetch, toolDescriptions = {}, shareDecisionSession = false, sessionStore }) {
    if (typeof fetchImpl !== 'function') throw new Error('当前 Node 版本不支持 fetch');
    this.api = api;
    this.fetch = fetchImpl;
    this.roles = new Map(roles.map(role => [role.name, role]));
    this.sessions = new Map();
    this.uncertain = new Set();
    this.toolDescriptions = toolDescriptions;
    this.shareDecisionSession = shareDecisionSession;
    this.activeRole = null;
    this.sessionStore = sessionStore;
    this.loaded = false;
  }

  async loadSession() {
    if (this.loaded) return;
    if (this.sessionStore) {
      const state = await this.sessionStore.load();
      if (state) {
        this.sessions = new Map(Object.entries(state.heads));
        this.uncertain = new Set(state.uncertain);
      }
    }
    this.loaded = true;
  }

  async persist(pending = null) {
    if (this.sessionStore) await this.sessionStore.save({ heads: Object.fromEntries(this.sessions), uncertain: [...this.uncertain], pending });
  }

  async beginToolBatch(role) {
    await this.loadSession();
    await this.persist({ type: 'tool', role: role?.name ?? '' });
  }

  /** 工具批次全部确认后，清除待完成标记；未完成或异常时保留中断保护。 */
  async finishToolBatch() {
    await this.loadSession();
    await this.persist();
  }

  async request({ input, instructions, previousResponseId }) {
    const url = this.api.baseUrl.replace(/\/$/, '').replace(/\/responses$/, '') + '/responses';
    const body = { model: this.api.model, input, stream: false };
    if (instructions) body.instructions = instructions;
    if (previousResponseId) body.previous_response_id = previousResponseId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.api.timeoutMs);
    try {
      const response = await this.fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.api.apiKey}` },
        body: JSON.stringify(body), signal: controller.signal,
      });
      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error(`模型服务返回无效 JSON（HTTP ${response.status}）`); }
      if (!response.ok) {
        const reason = typeof data?.error?.message === 'string' ? data.error.message.replaceAll(this.api.apiKey, '***') : '请求失败';
        const error = new Error(`模型服务 HTTP ${response.status}：${reason}`);
        // 只有服务端明确确认恢复了会话链头，才可在同一会话重试。
        error.retryableSession = response.status === 502 && data?.error?.code === 'upstream_confirmed_failure_retryable';
        throw error;
      }
      if (!data || data.status !== 'completed' || typeof data.id !== 'string' || !data.id) {
        throw new Error('模型响应未完成或缺少响应 ID');
      }
      const text = typeof data.output_text === 'string' ? data.output_text : (Array.isArray(data.output) ? data.output : [])
        .flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(item => item.type === 'output_text' && typeof item.text === 'string')
        .map(item => item.text).join('');
      if (!text.trim()) throw new Error('模型未返回文本');
      return { id: data.id, text };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('模型请求超时；会话可能已改变，请使用 /new 新建会话');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async respond({ message, role, roles = [], toolResults = [], previousReply = null }) {
    await this.loadSession();
    const roleName = role?.name ?? '';
    this.activeRole = roleName;
    if (this.uncertain.has(roleName)) throw new Error('当前角色会话状态不确定，请先使用 /new 新建会话');
    const previousResponseId = this.sessions.get(roleName);
    const instructions = [
      `你是个人助手，当前角色：${roleName || '默认'}。`,
      role?.persona || '',
      '用户直接发送自然语言。普通回答请直接输出文本，不要声称未执行的操作已经完成。',
      roles.length ? `可调用角色：${JSON.stringify(roles)}。需要本地操作时，整段回复只输出方括号 CSV 命令，例如 [游戏,run]；多个命令每行一条。字段含逗号时用双引号包裹，字段中的双引号写成两个双引号；不要输出解释或代码块。角色必须在可调用列表中。` : '当前没有可调用的本地角色，不要输出本地执行命令。',
    ].join('\n');
    let input = message;
    if (toolResults.length) {
      const images = [];
      const safeResults = toolResults.map(record => {
        if (!record.result?.imageDataUrl) return record;
        const { imageDataUrl, ...result } = record.result;
        images.push({ type: 'input_image', image_url: imageDataUrl });
        return { ...record, result };
      });
      const text = `当前任务：${message}\n以下是上一轮本地调用的结果，请据此继续执行，不要编造执行结果：\n${JSON.stringify({ previousReply, toolResults: safeResults })}`;
      input = images.length ? [{ role: 'user', content: [{ type: 'input_text', text }, ...images] }] : text;
    }
    let response;
    await this.persist({ type: 'request', role: roleName });
    try {
      response = await this.request({ input, instructions: previousResponseId && !this.api.instructionsEachRequest ? undefined : instructions, previousResponseId });
    } catch (error) {
      if (error.retryableSession) {
        await this.persist();
        throw error;
      }
      if (previousResponseId) {
        this.uncertain.add(roleName);
        throw new Error(`${error.message}；续接状态可能已改变，请使用 /new 新建会话`);
      }
      throw error;
    }
    this.sessions.set(roleName, response.id);
    await this.persist();
    const text = response.text.trim();
    // 只有整段均为授权角色的完整命令才执行，说明文字中的方括号只是文本。
    const lines = text.split(/\r?\n/);
    if (roles.length && lines.length <= 8 && lines.every(line => line.startsWith('[') && line.endsWith(']'))) {
      try {
        const allowed = new Set(roles.map(item => item.name));
        if (lines.every(line => allowed.has(parseCommand(line).role))) return { commands: lines };
      } catch (_) { /* 非命令或格式错误不触发本地执行。 */ }
    }
    return response.text;
  }

  async decide({ role, task, args }) {
    await this.loadSession();
    const available = this.roles.get(role.name)?.permissions ?? [];
    if (!available.length) throw new Error(`角色 ${role.name} 未授权本地能力`);
    const instructions = `你是本地能力选择器。只能选择以下能力：${JSON.stringify(available)}。` +
      `能力说明：${JSON.stringify(this.toolDescriptions)}。` +
      '只输出 JSON 对象 {"tool":"能力名","input":任意输入}。如选择 delegate，还须包含 role、task 和可选 args。不要声称已执行。';
    const previousResponseId = this.shareDecisionSession && this.activeRole !== null ? this.sessions.get(this.activeRole) : undefined;
    let response;
    try {
      const retain = previousResponseId && !this.api.instructionsEachRequest;
      const input = retain ? `${instructions}\n${JSON.stringify({ role, task, args })}` : JSON.stringify({ role, task, args });
      if (previousResponseId) await this.persist({ type: 'request', role: this.activeRole });
      response = await this.request({ input, instructions: retain ? undefined : instructions, previousResponseId });
    } catch (error) {
      if (previousResponseId) this.uncertain.add(this.activeRole);
      throw error;
    }
    if (previousResponseId) { this.sessions.set(this.activeRole, response.id); await this.persist(); }
    let result;
    try { result = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/, '')); }
    catch (_) { throw new Error('模型返回的能力决策不是有效 JSON'); }
    if (!result || typeof result !== 'object' || Array.isArray(result) || !available.includes(result.tool)) {
      throw new Error('模型选择了未授权能力');
    }
    return result;
  }

  async resetSession(role) {
    await this.loadSession();
    this.sessions.delete(role?.name ?? '');
    this.uncertain.delete(role?.name ?? '');
    await this.persist();
  }

  async markSessionUncertain(role) {
    this.uncertain.add(role?.name ?? '');
    await this.persist({ type: 'uncertain', role: role?.name ?? '' });
  }
}

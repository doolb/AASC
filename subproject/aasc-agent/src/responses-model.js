/** OpenAI Responses 兼容模型；每个聊天角色独立保存续接 ID。 */
export class ResponsesModel {
  constructor({ api, roles, fetchImpl = globalThis.fetch }) {
    if (typeof fetchImpl !== 'function') throw new Error('当前 Node 版本不支持 fetch');
    this.api = api;
    this.fetch = fetchImpl;
    this.roles = new Map(roles.map(role => [role.name, role]));
    this.sessions = new Map();
    this.uncertain = new Set();
  }

  async request({ input, instructions, previousResponseId }) {
    const url = this.api.baseUrl.replace(/\/$/, '').replace(/\/responses$/, '') + '/responses';
    const body = { model: this.api.model, input, instructions, stream: false };
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
        throw new Error(`模型服务 HTTP ${response.status}：${reason}`);
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
    const roleName = role?.name ?? '';
    if (this.uncertain.has(roleName)) throw new Error('当前角色会话状态不确定，请先使用 /new 新建会话');
    const previousResponseId = this.sessions.get(roleName);
    const instructions = [
      `你是个人助手，当前角色：${roleName || '默认'}。`,
      role?.persona || '',
      '用户直接发送自然语言。普通回答请直接输出文本，不要声称未执行的操作已经完成。',
      roles.length ? `可调用角色：${JSON.stringify(roles)}。只有确实需要本地操作时，才输出 JSON 对象 {"text":"说明","commands":["[角色,\\"任务\\"]"]}；本地能力可能尚未接入。` : '当前没有可调用的本地角色，不要输出本地执行命令。',
    ].join('\n');
    const input = toolResults.length
      ? `以下是上一轮本地调用的结果，请据此继续回复用户，不要编造执行结果：\n${JSON.stringify({ previousReply, toolResults })}`
      : message;
    let response;
    try {
      response = await this.request({ input, instructions, previousResponseId });
    } catch (error) {
      if (previousResponseId) {
        this.uncertain.add(roleName);
        throw new Error(`${error.message}；续接状态可能已改变，请使用 /new 新建会话`);
      }
      throw error;
    }
    this.sessions.set(roleName, response.id);
    const text = response.text.trim();
    // 仅显式结构化命令可触发执行；普通文本中的方括号始终只作文本。
    const candidate = text.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/, '');
    if (roles.length && candidate.startsWith('{') && candidate.endsWith('}')) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
            Object.hasOwn(parsed, 'commands')) return parsed;
      } catch (_) { /* 不完整 JSON 当作普通回复，绝不猜测修补命令。 */ }
    }
    return response.text;
  }

  async decide({ role, task, args }) {
    const available = this.roles.get(role.name)?.permissions ?? [];
    if (!available.length) throw new Error(`角色 ${role.name} 未授权本地能力`);
    const instructions = `你是本地能力选择器。只能选择以下能力：${JSON.stringify(available)}。` +
      '只输出 JSON 对象 {"tool":"能力名","input":任意输入}。如选择 delegate，还须包含 role、task 和可选 args。不要声称已执行。';
    const response = await this.request({ input: JSON.stringify({ role, task, args }), instructions });
    let result;
    try { result = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/, '')); }
    catch (_) { throw new Error('模型返回的能力决策不是有效 JSON'); }
    if (!result || typeof result !== 'object' || Array.isArray(result) || !available.includes(result.tool)) {
      throw new Error('模型选择了未授权能力');
    }
    return result;
  }

  resetSession(role) {
    this.sessions.delete(role?.name ?? '');
    this.uncertain.delete(role?.name ?? '');
  }

  markSessionUncertain(role) {
    this.uncertain.add(role?.name ?? '');
  }
}

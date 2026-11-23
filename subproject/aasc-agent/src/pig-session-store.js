import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 导航会话共享一个私有模型续接点；中断和并发修改均不能静默覆盖。 */
export class PigSessionStore {
  constructor({ getDirectory, evidenceRoot, api, newConversation = false }) {
    this.getDirectory = getDirectory;
    this.root = join(evidenceRoot, '.agent-sessions');
    this.identity = createHash('sha256').update(JSON.stringify([api.baseUrl, api.model, api.apiKey])).digest('hex');
    this.id = null;
    this.revision = null;
    this.newConversation = newConversation;
  }

  async attach() {
    const directory = await this.getDirectory();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const ref = join(directory, 'agent-session-ref.json');
    let saved;
    try { saved = JSON.parse(await readFile(ref, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (this.newConversation) {
      this.id = randomUUID();
      const temporary = ref + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify({ id: this.id }) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, ref);
      this.newConversation = false;
      return join(this.root, this.id + '.json');
    }
    if (saved) {
      if (!/^[0-9a-f-]{36}$/.test(saved.id ?? '')) throw new Error('模型会话关联无效');
      if (this.id && this.id !== saved.id) throw new Error('导航会话关联了不同的模型会话');
      this.id = saved.id;
    } else {
      this.id ??= randomUUID();
      try { await writeFile(ref, JSON.stringify({ id: this.id }) + '\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; return this.attach(); }
    }
    return join(this.root, this.id + '.json');
  }

  async read(path) {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  /** 在任何现场动作前检查上次请求与工具批次，不能因缺口去重掩盖中断状态。 */
  async inspect() {
    const state = await this.read(await this.attach());
    if (!state) return { uncertain: false };
    if (state.version !== 1 || state.identity !== this.identity || !Number.isSafeInteger(state.revision)
        || !state.heads || typeof state.heads !== 'object' || !Array.isArray(state.uncertain)) throw new Error('模型续接记录无效或配置不一致');
    if (state.pending) return { uncertain: true, reason: '上次模型请求或工具执行未完成' };
    if (state.uncertain.length) return { uncertain: true, reason: '模型角色续接状态不确定' };
    return { uncertain: false };
  }

  async load() {
    const path = await this.attach();
    const state = await this.read(path);
    if (!state) { this.revision = 0; return null; }
    if (state.version !== 1 || state.identity !== this.identity || !Number.isSafeInteger(state.revision)
        || !state.heads || typeof state.heads !== 'object' || !Array.isArray(state.uncertain)) throw new Error('模型续接记录无效或配置不一致');
    if (state.pending) throw new Error('上次模型请求或工具执行未完成，会话状态不确定');
    this.revision = state.revision;
    return state;
  }

  async save({ heads, uncertain, pending }) {
    const path = await this.attach();
    const lock = path + '.lock';
    let handle;
    try {
      handle = await open(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('模型续接记录正在被其他进程使用');
      throw error;
    }
    let temporary;
    try {
      const old = await this.read(path);
      if ((old?.revision ?? 0) !== this.revision || (old && old.identity !== this.identity)) throw new Error('模型续接记录已被其他进程修改');
      const state = { version: 1, identity: this.identity, revision: this.revision + 1, heads, uncertain, pending: pending ?? null };
      temporary = path + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
      this.revision = state.revision;
    } finally {
      if (temporary) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await handle.close();
      await unlink(lock).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}

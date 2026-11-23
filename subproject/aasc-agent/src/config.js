import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CONFIG_PATH = fileURLToPath(new URL('../config.json', import.meta.url));

/** 本地配置只描述模型与授权；密钥不进入日志、事件或示例。 */
export async function loadConfig(path = DEFAULT_CONFIG_PATH) {
  let config;
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('未找到配置文件，请复制 config.example.json 为 config.json 并填写 API Key');
    throw new Error('无法读取配置文件：' + (error instanceof SyntaxError ? 'JSON 格式无效' : error.message));
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置必须是对象');
  const api = config.api;
  if (!api || typeof api !== 'object' || Array.isArray(api)) throw new Error('缺少 API 配置');
  let base;
  try { base = new URL(api.baseUrl); } catch (_) { throw new Error('API 地址无效'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('API 地址必须是无凭据和查询参数的 HTTP(S) 地址');
  }
  if (typeof api.apiKey !== 'string' || !api.apiKey.trim()) throw new Error('请在配置中填写 API Key');
  if (typeof api.model !== 'string' || !api.model.trim()) throw new Error('请在配置中填写模型名称');
  if (api.instructionsEachRequest !== undefined && typeof api.instructionsEachRequest !== 'boolean') throw new Error('instructionsEachRequest 必须为布尔值');
  const timeoutMs = api.timeoutMs ?? 300000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw new Error('API 超时须为 1000 到 1800000 毫秒');
  if (!Array.isArray(config.roles) || !config.roles.length) throw new Error('至少配置一个角色');
  const names = new Set();
  for (const role of config.roles) {
    if (!role || typeof role.name !== 'string' || !role.name.trim() || names.has(role.name) ||
        typeof role.persona !== 'string' || !Array.isArray(role.permissions) ||
        role.permissions.some(p => typeof p !== 'string' || !p.trim())) throw new Error('角色配置无效');
    names.add(role.name);
  }
  if (typeof config.defaultRole !== 'string' || !names.has(config.defaultRole)) throw new Error('默认角色未注册');
  if (!Array.isArray(config.commandRoles) || config.commandRoles.some(name => !names.has(name))) {
    throw new Error('可调用角色配置无效');
  }
  return { ...config, api: { ...api, baseUrl: base.href.replace(/\/$/, ''), timeoutMs } };
}

import { Agent } from './agent.js';
import { ResponsesModel } from './responses-model.js';

/** 本地工具由宿主按需注入，默认仅启用模型聊天。 */
export function createConfiguredAgent(config, { tools = {}, fetchImpl } = {}) {
  const model = new ResponsesModel({ api: config.api, roles: config.roles, fetchImpl });
  return new Agent({ roles: config.roles, tools, model, commandRoles: config.commandRoles, defaultRole: config.defaultRole });
}

const { createChat2ApiRuntime } = require('../../chat2api/chat2api-runtime');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../../../');

const FALSE_VALUES = new Set(['false', '0', 'off', 'no']);
const TRUE_VALUES = new Set(['true', '1', 'on', 'yes']);

const normalizeBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  if (FALSE_VALUES.has(normalized)) return false;
  if (TRUE_VALUES.has(normalized)) return true;
  return fallback;
};

const escapeWidgetText = (value) => String(value == null ? '' : value)
  .replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;')
  .replace(/'/gu, '&#39;');

module.exports = {
  id: 'chat2api.proxy',
  name: 'Chat2API 兼容代理',
  description: '内置 Provider、账号负载均衡和 OpenAI 兼容代理服务',
  target: 'server',
  mode: 'service',
  sidebar: { group: 'aiService', tab: 'proxy', label: 'Chat2API', icon: '🤖', priority: 20 },
  params: [
    { name: 'host', type: 'text', required: false, default: '127.0.0.1', label: '监听地址' },
    { name: 'port', type: 'number', required: false, default: 8080, label: '监听端口' },
    { name: 'enableApiKey', type: 'toggle', required: false, default: true, label: '启用 API Key 鉴权' },
  ],
  widget: {
    html: '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<div>状态：<strong style="color:{{_statusColor}}">{{statusText}}</strong></div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.65)">地址：{{addressText}}</div>' +
      '<div>网页会话：<strong>{{qwenImportText}}</strong></div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.65)">导入文件：{{qwenImportPath}}</div>' +
      '<div style="display:flex;gap:8px"><button class="task-card-btn" onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'widgetRefresh\')">刷新</button>' +
      '<button class="task-card-btn primary" onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'importQwenWebHistory\')">手动导入网页会话记录</button>' +
      '<button class="task-card-btn primary" onclick="Chat2APIControl.open(\'{{addressText}}\',\'{{instanceId}}\')">账户管理</button>' +
      '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'{{instanceId}}\')">停止服务</button></div>' +
    '</div>',
    actions: [{ id: 'widgetRefresh', label: '刷新' }],
  },
  async run(context) {
    const params = context.params || {};
    const factory = context.chat2apiRuntimeFactory || createChat2ApiRuntime;
    const runtime = factory({
      rootDir: params.rootDir,
      host: params.host,
      port: params.port,
      projectRoot: context.projectRoot || PROJECT_ROOT,
      config: { enableApiKey: normalizeBoolean(params.enableApiKey, true) },
    });
    await runtime.start();

    const widgetState = {
      qwenImportText: '尚未导入',
      qwenImportPath: '--',
    };

    const pushWidgetUpdate = () => {
      if (typeof context.postWidgetUpdate !== 'function') return;
      const status = runtime.getStatus();
      const address = status.address;
      context.postWidgetUpdate({
        statusText: status.running ? '运行中' : '已停止',
        _statusColor: status.running ? '#4ade80' : '#f87171',
        addressText: address ? `${address.address}:${address.port}` : '--',
        ...widgetState,
      });
    };
    const handlers = context.onWidgetAction;
    if (typeof handlers === 'function') {
      handlers('widgetRefresh', async () => {
        pushWidgetUpdate();
        return { success: true };
      });
      handlers('importQwenWebHistory', async (actionParams = {}) => {
        widgetState.qwenImportText = '正在导入...';
        pushWidgetUpdate();
        try {
          if (!runtime.managementService || typeof runtime.managementService.importQwenWebConversations !== 'function') {
            throw new Error('Qwen 网页会话导入服务不可用');
          }
          const result = await runtime.managementService.importQwenWebConversations(actionParams);
          widgetState.qwenImportText = `已导入 ${result.imported}/${result.total} 个会话${result.failed ? `，失败 ${result.failed} 个` : ''}`;
          widgetState.qwenImportPath = result.indexFile || 'tmp/qwen-web-import/index.json';
          pushWidgetUpdate();
          return { success: result.failed === 0, data: result };
        } catch (error) {
          widgetState.qwenImportText = `导入失败：${escapeWidgetText(error && error.message)}`;
          widgetState.qwenImportPath = '--';
          pushWidgetUpdate();
          return { success: false, error: error.message };
        }
      });
    }
    pushWidgetUpdate();

    return {
      type: 'service',
      stop: async () => {
        await runtime.stop();
        pushWidgetUpdate();
      },
    };
  },
};

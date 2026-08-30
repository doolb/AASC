const { createChat2ApiRuntime } = require('../../chat2api/chat2api-runtime');

const FALSE_VALUES = new Set(['false', '0', 'off', 'no']);
const TRUE_VALUES = new Set(['true', '1', 'on', 'yes']);

const normalizeBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  if (FALSE_VALUES.has(normalized)) return false;
  if (TRUE_VALUES.has(normalized)) return true;
  return fallback;
};

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
      '<div style="display:flex;gap:8px"><button class="task-card-btn" onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'widgetRefresh\')">刷新</button>' +
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
      config: { enableApiKey: normalizeBoolean(params.enableApiKey, true) },
    });
    await runtime.start();

    const pushWidgetUpdate = () => {
      if (typeof context.postWidgetUpdate !== 'function') return;
      const status = runtime.getStatus();
      const address = status.address;
      context.postWidgetUpdate({
        statusText: status.running ? '运行中' : '已停止',
        _statusColor: status.running ? '#4ade80' : '#f87171',
        addressText: address ? `${address.address}:${address.port}` : '--',
      });
    };
    const handlers = context.onWidgetAction;
    if (typeof handlers === 'function') {
      handlers('widgetRefresh', async () => {
        pushWidgetUpdate();
        return { success: true };
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

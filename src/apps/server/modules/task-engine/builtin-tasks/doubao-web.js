'use strict';

const { DEFAULT_ROOT_DIR } = require('../../chat2api/chat2api-data-store');
const { createChat2ApiRuntime } = require('../../chat2api/chat2api-runtime');
const { createChat2ApiDataStore } = require('../../chat2api/chat2api-data-store');
const { createDoubaoWebMediaService } = require('../../chat2api/chat2api-doubao-web-media');
const { createDoubaoWebFileService } = require('../../chat2api/chat2api-doubao-web-file');
const { createDoubaoBrowserBridge } = require('../../chat2api/chat2api-doubao-browser-bridge');
const { createDoubaoAndroidBridge } = require('../../chat2api/chat2api-doubao-android-bridge');
const { normalizeDoubaoWebConfig } = require('../../chat2api/chat2api-doubao-web-config');
const { activateDoubaoWebTask } = require('../../chat2api/chat2api-doubao-web-task-registry');

module.exports = {
  id: 'doubao.web',
  name: '豆包网页',
  description: '通过专用浏览器运行豆包网页能力，并向 Chat2API 提供页面内请求',
  target: 'server',
  mode: 'service',
  sidebar: { group: 'aiService', tab: 'doubaoWeb', label: '豆包网页', icon: '🫘', priority: 21 },
  params: [
    { name: 'port', type: 'number', required: false, default: 9091, label: '兼容 API 端口' },
    { name: 'browserExecutable', type: 'text', required: false, default: 'vivaldi', label: '浏览器名称或绝对路径' },
    { name: 'debugPort', type: 'number', required: false, default: 9224, label: '本机调试端口' },
    { name: 'accountId', type: 'text', required: false, default: '', label: '豆包账号 ID' },
  ],
  widget: {
    html: '<div>状态：<strong style="color:{{_statusColor}}">{{statusText}}</strong></div>' +
      '<div style="font-size:12px">账号：{{accountText}}</div>' +
      '<div style="font-size:12px">API：{{addressText}}</div>' +
      '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'{{instanceId}}\')">停止服务</button>',
  },
  async run(context) {
    const config = normalizeDoubaoWebConfig({ mode: 'browser-fetch',
      browserExecutable: context.params?.browserExecutable || 'vivaldi',
      debugPort: Number(context.params?.debugPort ?? 9224),
      accountId: context.params?.accountId || '' });
    const bridge = context.doubaoBrowserBridge || (process.env.AASC_ANDROID_NODE === '1'
      ? createDoubaoAndroidBridge({ accountId: config.accountId })
      : createDoubaoBrowserBridge({
        rootDir: context.chat2apiRootDir || DEFAULT_ROOT_DIR, getConfig: () => config,
      }));
    const deactivate = activateDoubaoWebTask(bridge, config);
    const port = Number(context.params?.port ?? 9091);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      deactivate();
      throw new Error('豆包网页兼容 API 端口无效');
    }
    const factory = context.chat2apiRuntimeFactory || createChat2ApiRuntime;
    const rootDir = context.chat2apiRootDir || DEFAULT_ROOT_DIR;
    const mediaStore = context.doubaoMediaDataStore || createChat2ApiDataStore({ rootDir });
    const doubaoMediaService = context.doubaoMediaService || createDoubaoWebMediaService({
      bridge, dataStore: mediaStore, accountId: config.accountId,
    });
    const doubaoFileService = context.doubaoFileService || createDoubaoWebFileService({
      bridge, dataStore: mediaStore, accountId: config.accountId,
    });
    let runtime;
    try {
      runtime = factory({ rootDir,
        projectRoot: context.projectRoot, host: '127.0.0.1', port, config: { enableApiKey: true },
        doubaoBrowserBridge: bridge, getDoubaoTransport: () => 'browser-fetch',
        doubaoMediaService, doubaoFileService });
      await runtime.start();
    }
    catch (error) {
      deactivate();
      await Promise.resolve().then(() => runtime?.stop?.()).catch(() => {});
      await bridge.stop().catch(() => {});
      throw error;
    }
    context.postWidgetUpdate?.({ statusText: '运行中', _statusColor: '#4ade80',
      accountText: config.accountId || '按当前请求选择', addressText: `127.0.0.1:${port}` });
    return { type: 'service', stop: async () => {
      deactivate();
      await runtime.stop();
      await bridge.stop();
      context.postWidgetUpdate?.({ statusText: '已停止', _statusColor: '#f87171',
        accountText: '--', addressText: '--' });
    } };
  },
};

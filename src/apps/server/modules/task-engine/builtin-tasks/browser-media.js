'use strict';
const { createBrowserMediaService, normalizeOrigins, normalizeSessionLimit } = require('../../media/browser-media-service');
const { createAndroidBrowserAdapter } = require('../../media/browser-media-android');
const { activateBrowserMedia } = require('../../media/browser-media-registry');
const { USER_CONFIG_DIR } = require('../../config/user-config-paths');
const fs = require('node:fs');

module.exports = {
  id: 'browser.media', name: '浏览器媒体', description: '浏览器访问及受限媒体采集', target: 'server', mode: 'service',
  params: [
    { name: 'browserExecutable', type: 'text', required: false, default: 'vivaldi', label: 'Vivaldi 路径' },
    { name: 'allowedOrigins', type: 'text', required: false, default: '', label: '允许的网站（留空允许所有 HTTPS，多个地址用逗号分隔）' },
    { name: 'maxSessions', type: 'number', required: false, default: 1, min: 1, max: 4, step: 1, label: '会话上限（1–4）' },
    { name: 'initialUrl', type: 'text', required: false, default: '', label: '启动时打开的网址（可选）' },
    { name: 'proxyUrl', type: 'text', required: false, default: '', label: '启动页面代理（可选）' }
  ],
  widget: { html: '<div>状态：<strong>{{statusText}}</strong></div><div>浏览器会话：{{sessionCount}}</div><div>{{scanText}}</div>' +
    '<button class="task-card-btn" onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'showBrowserMediaPage\')">查看运行页面</button> ' +
    '<button class="task-card-btn" onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'scanMedia\')">扫描并保存</button> ' +
    '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'{{instanceId}}\')">停止服务</button>' },
  async run(context) {
    const environment = context.browserMediaEnvironment || process.env;
    const platform = context.browserMediaPlatform || process.platform;
    const hasX1 = context.browserMediaHasX1 ?? fs.existsSync('/tmp/.X11-unix/X1');
    const display = environment.DISPLAY || (!environment.WAYLAND_DISPLAY && hasX1 ? ':1' : '');
    const android = environment.AASC_ANDROID_NODE === '1' || Boolean(environment.ANDROID_ROOT);
    if (!android && (platform !== 'linux' || (!display && !environment.WAYLAND_DISPLAY))) throw new Error('浏览器媒体任务仅支持 Linux 图形桌面或 Android Offline');
    const params = context.params || {};
    const origins = normalizeOrigins(params.allowedOrigins);
    let scanText = '尚未扫描';
    const push = status => {
      const entries = status.sessions || [];
      const statusText = entries.some(item => item.state === 'challenge' || item.state === 'blocked') ? '请求受限，请查看运行页面' : entries.some(item => item.state === 'error') ? '页面请求失败' : (status.running ? '运行中' : '已停止');
      context.postWidgetUpdate?.({ statusText, sessionCount: String(entries.length), scanText });
    };
    const factory = context.browserMediaFactory || createBrowserMediaService;
    const adapter = android ? createAndroidBrowserAdapter({ port: environment.AASC_BROWSER_MEDIA_PORT, token: environment.AASC_BROWSER_MEDIA_TOKEN }) : {};
    const service = factory({ ...adapter, rejectProxy: android, rootDir: context.browserMediaRoot || USER_CONFIG_DIR, browserExecutable: params.browserExecutable || 'vivaldi', allowedOrigins: origins, maxSessions: normalizeSessionLimit(params.maxSessions), display, onStatus: push });
    let deactivate;
    try { deactivate = activateBrowserMedia(service); }
    catch (error) { await service.stop(); throw error; }
    const manual = { sourceId: 'manual', pageUrl: String(params.initialUrl || ''), proxyUrl: String(params.proxyUrl || '') };
    if (manual.pageUrl) {
      try { await service.open(manual); }
      catch (error) {
        if (error.code !== 'BROWSER_MEDIA_CHALLENGE') { deactivate(); await service.stop(); throw error; }
      }
    }
    context.onWidgetAction?.('widgetRefresh', async () => { push(service.status()); return { success: true }; });
    context.onWidgetAction?.('showPage', async () => {
      try { await service.showPage(); return { success: true }; }
      catch { scanText = '尚无运行页面，请先在参数中设置网址'; push(service.status()); return { success: false, error: scanText }; }
    });
    context.onWidgetAction?.('scanMedia', async () => {
      try {
        const result = await service.extractCurrent();
        if (!result.items.length) { scanText = '未发现媒体，播放后可重试'; push(service.status()); return { success: false, error: '未发现媒体，播放后可重试' }; }
        if (!context.saveUserMedia) throw new Error('用户媒体存储不可用');
        await context.saveUserMedia(result);
        scanText = `已保存 ${result.items.length} 个媒体候选`;
        push(service.status());
        return { success: true, data: { count: result.items.length } };
      } catch (error) {
        scanText = ['BROWSER_MEDIA_CHALLENGE', 'BROWSER_MEDIA_BLOCKED'].includes(error.code) ? '页面需要验证，请处理后重试' : '扫描或保存失败，请检查运行页面';
        push(service.status());
        return { success: false, error: scanText };
      }
    });
    push(service.status());
    return { type: 'service', stop: async () => { try { await service.stop(); } finally { deactivate(); } } };
  }
};

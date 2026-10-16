'use strict';

const COMMANDS = Object.freeze({ select: 'android.saf.select', status: 'android.saf.status' });
const STATES = new Set(['idle', 'pending', 'succeeded', 'cancelled', 'failed']);
const REQUEST_ID = /^[a-f0-9-]{36}$/u;

/**
 * SAF目录属于Android系统授权，不将content URI写入Node配置。
 * 本模块只通过APK注入的带token回环网关发起动作，复用既有AASC节点请求。
 */
function createAndroidSafControl(options = {}) {
    const { url, token, mediaLibraryManager, fetchImpl = globalThis.fetch } = options;
    let supported = false;
    let refreshedRequestId = null;
    let refreshing = null;
    let watchedRequestId = null;
    let baseUrl;
    if (url && token) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)
            || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
            throw new Error('Android SAF 控制网关必须是APK提供的回环HTTP地址');
        }
        baseUrl = parsed;
    }

    /** 仅投影明确字段，原生授权URI、网关token与未知字段不能进入控制端快照。 */
    function snapshot(value) {
        if (!value || value.supported !== true || !STATES.has(value.state)
            || (value.state !== 'idle' && !REQUEST_ID.test(value.requestId))
            || (value.requestId != null && !REQUEST_ID.test(value.requestId))) {
            throw new Error('Android SAF 选择状态格式无效');
        }
        return { supported: true, state: value.state, requestId: value.requestId || null,
            hasDirectory: value.hasDirectory === true,
            message: typeof value.message === 'string' ? value.message.slice(0, 256) : '' };
    }

    async function gateway(method, requestId) {
        if (!baseUrl) throw new Error('当前服务器没有Android SAF授权入口');
        const endpoint = new URL('v1/directory-selection', baseUrl);
        if (requestId) endpoint.searchParams.set('requestId', requestId);
        const response = await fetchImpl(endpoint, { method, redirect: 'error',
            headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`Android SAF 选择入口不可用（HTTP ${response.status}），请先更新APK`);
        }
        return snapshot(await response.json());
    }

    /** 探测旧APK时404/超时视为不支持，不能阻塞普通服务器启动。 */
    async function initialize() {
        if (!baseUrl) return;
        try { supported = (await gateway('GET')).supported; }
        catch { supported = false; }
    }

    async function refreshLibrary(requestId) {
        if (refreshedRequestId === requestId) return;
        if (refreshing) {
            await refreshing;
            if (refreshedRequestId === requestId) return;
        }
        refreshing = (async () => {
            const existing = mediaLibraryManager.getLibrary('android-saf');
            if (existing) {
                await existing.provider.connect();
                existing.provider.cache?.clear();
            } else {
                await mediaLibraryManager.addLibrary({ id: 'android-saf', name: 'Android SAF 媒体目录',
                    type: 'android-saf', managed: true, readonly: false, url: baseUrl.href, token });
                if (!mediaLibraryManager.getDefaultLibraryId()) mediaLibraryManager.defaultLibraryId = 'android-saf';
            }
            refreshedRequestId = requestId;
        })();
        try { await refreshing; }
        catch (error) { throw new Error(`目录已授权，但媒体库刷新失败：${error.message}`); }
        finally { refreshing = null; }
    }

    /** 控制端关闭也继续观察本次结果；观察有界且不保持Node进程存活。 */
    function watchSelection(requestId) {
        if (watchedRequestId === requestId) return;
        watchedRequestId = requestId;
        let attempts = 0;
        const poll = async () => {
            if (watchedRequestId !== requestId) return;
            try {
                const result = await gateway('GET', requestId);
                if (watchedRequestId !== requestId) return;
                if (result.state === 'succeeded') await refreshLibrary(requestId);
                if (watchedRequestId !== requestId) return;
                if (result.state !== 'pending') { watchedRequestId = null; return; }
            } catch {
                // 临时断开或刷新失败可在后续查询重试，不能清掉APK已保存的授权。
            }
            if (watchedRequestId !== requestId) return;
            if (++attempts >= 600) { watchedRequestId = null; return; }
            const timer = setTimeout(() => { void poll(); }, 1000);
            timer.unref?.();
        };
        const timer = setTimeout(() => { void poll(); }, 1000);
        timer.unref?.();
    }

    async function handle(type, payload = {}) {
        if (!supported) throw new Error('当前APK不支持重选SAF目录，请先更新APK');
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)
            || Object.keys(payload).some(key => key !== 'requestId')
            || (payload.requestId !== undefined && !REQUEST_ID.test(payload.requestId))) {
            throw new Error('SAF目录动作只接受有效requestId，不能指定目录或URI');
        }
        const result = await gateway(type === COMMANDS.select ? 'POST' : 'GET', payload.requestId);
        if (result.state === 'pending') watchSelection(result.requestId);
        if (result.state === 'succeeded') await refreshLibrary(result.requestId);
        return result;
    }

    return { initialize, capabilities: () => supported ? { androidSafDirectorySelection: true } : {},
        handlers: new Map(Object.values(COMMANDS).map(type => [type, payload => handle(type, payload)])) };
}

module.exports = { createAndroidSafControl };

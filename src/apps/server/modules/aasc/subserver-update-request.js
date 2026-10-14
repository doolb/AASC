'use strict';

const crypto = require('node:crypto');

function normalizeUpdateRequest(payload = {}) {
    return { type: 'serverUpdateRequested', requestId: crypto.randomUUID(), force: payload.force === true };
}

/** 请求只交给声明了更新能力的进程监督器；accepted只表示接收，不表示下载或安装成功。 */
async function requestManagedUpdate(options = {}) {
    const environment = options.environment || process.env;
    if (!options.send || environment.AASC_SUBSERVER_UPDATE_IPC !== '1') {
        throw new Error('当前启动器不支持主服务器服务更新，请重装新版普通APK或使用新版受管启动器');
    }
    const request = normalizeUpdateRequest(options.payload);
    request.healthUrl = options.healthUrl;
    request.mainServerUrl = options.mainServerUrl;
    await new Promise((resolve, reject) => {
        try { options.send(request, error => error ? reject(error) : resolve()); }
        catch (error) { reject(error); }
    });
    return { accepted: true, requestId: request.requestId, force: request.force,
        source: 'main-server', state: 'preparing' };
}

module.exports = { normalizeUpdateRequest, requestManagedUpdate };

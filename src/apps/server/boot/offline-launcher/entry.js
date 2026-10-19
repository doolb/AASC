'use strict';

const { Controller } = require('./controller');
const files = require('./files');

/** 宿主原有launcherVersion是代码包身份；新增字段读取签名清单中的独立启动器版本。 */
function launcherReleaseVersion(config) {
    const codeVersion = config.launcherVersion || 0;
    const state = files.read(config.root, 'updates/launcher-state.json', {});
    const selected = [state.pending, state.active].find(value => value?.version === codeVersion);
    const releaseVersion = selected?.manifest?.payload?.components?.code?.launcherVersion;
    return Number.isSafeInteger(releaseVersion) && releaseVersion > 0 ? releaseVersion : codeVersion;
}

function main(config = JSON.parse(process.env.AASC_LAUNCH_CONTEXT || '{}')) {
    if (!process.send || config.hostApi !== 1 || config.stateApi !== 1) throw new Error('JS启动器必须由兼容宿主启动');
    const send = value => { if (process.connected) process.send(value); };
    const controller = new Controller(config, send, payload => send({ type: 'launcher.switch', payload }));
    let closing = false;
    process.on('message', async message => {
        if (message?.type === 'host.stop') {
            if (closing) return; closing = true;
            await controller.close(); process.exit(0); return;
        }
        if (closing || typeof message?.requestId !== 'string') return;
        try {
            const result = await controller.handle(message);
            if (!result?.handingOff) send({ type: 'rpc.result', requestId: message.requestId, result });
        } catch (error) { send({ type: 'rpc.result', requestId: message.requestId, error: error.message }); }
        finally { send({ type: 'models.state', payload: controller.models.status() }); }
    });
    process.once('disconnect', async () => { await controller.close(); process.exit(0); });
    send({ type: 'launcher.ready', payload: { hostApi: 1, stateApi: 1, launcherVersion: config.launcherVersion || 0,
        launcherReleaseVersion: launcherReleaseVersion(config),
        catalog: { ...controller.models.catalog, groups: controller.models.groups() } } });
    send({ type: 'models.state', payload: controller.models.status() });
    controller.initializing = controller.boot().catch(error => { console.error('[JS启动器]', error.message); throw error; });
    controller.initializing.catch(error => send({ type: 'launcher.failed', payload: { error: error.message } }));
    return controller;
}
if (require.main === module) main();
module.exports = { main, launcherReleaseVersion };

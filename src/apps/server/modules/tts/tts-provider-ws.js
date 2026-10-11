'use strict';

// 与AASC控制端handler共用同一权威配置流程，禁止额外HTTP配置接口。
function createTtsProviderWs({ config, service, accounts, isControl, broadcast }) {
    const message = extra => ({ type: 'ttsProviderConfig', config: config.getPublicTtsProviderSettings(), ...extra });
    return {
        snapshot: message,
        async handle(ws, data) {
            if (!['setTtsProviderConfig', 'getTtsProviderVoices', 'getTtsProviderAccounts'].includes(data.type)) return false;
            if (!isControl(ws)) return true;
            if (data.type === 'getTtsProviderAccounts') {
                try {
                    const choices = await accounts.list();
                    ws.send(JSON.stringify({ type: 'ttsProviderAccounts', requestId: data.requestId, accounts: choices, success: true }));
                } catch (error) {
                    ws.send(JSON.stringify({ type: 'ttsProviderAccounts', requestId: data.requestId, success: false,
                        message: 'Chat2API 千问账号列表读取失败' }));
                }
                return true;
            }
            if (data.type === 'getTtsProviderVoices') {
                try {
                    const voices = await service.voices(data.provider);
                    ws.send(JSON.stringify({ type: 'ttsProviderVoices', provider: data.provider,
                        requestId: data.requestId, voices, success: true }));
                } catch (error) {
                    ws.send(JSON.stringify({ type: 'ttsProviderVoices', provider: data.provider,
                        requestId: data.requestId, success: false, message: error.message }));
                }
                return true;
            }
            try {
                config.setTtsProviderSettings(data.config);
                broadcast(message({ requestId: data.requestId, success: true }));
            } catch (error) {
                ws.send(JSON.stringify(message({ requestId: data.requestId, success: false, message: error.message })));
            }
            return true;
        }
    };
}

module.exports = { createTtsProviderWs };

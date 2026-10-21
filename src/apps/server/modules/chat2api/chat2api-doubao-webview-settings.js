'use strict';

const CONFIG_PATH = 'chat2api.doubaoWebView';
const normalizeDoubaoWebViewSettings = value => ({ closeAfterSign: value?.closeAfterSign === true });

/** 运行参数只通过AASC权威配置流保存，Chat2API HTTP配置接口不承担这项配置。 */
const createDoubaoWebViewSettings = ({ config, broadcast, isControl }) => {
  const snapshot = extra => ({ type: 'doubaoWebViewConfig',
    ...normalizeDoubaoWebViewSettings(config.get(CONFIG_PATH)), ...extra });
  const handle = (socket, data) => {
    if (!['getDoubaoWebViewConfig', 'setDoubaoWebViewConfig'].includes(data.type)) return false;
    if (!isControl(socket)) return true;
    try {
      if (data.type === 'getDoubaoWebViewConfig') {
        socket.send(JSON.stringify(snapshot({ requestId: data.requestId })));
        return true;
      }
      if (typeof data.closeAfterSign !== 'boolean') throw new Error('关闭签名页面开关必须是布尔值');
      const normalized = normalizeDoubaoWebViewSettings(data);
      if (!config.set(CONFIG_PATH, normalized)) throw new Error('保存豆包签名页面配置失败');
      broadcast(snapshot({ requestId: data.requestId, success: true }));
    } catch (error) {
      socket.send(JSON.stringify(snapshot({ requestId: data.requestId, success: false, message: error.message })));
    }
    return true;
  };
  return { snapshot, handle, get: () => normalizeDoubaoWebViewSettings(config.get(CONFIG_PATH)) };
};

module.exports = { normalizeDoubaoWebViewSettings, createDoubaoWebViewSettings };

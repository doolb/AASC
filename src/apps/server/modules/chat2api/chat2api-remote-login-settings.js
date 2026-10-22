'use strict';
const CONFIG_PATH = 'chat2api.remoteLogin';
const normalizeRemoteLoginSettings = value => ({ fps: Number.isInteger(value?.fps) && value.fps >= 1 && value.fps <= 30 ? value.fps : 10 });
/** 运行配置只经控制端WS持久化，所有控制端接收同一权威值。 */
const createRemoteLoginSettings = ({ config, broadcast, isControl }) => {
  const get = () => normalizeRemoteLoginSettings(config.get(CONFIG_PATH));
  const snapshot = extra => ({ type: 'chat2apiRemoteLoginConfig', ...get(), ...extra });
  const handle = (socket, data) => {
    if (!['getChat2ApiRemoteLoginConfig', 'setChat2ApiRemoteLoginConfig'].includes(data.type)) return false;
    if (!isControl(socket)) return true;
    try {
      if (data.type === 'getChat2ApiRemoteLoginConfig') socket.send(JSON.stringify(snapshot({ requestId: data.requestId })));
      else {
        if (!Number.isInteger(data.fps) || data.fps < 1 || data.fps > 30) throw new Error('帧率必须是1～30的整数');
        if (!config.set(CONFIG_PATH, normalizeRemoteLoginSettings(data))) throw new Error('保存帧率失败');
        broadcast(snapshot({ requestId: data.requestId, success: true }));
      }
    } catch (error) { socket.send(JSON.stringify(snapshot({ requestId: data.requestId, success: false, message: error.message }))); }
    return true;
  };
  return { get, snapshot, handle };
};
module.exports = { normalizeRemoteLoginSettings, createRemoteLoginSettings };

'use strict';

const { browserError } = require('./chat2api-doubao-browser-bridge');

let active = null;

/** Chat2API 与任务引擎共处一个 Node 进程，只有运行中的内置任务持有浏览器桥。 */
const activateDoubaoWebTask = (bridge, config) => {
  if (active) throw browserError('busy');
  const token = Symbol('doubao.web');
  active = { token, bridge, config };
  return () => {
    if (active?.token === token) active = null;
  };
};
const getDoubaoWebTaskStatus = () => ({ running: Boolean(active),
  accountId: active?.config?.accountId || '', mode: active?.config?.mode || 'browser-fetch' });
const doubaoWebTaskBridge = {
  request: options => active?.bridge?.request(options) || Promise.reject(browserError('disabled')),
};

module.exports = { activateDoubaoWebTask, getDoubaoWebTaskStatus, doubaoWebTaskBridge };

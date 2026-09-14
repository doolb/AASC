const getDisplayId = (display) => display && (display.displayId || display.id);

const getState = (display) => display && display.state && typeof display.state === 'object' ? display.state : {};

const hasAndroidControlCapability = (display) => {
  const state = getState(display);
  const capabilities = state.capabilities || display?.capabilities || {};
  return capabilities.androidControlPage === true;
};

const createAndroidControlPageAccess = ({ sendToDisplay = () => {}, persist = () => {} } = {}) => {
  const set = (display, enabled) => {
    const displayId = getDisplayId(display);
    if (!displayId) {
      throw new Error('显示端缺少有效 ID');
    }
    if (typeof enabled !== 'boolean') {
      throw new Error('Android 控制端开放状态必须是布尔值');
    }
    if (!hasAndroidControlCapability(display)) {
      throw new Error('显示端不支持 Android 控制端');
    }
    const message = { type: 'displayControlAccess', enabled };
    sendToDisplay(displayId, message);
    persist(display, { androidControlPageOpen: enabled });
    return { displayId, enabled, message };
  };

  const get = (display) => ({
    supported: hasAndroidControlCapability(display),
    enabled: getState(display).androidControlPageOpen === true,
  });

  return { set, get, hasAndroidControlCapability };
};

module.exports = {
  createAndroidControlPageAccess,
  hasAndroidControlCapability,
};

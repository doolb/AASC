const BuildingType = {
  SERVER: 'server',
  DISPLAY: 'display',
  CONTROL: 'control'
};

const BuildingStatus = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  BUSY: 'busy'
};

const ActorStatus = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  BUSY: 'busy',
  DEGRADED: 'degraded',
  OFFLINE: 'offline'
};

const CapabilityCategory = {
  BASIC: 'basic',
  PROFESSIONAL: 'professional',
  SPECIAL: 'special'
};

const BuildingColors = {
  server: 0x3498db,
  display: 0x2ecc71,
  control: 0xe67e22
};

const StatusColors = {
  initializing: 0x3498db,
  ready: 0x2ecc71,
  busy: 0xf1c40f,
  degraded: 0xe67e22,
  offline: 0x95a5a6
};

const LevelSizeMap = {
  1: 24,
  2: 32,
  3: 40,
  4: 48,
  5: 56
};

const BuildingSize = {
  server: { width: 140, height: 100 },
  display: { width: 100, height: 70 },
  control: { width: 80, height: 60 }
};

const BuildingIcons = {
  server: '🖥️',
  display: '📺',
  control: '📱'
};

const AccessoryIcons = {
  basic: '🎩',
  professional: '🧥',
  special: '✨'
};

export {
  BuildingType,
  BuildingStatus,
  ActorStatus,
  CapabilityCategory,
  BuildingColors,
  StatusColors,
  LevelSizeMap,
  BuildingSize,
  BuildingIcons,
  AccessoryIcons
};

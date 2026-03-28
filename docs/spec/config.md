# 配置实现文档

## 配置文件

| 文件 | 说明 |
|------|------|
| config/config.json | 主配置文件 |
| config/chat-history.json | 聊天历史 |
| config/media-libraries.json | 媒体库配置 |
| config/reminders.json | 提醒配置 |

## 默认配置

**core/config.js**:
```javascript
const defaultConfig = {
    server: {
        port: 8081
    },
    tts: {
        serviceUrl: 'http://192.168.1.16:3000/api/tts',
        defaultVoice: 'Microsoft Xiaoxiao',
        defaultSpeed: 0
    },
    displayStates: {}
};

const defaultDisplayState = {
    currentMedia: null,
    rotation: 0,
    fit: 'contain',
    crop: { x: 0, y: 0, width: 100, height: 100 },
    volume: 100,
    playlist: []
};
```

## API

### loadConfig()
加载配置文件。

### saveConfig()
保存配置到文件。

### get(key, defaultValue)
获取配置项，支持点分隔路径。

```javascript
config.get('server.port', 8081);
config.get('tts.serviceUrl');
```

### set(key, value)
设置配置项。

```javascript
config.set('server.port', 3000);
config.set('tts.defaultVoice', 'Microsoft Huihui');
```

### getTtsConfig() / setTtsConfig()
获取/设置 TTS 配置。

### getDisplayState(ip) / saveDisplayState(ip, state)
获取/保存显示端状态。

## 相关文件

| 文件 | 说明 |
|------|------|
| core/config.js | 配置管理模块 |
| server.js | 配置初始化和使用 |

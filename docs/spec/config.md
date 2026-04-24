# 配置实现文档

## 配置文件

| 文件 | 说明 |
|------|------|
| config/config.json | 主配置文件 |
| config/chat-history.json | 聊天历史 |
| config/media-libraries.json | 媒体库配置 |
| config/reminders.json | 提醒配置 |

## 默认配置

**src/core/config/config.js**:
```javascript
const defaultConfig = {
    server: {
        port: 8081
    },
    tts: {
        serviceUrl: 'http://192.168.1.16:3000/api/tts',
        defaultVoice: 'Microsoft Xiaoxiao',
        defaultSpeed: 0,
        requestTimeoutMs: 20000,
        maxErrorBytes: 65536
    },
    voiceCommand: {
        defaultWeatherCity: '',
        weatherCities: ['北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '重庆', '天津', '武汉', '西安', '长沙', '郑州', '青岛', '厦门', '福州', '宁波', '无锡', '合肥'],
        reminderTemplate: '{content}',
        reminderTemplatePrefix: '',
        reminderTemplateSuffix: ''
    },
    logBrain: {
        errorThreshold: 1,
        warnThreshold: 20,
        memoryWarningThreshold: 85,
        defaultTimeRange: '10m'
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

## 核心 API

### loadConfig()
加载配置文件。

```
如果配置文件存在:
    读取文件内容
    解析 JSON
    与默认配置深度合并 (deepMerge)
否则:
    使用默认配置
    保存到文件
```

### saveConfig()
保存配置到文件。

```
将 config 序列化为 JSON (缩进2空格)
写入 CONFIG_FILE
```

### getConfig()
获取完整配置对象。

### get(key, defaultValue)
获取配置项，支持点分隔路径。

```javascript
config.get('server.port', 8081);
config.get('tts.serviceUrl');
```

```
分割 key 为路径数组
遍历路径获取值
如果路径不存在，返回 defaultValue
```

### set(key, value)
设置配置项。

```javascript
config.set('server.port', 3000);
config.set('tts.defaultVoice', 'Microsoft Huihui');
```

```
分割 key 为路径数组
遍历路径创建中间对象
设置最终值
调用 saveConfig()
```

## 日志大脑配置

### get('logBrain.*')
读取日志大脑规则阈值。

```javascript
config.get('logBrain.errorThreshold', 1);
config.get('logBrain.warnThreshold', 20);
config.get('logBrain.memoryWarningThreshold', 85);
config.get('logBrain.defaultTimeRange', '10m');
```

## TTS 配置 API

### getTtsConfig()
获取 TTS 配置。

```javascript
{
    serviceUrl: 'http://...',
    defaultVoice: 'Microsoft Xiaoxiao',
    defaultSpeed: 0,
    requestTimeoutMs: 20000,
    maxErrorBytes: 65536
}
```

### setTtsConfig(ttsConfig)
设置 TTS 配置。

```
如果 serviceUrl 存在:
    set('tts.serviceUrl', serviceUrl)
如果 defaultVoice 存在:
    set('tts.defaultVoice', defaultVoice)
如果 defaultSpeed 存在:
    set('tts.defaultSpeed', defaultSpeed)
如果 requestTimeoutMs 存在:
    set('tts.requestTimeoutMs', requestTimeoutMs)
如果 maxErrorBytes 存在:
    set('tts.maxErrorBytes', maxErrorBytes)
```

## 显示端状态 API

### getDisplayState(ip)
获取显示端状态。

```
从 displayStates 获取指定 IP 的状态
如果不存在，返回默认状态
```

### setDisplayState(ip, state)
保存显示端状态。

```
获取 displayStates
设置 states[ip] = state
调用 set('displayStates', states)
```

### updateDisplayState(ip, partialState)
更新显示端状态（部分更新）。

```
获取当前状态
合并 partialState
保存状态
返回新状态
```

## 播放列表 API

### addToPlaylist(ip, media)
添加媒体到播放列表。

```
获取显示端状态
如果 playlist 不存在，初始化为 []
添加 media 到 playlist
保存状态
```

### removeFromPlaylist(ip, index)
从播放列表移除媒体。

```
获取显示端状态
检查 index 有效
从 playlist 删除指定项
保存状态
```

### clearPlaylist(ip)
清空播放列表。

```
获取显示端状态
设置 playlist = []
保存状态
```

### getPlaylist(ip)
获取播放列表。

```
获取显示端状态
返回 playlist 或 []
```

### getAllDisplayStates()
获取所有显示端状态。

```
返回 get('displayStates', {})
```

## 深度合并

```
function deepMerge(target, source):
    result = 复制 target
    对于 source 的每个 key:
        如果值是对象且不是数组:
            result[key] = deepMerge(target[key] || {}, source[key])
        否则:
            result[key] = source[key]
    返回 result
```

## 导出模块

```javascript
module.exports = {
    loadConfig,
    saveConfig,
    getConfig,
    get,
    set,
    setTtsConfig,
    getTtsConfig,
    getDisplayState,
    setDisplayState,
    updateDisplayState,
    addToPlaylist,
    removeFromPlaylist,
    clearPlaylist,
    getPlaylist,
    getAllDisplayStates,
    defaultDisplayState
};
```

## 相关文件

| 文件 | 说明 |
|------|------|
| src/core/config/config.js | 配置管理模块 |
| server.js | 配置初始化和使用 |
| config/config.json | 配置存储文件 |

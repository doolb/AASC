# 分层架构实现文档（伪代码）

## 1. 分层入口伪代码

```text
过程 StartWebMediaCenterApp:
    coreContracts = Core.loadContracts()
    frameworkRuntime = Framework.createRuntime(coreContracts)
    externalContainer = External.createContainer(frameworkRuntime)
    appInstance = App.create('web-mediacenter', externalContainer, frameworkRuntime)
    appInstance.bootstrap()

过程 StartServerApp:
    coreContracts = Core.loadContracts()
    frameworkRuntime = Framework.createRuntime(coreContracts)
    externalContainer = External.createContainer(frameworkRuntime)
    appInstance = App.create('server', externalContainer, frameworkRuntime)
    appInstance.bootstrap()
```

## 2. 依赖检查伪代码

```text
过程 ValidateDependency(module):
    若 module.layer == 'core':
        禁止依赖 framework/external/app
    若 module.layer == 'framework':
        禁止依赖 app
    若 module.layer == 'external':
        禁止依赖 app
    若 module.layer == 'app':
        允许依赖 external/framework/core
```

## 3. App 组装伪代码

```text
过程 BuildWebMediaCenterModules(container):
    reminderModule = App.Modules.Reminder.create(container)
    chatModule = App.Modules.Chat.create(container)
    mediaModule = App.Modules.Media.create(container)
    uiModule = App.UI.ControlDisplay.create(container)

    register reminderModule
    register chatModule
    register mediaModule
    register uiModule
```

## 4. External 调用伪代码

```text
过程 ChatModuleHandleInput(input):
    llmResponse = External.LLM.generate(input)
    ttsAudio = External.TTS.synthesize(llmResponse.text)
    Framework.Transport.sendToDisplay(ttsAudio)
```

## 5. AASC 边界伪代码

```text
AASC:
    负责 topic 路由
    负责 runtime 与设备桥接
    不负责业务决策

App:
    负责业务规则
    通过 Framework.AASC 发布和订阅消息
```

## 6. External 兼容迁移伪代码

```text
server.js:
    import tts from src/external/tts/tts-service
    import asr from src/external/asr/asr-service
    import chat from src/external/llm/llm-service

external service:
    module.exports = require(core legacy module)
```

## 7. External 第二阶段迁移伪代码

```text
external service:
    保持原有功能实现
    修正相对路径到 src/external 位置

core compatibility module:
    module.exports = require(src/external service)
```

## 8. App 第三阶段迁移伪代码

```text
server.js:
    import voiceCommand from src/apps/web-mediacenter/modules/voice/voice-command-app-service
    import reminder from src/apps/web-mediacenter/modules/reminder/reminder-app-service
    import timeAnnounce from src/apps/web-mediacenter/modules/time/time-announce-app-service
    import timeListener from src/apps/web-mediacenter/modules/time/time-listener-app-service

core compatibility module:
    module.exports = require(src/apps/web-mediacenter/modules/*)
```

## 9. App 第四阶段迁移伪代码

```text
server.js:
    import MediaLibraryManager from src/apps/web-mediacenter/modules/media/media-library-app-service

core compatibility module:
    module.exports = require(src/apps/web-mediacenter/modules/media/media-library-app-service)
```

## 10. Framework 第五阶段迁移伪代码

```text
server.js:
    import SubServerManager from src/framework/cluster/sub-server-manager
    import LogBuffer from src/framework/observability/log-buffer
    import SystemMonitor from src/framework/observability/system-monitor

core compatibility module:
    module.exports = require(src/framework/*)
```

## 11. Core 第六阶段收口伪代码

```text
扫描项目代码:
    查找所有 require(core migrated modules)
    替换为 src/external、src/apps、src/framework 对应路径

删除 core 兼容文件:
    core/asr.js
    core/tts.js
    core/chat.js
    core/voiceCommand.js
    core/reminder.js
    core/timeAnnounce.js
    core/timeListener.js
    core/media-library.js
    core/sub-server.js
    core/log-buffer.js
    core/system-monitor.js
```

## 12. Core 第七阶段收口伪代码

```text
迁移剩余核心模块:
    core/config.js -> src/core/config/config.js
    core/timeParser.js -> src/core/utils/time-parser.js
    core/console-redirect.js -> src/framework/observability/console-redirect.js
    core/connection.js -> src/framework/transport/ws/connection.js
    core/tui.js -> src/framework/observability/server-tui.js
    core/tui-utils.js -> src/framework/observability/tui-utils.js
    core/data-snapshot/* -> src/core/data-snapshot/*
    core/viewbind/* -> src/core/viewbind/*

替换引用并清理目录:
    替换 server、aasc、voice-display-node 相关引用
    删除空 core 目录
```

# 分层架构设计（Core / Framework / External / App）

## 目标

为“一个仓库包含多个程序”建立统一分层标准，降低模块耦合，提升后续扩展效率。

## 分层定义

| 层 | 说明 | 典型内容 |
|----|------|----------|
| Core | 通用基础能力层 | 契约、错误模型、工具函数 |
| Framework | 技术基础设施层 | AASC 总线、HTTP/WS、存储、观测 |
| External | 外部服务封装层 | LLM、TTS、ASR、第三方 API 适配 |
| App | 应用业务层 | 提醒/聊天/媒体控制规则、页面、编排 |

## 依赖规则

1. `App -> External -> Framework -> Core`
2. `App -> Framework` 可直接依赖（消息总线、路由注册等场景）
3. `External` 不依赖 `App`
4. `Core` 不依赖任何上层

## 当前项目映射

1. AASC 归属 Framework（仅消息总线和跨设备桥接能力）。
2. LLM/TTS/ASR 归属 External。
3. 提醒/聊天/媒体控制业务规则、控制端/显示端页面归属 App。

## 目录约定

```text
src/
  core/
  framework/
  external/
  apps/
    web-mediacenter/
      bootstrap/
      modules/
      ui/
    server/
      bootstrap/
      modules/
      api/
```

## 多应用说明

1. `web-mediacenter`：面向控制端/显示端的业务应用。
2. `server`：面向“服务端”场景的业务应用（统一对外提供能力）。

## 迁移策略

1. 先建立新目录，不立即删除旧目录。
2. 先迁移入口装配，再迁移模块实现。
3. 每次迁移后保持旧行为不变，逐步切换引用。

## External 第一阶段迁移

1. 先把入口依赖切到 `src/external/*`。
2. `src/external/*` 通过兼容转发承接旧 `core/*` 实现。
3. 后续再将实现体从 `core/*` 迁入 `src/external/*`，最后移除兼容层。

## External 第二阶段迁移

1. `src/external/*` 承接 ASR/TTS/LLM 实现体。
2. `core/*` 保留兼容导出，供旧路径平滑过渡。

## App 模块迁移（第三阶段）

1. 将提醒、语音命令、整点报时、时间监听从 `core/*` 迁入 `src/apps/web-mediacenter/modules/*`。
2. `server.js` 入口直接依赖 App 模块路径。
3. `core/*` 保留薄兼容导出，保障旧引用不中断。

## App 模块迁移（第四阶段）

1. 已将媒体库实现从 `core/media-library.js` 迁入 `src/apps/web-mediacenter/modules/media/*`。
2. `server.js` 直接依赖 App 的 media 模块。
3. 已完成兼容导出清理，统一使用 `src/apps/web-mediacenter/modules/media/*`。

## Framework 模块迁移（第五阶段）

1. 已将 `core/sub-server.js` 迁入 `src/framework/cluster/*`。
2. 已将 `core/log-buffer.js`、`core/system-monitor.js` 迁入 `src/framework/observability/*`。
3. `server.js` 入口直接依赖 Framework 模块路径。
4. `core/*` 保留兼容导出，平滑旧路径调用。

## Core 收口（第六阶段）

1. 全量替换项目内部对已迁移 `core/*` 文件的引用。
2. 删除已迁移模块在 `core/` 下的兼容导出文件。
3. `core/` 仅保留未迁移的基础模块（如 `config`、`timeParser`、`console-redirect`）。

## Core 收口（第七阶段）

1. 将 `config`、`timeParser`、`console-redirect` 从 `core/` 迁入 `src/core` 或 `src/framework`。
2. 将 `connection`、`tui`、`tui-utils`、`data-snapshot`、`viewbind` 迁入 `src/framework` 或 `src/core`。
3. 删除空 `core/` 目录，彻底完成旧目录收口。

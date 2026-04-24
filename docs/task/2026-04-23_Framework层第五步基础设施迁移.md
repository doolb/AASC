# Framework 层第五步基础设施迁移任务

## 任务描述

- 目标：将 `sub-server`、`log-buffer`、`system-monitor` 从 `core/*` 迁入 `src/framework/*`。
- 范围：迁移实现体、更新 `server.js` 引用、保留 `core/*` 兼容导出。

## design 需求

- 基础设施实现体归属 Framework。
- server 入口直接依赖 Framework 模块。
- core 保留兼容导出，不承载基础设施实现。

## spec 设计

- 增加 Framework 第五阶段迁移伪代码。
- 明确 server 与 core 兼容层导出关系。

## 受影响模块与文件

- `server.js`
- `src/framework/cluster/sub-server-manager.js`
- `src/framework/observability/log-buffer.js`
- `src/framework/observability/system-monitor.js`
- `core/sub-server.js`
- `core/log-buffer.js`
- `core/system-monitor.js`
- `docs/design/layered-architecture.md`
- `docs/spec/layered-architecture.md`
- `docs/task/2026-04-23_Framework层第五步基础设施迁移.md`
- `changelog.md`
- `docs/todo.md`

## 自测用例

1. `node --check server.js` 通过。
2. `node --check src/framework/cluster/sub-server-manager.js` 通过。
3. `node --check src/framework/observability/log-buffer.js` 通过。
4. `node --check src/framework/observability/system-monitor.js` 通过。
5. `node -e "require('./core/sub-server'); require('./core/log-buffer'); require('./core/system-monitor');"` 通过。

## 兼容性测试

1. server 对子服务器管理和系统监控行为不变。
2. 旧 `core/*` 引用仍可工作。

## 性能测试

1. 本次为代码位置迁移，运行时性能影响可忽略。

## 风险评估

- 风险：迁移后引用路径错误导致初始化失败。
- 缓解：执行语法检查和兼容导出加载测试。

## 预计工时

- 0.2 人日

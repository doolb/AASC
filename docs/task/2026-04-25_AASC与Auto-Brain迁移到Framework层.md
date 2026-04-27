# 任务：AASC 与 Auto-Brain 迁移到 Framework 层

## 任务描述

- 目标：将 `aasc` 与 `auto-brain` 从 `src/` 根下迁入 `src/framework/`，统一基础设施分层
- 范围：目录迁移、入口引用调整、静态调试路由补齐、文档同步

## Design 需求

- AASC 目录迁移到 `src/framework/aasc/*`
- Auto-Brain 目录迁移到 `src/framework/auto-brain/*`
- server 入口与测试脚本切换到新路径
- 保留 `/aasc` 与 `/auto-brain` 静态访问路径用于调试

## Spec 设计（伪代码）

```
迁移目录:
    move src/aasc -> src/framework/aasc
    move src/auto-brain -> src/framework/auto-brain

修正引用:
    server-app import initializeAASCSystem from src/framework/aasc/init
    run-log-brain-tests import runtime-chain test from src/framework/aasc

修正 AASC 内部跨层 require:
    ../../external/* -> ../../../external/*
    ../../apps/* -> ../../../apps/*

调试静态路由:
    app.use('/aasc', static(src/framework/aasc))
    app.use('/auto-brain', static(src/framework/auto-brain))
```

## 受影响模块与代码

- `src/framework/aasc/*`（由 `src/aasc/*` 迁移）
- `src/framework/auto-brain/*`（由 `src/auto-brain/*` 迁移）
- `src/apps/server/boot/server-app.js`
- `src/scripts/run-log-brain-tests.js`
- `docs/design/project-structure.md`
- `docs/design/layered-architecture.md`
- `docs/spec/layered-architecture.md`
- `docs/rules.md`
- `readme.md`

## 自测用例

- 用例1：`node --check src/apps/server/boot/server-app.js`
  - 预期：语法检查通过
- 用例2：`node --check src/framework/aasc/init.js`
  - 预期：语法检查通过
- 用例3：`node --check src/framework/aasc/agents/index.js`
  - 预期：语法检查通过
- 用例4：`node --check src/scripts/run-log-brain-tests.js`
  - 预期：语法检查通过

## 兼容性测试

- `/api/aasc/*` 业务接口行为不变
- `/aasc/*` 与 `/auto-brain/*` 静态访问路径可用

## 风险评估

- 目录迁移后相对路径容易出错，已对关键模块做语法检查

## 预计工时

- 约 1.2 小时

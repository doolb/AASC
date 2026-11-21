# 3rd 与 subproject 文档目录隔离

## 任务描述

将只属于 `3rd/<组件名>/` 和 `subproject/<子项目名>/` 的 `design`、`spec`、`usage`、`superpowers`、`task` 及 `todo` 文档从根目录 `docs/` 迁出，分别保存在对应 `3rd/<组件名>/docs/` 和 `subproject/<子项目名>/docs/` 下，并在项目规则与工程结构文档中固化该目录边界。

## 设计与规范

- 设计文档：`docs/design/project-structure.md`
- 伪代码规范：`docs/spec/project-structure.md`
- 规则文档：`AGENTS.md`、`CLAUDE.md`、`docs/rules.md`、`readme.md`

## 受影响目录与文档处理

1. **规范修订**：明确 `3rd/<组件名>/docs/` 与 `subproject/<子项目名>/docs/` 独立维护各自的 `design/`、`spec/`、`usage/`、`task/`、`todo.md`、`changelog.md`；根目录 `docs/` 仅维护主工程及跨端集成文档，并在索引保留子目录链接。
2. **全量迁移与合并（共 302 篇）**：
   - `3rd/mmd-ar-test/docs/`：11 对 `design/spec`、6 篇 `usage`、147 篇纯独立 `task`。
   - `3rd/mind-basic/docs/`：1 对 `design/spec`（`mindar-basic-web.md`）、13 篇 `task`。
   - `3rd/hmr2-node-onnx/docs/`：3 对 `design/spec`、3 篇 `usage`、20 篇 `task`。
   - `3rd/imu-six-axis-test/docs/`：1 对 `design/spec`、1 篇 `usage`、25 篇 `task`。
   - `3rd/tts-server/docs/`：2 对 `design/spec`、合并根目录重复 `tts-linux.md`（`design`/`spec`）并删除根目录副本、8 篇 `superpowers`、18 篇 `task`。
   - `subproject/aasc-agent/docs/`：1 对 `design/spec`、7 篇 `task`。
   - `subproject/retop/docs/`：1 对 `design/spec`、1 篇 `task`。
   - `subproject/aasc-hie/docs/`：1 对 `design/spec`（`subprojects-hie.md`）、2 篇 `task`。
   - `subproject/aasc-game/docs/`：4 篇猪关卡网页/求解 `task`。
3. **跨端与引用保留**：
   - `docs/spec/voice-display.md`、`mmd-ar-production-offline.md`、`mmd-display-*`、`mmd-human-interface.md`、`mmd-image-ar.md` 等涉及主工程 `src/` 的文档保留在根目录 `docs/`。
   - `docs/references/pig-game/` 因被 `subproject/aasc-game/tests/` 与 `subproject/aasc-hie/src/runtime/pig-navigation.js` 直接读取，暂保留在原路径。
4. **索引与待办同步**：
   - 补齐/更新各目标子目录的 `docs/design.md`、`docs/spec.md`、`docs/usage.md`、`docs/todo.md`。
   - 重写根目录 `docs/design.md`、`docs/spec.md`、`docs/usage.md`、`docs/todo.md` 及所有迁入文档中的相对链接。

## 验证结果

- 全量工作区 Markdown 相对链接校验：750 个文件、714 条 `.md` 链接校验通过（修复 `3rd/hmr2-node-onnx/docs/todo.md` 2 处 `../task/` 后，工作区内断链为 0）。
- `node --test tests/text-media-integration.test.js` 全部通过（涉及读取 `docs/spec/text-media.md` 与 `docs/task/2026-08-23_纯文本分页TTS播放.md`）；`tests/task-common-capabilities.test.js` 中读取 `docs/design/ai-rules.md` 与 `docs/spec/remote-task-system.md` 的文档断言通过（另有一项既有的 `task-manager.js` 代码正则距离断言失败，与本次文档迁移无关）。

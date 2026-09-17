---
name: openspec-to-aasc-docs
description: Use when an OpenSpec change contains proposal.md, design.md, tasks.md, or specs/**/*.md and those artifacts need to become this project's docs/design/*.md and docs/spec/*.md documents.
---

# OpenSpec 转 AASC 项目文档

## 目标

把 OpenSpec 的变更计划转换为项目长期维护的设计文档和实现伪代码文档。转换结果必须符合仓库的 `docs/design.md`、`docs/spec.md`、`docs/rules.md` 和根目录 AI 规则；它不是把原文件机械改名，也不是直接生成业务代码。

## 输入职责

| OpenSpec 输入 | 读取重点 | 项目文档去向 |
|---|---|---|
| `proposal.md` | 为什么做、改什么、范围、影响 | `docs/design/<模块>.md` 的背景、需求、目标和非目标 |
| `design.md` | 现状、约束、技术决策、取舍、风险、开放问题 | `docs/design/<模块>.md` 的架构、数据流、接口和风险 |
| `specs/**/*.md`（存在时） | ADDED/MODIFIED/REMOVED requirements 与 scenarios | design 的行为边界；spec 的回归契约 |
| `tasks.md` | 分组、顺序、依赖、勾选状态、涉及文件 | `docs/spec/<模块>.md` 的落点、伪代码、自测映射和实施状态 |

## 固定流程

1. 先读取仓库根目录规则、`package.json`、`docs/design.md`、`docs/spec.md`、`docs/rules.md`，再读取目标模块已有设计/spec 文档。用 `rg --files`、`rg` 和真实代码核实路径、类名、函数名、消息类型、配置项和测试入口。
2. 读取 OpenSpec 全部输入。把 `proposal.md` 当作 why/what，把 `design.md` 当作 how，把 `tasks.md` 当作执行清单；若有 `specs/**/*.md`，保留 ADDED、MODIFIED、REMOVED 的语义和场景，不把设计细节写成行为要求。
3. 确定唯一模块名和文件 slug。已有模块优先增量更新对应文档；多个候选模块或输入路径与仓库不一致时先列出冲突并请求确认，禁止套用名称相近但职责不同的文档。
4. 生成或更新 `docs/design/<模块>.md`，至少包含：概述、需求背景、目标、非目标、现状、约束、设计原则、核心架构、数据流、接口/数据模型、兼容性、风险与取舍、验收标准、相关文件。
5. 生成或更新 `docs/spec/<模块>.md`，至少包含：模块与真实文件映射、输入输出契约、状态/数据流、主要流程伪代码、异常与边界、回归契约、自测方案、实施状态。每个 `tasks.md` 分组必须能在 spec 中找到对应落点；没有真实代码落点的任务标记为“待实现/待确认”，不伪造已完成状态。
6. 回写项目索引和任务记录：新增模块时更新 `docs/design.md`、`docs/spec.md`；按项目规则创建 `docs/task/<时间>_<简要描述>.md`，完成后从 `docs/todo.md` 移除已完成项并在 `changelog.md` 记录文件和验证结果。
7. 完成自检：检查输入到目标的逐项映射、文件路径确实存在或明确标为待实现、未遗留未完成占位符或未决假设、spec 只有中文命令式伪代码而非可运行代码，并执行适合本改动的文档格式检查和 `git diff --check`。

## design 与 spec 的边界

- `design` 描述为什么做、目标行为和技术方案，可以描述尚未实现的目标；不得把任务勾选状态伪装成实现结果。
- `spec` 描述项目如何落地：真实文件、数据契约、消息流、状态转换、伪代码和测试；已实现内容必须以代码检查或测试结果为依据，未实现内容必须明确标注状态。
- `tasks.md` 的复选框只表示 OpenSpec 原始计划状态。不要原样复制成项目 spec；把每一项转换为“真实落点 + 伪代码位置 + 验收/测试”，并保留任务编号追溯关系。
- 伪代码使用中文动作语句和已核实的标识符，不写类型声明、可执行函数体、模块导入或完整 JavaScript。复杂分支优先使用提前返回、状态表或规则表，避免大段 `if-else-else if`。

## 常见错误

- 只把 `proposal.md` 改名为 design：会遗漏现状、接口、风险和兼容性。
- 把 `tasks.md` 直接改名为 spec：会缺少实现数据流和伪代码。
- 看到相似模块就复用其文件列表：必须先用仓库搜索确认真实职责和路径。
- 把 OpenSpec 的已勾选任务当作本仓库已验证：只有代码、测试或明确验证记录才能支持“已完成”。
- 找不到 `specs/` 就停止：`specs/` 是可选输入；应从 proposal、design、tasks 和仓库现状生成，并在输出中说明缺少行为场景的风险。

## 输出摘要

完成后简要报告：输入目录、生成/更新的 design/spec 路径、任务映射情况、未决项、验证命令和结果。若用户只要求文档转换，不得顺带修改业务代码；代码实现另行确认。

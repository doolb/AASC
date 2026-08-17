# 文件驱动多 Agent 工作组（Workgroup）

## 概述

一个**开发流程工具**，让多个独立的 Claude 进程组成一个"AI 开发团队"，通过**纯文件系统**协同：主 agent（main）接收需求并分发任务，子 agent 自治轮询认领任务、干活、写回结果。角色定义、成员在线状态、任务流转全部落在文件里，可审计、可追溯、无 server 依赖。

对应 todo.md 中的「重构ai开发流程」。

## 设计目标

1. 主 agent（main）收需求 → 拆解 → 自动分发到合适且空闲的子 agent
2. 每个子 agent 读角色文件确定自己干什么活，工作内容和结果通过文件分发
3. 多个独立 claude 进程（不共享上下文）用文件系统通信
4. 子 agent 自治轮询，不依赖 AASC server
5. 全过程可审计（任务与结果文件永远在磁盘上）

## 目录结构

```
workgroup/                          # 工作组根（git 提交 roles/ 和结果，运行时状态 gitignore）
├── roles/                          # 角色定义（静态，只读）
│   ├── main.md                     # 主 agent 角色：拆需求、投递任务、回收结果
│   ├── frontend.md                 # 前端：UI/交互
│   ├── backend.md                  # 后端：服务端逻辑
│   ├── tester.md                   # 测试：用例/验证
│   └── voice.md                    # 语音：ASR/TTS
├── members/                        # 成员（role.md + history.md 提交；运行时信号 gitignore）
│   └── alice/                      # 每个 claude 一个命名目录（用户启动时指定名字）
│       ├── role.md                 # 内容 = 角色名（如 "frontend"）
│       ├── history.md              # 历史任务画像：做过的任务 id/标题/摘要/标签（长期保留）
│       ├── lock                    # 在线标记：poll.js 启动时创建、退出时删除
│       ├── busy                    # 空闲标记：认领任务时创建、完成后删除
│       └── current-task            # 正在执行的任务 id
├── tasks/
│   ├── pending/                    # 待认领任务：<taskId>.json（main 投递）
│   └── claimed/<agentName>/        # 已认领：<taskId>.json（原子 rename 结果）
└── results/                        # 完成结果：<taskId>.json（子 agent 写回）
```

## 角色定义（roles/*.md）

角色文件是"岗位说明书"，只定义**干什么**，不关心**谁在干**。每个角色文件包含：

- 职责边界（哪些类型的任务属于该角色）
- 负责的目录/文件范围
- 工作规范（引用 CLAUDE.md 规则、docs/design、docs/spec 同步要求）

角色文件由 main agent 在初始化时创建模板，**内容由用户确认**；之后可随时新建 `roles/<name>.md` 添加角色，无需审批。一个角色可被多个成员（agent 实例）认领。`main.md` 是主 agent 角色。

## 任务文件格式（tasks/pending/<taskId>.json）

```json
{
  "id": "20260817-1530-001",
  "title": "实现 XX 功能",
  "role": "frontend",
  "requirement": "需求描述，claude --print 直接据此干活",
  "priority": "high",
  "createdAt": 1723876200000,
  "references": ["docs/design/xx.md"]
}
```

- `role`：poll.js 路由依据（子 agent 只认领 role == 自己角色 的任务）
- `requirement`：子 agent 的工作内容
- `id` 生成规则：`YYYYMMDD-HHMM-序号`

## 启动方式与交互向导

### 方式一：带参数启动（脚本化/非交互）

```
node poll.js --role frontend --name alice
```

### 方式二：无命令启动（交互向导）

```
node poll.js
```

进入交互向导：

1. **选角色**：列出 `roles/*.md` 已有角色（编号菜单）→ 用户选择
2. **创新角色**：输入新角色名 → 自动生成 `roles/<name>.md` 模板（职责/目录/规范骨架，用户后续可完善）
3. **选成员名**：列出 `members/` 已有成员（编号菜单）→ 有就选择复用；或输入新名字创建新成员
4. **校验**：lock 冲突检查 → 开始轮询

两种方式最终都走到同一个启动流程（见下）。

## 子 agent 生命周期（workgroup/tools/poll.js）

```
启动（方式一直接进入 / 方式二经交互向导后进入）
 ├─ 创建 members/<name>/（不存在时）
 ├─ 写 role.md = "<role>"（覆盖）
 ├─ history.md 若存在则原样保留（只追加，绝不覆盖）   ← 重启保留历史
 ├─ 崩溃残留检查：lock 若存在，读 PID → 进程已死才覆盖
 └─ 写 lock（内容 = PID + 启动时间）
循环
 ├─ 扫描 tasks/pending/*.json，找 role 匹配且未认领的
 ├─ 原子认领：fs.rename(pending/<id>.json → claimed/<name>/<id>.json)
 │   （两个 agent 同时抢同一任务，只有一个成功，另一个 ENOENT 跳过）
 ├─ 写 busy + current-task=<id>   ← 进入忙碌状态
 ├─ spawn `claude --print "读 claimed/<name>/<id>.json 完成任务，结果写 results/<id>.json"`
 ├─ 等待完成（含失败，结果文件标记 status）
 ├─ 读 results/<id>.json 的 summary/tags/learnings，更新 history.md   ← 历史累积
 └─ 删除 busy + current-task      ← 回到空闲
退出（Ctrl+C/正常结束）
 └─ 删除 lock
```

## history.md 结构与保留策略

history.md 分三段，防止无限增长：

```markdown
# 专长画像（聚合摘要，增量维护，覆盖全部历史）
{ "frontend": 3, "UI": 2, "播放列表": 1, ... }

## 经验约定（最多 M 条，默认 30）
- 本项目改动需同步 docs/spec/websocket.md 协议说明
- ...

## 最近记录（最多 N 条，默认 100）
- { "id": "20260817-1530-001", "title": "...", "tags": [...] }
- ...
```

**保留机制（每次任务完成时执行）**：

1. 任务 tags 计数累加进「专长画像」段（聚合摘要始终覆盖全部历史）
2. 经验约定：agent 在结果中写的 learnings（1-3 条）append 到「经验约定」段；超过 M 条删最旧
3. 详细记录 append 到「最近记录」段；超过 N 条删最旧

效果：文件大小有界（聚合摘要固定小 + 经验约定 M 条 + 最近 N 条详细记录），长期专长信号不丢，main 打分读聚合摘要即可。

## 启动上下文总结注入

子 agent 每次 `claude --print` 是**全新进程**，无历史上下文；逐条旧任务细节注入会误导新任务。因此 poll.js 在 spawn claude 前，从 history.md 提取「总结」注入 prompt：

```
总结 = 专长画像（tags 统计） + 经验约定（learnings 列表）
```

- **注入内容不含最近记录**（避免旧任务解法带偏新任务）
- 子 agent 干活时提示：读任务文件、按经验约定工作、结果中写 learnings

这样每个新任务进程都有「我是谁、我擅长什么、项目有哪些约定」的上下文，而不被逐条旧任务细节误导。

**重启历史保留规则**：
- history.md 只在任务完成后写入，启动时绝不覆盖
- 同名成员重启（同机同目录）→ history 完整保留
- history.md 提交进 git → 换机器 / clone 后同样保留（与角色文件同为资产）

## 空闲判定（成员状态）

成员状态 = 两个信号叠加：

| 信号 | 文件 | 判定 |
|------|------|------|
| 在线 | `members/<name>/lock` | 存在 = 在线；不存在 = 离线 |
| 空闲 | `members/<name>/busy` | 不存在 = 空闲；存在 = 忙碌 |

- **在线**：lock 存在
- **空闲**：在线 且 无 busy
- **忙碌**：busy 存在（current-task 显示在干什么）
- 无 busy 但无 lock = 离线

poll.js 每次启动校验 lock 内 PID 是否存活：已死则覆盖（防止 agent 崩溃后 main 误判在线）。

## 历史画像与匹配度打分

每个成员目录的 `history.md` 记录该 agent 做过的任务（任务完成后由 poll.js 追加一行）：

```json
{ "id": "20260817-1530-001", "title": "实现 XX 功能", "summary": "一句话摘要", "tags": ["前端", "UI"] }
```

多个成员扮演同一角色时，main 按**匹配度打分**选择目标成员：

1. 取任务的关键词/领域标签
2. 遍历同角色空闲成员，读各自 history.md 的 tags 与任务标签求交集（或关键词命中计数）
3. 得分高者优先分配；得分相同则分配给最近任务时间更早（相对空闲）者

该机制让同角色成员逐渐形成差异化专长（agent 积累各自的 history），main 按历史专长自动路由。


## coordinator（main）流程

1. 用户对 main 说需求 → 读 `roles/*.md` 和 `members/*/` 了解成员与能力
2. 状态判定（见上表）→ 确定谁在线、谁空闲
3. 拆解需求 → 选择合适且空闲的成员 → 写任务文件到 `tasks/pending/`
4. 定期查看 `results/` 回收结果 → 汇总汇报给用户

## git 策略

| 目录 | 策略 |
|------|------|
| `workgroup/roles/` | 提交（角色定义是资产） |
| `workgroup/tasks/claimed/` | 提交（可审计） |
| `workgroup/results/` | 提交（可审计） |
| `workgroup/members/<name>/role.md` | 提交（成员岗位信息） |
| `workgroup/members/<name>/history.md` | 提交（历史画像资产，跨机器保留） |
| `workgroup/members/<name>/lock` | gitignore（运行时信号） |
| `workgroup/members/<name>/busy` | gitignore（运行时信号） |
| `workgroup/members/<name>/current-task` | gitignore（运行时信号） |
| `workgroup/tasks/pending/` | gitignore（运行时队列） |

## 边界情况与规则

- **崩溃残留 lock**：poll.js 启动时校验 PID 存活，已死则覆盖
- **任务卡死**：本版不引入超时重发（YAGNI，先跑通再迭代）
- **AASC 规则**：poll.js 用状态机式分支（在线/空闲/忙碌 → 操作表），不写大段 if-else
- **角色添加**：新建 `roles/<name>.md` 即可，无需审批

## 受影响文件

| 文件 | 说明 |
|------|------|
| `workgroup/tools/poll.js` | 子 agent 轮询脚本（新增） |
| `workgroup/README.md` | 工作组使用说明（新增） |
| `workgroup/roles/*.md` | 角色定义模板（新增，内容由用户确认） |
| `workgroup/.gitignore` | 忽略运行时信号与待认领队列 |

## 自测用例

1. poll.js 启动 → members/<name>/ 创建、lock 写入、role.md 写入
2. main 投递一个 role 匹配任务 → 子 agent 原子认领 → busy 出现 → 完成后 busy 删除 → results/ 出现结果、history.md 更新（专长累加 + 最近记录追加）
3. 两个同名角色 agent 同时抢同一任务 → 只有一个认领成功
4. 崩溃残留 lock（PID 已死）→ 新 poll.js 能覆盖
5. 任务 role 不匹配 → 子 agent 跳过不认领
6. **重启历史保留**：同名 agent 重启 → history.md 原样保留、仅追加新任务
7. **启动总结注入**：spawn claude 前 prompt 含专长画像 + 经验约定，不含最近记录
8. **防膨胀**：最近记录超 N 条删最旧、经验约定超 M 条删最旧

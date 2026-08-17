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
├── roles/                          # 角色定义（静态，只读，21 个）
│   ├── main.md                     # 主 agent 角色：拆需求、投递任务、回收结果
│   ├── review.md                   # 审查角色：验收打回时把关
│   ├── frontend-ui.md              # 前端通用界面/样式
│   ├── frontend-media.md           # 前台媒体播放
│   ├── frontend-task.md            # 前台任务面板
│   ├── backend-aasc.md             # AASC 消息系统
│   ├── backend-media.md            # 后台媒体库
│   ├── backend-task.md             # 后台任务引擎
│   ├── backend-general.md          # 后台普通业务（语音命令/提醒/时间/声纹/配置）
│   ├── server-app.md               # 服务端骨架装配（server-app.js + api/）
│   ├── display.md                  # Web 显示端（display.html + render-display）
│   ├── 3d.md                       # 3D 可视化（viewer3d + map/pixi + webgpu-render）
│   ├── observability.md            # 可观测性（log-brain/log-buffer/system-monitor/server-tui）
│   ├── chat.md                     # 聊天系统
│   ├── auto-brain.md               # 行为编排/规划/策略门控
│   ├── asr.md                      # 语音识别
│   ├── tts.md                      # 语音合成
│   ├── voice-capture.md            # 语音采集（voice-display-node）
│   ├── android.md                  # Kotlin APK 工程
│   ├── framework.md                # 框架兜底（transport/cluster/data-snapshot/viewbind）
│   └── tester.md                   # 测试/自测
├── members/                        # 成员（每角色独立目录）
│   ├── main/                       # main 协调者身份（lock 检测 main 是否在线）
│   └── alice-frontend/             # 成员 alice 扮演 frontend 角色的目录
│       ├── role.md                 # 内容 = 角色名 + 主/副角色标记
│       ├── history.md              # 该角色专属专长画像/经验/记录（按角色隔离）
│       ├── lock                    # 在线标记：poll.js 启动时创建、退出时删除
│       ├── busy                    # 空闲标记：认领任务时创建、完成后删除
│       └── current-task            # 正在执行的任务 id
├── tasks/
│   ├── pending/                    # 待认领任务：<taskId>.json（main 投递）
│   ├── claimed/<agentName>/        # 已认领：<taskId>.json（原子 rename 结果）
│   └── cancel/                     # 取消信号：<taskId>（main 写，poll.js 检测后删除）
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
  "status": "",
  "priority": "high",
  "level": "L4",
  "createdAt": 1723876200000,
  "references": ["docs/design/xx.md"],
  "depends": ["20260817-1530-000"],
  "assignedTo": "alice",
  "reviewComment": "",
  "kind": "review",
  "reviewOf": "20260817-1530-000"
}
```

- `role`：poll.js 路由依据（子 agent 只认领 role == 自己角色 的任务）
- `requirement`：子 agent 的工作内容
- `status`：任务生命周期状态（空/缺失 = 未开始；值见下方状态机）
- `level`：需求等级（L4-L7，main 用 analyze-requirement-level 定级，决定路由策略）
- `depends`：可选字段，依赖的任务 id 数组；**依赖全部 `已验收`** 才可被认领（多角色协调）
- `assignedTo`：可选字段，目标 agent 名；main 指派给空角色/非空角色时填写（agent 检测到任务 role 与主角色不符则自动切换）
- `reviewComment`：验收打回时的修改意见（小改动由原 agent 改）
- `kind`：可选字段；值为 `"review"` 时标记为**审查子任务**；普通任务不设该字段
- `reviewOf`：kind=review 时必填，被审查原任务 id
- `id` 生成规则：`YYYYMMDD-HHMM-序号`

## 任务状态机与验收打回

任务状态存于**任务文件内**（随文件流动，不新增目录）：

| status 值 | 含义 | 设置者 |
|-----------|------|--------|
| （空/缺失） | 未开始 | main 投递时 |
| 进行中 | 已认领，子 agent 干活 | poll.js 认领后 |
| 已完成 | 干完活、结果已写 | poll.js 完成后 |
| 待修改 | 验收被打回，需修改 | main 打回时 |
| 已验收 | 用户确认通过 | main 验收时 |
| 已取消 | 被 main 取消 | poll.js 检测到取消信号后 |

```
（空）未开始 → 进行中 → 已完成 → 已验收
                    ↑          │
                    │   用户验收提修改
                    │          │
                    │     ┌────┴────────────┐
                    │    小改动            大改动
                    │    原 agent 改       review 角色审查把关
                    └──────────────────────────┘
```

> review 审查子任务自身也走同一状态机（空 → 进行中 → 已完成），但任务文件带 `kind:'review'` 与 `reviewOf`（被审查原任务 id）字段；main 验收扫描时用 `isReviewTask` 区分，呈现 verdict 与被审查原任务 id，而非当作普通待验收任务。

**main 验收流程**（人工把关）：

1. main 扫描 `tasks/claimed/*/` 找 `status === '已完成'` 的任务
2. 对每个已完成任务用 `isReviewTask(task)`（`task.kind === 'review'`，poll.js 导出的纯函数）区分：
   - **review 审查子任务**（kind=review）：呈现 `results/<id>.json` 的 output 中 verdict 与被审查原任务 id（`reviewOf`），据此判定：verdict=pass → 原任务 `status = '已验收'`；verdict=fail → 原任务继续打回（写 reviewComment + 待修改）
   - **普通任务**（无 kind）：读 `results/<id>.json` 呈现结果给用户走正常验收
3. 用户选择：
   - **通过** → 任务文件 `status = '已验收'`
   - **提修改**（写 `reviewComment` + 判定大小）：
     - **小改动** → 任务留在 `claimed/<原agent>/`，`status = '待修改'`；poll.js 轮询时扫描自己 claimed/ 里待修改任务，标记进行中、spawn claude（prompt 带 reviewComment）改，改完 `status = '已完成'`
     - **大改动** → main 产生一个 role=`review` 的 review 审查子任务（任务文件带 `kind:'review'` + `reviewOf: 原任务 id`）：review 角色子 agent 审查原任务结果与修改 → verdict pass/fail → pass 转已验收、fail 继续打回
4. 小/大判定：main 按修改意见复杂度判断

**结果文件** `results/<id>.json` 的 `status: completed/failed` 保持不变（那是完成质量，不是生命周期状态）。

## 启动方式与交互向导

poll.js 有两种启动模式：

### 方式一：带参数启动（脚本化/非交互）— 子 agent

```
node poll.js --role frontend --name alice [--secondary backend-media,tester]
```

- `--role`：主角色（必填）
- `--name`：成员名（必填）
- `--secondary`：可选副角色列表（逗号分隔，0-N 个）

### 方式二：无命令启动（交互向导）— main 或空角色

```
node poll.js
```

**启动身份判定**：

1. 检查 `members/main/lock`：
   - **无 main**（无 lock / PID 已死）→ 成为 **main 协调者**（写 `members/main/lock`，标记 main 在线）
   - **有 main**（lock 存活）→ 进入 **空角色**：无主角色起步，只认 `assignedTo` 自己的任务
2. 空角色交互向导：选成员名 → 以空角色启动

两种方式最终都走到同一个启动流程（见下）。

## 角色模型（主角色 + 副角色 + 每角色独立目录）

- **主角色**：启动时 `--role` 指定，优先匹配该角色任务
- **副角色**：`--secondary` 指定 0-N 个，仅当主角色无活时才接副角色任务（主要承接 L4/L5 低等级任务）
- **每角色独立目录**：`members/<名>-<角色>/`，历史/专长按角色完全隔离（该角色干的活只记在自己的 history.md）
- **role.md 内容**：主角色名 + 副角色列表

### 切换机制

| 触发源 | 适用 | 机制 |
|--------|------|------|
| **空闲自动切换** | 非空角色 | 主/副角色都没活 → 扫描 pending 有积压任务的角色 → 该角色无在线 agent → 切过去 |
| **main 指派** | 空角色 + 非空角色 | main 写 `assignedTo` + `role` 任务 → agent 检测到任务 role 与主角色不符就切 |

**切换动作**（统一）：
```
删旧活动目录 lock（members/<名>-<旧角色>/lock）→ 旧身份下线
写新活动目录 lock + role.md（members/<名>-<新角色>/）→ 新身份上线
主角色 = 新角色 → 认领任务干活
```

**统一规则**：
- **切了不回**：主角色永久变新角色，原角色历史隔离在旧目录
- **防撞车**：目标角色已有在线 agent（lock 存在）不切
- **空角色**：不自己扫 pending 乱跑，只认 `assignedTo` 自己的任务（听 main 调度）

## 等级路由（L4-L7）

任务文件带 `level` 字段，main 用 analyze-requirement-level 定级后选路由策略：

| 等级 | 含义 | 路由策略 |
|------|------|----------|
| L4 | 数据流/单功能 | 单 agent 直接干 |
| L5 | 业务流程 | 可拆多 agent 依赖链 |
| L6 | 功能模块替换 | 依赖链 + 强制 review |
| L7 | 系统级替换 | 依赖链 + review + main 严格把关 |

副角色主要承接 L4/L5 简单任务；复杂任务尽量交给主角色。

## 任务取消

- main 写取消信号 `tasks/cancel/<id>`
- poll.js 执行任务期间轮询检测（并行于 claude 运行），发现取消信号 → `child.kill()` 终止子进程 → 任务 `status = '已取消'`，删 busy/current-task + 取消信号

## 子 agent 生命周期（workgroup/tools/poll.js）

```
启动（方式一直接进入 / 方式二经交互向导后进入）
 ├─ 创建 members/<名>-<角色>/（不存在时，每角色独立目录）
 ├─ 写 role.md = 主角色 + 副角色列表（覆盖）
 ├─ history.md 若存在则原样保留（只追加，绝不覆盖）   ← 重启保留历史
 ├─ 崩溃残留检查：lock 若存在，读 PID → 进程已死才覆盖
 └─ 写 lock（内容 = PID + 启动时间）
循环
 ├─ ① 新任务：扫描 pending，找主角色匹配且 status 空、depends 依赖全已验收 的任务
 ├─ ② 指派：扫描 pending，找 assignedTo == 自己名字 的任务（空角色/被 main 指派）
 │     任务 role 与主角色不符 → 自动切换主角色 → 认领
 ├─ ③ 待修改：扫描自己 claimed/<名>-<角色>/ 里 status=待修改 的任务（打回小改动）
 ├─ ④ 副角色：主/副角色都没活 → 扫描 pending 里副角色匹配的任务
 ├─ ⑤ 空闲自动切换：都没活 → 探测 pending 有积压的角色 → 该角色无在线 agent → 切主角色
 ├─ 原子认领：fs.rename(pending/<id>.json → claimed/<名>-<角色>/<id>.json)
 │   （两个 agent 同时抢同一任务，只有一个成功，另一个 ENOENT 跳过）
 ├─ 写 busy + current-task=<id>，任务文件 status=进行中   ← 进入忙碌状态
 ├─ spawn `claude --print "读 claimed/<名>-<角色>/<id>.json 完成任务，结果写 results/<id>.json"`
 │   （prompt 注入总结；若是待修改任务，注入 reviewComment）
 │   （子进程 stdio='inherit'，claude 原始输出实时打到 poll.js 所在终端，不写日志文件）
 ├─ 执行期间轮询检测 tasks/cancel/<id>，发现则 kill 子进程 → status=已取消
 ├─ 等待完成（含失败，结果文件标记 status）
 ├─ 任务文件 status=已完成
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
2. 用 analyze-requirement-level 定级（L4-L7）→ 决定路由策略
3. 拆解需求 → 选合适空闲成员（或指派空角色 `assignedTo`）→ 写任务到 `tasks/pending/`（带 `depends` 依赖链）
4. 定期扫描 `tasks/claimed/*/` 找 `status='已完成'` → 读 `results/` 呈现 → 用户验收（通过→已验收 / 提修改→按大小打回）
5. main 启动时写 `members/main/lock` 标记在线；新进程检测到 main 在线则成为空角色

## git 策略

| 目录 | 策略 |
|------|------|
| `workgroup/roles/` | 提交（角色定义是资产） |
| `workgroup/tasks/claimed/` | 提交（可审计） |
| `workgroup/results/` | 提交（可审计） |
| `workgroup/members/<名>-<角色>/role.md` | 提交（成员岗位信息） |
| `workgroup/members/<名>-<角色>/history.md` | 提交（历史画像资产，跨机器保留） |
| `workgroup/members/<名>-<角色>/lock` | gitignore（运行时信号） |
| `workgroup/members/<名>-<角色>/busy` | gitignore（运行时信号） |
| `workgroup/members/<名>-<角色>/current-task` | gitignore（运行时信号） |
| `workgroup/members/main/` | gitignore（运行时身份） |
| `workgroup/tasks/pending/` | gitignore（运行时队列） |
| `workgroup/tasks/cancel/` | gitignore（运行时信号） |

## 边界情况与规则

- **崩溃残留 lock**：poll.js 启动时校验 PID 存活，已死则覆盖
- **任务卡死**：本版不引入超时重发（YAGNI，先跑通再迭代）
- **AASC 规则**：poll.js 用状态机式分支（在线/空闲/忙碌 → 操作表），不写大段 if-else
- **角色添加**：新建 `roles/<name>.md` 即可，无需审批
- **防撞车**：自动切换前检查目标角色已有在线 agent（lock 存在）则不切
- **切了不回**：主角色切换后永久保留新角色

## 受影响文件

| 文件 | 说明 |
|------|------|
| `workgroup/tools/poll.js` | 轮询脚本：启动模式/角色列表/切换/依赖门控/取消 |
| `workgroup/tools/wg-fs.js` | spawnClaude stdio inherit + kill 句柄 + cancelDir + 角色目录路径 |
| `workgroup/tools/wg-core.js` | 状态加"已取消" |
| `workgroup/README.md` | 工作组使用说明 |
| `workgroup/roles/*.md` | 21 个角色定义（新增 16、改 main/review/tester、删 frontend/voice） |
| `workgroup/.gitignore` | 忽略运行时信号/待认领队列/cancel |

## 自测用例

1. poll.js 启动 → members/<名>-<角色>/ 创建、lock 写入、role.md 写入
2. main 投递一个 role 匹配任务 → 子 agent 原子认领 → busy 出现 → 完成后 busy 删除 → results/ 出现结果、history.md 更新
3. 两个同名角色 agent 同时抢同一任务 → 只有一个认领成功
4. 崩溃残留 lock（PID 已死）→ 新 poll.js 能覆盖
5. 任务 role 不匹配 → 子 agent 跳过不认领
6. **重启历史保留**：同名 agent 重启 → history.md 原样保留、仅追加新任务
7. **启动总结注入**：spawn claude 前 prompt 含专长画像 + 经验约定，不含最近记录
8. **防膨胀**：最近记录超 N 条删最旧、经验约定超 M 条删最旧
9. **任务状态流转**：认领后 status=进行中、完成后 status=已完成、main 验收后=已验收
10. **打回小改动**：任务 status=待修改 + reviewComment → 原 agent 轮询到并带 comment 再改 → status=已完成
11. **打回大改动**：main 产生 role=review 子任务 → review 角色审查 → pass 转已验收
12. **两种启动模式**：无 --role 且无 main → 成为 main；无 --role 且有 main → 空角色
13. **主角色+副角色**：副角色任务仅在主角色无活时被认领，副角色历史写到副角色目录
14. **depends 依赖门控**：依赖未验收的任务不被认领；依赖全验收后可认领
15. **任务取消**：执行中写 cancel 信号 → kill 子进程 → status=已取消
16. **空闲自动切换**：主/副角色无活 → 有积压角色无在线 agent → 自动切主角色
17. **main 指派**：assignedTo 任务 → 空角色/不符角色 agent 检测后切主角色认领

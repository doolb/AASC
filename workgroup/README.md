# Workgroup — 文件驱动多 Agent 工作组

多个独立 Claude 进程通过纯文件系统组成 AI 开发团队。main 收需求分发任务，子 agent 自治轮询认领、干活、写回结果。文件即协议，可审计、无 server 依赖。

## 启动子 agent（两种启动模式）

```bash
# 方式一：带参数启动 → 子 agent（脚本化/非交互）
node tools/poll.js --role frontend --name alice [--secondary backend-media,tester]

# 方式二：无命令启动（交互向导）→ main 或空角色
node tools/poll.js
```

- 子 agent：`--role` 指定主角色，`--secondary` 指定 0-N 个副角色（副角色仅主角色无活时接活，主要承接 L4/L5 低等级任务）
- 无 `--role` 时按 `members/main/lock` 判定：无 main → 成为 **main 协调者**；有 main → 进入**空角色**（只认 `assignedTo` 自己的任务）

## 角色清单（21 个）

| 角色 | 说明 |
|------|------|
| main | 主 agent：拆需求、投递任务、回收结果、验收 |
| review | 审查：验收打回大改动时把关 |
| frontend-ui | 前端通用界面/样式 |
| frontend-media | 前台媒体播放 |
| frontend-task | 前台任务面板 |
| backend-aasc | AASC 消息系统 |
| backend-media | 后台媒体库 |
| backend-task | 后台任务引擎 |
| backend-general | 后台普通业务（语音命令/提醒/时间/声纹/配置） |
| server-app | 服务端骨架装配（server-app.js + api/） |
| display | Web 显示端（display.html + render-display） |
| 3d | 3D 可视化（viewer3d + map/pixi + webgpu-render） |
| observability | 可观测性（log-brain/log-buffer/system-monitor/server-tui） |
| chat | 聊天系统 |
| auto-brain | 行为编排/规划/策略门控 |
| asr | 语音识别 |
| tts | 语音合成 |
| voice-capture | 语音采集（voice-display-node） |
| android | Kotlin APK 工程 |
| framework | 框架兜底（transport/cluster/data-snapshot/viewbind） |
| tester | 测试/自测 |

## 目录结构

```
roles/<name>.md        角色定义（岗位说明书，21 个）
members/<名>-<角色>/    每角色独立目录（历史/专长按角色隔离）
  role.md              主角色 + 副角色列表
  history.md           专长画像 + 经验约定 + 最近记录
  lock                 在线标记（poll.js 启动写、退出删）
  busy                 忙碌标记（认领任务时写）
  current-task         正在执行的任务 id
tasks/pending/<id>.json  待认领任务（main 投递）
tasks/claimed/<agent>/<id>.json  已认领任务
tasks/cancel/<id>      取消信号（main 写，poll.js 检测后删）
results/<id>.json      完成结果
```

## main 如何分发

1. 读 `members/*/`：lock 存在 = 在线，无 busy = 空闲
2. 按任务 role 匹配角色；同角色多成员时读 history.md 专长画像打分
3. 写任务 JSON 到 `tasks/pending/`，子 agent 自治认领

## 任务文件格式

```json
{
  "id": "20260817-1530-001",
  "title": "实现 XX",
  "role": "frontend",
  "requirement": "需求描述",
  "priority": "high",
  "status": "",
  "level": "L4",
  "depends": [],
  "assignedTo": "",
  "reviewComment": "",
  "createdAt": 1723876200000,
  "references": []
}
```

- `level`：需求等级（L4-L7，main 用 analyze-requirement-level 定级，决定路由策略）
- `depends`：可选，依赖的任务 id 数组；依赖全部已验收才可被认领
- `assignedTo`：可选，目标 agent 名；main 指派给空角色/非空角色时填写

## 任务状态

| status | 含义 |
|--------|------|
| （空） | 未开始（main 投递） |
| 进行中 | 已认领，子 agent 干活 |
| 已完成 | 干完、结果已写，待 main 验收 |
| 待修改 | 验收打回（小改动，原 agent 重做） |
| 已验收 | 用户确认通过 |
| 已取消 | 被 main 取消（写 tasks/cancel/<id> 信号，poll.js 检测后终止） |

验收：main 扫描 status=已完成 任务呈现结果 → 用户通过（已验收）或提修改（写 reviewComment；小改动原 agent 改，大改动投 role=review 任务审查）。

## 文档

- 设计：`docs/design.md`
- 实现：`docs/spec.md`

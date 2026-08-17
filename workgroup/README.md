# Workgroup — 文件驱动多 Agent 工作组

多个独立 Claude 进程通过纯文件系统组成 AI 开发团队。main 收需求分发任务，子 agent 自治轮询认领、干活、写回结果。文件即协议，可审计、无 server 依赖。

## 启动子 agent

```bash
# 交互向导：选角色（或创新）、选成员（或新建）
node tools/poll.js

# 或直接指定（脚本化/非交互）
node tools/poll.js --role frontend --name alice
```

## 目录结构

```
roles/<name>.md        角色定义（岗位说明书）
members/<name>/        每个子 agent 一个命名目录
  role.md              当前扮演的角色名
  history.md           专长画像 + 经验约定 + 最近记录
  lock                 在线标记（poll.js 启动写、退出删）
  busy                 忙碌标记（认领任务时写）
  current-task         正在执行的任务 id
tasks/pending/<id>.json  待认领任务（main 投递）
tasks/claimed/<agent>/<id>.json  已认领任务
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
  "createdAt": 1723876200000,
  "references": []
}
```

## 文档

- 设计：`docs/design.md`
- 实现：`docs/spec.md`

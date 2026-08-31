# AI 执行规则实现规范

## 规则加载

```text
AI 开始项目任务：
  读取项目根目录 CLAUDE.md
  读取 docs/aiskill.md（需要遵循项目 AI 工作流程时）
  如果角色是 workgroup main：读取 workgroup/roles/main.md
  将服务器重启规则和任务归档规则作为当前任务的执行边界
```

## 服务器重启决策

```text
AI 判断代码修改后需要重启服务器：
  如果存在可用的控制端重启/重载接口：
    通过控制端接口发起请求
    根据控制端返回结果继续验证
  否则：
    不查找或操作服务器 PID
    不执行 kill/pkill/killall 或终止信号命令
    不直接启动、停止或重启 server-app.js
    向用户报告控制端接口不可用
```

## 适用范围

```text
规则适用于：工作 AI、workgroup 子 agent、控制端 AI 角色
允许：代码修改、文档更新、测试、静态检查
禁止：直接控制用户手动启动的服务器进程
```

## 任务状态与归档

```text
任务进入 docs/todo.md：
  状态只能是 待处理、可选任务 或 进行中

任务完成：
  从 docs/todo.md 删除该任务
  生成完成摘要 = 完成日期 + 任务描述 + 主要改动 + 验证结果
  如果 changelog.md 已有同一变更：补充或合并完成摘要
  否则：将完成摘要写入 changelog.md
  不在 docs/todo.md 保留 ✅已完成条目

任务取消：
  从 docs/todo.md 删除任务
  如果取消决定需要追踪：在 changelog.md 记录取消原因
```

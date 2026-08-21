# AI 执行规则实现规范

## 规则加载

```text
AI 开始项目任务：
  读取项目根目录 CLAUDE.md
  读取 docs/aiskill.md（需要遵循项目 AI 工作流程时）
  如果角色是 workgroup main：读取 workgroup/roles/main.md
  将服务器重启规则作为当前任务的执行边界
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

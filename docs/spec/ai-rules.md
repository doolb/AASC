# AI 执行规则实现规范

## 规则加载

```text
AI 开始项目任务：
  读取项目根目录 CLAUDE.md
  读取 docs/aiskill.md（需要遵循项目 AI 工作流程时）
  如果角色是 workgroup main：读取 workgroup/roles/main.md
  将服务器重启规则和任务归档规则作为当前任务的执行边界
```

## AI 任务系统通用契约

```text
任务模块导出任务描述：
  id/name/description
  target = server | display | subdisplay
  mode = one-shot | service
  params = 当前任务独立的参数定义和默认值
  sidebar = 可选的控制端侧边栏归属
  widget = 可选的控制端 HTML/字段/显示/动作/脚本
  control.actions = 可选的任务页面/弹窗定义（placement、title、html、script）
  configButton = 可选的任务专属配置入口

用户任务加载：
  服务端读取任务描述元数据
  task:list 返回元数据给控制端
  控制端按 taskName 合并任务实例和元数据
  sidebar + widget 显示任务页面、任务卡片和实例详情
  widget.script 在任务所属的控制端容器中初始化，并通过任务动作消息与服务端交互

内置任务迁移为用户任务：
  将任务描述迁移到 res/tasks/<taskName>/task.js；服务模式的运行实现另放在 service.js
  保留 target、mode、params、sidebar、widget、control.actions 等元数据
  继续使用同一套任务上下文和 TaskPanel 通用页面
  若依赖无法由通用上下文提供，则继续保留为内置任务
```

## 任务上下文能力

```text
创建任务上下文：
  注入 taskName、instanceId、taskType、target、mode、params、workDir、taskIO
  注入 sendProgress(progress)
  注入 postWidgetUpdate(data)
  注入 onWidgetAction(action, handler)
  注入 registerRoute(route)
  按任务目标注入 sendToDisplay / broadcastToDisplays 等可选系统服务

任务调用 registerRoute(route)：
  服务端任务 -> 直接挂载到 AASC HTTP 8081
  显示端/子显示端任务 -> 通过 task:route_register 注册并等待确认
  任务停止/异常/断连/销毁 -> 注销实例全部路由和等待请求
```

## 用户任务控制端资源

```text
用户任务需要控制端页面或交互：
  在任务元数据中提供 sidebar/widget/control.actions/configButton
  widget.html 提供展示结构
  widget.script 提供任务自主管理的 DOM、事件、状态和动作逻辑
  control.actions 提供任务页面或弹窗的 HTML、脚本和任务级消息交互
  控制端只负责加载到任务容器、传递实例标识和转发消息
  任务更新或卸载时执行自己的 onDestroy 清理逻辑
```

任务页面和脚本属于项目维护者自管理的任务资源，本规则不要求额外的白名单注册机制。

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

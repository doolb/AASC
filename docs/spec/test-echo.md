# test-echo 用户任务 - 实现文档

## 概述

`test-echo` 是验证远程任务系统端到端流程的测试用户任务。接收任意参数，原样输出到日志和结果中。

## 模块结构

```
res/tasks/test-echo/
├── task.js       # 任务入口，export { run, params }
└── results/      # 执行结果（按实例）
```

## task.js 接口

```text
export:
  run(context)    // async function，执行任务逻辑
  params          // Array<ParamDef>，参数定义（供前端表单渲染）

ParamDef:
  { name, type, required, default, label }

运行流程：
  1. 从 context.params 读取参数
  2. 从 context.refs 读取引用文件（可选）
  3. console.log 输出所有参数到日志
  4. 返回 { echo: params, refs, timestamp, message }
```

## web-socket-handler 流程

```text
task:list -> 控制端请求任务列表
  1. getBuiltinTasks()  — 读取内置注册表，每个任务自带 params
  2. taskManager.listTasks()  — 读取 res/tasks/ 下用户任务目录
  3. 遍历用户任务，require(taskName/task.js) 读取 params
  4. 合并返回 [{ taskName, files, instances, params }, ...]

  注意：require 会模块缓存，task.js 修改后需重启服务端才能反映新 params
       try-catch 保护，无法 require 时降级为 params: []
```

## 参数定义

```text
message: string, 必需: false, 默认: "hello", 标签: "消息内容"
count:   number, 必需: false, 默认: 1, 最小值: 1, 最大值: 100, 标签: "重复次数"
```

## Widget

内置 widget 包含两个输入字段（message 输入框 + count 数字输入），用户在草稿状态下编辑后点击"保存参数"，再点击"运行"执行。

```text
widget 渲染 → draft 状态显示 widget + "保存参数" 按钮
            用户填写字段 → 点击"保存参数"
            → task:update_instance_params { message, count }
            → 前端乐观更新本地数据 + 立即重绘 widget
            → 服务端确认 → task:instance_params_updated → 再次重绘
            点击"运行" → task:run → 执行 → 显示结果
```

### widget data 填充逻辑

```text
_resultDetailHTML 中渲染 widget 前：
  1. _widgetData[instanceId] = {}
  2. 合并 inst.params（来自 index.json 的已保存值）
  3. 用 PARAMS 默认值填补未定义字段
  4. _renderWidget() 通过 {{var}} 模板替换填充到 HTML value
  5. 用户保存参数时，_saveWidgetParams 乐观更新本地数据 + 重绘
  6. 服务端确认后，task:instance_params_updated 再触发一次重绘
```

#skill: ai-code-translation

# 服务端 TUI 集成 — 验证测试

## 已有声明

- `ServerTUI` — 位于 `src/framework/observability/server-tui.js`
- `installConsoleRedirect` — 位于 `src/framework/observability/console-redirect.js`
- `blessed` — 第三方 TUI 库, `^0.1.81`
- `log(category, message, extra)` — server-app.js 中的日志函数
- `logError(category, message, extra)` — server-app.js 中的错误日志函数
- `process.argv.includes('--no-tui')` — TUI 开关检测

## 操作流程

### 流程 1：模块加载验证

```
创建 test-tui-integration.js，验证:

    尝试 require('../../../framework/observability/server-tui')
    断言 返回对象为函数（即 ServerTUI class）
    尝试 require('../../../framework/observability/console-redirect')
    断言 返回对象包含 installConsoleRedirect 方法

    原因: 确保重构后的路径映射正确，require 不抛出 MODULE_NOT_FOUND
```

### 流程 2：--no-tui 标志检测验证

```
创建测试函数 testNoTUIFlag:

    构造含 --no-tui 的 argv 副本
    对 argv 执行 includes('--no-tui')
    断言 结果为 true

    构造不含 --no-tui 的 argv 副本
    对 argv 执行 includes('--no-tui')
    断言 结果为 false

    原因: useTUI 开关的正确性影响所有分支行为
```

### 流程 3：ServerTUI 实例化与 enabled 开关验证

```
创建测试函数 testServerTUIInstantiation:

    创建 ServerTUI 实例 启用状态:
        tui = new ServerTUI({ enabled: true })
        断言 tui.enabled === true
        断言 tui.screen 存在（可见 blessed 已正常初始化）
        tui.destroy()

    创建 ServerTUI 实例 禁用状态:
        tui = new ServerTUI({ enabled: false })
        断言 tui.enabled === false
        断言 tui.screen 为 undefined（不初始化 blessed）
        // 此时调用 addLog/setHeader/startRefresh 应静默返回

    原因: 确保 enabled=false 时 TUI 模块完全无副作用
```

### 流程 4：日志分支行为验证（无 blessed 环境）

```
创建测试函数 testLogBranching (不依赖实际 TUI 渲染):

    准备一个模拟 ServerTUI 实例:
        mockAddLog = []
        mockTui = { enabled: true, addLog: (cat, msg) => mockAddLog.push({cat, msg}) }

    调用 log 模拟函数（TUI 模式）:
        输入 ('连接', 'test display connected')
        断言 mockTui.addLog 被调用一次，内容匹配

    调用 log 模拟函数（非 TUI 模式）:
        断言 console.log 被调用一次

    原因: 核心集成逻辑验证，不依赖终端环境
```

### 流程 5：blessed 依赖声明验证

```
检查 root package.json:
    读取 package.json
    解析 dependencies
    'blessed' 在 dependencies 中
    版本为 '^0.1.81'
```

# Usage

AASC-HIE can be tested without ADB, OCR services, model files, or a connected
device. Device and browser adapters are injected by the host application.

## Commands

~~~sh
npm install
npm test
npm run test:watch
npm run build
npm start
node src/cli.js nav-check --file data/packages/honor-of-kings.nav.md
npm run nav-serve -- --host 127.0.0.1 --port 8787 --dry-run
~~~

nav-check validates a Markdown navigation package. nav-chain, nav-map-build,
and nav-serve use the same package, runtime, and NavMesh interfaces when the
host supplies configured dependencies. Live device input requires the explicit
--enable-execution switch and a configured executor.

## HTTP API

The HTTP facade exposes ordinary package and runtime routes:

- POST /api/v1/packages/:id/operations
- POST /api/v1/packages/:id/validate
- POST /api/v1/packages/:id/publish
- POST /api/v1/navmesh/:id/observations
- POST /api/v1/navmesh/:id/rebuild
- GET /api/v1/runtime/state
- POST /api/v1/runtime/observations
- POST /api/v1/runtime/simulate
- GET /api/v1/runtime/alerts
- GET /api/v1/runtime/goal
- PUT /api/v1/runtime/goal
- GET /api/v1/runtime/goals
- POST /api/v1/runtime/goals/:id/progress
- GET /api/v1/runtime/gaps
- GET /api/v1/runtime/chain
- POST /api/v1/runtime/command

See docs/operations/navigation-api.md for request examples.

## Layout

- src/recognition reports normalized observations.
- src/computation owns state, navigation, simulation, priorities, and alerts.
- src/execution owns validated ADB/browser command execution.
- src/package owns navigation-package data and revision rules.
- src/runtime owns scheduling, discovery, and sessions.
- src/server owns the HTTP boundary.
- data/ holds packages, NavMesh files, model registrations, progress, and other project resources.
- test holds unit, contract, and integration tests.

Game or application details belong in package data and configured adapters;
shared computation code remains game-agnostic.

## Selecting a goal

The active goal is runtime state and is not stored in the navigation package.

~~~sh
node src/cli.js nav-goal set --goal-id daily-routine --priority 500
node src/cli.js nav-goal get
~~~

The HTTP equivalent is `PUT /api/v1/runtime/goal` with
`{"goalId":"daily-routine","source":"operator"}`. Progress is kept in
the configured progress store, so daily and weekly buckets reset at their
period boundary without changing the package.
# 关卡任务桥接

`GameTaskBridge` 从指定的 `aasc-game` 关卡运行目录读取 `level.json`、`plan.json` 和 `result.json`。`snapshot(path, { report: true })` 会在存在失败结果时向构造器传入的 `NavigationGapQueue` 报告证据；缺少尚未生成的文件不会生成虚假结果，格式错误会报错。返回的计划只是数据，不能直接当作已执行指令。

`ScriptMaintenance` 供显式启用的游戏宿主使用，提供 `list()`、`read(name)` 与 `update({name, sha256, content})`。只能修改 `scripts/` 内已存在的普通 JavaScript 文件；摘要必须与当前文件一致，更新后运行语法检查与 HIE 测试，失败时恢复原内容。检查排除两组依赖本机缺失的王者荣耀数据集和导航资源的测试；其他 HIE 测试必须通过。检测到其他进程更改文件时不会覆盖其修改。

`PigNavigation` 加载 `data/packages/pig-game.nav.md`，通过 `GoalManager` 记录采集、复核、求解、执行和胜利五个步骤。`advance()` 先采集，未提供复核布局时返回阻塞原因和 `sessionDir`；使用同目录恢复并通过 `advance({ reviewedLayout })` 提供由可信宿主复核、绑定首屏 SHA-256 的布局。完整计划经 `auto` 求解和独立重放后，执行器重新检查关卡和现场；中断后禁止盲目重试。`allowExecution: false` 可仅求解。炸弹等未建模机制会停止；导航链的 `status: complete` 表示链构造完成，不表示游戏通关，实际胜利以会话目标进度及胜利截图为准。

显式以 `new GameTaskBridge({ enabled: true })` 启用后，`run({ startLevel, windowId, display, maxLevels, duckAuto })` 才能启动相邻 `aasc-game` 的连续游玩脚本；调用会等到脚本退出并返回退出码。此接口不接管正在运行的进程，也不自动修复卡关。默认路径可通过 `gameRoot` 覆盖。设备输入与状态核验仍由原脚本负责。

`decide(path, coordinator, context)` 把快照和缺口交给现有 `AutonomyCoordinator`，返回分层决策；不会自动执行决策。

## 网易云游戏广告时长

在子工程目录运行：

```sh
node src/cli.js netease-ad-time --serial 设备序列号 --dry-run
node src/cli.js netease-ad-time --serial 设备序列号 --ocr-url https://127.0.0.1:8081 --max-rewards 8 --enable-execution
```

默认 dry-run 只观察当前界面；显式启用执行后才启动应用和操作。`--max-rewards` 为本次运行的安全上限，默认 50，不表示平台剩余次数；默认总时长上限为 10 分钟。设备须已连接、账号已登录，OCR 服务仅在节点不足时使用，按当前步骤裁剪相关区域；中层 OCR 客户端默认单次请求超时为 60 秒，调用方可显式覆盖。结果输出状态、停止原因、奖励秒数、起止余额及状态事件；`balance-unconfirmed` 不代表到账。运行中的云游戏、未知页面、未完成广告、识别失败或断线会停止，安装确认仅取消，不主动强停客户端。

2026-11-25 修复后实机连续完成4次广告，达到今日次数上限并核对余额；冷启动和其他素材仍待验证，建议先 dry-run 并观察停止原因。导航包为目标说明和控制器交接点，通用导航链不会自行启动此控制器。

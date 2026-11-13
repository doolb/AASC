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

显式以 `new GameTaskBridge({ enabled: true })` 启用后，`run({ startLevel, windowId, display, maxLevels, duckAuto })` 才能启动相邻 `aasc-game` 的连续游玩脚本；调用会等到脚本退出并返回退出码。此接口不接管正在运行的进程，也不自动修复卡关。默认路径可通过 `gameRoot` 覆盖。设备输入与状态核验仍由原脚本负责。

`decide(path, coordinator, context)` 把快照和缺口交给现有 `AutonomyCoordinator`，返回分层决策；不会自动执行决策。

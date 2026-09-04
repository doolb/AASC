# 使用说明

## 状态

基础功能已实现。运行代码和测试均为纯 JavaScript；以下命令和图片格式是当前接口，只使用新的游戏/功能/State/Flow 目录。

## OpenCV 运行时

项目使用 `@techstark/opencv-js` 提供的预编译 OpenCV.js/WASM，不需要安装系统 OpenCV、`node-gyp` 或 C++ 编译工具。PNG/BMP 文件由纯 JavaScript 解码后交给 OpenCV.js；默认使用模板匹配，也支持 `--matcher orb`。

## Markdown 导航包

统一导航包使用 `*.nav.md`，由人工或 HTTP 接口上传，不提供旧图片 Flow 的自动转换器。
一个包可以包含多个 Scenario；每个状态的 `uis` 按底层到顶层排列，`topmost` 表示最上层界面。
图片资源写成 Markdown Base64 data URI；NavMesh 网格不嵌入 Markdown，单独保存为 `*.navmesh`。

导航包的机器可读部分放在 `navigation-json` fenced block 中，例如：

~~~text
```navigation-json
{
  "metadata": { "id": "infinity-nikki", "version": "2026.09" },
  "goals": [{ "id": "daily", "kind": "ui", "flowId": "open-daily" }],
  "flows": [{
    "id": "open-daily",
    "navigator": "ui",
    "steps": [{ "id": "tap", "kind": "action", "goto": "done" },
              { "id": "done", "kind": "terminal", "terminal": true }]
  }]
}
```
~~~

检查和查询导航链：

~~~bash
npm run nav-check -- --file navigation/infinity-nikki.nav.md
npm run nav-chain -- --file navigation/infinity-nikki.nav.md --goal-id daily --state '{}'
~~~

## 本地 YOLO 和外部 OCR

`nav-serve` 是无认证的 HTTP 服务，认证预留给后续 AASC 权限适配：

~~~bash
npm run nav-serve -- --port 8787 --yolo-models config/yolo-models.json
~~~

`POST /api/v1/vision/yolo` 使用 autohelper 内部注册的 ONNX YOLO 模型；模型通过 JSON 配置扩展，
第一版内置 YOLO11 检测后端，分割模型可注册自定义 backend。OCR 仍使用 `OcrClient` 调用外部
AASC OCR 服务，显示器由 OCR 服务器自行调度。

## 图片目录

目录结构为 `flows/<game>/<feature>/{state,flow}`：

```text
flows/
├── netease-cloud/
│   ├── flow/{bootstrap,choose-normal,skip-ad,enter-game}/
│   └── state/{cloudgame-home,server-select,ad-offer,game-running}/
└── infinity-nikki/
    ├── targets/daily/*.txt
    └── daily/
        ├── state/calendar/match/
        └── flow/{open-calendar,open-daily-inspiration,open-star-sea-pickup}/
```

目标文本可声明提供方启动链：

```text
bootstrap-root=netease-cloud
bootstrap-flow=bootstrap
bootstrap-done-state=game-running
bootstrap-package=com.netease.android.cloudgame
bootstrap-activity=.activity.SplashActivity
bootstrap-display=0
```

提供方 Flow 成功进入 `game-running` 后，运行时重新加载目标游戏的 State 和入口
Flow。`bootstrap-feature` 仍作为旧格式兼容别名；新文件使用 `bootstrap-root`。

## 文件名参数

- `10@0.90`：队列 10，匹配阈值 0.90。
- `clickpoint@0.6&0.5`：在识别矩形内按归一化坐标点击。
- `clickpoint_ab@0&0`：保留原项目语义，点击当前画面中心。
- `delay@1000`：动作后等待 1000 毫秒。
- `loop`：允许匹配时重复动作。
- `wait`：只识别，不点击，也不执行 `goto`。
- `default`：无普通匹配时参与默认候选。
- `select@图片名`：要求同一 Flow 的另一张图片也匹配。
- `goto@home`：在动作 Flow 中点击成功后切换到当前功能的 `flow/home`。
- `ocr@放弃福利`：要求同一轮 OCR 结果中包含“放弃福利”，再允许该图片节点点击。OCR 只辅助图片匹配，点击位置仍由图片匹配矩形决定。
- `match@daily-task`：只能写在某个 State 的 `match/` 图片中，命中后创建或定位 `daily-task` 子目标。
- `done@daily-task-complete`：子目标执行后，匹配到该 State 才保存为完成。

State 目录直接图片全部匹配后才成立，`match/` 只在这个 State 成立时执行。

目标文件示例：

```text
id=daily-routine
type=daily
enabled=true
feature=enter-game
entry-flow=open-task
result-state=task-panel
done-state=daily-complete
completion=all-discovered-subgoals
```

例如动作文件名：

```text
flows/infinity-nikki/enter-game/flow/launch/enter-game@0.90,ocr@放弃福利,goto@home.png
```

当前 Flow 有 OCR 条件时，每轮截图只调用一次 `/api/vision/ocr`，所有 OCR 图片节点共享结果。OCR 接口不可用时输出 `ocr-error` 并跳过本轮点击。

## 命令

```bash
npm install
npm test
npm run build
npm run capture -- --device 192.168.1.6:5555 --game infinity-nikki --feature enter-game --flow launch --name close-popup@0.88
npm run inspect -- --device 192.168.1.6:5555 --game infinity-nikki --feature enter-game --flow launch
npm run record -- --record-file logs/record.jsonl
npm run start -- --device 192.168.1.6:5555 --game infinity-nikki --target daily-routine --dry-run --once
npm run start -- --device 192.168.1.6:5555 --game infinity-nikki --target daily-routine
npm run start -- --device 192.168.1.6:5555 --game infinity-nikki --target daily-routine --ocr-url http://127.0.0.1:8081
```

OCR 参数：

- `--ocr-url <url>`：OCR 服务地址；默认读取 `AASC_URL`，否则为 `https://127.0.0.1:8081`。
- `--ocr-short-side <pixels>`：OCR 缩放短边，取 `0` 或 `256` 到 `2048`。
- OCR 显示器由 AASC OCR 服务自行调度，AutoHelper 不指定显示器。
- `AASC_INSECURE=0`：校验 HTTPS 证书；默认保持与 AASC OCR 脚本一致，允许本地自签名证书。
- `AASC_TIMEOUT_SECONDS`：OCR 请求超时时间，默认 30 秒。
- `start` 必须指定 `--game <gameId>` 和 `--target <targetId>`；目标文本决定功能和入口 Flow。
- `capture`、`inspect` 必须指定 `--game <gameId>`、`--feature <featureId>` 和 `--flow <flowId>`。
- `capture` 也支持 `--flow-root <directory>`，用于直接采集顶层提供方 Flow 或独立
  State；使用它时不需要 `--game` 和 `--feature`。
- `--progress-root <directory>`：进度目录，默认 `progress`；进度文件按游戏、目标和周期分目录保存。

自动点击前应先执行 `--dry-run --once`，确认匹配图片和坐标。

参数缺失时 CLI 返回退出码 2；ADB、图片或 Flow 运行错误返回退出码 1。`start` 收到 Ctrl-C 后通过 AbortController 停止循环，不接管其他服务进程。

《无限暖暖》的模板目录见 `flows/infinity-nikki`。如果游戏尚未启动或设备没有安装游戏，不要把当前其他应用的画面作为模板；进入目标画面后再用 `capture` 生成局部 PNG，并在确认识别报告后决定是否使用真实点击。

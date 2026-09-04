# autohelper-node

Linux + Node.js（纯 JavaScript）+ ADB + OpenCV 的图片驱动自动化工具，参考 `/mnt/tmp/autohelper` 的 C# 设计实现。

当前工程支持按游戏、功能、状态和 Flow 组织图片流程，使用 `ocr@文字` 做 OCR 辅助确认，并保存每日、每周和版本目标进度。

## 运行环境

- Linux
- Node.js 25 或兼容的现代 Node.js
- ADB，并且目标 Android 设备状态为 `device`
- `@techstark/opencv-js` 预编译 OpenCV.js/WASM（由 npm 自动安装）
- `onnxruntime-web` Node 运行时，用于 autohelper 内部 YOLO ONNX 推理

## 常用命令

```bash
npm install
npm test
npm run build
npm run capture -- --device <serial> --game infinity-nikki --feature daily --flow open-calendar --name close-popup@0.88
npm run capture -- --device <serial> --flow-root flows/netease-cloud/flow --flow bootstrap --name official-play@0.88
npm run inspect -- --device <serial> --game infinity-nikki --feature enter-game --flow open-task
npm run record -- --record-file logs/record.jsonl
npm run start -- --device <serial> --game infinity-nikki --target daily-routine --dry-run --once
npm run nav-check -- --file navigation/game.nav.md
npm run nav-chain -- --file navigation/game.nav.md --goal-id daily
npm run nav-serve -- --port 8787 --yolo-models config/yolo-models.json
```

`--dry-run` 只截图、识别和输出拟点击坐标，不发送 ADB 点击。自动化前建议先使用 `--dry-run --once`。

## 图片流程

```text
flows/
├── netease-cloud/
│   ├── flow/bootstrap/
│   └── state/game-running/
└── infinity-nikki/
    ├── targets/daily/*.txt
    └── daily/{flow,state}/
```

目标可以通过 `bootstrap-root=netease-cloud` 先启动网易云游戏，再在
`bootstrap-done-state=game-running` 成立后交接到目标的 `feature` 和 `entry-flow`。
网易云 Flow 和游戏 Flow 使用独立目录，State 也不会跨目录混合匹配。

完整参数、State/Match、进度和 `goto` 规则见 [使用说明](docs/usage.md)。

## 导航包和视觉接口

新导航数据使用人工或 HTTP 上传的 `.nav.md`，不自动转换旧图片 Flow。Markdown
中的 navigation-json 区块保存目标、状态、Flow 和场景；图片使用
data:image/*;base64,，NavMesh 网格独立保存为 `.navmesh` 文件。

本地 YOLO 模型通过模型配置注册，可按游戏自行增加检测或分割后端：

~~~json
{
  "models": [{
    "id": "yolo11n",
    "task": "detect",
    "backend": "onnx-yolo11",
    "modelPath": "/mnt/AASC/res/models/yolo11/yolo11n.onnx",
    "labelsPath": "/mnt/AASC/res/models/yolo11/yolo11n.classes.json"
  }]
}
~~~

OCR 不在本地 YOLO 模块中实现，继续通过外部 AASC OCR 服务调用。

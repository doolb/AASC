# autohelper-node

Linux + Node.js + ADB + OpenCV 的图片驱动自动化工具，参考 `/mnt/tmp/autohelper` 的 C# 设计实现。

当前工程支持让图片文件名描述点击规则，使用 `goto@flowId` 在多个图片目录之间切换，并使用 `ocr@文字` 做 OCR 辅助确认。

## 运行环境

- Linux
- Node.js 25 或兼容的现代 Node.js
- ADB，并且目标 Android 设备状态为 `device`
- `@techstark/opencv-js` 预编译 OpenCV.js/WASM（由 npm 自动安装）

## 常用命令

```bash
npm install
npm test
npm run build
npm run capture -- --device <serial> --flow launch --name close-popup@0.88
npm run inspect -- --device <serial> --flow launch
npm run record -- --record-file logs/record.jsonl
npm run start -- --device <serial> --flow launch --dry-run
```

`--dry-run` 只截图、识别和输出拟点击坐标，不发送 ADB 点击。自动化前建议先使用 `--dry-run --once`。

## 图片流程

```text
flows/
├── launch/
│   └── enter@0.90,ocr@放弃福利,goto@home.png
└── home/
    └── menu@0.88,clickpoint@0.5&0.5.png
```

完整参数、`ocr@文字` 和 `goto` 规则见 [使用说明](docs/usage.md)。

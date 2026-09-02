# 使用说明

## 状态

功能正在实现中。以下命令和图片格式是已确认的目标接口。

## OpenCV 运行时

项目使用 `@techstark/opencv-js` 提供的预编译 OpenCV.js/WASM，不需要安装系统 OpenCV、`node-gyp` 或 C++ 编译工具。PNG/BMP 文件由纯 JavaScript 解码后交给 OpenCV.js；默认使用模板匹配，也支持 `--matcher orb`。

## 图片目录

每个 `flows/` 一级子目录是一个 Flow：

```text
flows/
├── launch/
│   ├── close-popup@0.88.png
│   └── enter-game@0.90,goto@home.png
└── home/
    └── menu@0.86,clickpoint@0.5&0.5.png
```

## 文件名参数

- `10@0.90`：队列 10，匹配阈值 0.90。
- `clickpoint@0.6&0.5`：在识别矩形内按归一化坐标点击。
- `clickpoint_ab@0&0`：保留原项目语义，点击当前画面中心。
- `delay@1000`：动作后等待 1000 毫秒。
- `loop`：允许匹配时重复动作。
- `wait`：只识别，不点击，也不执行 `goto`。
- `default`：无普通匹配时参与默认候选。
- `select@图片名`：要求同一 Flow 的另一张图片也匹配。
- `goto@home`：成功点击后切换到 `home` 目录。

## 命令

```bash
npm install
npm test
npm run build
npm run capture -- --device 192.168.1.6:5555 --flow launch --name close-popup@0.88
npm run inspect -- --device 192.168.1.6:5555 --flow launch
npm run record -- --record-file logs/record.jsonl
npm run start -- --device 192.168.1.6:5555 --flow launch --dry-run --once
npm run start -- --device 192.168.1.6:5555 --flow launch
```

自动点击前应先执行 `--dry-run --once`，确认匹配图片和坐标。

参数缺失时 CLI 返回退出码 2；ADB、图片或 Flow 运行错误返回退出码 1。`start` 收到 Ctrl-C 后通过 AbortController 停止循环，不接管其他服务进程。

《无限暖暖》的模板目录见 `flows/infinity-nikki`。如果游戏尚未启动或设备没有安装游戏，不要把当前其他应用的画面作为模板；进入目标画面后再用 `capture` 生成局部 PNG，并在确认识别报告后决定是否使用真实点击。

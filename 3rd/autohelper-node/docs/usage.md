# 使用说明

## 状态

基础功能已实现。以下命令和图片格式是当前接口。

## OpenCV 运行时

项目使用 `@techstark/opencv-js` 提供的预编译 OpenCV.js/WASM，不需要安装系统 OpenCV、`node-gyp` 或 C++ 编译工具。PNG/BMP 文件由纯 JavaScript 解码后交给 OpenCV.js；默认使用模板匹配，也支持 `--matcher orb`。

## 图片目录

每个 `flows/` 一级子目录是一个 Flow：

```text
flows/
├── launch/
│   ├── close-popup@0.88.png
│   └── enter-game@0.90,ocr@放弃福利,goto@home.png
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
- `ocr@放弃福利`：要求同一轮 OCR 结果中包含“放弃福利”，再允许该图片节点点击。OCR 只辅助图片匹配，点击位置仍由图片匹配矩形决定。

例如：

```text
flows/infinity-nikki/launch/enter-game@0.90,ocr@放弃福利,goto@home.png
```

当前 Flow 有 OCR 条件时，每轮截图只调用一次 `/api/vision/ocr`，所有 OCR 图片节点共享结果。OCR 接口不可用时输出 `ocr-error` 并跳过本轮点击。

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
npm run start -- --device 192.168.1.6:5555 --flow launch --ocr-url http://127.0.0.1:8081
```

OCR 参数：

- `--ocr-url <url>`：OCR 服务地址；默认读取 `AASC_URL`，否则为 `https://127.0.0.1:8081`。
- `--ocr-short-side <pixels>`：OCR 缩放短边，取 `0` 或 `256` 到 `2048`。
- OCR 显示器由 AASC OCR 服务自行调度，AutoHelper 不指定显示器。
- `AASC_INSECURE=0`：校验 HTTPS 证书；默认保持与 AASC OCR 脚本一致，允许本地自签名证书。
- `AASC_TIMEOUT_SECONDS`：OCR 请求超时时间，默认 30 秒。

自动点击前应先执行 `--dry-run --once`，确认匹配图片和坐标。

参数缺失时 CLI 返回退出码 2；ADB、图片或 Flow 运行错误返回退出码 1。`start` 收到 Ctrl-C 后通过 AbortController 停止循环，不接管其他服务进程。

《无限暖暖》的模板目录见 `flows/infinity-nikki`。如果游戏尚未启动或设备没有安装游戏，不要把当前其他应用的画面作为模板；进入目标画面后再用 `capture` 生成局部 PNG，并在确认识别报告后决定是否使用真实点击。

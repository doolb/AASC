# YOLO、ASR与声纹模型同步

模型目录为[外网aimodel](https://c.aasc.us/mnt/aimodel/)，[模型清单](https://c.aasc.us/mnt/aimodel/manifest.json)记录相对路径、大小和SHA-256。当前共30个文件、1,042,798,505字节，分类目录与本地`res/models`对应。

## 下载到当前项目

```bash
npm run sync:ai-models
```

已有文件大小及哈希一致时复用；缺失或变化文件先写同目录临时文件，完整校验后替换。默认下载全部模型，也可只选分类或指定其他目标目录：

```bash
npm run sync:ai-models -- --groups sensevoice,streaming-zipformer,voiceprint
npm run sync:ai-models -- --groups yolo11 --root /path/to/res/models
```

分类可选`yolo11`、`sensevoice`、`streaming-zipformer`、`voiceprint`、`speech-enhancement`。模型下载失败时原文件保留，下次重复运行复用已成功文件。脚本不删除额外模型、测试音频或其他资源。

## 上传或更新服务器

```bash
npm run publish:ai-models -- --verify-from server
```

默认从项目`res/models`读取全部允许文件，通过SSH上传至`as@120.79.245.103:/home/as/a/aimodel`。需要本机ssh/rsync及远端Python3，使用现有SSH身份，不在代码或清单中保存凭证。只有新增/变化文件传输；远端先校验，逐文件替换并最后发布清单，替换失败恢复本次备份。远端额外文件保持。

`server`模式仅用于该SSH服务器直接提供对应HTTPS域名的场景：服务器回环TCP连接，公开URL、Host、SNI和CA/主机名证书校验保持，完整流式读取全部文件，不跨WAN重复下载约1GB。本机仍读取公开清单；首次发布另外通过真实外网下载验证可用性。省略该参数或使用`--verify-from client`，会从客户端通过外网完整下载全部文件做哈希检查，时间取决于下行带宽。

上传成功后更新`scripts/models/ai-model-catalog.json`清单快照；它只包含路径、大小、哈希，不包含模型数据。可通过`--catalog PATH`指定其他清单文件。两端入口均支持`--report PATH`记录结果，`--source URL`覆盖HTTP(S)源目录；上传端还支持`--host USER@HOST`和`--remote-root PATH`。

## 与正式包的关系

上传全部模型只提供可恢复的服务器资源，不改变正式端模型选择或下载API。当前正式服务代码包不携带模型，普通正式APK按需通过AASC服务器API下载，YOLO默认`yolo11n`，声纹固定base FP32和Pyannote。声纹large/V2及INT8变体、其他YOLO尺寸与分割PT不会因上传而自动加载。

2026-10-12核对当前已发布完整Offline v23 APK和allserver profile，在本次范围内内置SenseVoice、base FP32和Pyannote三个ONNX；allserver-min为update-only且模型列表为空。历史文档中的完整生产模型集合不能作为当前实包目录证据，其他模型是否可用依赖服务端缓存和实际选择。当前仓库的全部模型同步不会触发APK构建或扩充APK白名单。

## 验证命令

```bash
npm run test:ai-models
```

2026-10-12：27项通过，无失败/跳过。实际发布30项远端文件及服务器本机HTTPS大小/SHA-256一致；客户端外网目录和清单HTTP200、13项小文件完整哈希检查通过，GTCRN下载到空目录后重复同步复用。本地原模型目录同步复用全部30项。

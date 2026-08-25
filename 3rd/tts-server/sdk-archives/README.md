# TTS SDK 原始归档

本目录保存 `prepare-runtime.sh` 从 Microsoft 官方地址下载的原始 SDK 压缩包。
构建脚本会直接复用这些文件，并将内容解压到构建运行目录；原始压缩包不在构建结束后删除。

当前版本：`1.51.2`

- Linux Embedded Speech SDK：`https://aka.ms/csspeech/linuxembeddedbinary`
- Wine Speech SDK：`https://www.nuget.org/api/v2/package/Microsoft.CognitiveServices.Speech/1.51.2`
- Wine Embedded TTS：`https://www.nuget.org/api/v2/package/Microsoft.CognitiveServices.Speech.Extension.Embedded.TTS/1.51.2`
- Wine ONNX Runtime：`https://www.nuget.org/api/v2/package/Microsoft.CognitiveServices.Speech.Extension.ONNX.Runtime/1.51.2`
- Wine Telemetry：`https://www.nuget.org/api/v2/package/Microsoft.CognitiveServices.Speech.Extension.Telemetry/1.51.2`

下载包中的 `LICENSE.md`、`REDIST.txt`、`ThirdPartyNotices.md` 和 NuGet 元数据是再分发与许可证核对依据；提交前应确认仓库分发范围符合对应条款。

校验：

```bash
sha256sum --check SHA256SUMS
```

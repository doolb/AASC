# Qwen API 与千问网页朗读频率控制

日期：2026-10-18
状态：源码与离线自测完成；真实账号现场验收待做。

## 任务描述与设计需求

04:48:22 聊天 TTS 生成报告 `Qwen API HTTP 429 [Throttling.RateQuota]`。目标是在不改变文字聊天、分句播放顺序和其他 Provider 行为的前提下，降低本应用同账号短时请求峰值，且不能因为排队容量或一次重试就丢掉已提交的 TTS 分句。具体范围见 `docs/design/tts-providers.md` 对应章节。

## 实现记录

按 `docs/spec/tts-providers.md` 的伪代码实现。`chat2api-speech-upstream.js` 与 `chat2api-speech-service.js` 对 Qwen API 和 Qwen Chat 分别建立同账号保序请求启动闸门；`chat2api-runtime.js`、`server-app.js` 注入同一 controller，覆盖聊天与内置代理。Qwen API 仅对结构化 `Throttling.RateQuota`、Qwen Chat 仅对可靠识别的限流进行持续退避与重新排队。`chat2api-qwen-speech-auth.js` 和 `chat2api-qwen-speech-adapter.js` 识别签名/握手 429 与明确限流事件，取消中断签名和 WebSocket。`server-app.js` 的聊天代次将取消信号传到分句合成，旧轮结束后不留无限重试请求。相关定向测试在 speech upstream/service/unified、Qwen Chat 适配器及服务端 TTS 集成测试中。

## 自测、兼容性与性能

同账号多批次在本实例内按 500 毫秒间隔启动；不同账号不互堵；明确 429 不因本地队列容量或固定重试次数而丢句；取消后不迟到发请求；原句顺序、豆包网页与系统原生 TTS 行为保持。`npm run check:chat2api` 284/284、`npm run test:mmd-production:tts` 23/23 通过；Qwen Chat 握手/事件及 Qwen API 连续限流均有定向测试。真实百炼账号及网页账号、同主账号外部流量需现场验收。

## 风险与预计工时

主账号下其他进程或应用也共享百炼限流，本实例闸门不能保证完全杜绝 429；持续限流会增加播报延迟，未取消的等待项持续占用进程内存。服务重启、用户取消和非限流错误不保证补播。预计工时半日至一日；本轮未执行云端合成或修改运行配置。

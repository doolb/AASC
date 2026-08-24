# 文本媒体语音路由与批量类型筛选设计

## 需求

批量播放设置增加媒体类型选择：文本、音频、图片、视频、网页，默认全部选中。控制端只把选择结果作为 `mediaTypes` 上报给服务器，不在浏览器筛选文件；服务器统一对媒体库扫描结果和临时文件执行筛选。

纯文本播放继续由显示端分页和分句，但语音播放能力改为控制端手动维护。显示端不再依赖“无扬声器/不可播放”的自动上报，控制端可以在显示端能力设置中关闭“语音播放”。当文本显示端没有语音播放能力时，服务器从本次选中的显示端中选择一个已手动启用语音播放的设备转发 TTS。没有可用设备时，文本仍显示，当前句跳过并记录提示。

文本 TTS 采用单句串行播放，并允许最多预先生成下一句。下一句只生成一次并缓存，当前句播放结束后优先使用缓存；翻页、暂停、停止、切换媒体或播放标识失效时清理缓存，避免旧语音串入新播放。

## 目标与约束

- 类型值固定为 `text`、`audio`、`image`、`video`、`web`；服务器内部兼容已有 `html`，并将 `gif` 归入图片。
- `mediaTypes` 缺失、为空或规范化后没有合法值时按“全部类型”处理；合法值与未知值混合时保留合法值，兼容旧控制端。
- 控制端不读取文件类型进行筛选，也不改变服务器返回播放列表的顺序语义。
- `voicePlayback` 的控制端手动设置保存为 `userCapabilities`，服务器合并显示端能力上报时始终以手动值为准。
- 语音目标只能来自本次请求的 `displayIds`；不自动扩展到未选中的显示端。
- 同一文本播放上下文只选择一个语音目标，避免多个显示端重复播报。
- 远程语音播放必须回报结束/失败，源文本显示端据此推进下一句。

## 语音路由

服务器收到媒体或播放列表请求后，保留选中的 `displayIds`，为每个文本显示端计算 `voiceTargetDisplayId`：优先当前显示端，随后按选中顺序选择手动启用 `voicePlayback` 的设备。播放列表的路由信息随 `playlistStart` 持久化，单媒体路由信息随媒体消息下发。

源显示端请求 `textSentenceTts` 时携带 `voiceTargetDisplayId`。目标为源显示端时沿用 `tts/playAudio + textPlayback`；目标为另一台显示端时服务器发送带 `textPlaybackRemote` 和 `originDisplayId` 的音频消息。远程设备播放结束或失败后发送 `textSentenceTtsFinished`，服务器只把结束消息转发给对应源显示端。暂停、停止、翻页和切换播放标识会同时取消源端和远程端的过期上下文。

## 预生成时序

1. 源端请求当前句，服务器合成并发送当前句音频。
2. 源端收到当前句音频后，立即请求下一句，标记 `prefetch: true`；服务端每个播放上下文最多保留一个预生成句。
3. 当前句结束后，源端从 `prefetchedAudio` 播放下一句；若缓存尚未到达，则正常等待下一句回包。
4. 预生成回包不立即播放，且必须带完整的 `playbackId/pageIndex/sentenceIndex` 定位字段。
5. 远程目标同样只缓存一个预生成句；当前句结束回报后，服务器才发送缓存的下一句，确保远程设备不会抢播。

## Task 3 落地状态

- 2026-08-24 已完成下一句 TTS 预生成核心链路：源显示端当前句音频开始后只发送一次 `prefetch:true` 下一句请求。
- 源端本地预取回包带 `textPlayback:true,prefetch:true` 和完整 `playbackId/pageIndex/sentenceIndex` 定位，只写入单个预取槽，不立即抢播。
- 当前句结束后优先消费本地预取缓存；预取尚未完成时等待，预取失败时清理槽位并回退普通 `textSentenceTts` 请求，不跳过当前目标句。
- 暂停、翻页、停止、新播放标识和旧回包都会清理或失效预取槽，避免旧音频串入新播放。
- 服务端识别 `prefetch`，重复预取只占一个生成槽；预取错误返回 `textSentenceTtsError(prefetch=true)`，不推进当前句。
- 远程语音路径保持协议兼容：远程预取音频带 `textPlaybackRemote:true,prefetch:true`，服务端向源端发送可定位 `textSentenceTtsReady(prefetch=true)`；远程显示端只保留一个预取缓存，不影响当前音频。
- 2026-08-24 Task 3 review-fix：源端 `pause/prev/next/stop`、route replacement、`clearDisplayRoute` 或新 `playbackId` 失效旧远程上下文时，服务端先向远程语音目标发送 `textPlaybackRemote:true/action:'stop'`，远程显示端暂停当前远程文本音频并清空当前/预取槽；旧 `ended/error` 回调不能再消费旧缓存。
- 远程预取消费必须同时匹配 `originDisplayId/voiceTargetDisplayId/playbackId` 和下一句定位，不能只按 `playbackId` 或上下文三元组自动播放。

## 批量类型协议

控制端发送：

```json
{
  "type": "playlistRequest",
  "displayIds": ["display-a"],
  "mediaTypes": ["text", "audio", "image", "video", "web"]
}
```

服务器内部筛选 `html` 和 `web` 的等价关系、`gif` 和 `image` 的归类关系，播放列表返回给显示端时仍使用现有 `mediaType` 值，避免影响已有渲染器。

## Task 1 落地状态

- 2026-08-24 已完成批量类型协议首段落地：控制端批量设置弹窗新增 `text/audio/image/video/web` 五类复选框，默认全部勾选。
- 控制端确认后只发送 `mediaTypes`，不在浏览器侧对媒体库结果或临时文件做客户端筛选。
- 服务器 `PlaylistManager` 已对媒体库扫描和临时文件两条路径统一执行 `mediaTypes` 规范化与过滤，兼容旧客户端缺少该字段时按全部类型处理。
- `server-app` 当前只做字段透传，不复制媒体类型映射逻辑，避免控制层与服务层规则漂移。
- 2026-08-24 reviewer fix2：`upload.js` 的临时批量预处理恢复为使用当前循环索引生成 `tempPreviewKey`，避免 `prepareTempFiles()` 引用未定义 `i` 后吞错并导致整批临时播放请求不发出。

## 手动能力设置

控制端继续使用显示端能力编辑器发送 `updateCapabilities`。能力面板明确说明“语音播放为手动路由开关”；服务器保存覆盖值并在显示端重新上报能力时重新合并，自动能力上报不得覆盖手动选择。

## Task 2 落地状态

- 2026-08-24 已完成手动语音设备路由：控制端能力编辑器明确 `voicePlayback` 是“语音播放为手动路由开关”，未新增显示端自动无扬声器上报。
- 服务器在单媒体 `mediaBatch` 和批量 `playlistRequest` 中，为文本媒体按本次 `displayIds` 计算 `voiceTargetDisplayId`：源端启用语音时优先源端，否则只在本次选中的在线语音设备中按顺序选择，不扩展到未选设备。
- 文本媒体消息和 `playlistStart` 下发 `selectedDisplayIds`、`selectedVoiceDisplayIds`、`voiceTargetDisplayId`，播放列表额外保留 `voiceRouteByDisplayId`，重连恢复时继续使用同一批路由字段。
- `textSentenceTts` 显式携带 route 时由服务端校验播放上下文、选中设备集合、目标在线状态和手动 `voicePlayback`；远程目标收到 `textPlaybackRemote` 后播放音频并以 `textSentenceTtsFinished` 回执，由服务器校验后转发源端推进当前句。
- 暂停、翻页、停止或切换文本播放标识会取消源端 TTS 上下文，远程显示端迟到回执不会推进旧句子。
- 2026-08-24 reviewer fix：`server-app` 在单媒体和播放列表下发时把服务器计算的 route 注册到 `TextMediaTtsService`，首个 `textSentenceTts` 不再信任显示端自带 route；远程句子下发后登记 pending 定位，`textSentenceTtsFinished` 必须匹配 origin/target/playbackId/pageIndex/sentenceIndex 才会转发。

## 失败与兼容

- 没有可用语音目标：服务器回源端 `textSentenceTtsError`，源端跳过当前句但继续分页。
- 远程目标离线或播放失败：服务器回源端同样发送可定位错误/完成消息，不阻塞后续句子。
- 旧客户端不发送 `mediaTypes`、`voiceTargetDisplayId` 或 `prefetch` 时，按当前单显示端串行 TTS 逻辑兼容。

## Task 4 核对状态

- 2026-08-24 已按 `server-app.js`、`playlist-app-service.js`、`text-media-tts-service.js`、`text-media-ws-integration.js`、`text-media-player.js` 与现有 focused tests 复核 Task 1/2/3 文档描述。
- 当前设计文档保留以下已落地事实：`mediaTypes` 仅由控制端上报、服务器统一筛选；`voicePlayback` 为手动路由开关；远程 `textSentenceTtsFinished` 必须匹配上下文定位；单句 `prefetch` 只保留一个槽位，`pause/prev/next/stop` 与 route replacement 会使旧上下文失效。
- 交付验证结果和环境限制单独记录在 `.superpowers/sdd/2026-08-24-text-media-routing/task-4-implementation-report.md`，避免把回归细节混入设计正文。

## Task 5 审查修复状态

- 批量 `pause/prev/next/jump` 会取消当前源显示端的远程 TTS 上下文，但保留已注册 route，恢复或切换后的新 playbackId 可以继续请求。
- 远程句子增加有限完成超时；目标显示端断连时立即向源端回传带定位错误，并清理同一上下文的当前句和预取句。
- 显示端重连时从持久化单媒体/播放列表文本状态重新注册服务器权威 route；当前手动能力和选中设备仍由服务端重新校验。
- 远程预取句已经消费后暂停会失效当前 playbackId，恢复时从当前句重新请求，不会因保留旧 remoteActiveSentence 停滞。
- 当前句远程完成超时时先删除旧 active context，再停止远程目标并失败 pending；仍在生成的迟到预取结果因旧 token 失效而不会再次下发。

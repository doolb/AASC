# Android 显示端原生声纹识别（说话人识别 + 多人分割）设计文档

## 概述

在刚完成的 android-display 原生 ASR（sherpa-onnx AAR）基础上，扩展**说话人识别**：同一段音频既识别文字、又识别说话人；支持**一句对话多个人说话时逐段归属**（diarization）。识别结果沿现有 `asrAudio`/`asrResult` 中转链路回传，**服务器只处理识别到声纹的语音**——`speaker` 匹配到声纹库的语音才触发命令，未识别到声纹的语音静默忽略。

核心价值：把"谁在说话"带进语音命令，实现按说话人归因、防止未注册者误触发命令、多人对话各自执行命令。

## 需求背景

### 现状问题

| 问题 | 根因 |
|------|------|
| 语音命令不知道"谁说的" | 现有 ASR 只出文字，无说话人信息 |
| 任何人说话都会触发命令 | 无法区分已注册用户与陌生人 |
| 多人对话只能整段处理 | 一段音频只产出一个 text，混在一起无法逐句归属 |

### 目标

1. APK 原生声纹识别：每段语音识别出说话人（`speaker`），与文字一起回传
2. 支持多人分割：一句对话里多个说话人各自分段归属（`segments: [{text, speaker, start, end}]`）
3. 只处理声纹语音：`speaker` 匹配到声纹库才触发命令，未识别/未注册静默忽略
4. 注册：控制端输入名字 + 控制端录音，`voiceprint.extraction` 可配置（服务器或 APK 中转提取）
5. 多台显示端共享声纹库（服务器权威库 + APK 本机缓存）

### 约束

- 显示端 APK：minSdk 24；AAR 已含 `SpeakerEmbeddingExtractor`/`SpeakerEmbeddingManager`/`OfflineSpeakerDiarization`
- 三端同模型：服务器(sherpa-onnx-node)与 APK(AAR)加载**同一 embedding 模型**，特征向量可比
- 桥接口契约沿用现有同步 JSON 先例；输入均为裸 PCM(16k mono s16le) base64
- 识别链路复用现有 `asrAudio`/`asrResult` 中转协议；服务器 `/api/asr/recognize` 返回结构升级
- 浏览器 WASM 路径无声纹能力：**无 speaker 字段的语音保持现有行为放行**（"只处理声纹语音"只约束能拿到 speaker 的语音）
- 模型按需下载沿用现有机制（SSL-trust 下载）

## 核心架构

```
【控制端 upload.html】      【服务器】                  【APK 显示端】
┌──────────────┐  注册     ┌──────────────────────┐   asrAudio  ┌──────────────────────┐
│ 声纹管理面板   │ ──音频──► │ /api/voiceprint/register │ ──────────►│ display.html          │
│ 输入名字+录音 │ +name    │   ├ extraction='server'│            │  ├ asrRecognize→text │
└──────────────┘          │   │   sherpa-onnx 提取 │            │  ├ voiceprintDiarize  │
                          │   └ extraction='display'│            │  └   →segments[]     │
                          │      中转在线 APK 提取 ◄──────────────┤                      │
                          │  voiceprint.db(权威库)  │   speakerDbUpdated+re-pull  │
                          │  ▼ 持久化 res/voiceprint│ ──────────►│ VoiceprintDbCache    │
                          │  /api/voiceprint/db    │   GET db   │  (本机缓存,离线可用)  │
                          └──────────────────────┘            └──────────────────────┘
```

### 三原则

1. **服务器权威库**：`voiceprint.db`（`name → embedding` 向量）持久化在服务器，所有变更经服务器广播
2. **APK 本机识别**：每台 APK 缓存全量库重建本地 `SpeakerEmbeddingManager`，识别零 RTT、服务器离线也能匹配
3. **三端同模型**：服务器与 APK 加载同一 embedding 模型，特征向量空间一致才能跨端匹配

## 组件设计

### 1. VoiceprintEngine（Kotlin 单例，仿 AsrEngine）

- `SpeakerEmbeddingExtractor` + `SpeakerEmbeddingManager(dim)`，`synchronized` 包裹（同 AsrEngine 的 use-after-free 防护）
- `extract(samples)→float[]`：`createStream → acceptWaveform(samples,16000) → inputFinished → compute(stream)`，`finally stream.release()`
- `dbChanged(name→float[])`：重建 manager（`add` 每个 speaker）；空库时 manager 置空
- 单段匹配：`manager.search(embedding, threshold)` → `name|null`
- 多人模式：`OfflineSpeakerDiarization.process(samples)` → 分段 `[{start,end,speakerIndex}]` → 每段切片音频 → 每段提取 embedding → 匹配人名 → `segments:[{text,speaker,start,end}]`
- **注意**：diarization 的 `speakerIndex` 是聚类编号非人名，`index→人名` 由每段独立匹配声纹库决定；低于 threshold 归 null

### 2. VoiceprintModelManager（Kotlin，复用 AsrModelManager 模式）

- embedding 模型 + segmentation 模型按需下载（`/api/voiceprint/model/<file>`，白名单），存 `filesDir/models/voiceprint/`
- 状态机/进度/SSL-trust 下载逻辑复用 AsrModelManager；`voiceprintStatus()` 暴露 ready/enabled/dim/speakers

### 3. VoiceprintDbCache（Kotlin）

- 本机缓存 `filesDir/voiceprint/db.json`，离线识别用
- `syncFromServer()`：GET `/api/voiceprint/db` → 写缓存 → `VoiceprintEngine.dbChanged`
- 服务器广播 `speakerDbUpdated` → 重拉重建

### 4. 原生桥（NativeBridge 新增）

```kotlin
// 单段声纹匹配：裸 PCM(16k mono s16le) base64，同步返回 {"speaker":"妲己"|null,"dim":192} 或 {"error":"..."}
// 特征提取在工作线程串行（复用 asrExecutor），future.get(20s)
@JavascriptInterface fun voiceprintMatch(pcmBase64: String): String

// 多人分割+匹配：裸 PCM base64，同步返回 {"segments":[{text,speaker,start,end}]} 或 {"error":"..."}
// 内部 diarization → 分段 → 每段 ASR+声纹匹配（multiSpeaker=true 时 display.html 优先调用这个）
@JavascriptInterface fun voiceprintDiarize(pcmBase64: String): String

// 查询声纹引擎状态：{"ready":true|false,"enabled":true|false,"dim":192,"speakers":["妲己","控制端"]}
// ready = embedding 模型已加载 + 库已同步；enabled = config voiceprint.enabled
@JavascriptInterface fun voiceprintStatus(): String

// 拉取服务器权威库（重建本地 SpeakerEmbeddingManager），幂等；结果触发 window.onVoiceprintDb
@JavascriptInterface fun voiceprintSyncDb(): String

// 原生→JS 回调（evaluateJavascript，主线程）
window.onVoiceprintDb({state:'syncing'|'ready'|'error', speakers:[...], error})
```

### 5. display.html 接入（浏览器不受影响）

```
1. 全局：nativeVoiceprintAvailable = !!(window.NativeDisplay?.voiceprintMatch)；voiceprintReady=false；voiceprintEnabled=false
2. detectCapabilities 加 voiceprintAvailable → 服务器广播给控制端（面板据此显示可用状态）
3. asrAudio 原生路径 → 按 voiceprint.multiSpeaker 分派：
     false → [asrRecognize(pcm), voiceprintMatch(pcm)] → asrResult{text, speaker}
     true  → voiceprintDiarize(pcm) → asrResult{segments:[{text,speaker,start,end}]}
   （model 未就绪 → 降级单段 text，speaker 缺省 → 命令照常）
4. onVoiceprintDb → 更新 voiceprintReady + 提示"声纹库已同步 N 人"
5. voiceprintConfig 消息 → enabled 开关：关 → 跳过声纹步骤（speaker 缺省），保持现有命令行为
6. 库为空时提示"请先在控制端注册声纹"（每 N 分钟一次不刷屏）
```

### 6. 服务器（server-app.js）

**接口：**
```
GET  /api/voiceprint/db                  # 返回权威库 {version, dim, speakers}
POST /api/voiceprint/register            # multipart(audio + name)；按 voiceprint.extraction 分派
GET  /api/voiceprint/model/<file>        # embedding/segmentation 模型下载（白名单，复用 ASR 模型下载逻辑）
GET  /api/voiceprint/config              # {enabled, extraction, threshold, multiSpeaker}
POST /api/voiceprint/config
POST /api/voiceprint/remove              # 删除某人声纹
```

**register 双模式分派（voiceprint.extraction）：**
- `'server'`：sherpa-onnx-node `SpeakerEmbeddingExtractor` 本地提取（复用现有 ASR 进程，懒加载 embedding 模型，提取完可释放）
- `'display'`：`findDisplayWithVoiceprint()` 找在线 APK → WS `voiceprintExtract(audioBase64)` → APK 原生提取 → WS `voiceprintExtracted(embedding)` → 服务器存库
- 同名字重复注册 = 覆盖；成功后写入库 → 持久化 `res/voiceprint/db.json`（防抖）→ 广播 `speakerDbUpdated`

**库持久化：** 服务器内存持库 + 每次变更落盘（防抖），启动加载。

**`/api/asr/recognize` 响应升级（display 中转模式）：**
```
单段：asrResult{text, speaker} → speaker 非 null → {status:'success', text, speaker}
                                 speaker null   → {status:'ignored', reason:'未识别到已注册声纹', text}
多段：asrResult{segments:[{text,speaker}]} → 过滤 speaker null 段 → {status:'success', segments:[{text,speaker}]}
```

**voiceInput 入口 speaker 校验（"只处理声纹语音"统一把关）：**
- 语音来源声明了 speaker 字段 → 仅 `speaker` 非 null 才交给 voiceCommand；null 段丢弃并 log（不误触发）
- 语音来源**没有** speaker 字段（浏览器 WASM、旧 APK）→ 维持现有行为放行（不破坏现有功能）

## 数据流

**单段识别（multiSpeaker=false）：**
```
控制端录音 → POST /api/asr/recognize → asr.device=display → asrAudio(pcm)
→ display.html: [asrRecognize(pcm), voiceprintMatch(pcm)]
→ asrResult{text, speaker} → 服务器 resolve → 上传端发 voiceInput{text, speaker}
→ 服务器 speaker 校验 → voiceCommand 归因到说话人
```

**多人识别（multiSpeaker=true）：**
```
控制端录音 → POST /api/asr/recognize → asrAudio(pcm)
→ display.html: voiceprintDiarize(pcm)
→ segments:[{text,speaker,start,end}] → asrResult{segments} → 服务器 resolve
→ 上传端逐段发 voiceInput{text, speaker}（display.html 自身录音 & chat.js 各段一条）
→ 服务器逐段 speaker 校验 → 每段各自触发 voiceCommand
```

**注册（control 端）：**
```
控制端面板输入名字+录音 → POST /api/voiceprint/register(audio,name)
→ extraction='server'：本地提取 → 存库
→ extraction='display'：中转在线 APK 提取 → 存库
→ 持久化 → 广播 speakerDbUpdated → 各 APK 重拉 db 重建
```

## 错误处理

| 场景 | 行为 |
|------|------|
| embedding 模型未下载 | `voiceprintMatch` 回 `{error}`，识别正常出 text，speaker 缺省 → 命令照常（一期降级） |
| diarization 模型未下载 | `multiSpeaker=true` 时回 `{error:'分割模型未下载'}` → 降级单段 speaker |
| 库为空 | 匹配全 null → 命令不触发，提示"请先注册声纹"（每 N 分钟一次不刷屏） |
| 全段 speaker null | `/api/asr/recognize` 回 ignored，不触发命令 |
| 匹配低于 threshold | 段归 null → 丢弃（宁缺勿错） |
| 多台 APK 同时识别 | 各自本机匹配，互不干扰；库同步防抖合并 |
| 浏览器 WASM 无 voiceprint | speaker 恒缺省 → 保持现有行为放行（不拦截） |

## 性能与模型成本

- embedding 模型 ~4MB（eres2net 系，192 维），每台 APK 必下（识别是本机做的）
- segmentation 模型额外 ~几十MB，仅 `multiSpeaker=true` 时下载
- 单人模式识别延迟 ≈ max(ASR, 声纹)；多人模式 ≈ diarization + 逐段 ASR+声纹（明显上升，低频可接受）

## 自测方案

1. **Kotlin 单测**：`VoiceprintEngine` 特征提取（合成两段不同 tone 音频→embedding 可分）；`VoiceprintDbCache` 缓存读写
2. **接口自测**：curl `/api/voiceprint/register`（server 模式提取 embedding 返回 dim 校验）；`/api/voiceprint/db` 读写一致
3. **真机链路**：
   - 注册 A/B 两人（控制端录音）→ 库同步到 APK → 单人说话命令触发带 speaker
   - 一段里 A 说"开灯"B 说"唱歌"→ 两条命令各自执行
   - 未注册者说话 → 不触发命令
   - `extraction='display'` 时注册中转 APK 提取成功
   - 多台 APK 共享库：一台注册，另一台也能识别
   - 浏览器 WASM 路径不受影响

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `.../VoiceprintEngine.kt`（新增） | 特征提取/库管理/单段匹配/多人 diarization |
| `.../VoiceprintModelManager.kt`（新增） | embedding/segmentation 模型下载（复用 AsrModelManager 模式） |
| `.../VoiceprintDbCache.kt`（新增） | 本机库缓存 + 同步 |
| `.../NativeBridge.kt` | voiceprintMatch/voiceprintDiarize/voiceprintStatus/voiceprintSyncDb 4 桥方法 + onVoiceprintDb |
| `src/apps/web-mediacenter/ui/public/display.html` | 声纹接入（能力/分派/回调/提示） |
| `src/apps/server/boot/server-app.js` | /api/voiceprint/* 接口 + register 双模式 + /api/asr/recognize 升级 + voiceInput speaker 校验 |
| `.../asr-service.js`（或独立 voiceprint-service） | server 模式特征提取 |
| `src/apps/web-mediacenter/ui/public/upload.html` + js | 控制端声纹管理面板（输入名字+录音+列表/删除） |
| `config/config.json` | voiceprint.enabled / extraction / threshold / multiSpeaker |
| `docs/spec/voiceprint.md`（新增） | 实现伪代码文档 |
| `docs/design.md` / `docs/spec.md` | 索引更新 |

## 分期说明

用户选择**一次性全做**（一期二期一起实现）。设计内部仍保留单段/多段两条路径，`voiceprint.multiSpeaker` 控制；单人场景走高效单段路径，多人场景走 diarization。

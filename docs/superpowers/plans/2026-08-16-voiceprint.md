# Android 显示端原生声纹识别（说话人识别 + 多人分割）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 android-display APK 的原生 sherpa-onnx 栈上叠加声纹识别：每段语音识别出说话人（`speaker`），支持一句对话多人说话时逐段归属（diarization）；服务器只处理识别到声纹的语音（`speaker` 匹配到声纹库才触发命令，未识别静默忽略）；控制端输入名字+录音注册，`voiceprint.extraction` 可配置服务器或中转 APK 提取；多台显示端经服务器权威库共享声纹。

**Architecture:** 服务器权威库（`res/voiceprint/db.json` 持久化 + `speakerDbUpdated` 广播），APK 缓存全量库重建本地 `SpeakerEmbeddingManager` 做本机零 RTT 匹配，三端加载同一 embedding 模型（`3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`，512 维）保证特征可比。识别沿现有 `asrAudio`/`asrResult` 中转协议扩展：`asrResult` 从 `{text}` 升级为 `{text, speaker}`（单段）或 `{segments:[{text,speaker,start,end}]}`（多人），服务器据此返回/忽略。关键语义：`speaker` 字段**缺省**（声纹未启用/模型未就绪）→ 放行；`speaker:null`（声纹启用但未匹配）→ 拦截。

**Tech Stack:** Kotlin / sherpa-onnx AAR（SpeakerEmbeddingExtractor、SpeakerEmbeddingManager、OfflineSpeakerDiarization）、Node.js Express、WebSocket、原生 JavaScript。

## Global Constraints

- 三端同模型：APK（AAR）与服务器（sherpa-onnx-node）加载同一 embedding 模型 `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`（512 维）；segmentation 模型 `pyannote_segmentation_3_0_int8.onnx`
- 模型按需下载沿用现有 SSL-trust 逻辑（自签名证书 trust-all，镜像 MainActivity.onReceivedSslError 姿态）
- 桥接口契约沿用现有同步 JSON 先例；音频输入均为裸 PCM(16k mono s16le) base64
- `speaker` 语义三态：**缺省**（声纹不可用→放行）/ **null**（可用但未匹配→拦截）/ **人名**（匹配→放行+归属）；"只处理声纹语音"只约束能拿到 speaker 的语音，浏览器/旧 APK（无 speaker 字段）保持现有行为
- 多人模式每段各自触发命令：服务器过滤 `speaker:null` 段，`segments` 逐段下发 `voiceInput`
- config `voiceprint` 默认：`enabled:true, extraction:'server', threshold:0.5, multiSpeaker:true`
- 中文注释；不用 var；不产生一大段 if-else-if 链；异步 async/await；错误 try-catch

---

### Task 1: 声纹模型落地 + 下载接口

**Files:**
- Create: `res/models/voiceprint/`（embedding + segmentation 模型文件，git 提交）
- Modify: `src/apps/server/boot/server-app.js`

**Interfaces:**
- Consumes: 无
- Produces: `GET /api/voiceprint/model/<file>`（filename ∈ {embedding, segmentation} 白名单）— Task 6 的 `VoiceprintModelManager` 下载它

- [ ] **Step 1: 下载 embedding 模型**

Run（使用代理；约 40MB）:
```bash
cd /mnt/AASC
HTTPS_PROXY=http://localhost:7899 curl -L --max-time 300 -o res/models/voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
ls -la res/models/voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx   # 期望 39593761 字节
```

- [ ] **Step 2: 下载并解包 segmentation 模型（int8）**

Run:
```bash
cd /mnt/AASC
HTTPS_PROXY=http://localhost:7899 curl -L --max-time 120 -o /tmp/pyannote.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2
tar xjf /tmp/pyannote.tar.bz2 -C /tmp
cp /tmp/sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx res/models/voiceprint/pyannote_segmentation_3_0_int8.onnx
ls -la res/models/voiceprint/pyannote_segmentation_3_0_int8.onnx   # 期望 1540506 字节
rm -rf /tmp/sherpa-onnx-pyannote-segmentation-3-0 /tmp/pyannote.tar.bz2
```

- [ ] **Step 3: 提交模型文件**

```bash
git add res/models/voiceprint/
git commit -m "feat(models): 声纹识别 embedding + segmentation 模型落地（3d-speaker eres2net / pyannote int8）"
```
（模型 git 提交，与 res/models/sensevoice/model.int8.onnx 现有模式一致）

- [ ] **Step 4: 新增模型下载路由**

在 `src/apps/server/boot/server-app.js` 的 `/api/asr/model/:filename` 路由（约 1056-1078 行）之后插入：

```js
// 声纹模型文件下载（Android 原生声纹识别按需拉取；filename 白名单防路径穿越）
const VOICEPRINT_MODEL_DIR = path.join(RES_DIR, 'models', 'voiceprint');
const VOICEPRINT_MODEL_FILES = [
    '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
    'pyannote_segmentation_3_0_int8.onnx'
];

app.get('/api/voiceprint/model/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!VOICEPRINT_MODEL_FILES.includes(filename)) {
        return res.status(400).json({ status: 'error', message: '非法文件名' });
    }
    const filePath = path.join(VOICEPRINT_MODEL_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ status: 'error', message: '声纹模型文件不存在' });
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
        if (!res.headersSent) {
            res.status(500).json({ status: 'error', message: '模型文件读取失败' });
        } else {
            res.end();
        }
    });
    res.on('close', () => stream.destroy());
    res.on('error', () => stream.destroy());
    stream.pipe(res);
});
```

- [ ] **Step 5: node --check + 重启验证**

```bash
node --check src/apps/server/boot/server-app.js
curl -sk -X POST https://localhost:8081/api/restart
# 轮询直到恢复（~30s，媒体库 http 无超时可能 ~2min）：
until curl -sk https://localhost:8081/api/asr/status >/dev/null 2>&1; do sleep 3; done
curl -skI https://localhost:8081/api/voiceprint/model/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx | grep -E "HTTP|Content-Length"   # 200, 39593761
curl -sk https://localhost:8081/api/voiceprint/model/foo.bin   # 400
```

- [ ] **Step 6: 提交路由**

```bash
git add src/apps/server/boot/server-app.js
git commit -m "feat(server): 声纹模型下载接口 GET /api/voiceprint/model/<file>"
```

---

### Task 2: voiceprint 配置 + 配置接口

**Files:**
- Modify: `config/config.json`
- Modify: `src/apps/server/boot/server-app.js`

**Interfaces:**
- Consumes: 无
- Produces: `config.get('voiceprint.*')` 与 `GET/POST /api/voiceprint/config` — Task 4/9/10 消费

- [ ] **Step 1: config.json 加默认配置**

在 `config/config.json` 的 `"asr"` 块之后（约 22 行后）加：

```json
  "voiceprint": {
    "enabled": true,
    "extraction": "server",
    "threshold": 0.5,
    "multiSpeaker": true
  },
```

- [ ] **Step 2: 配置接口**

在 `/api/voiceprint/model/:filename` 路由（Task 1 之后）之后插入：

```js
// 声纹识别配置
app.get('/api/voiceprint/config', (req, res) => {
    res.json({
        status: 'success',
        enabled: config.get('voiceprint.enabled', true),
        extraction: config.get('voiceprint.extraction', 'server'),
        threshold: config.get('voiceprint.threshold', 0.5),
        multiSpeaker: config.get('voiceprint.multiSpeaker', true)
    });
});

app.post('/api/voiceprint/config', (req, res) => {
    const { enabled, extraction, threshold, multiSpeaker } = req.body || {};
    if (extraction !== undefined && !['server', 'display'].includes(extraction)) {
        return res.status(400).json({ status: 'error', message: 'extraction 只能是 server 或 display' });
    }
    if (threshold !== undefined && (typeof threshold !== 'number' || threshold <= 0 || threshold > 1)) {
        return res.status(400).json({ status: 'error', message: 'threshold 必须是 (0,1] 的数值' });
    }
    if (enabled !== undefined) config.set('voiceprint.enabled', !!enabled);
    if (extraction !== undefined) config.set('voiceprint.extraction', extraction);
    if (threshold !== undefined) config.set('voiceprint.threshold', threshold);
    if (multiSpeaker !== undefined) config.set('voiceprint.multiSpeaker', !!multiSpeaker);
    config.saveConfig();
    // 广播给所有显示端，display.html 收到后 nativeBridge.voiceprintConfigure 重载引擎
    displayClients.forEach((displayData, displayId) => {
        sendToDisplay(displayId, {
            type: 'voiceprintConfig',
            enabled: config.get('voiceprint.enabled', true),
            extraction: config.get('voiceprint.extraction', 'server'),
            threshold: config.get('voiceprint.threshold', 0.5),
            multiSpeaker: config.get('voiceprint.multiSpeaker', true)
        });
    });
    res.json({ status: 'success', message: '声纹配置已更新' });
});
```

- [ ] **Step 3: 验证**

```bash
node --check src/apps/server/boot/server-app.js
curl -sk -X POST https://localhost:8081/api/restart   # 轮询恢复
curl -sk https://localhost:8081/api/voiceprint/config   # {status:success, enabled:true, ...}
curl -sk -X POST https://localhost:8081/api/voiceprint/config -H "Content-Type: application/json" -d '{"multiSpeaker":false}'
curl -sk https://localhost:8081/api/voiceprint/config   # multiSpeaker:false
curl -sk -X POST https://localhost:8081/api/voiceprint/config -H "Content-Type: application/json" -d '{"multiSpeaker":true}'   # 还原
```

- [ ] **Step 4: 提交**

```bash
git add config/config.json src/apps/server/boot/server-app.js
git commit -m "feat(server): voiceprint 配置 + GET/POST /api/voiceprint/config + 广播"
```

---

### Task 3: 服务器声纹权威库（持久化 + 广播 + db/remove 接口）

**Files:**
- Create: `src/apps/server/modules/voiceprint/voiceprint-store.js`
- Modify: `src/apps/server/boot/server-app.js`

**Interfaces:**
- Consumes: `config.get('voiceprint.dim')` 缺省 512（embedding 模型维度）
- Produces: `voiceprintStore`（`{ load() , getDb(), getSpeakers(), add(name, embedding), remove(name), getVersion(), onChange(cb) }`，变更时持久化 + 触发回调）— Task 4/5/10 消费

- [ ] **Step 1: 写 voiceprint-store 模块**

创建 `src/apps/server/modules/voiceprint/voiceprint-store.js`：

```js
// 声纹权威库：内存持库 + res/voiceprint/db.json 持久化（防抖落盘）+ 变更回调
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../../res/voiceprint/db.json');
const VOICEPRINT_DIM = 512;
const SAVE_DEBOUNCE_MS = 500;

class VoiceprintStore {
    constructor() {
        this.speakers = {};          // name -> Float32Array（或普通数组持久化时转 Array）
        this.version = 1;
        this.listeners = [];
        this._saveTimer = null;
        this.load();
    }

    load() {
        try {
            if (!fs.existsSync(DB_PATH)) return;
            const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
            if (raw && raw.speakers) {
                this.speakers = raw.speakers;
                this.version = (raw.version || 1) + 1;
            }
        } catch (e) {
            console.error('[voiceprint] 声纹库加载失败:', e.message);
        }
    }

    getDb() {
        return { version: this.version, dim: VOICEPRINT_DIM, speakers: this.speakers };
    }

    getSpeakers() {
        return Object.keys(this.speakers);
    }

    add(name, embeddingArray) {
        this.speakers[name] = embeddingArray;
        this.version++;
        this._scheduleSave();
        this._notify();
    }

    remove(name) {
        if (!(name in this.speakers)) return false;
        delete this.speakers[name];
        this.version++;
        this._scheduleSave();
        this._notify();
        return true;
    }

    onChange(cb) {
        this.listeners.push(cb);
    }

    _scheduleSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            try {
                fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
                fs.writeFileSync(DB_PATH, JSON.stringify(this.getDb(), null, 2));
            } catch (e) {
                console.error('[voiceprint] 声纹库持久化失败:', e.message);
            }
        }, SAVE_DEBOUNCE_MS);
    }

    _notify() {
        this.listeners.forEach(cb => cb(this.getDb()));
    }
}

module.exports = new VoiceprintStore();
```

- [ ] **Step 2: server-app.js 接入 store + db/remove 接口 + 广播**

在 `src/apps/server/boot/server-app.js` 顶部 require 区（约第 10 行 config require 之后）加：

```js
const voiceprintStore = require('../modules/voiceprint/voiceprint-store');
```

在 `/api/voiceprint/config` 路由（Task 2）之后插入：

```js
// 声纹库：读取权威库（APK 同步用）
app.get('/api/voiceprint/db', (req, res) => {
    const db = voiceprintStore.getDb();
    res.json({ status: 'success', ...db });
});

// 声纹库：删除某人声纹
app.post('/api/voiceprint/remove', (req, res) => {
    const name = req.body && req.body.name;
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ status: 'error', message: '缺少 name' });
    }
    const removed = voiceprintStore.remove(name);
    if (!removed) {
        return res.status(404).json({ status: 'error', message: '声纹不存在' });
    }
    res.json({ status: 'success', message: '已删除' });
});
```

在 server-app.js 找到广播函数区（`broadcastToControls` 定义约 2179 行），在其后加：

```js
// 声纹库变更广播：让所有显示端重拉权威库重建本地 SpeakerEmbeddingManager
function broadcastVoiceprintDbUpdated() {
    displayClients.forEach((displayData, displayId) => {
        sendToDisplay(displayId, { type: 'speakerDbUpdated' });
    });
}
```

在 `voiceprintStore` 加载后（Step 2 的 require 之后）注册回调：

```js
voiceprintStore.onChange(() => broadcastVoiceprintDbUpdated());
```

- [ ] **Step 3: 验证**

```bash
node --check src/apps/server/boot/server-app.js
curl -sk -X POST https://localhost:8081/api/restart   # 轮询恢复
curl -sk https://localhost:8081/api/voiceprint/db   # {status:success, version:1, dim:512, speakers:{}}
curl -sk -X POST https://localhost:8081/api/voiceprint/remove -H "Content-Type: application/json" -d '{"name":"x"}'   # 404 声纹不存在
```

- [ ] **Step 4: 提交**

```bash
git add src/apps/server/modules/voiceprint/voiceprint-store.js src/apps/server/boot/server-app.js
git commit -m "feat(server): 声纹权威库（持久化+防抖落盘+变更广播）+ db/remove 接口"
```

---

### Task 4: 服务器注册接口（双模式分派 + server 模式提取）

**Files:**
- Create: `src/apps/server/modules/voiceprint/voiceprint-service.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/external/asr/asr-service.js`

**Interfaces:**
- Consumes: `voiceprintStore.add/remove/getDb`（Task 3）；`asr-service.readWavFile`（本任务导出）
- Produces: `POST /api/voiceprint/register`（multipart audio+name，按 `voiceprint.extraction` 分派 server/display）；WS 下行 `voiceprintExtract {requestId, audioBase64}` 与 pending 表 — Task 5 处理 APK 回传

- [ ] **Step 1: 导出 asr-service.readWavFile**

在 `src/external/asr/asr-service.js` 末尾 `module.exports` 中加一项：

```js
module.exports = {
    SherpaOnnxASR,
    init,
    reset,
    getMode,
    recognize,
    isReady,
    readWavFile: (filePath) => {
        const inst = new SherpaOnnxASR();
        return inst.readWavFile(filePath);
    }
};
```

- [ ] **Step 2: 写 voiceprint-service（server 模式懒加载提取）**

创建 `src/apps/server/modules/voiceprint/voiceprint-service.js`：

```js
// 服务器端声纹提取（voiceprint.extraction='server' 时注册用）
// 懒加载 sherpa-onnx-node SpeakerEmbeddingExtractor，提取完释放（不长期占用 40MB 模型内存）
const path = require('path');
const asr = require('../../../external/asr/asr-service');

const EMBEDDING_MODEL = path.join(__dirname, '../../../../res/models/voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx');

let extractor = null;
let sherpa = null;

function getSherpa() {
    if (!sherpa) {
        try {
            sherpa = require('sherpa-onnx-node');
        } catch (e) {
            throw new Error('sherpa-onnx-node 未安装');
        }
    }
    return sherpa;
}

function getExtractor() {
    if (!extractor) {
        const onnx = getSherpa();
        extractor = new onnx.SpeakerEmbeddingExtractor({
            model: EMBEDDING_MODEL,
            numThreads: 1,
            debug: false,
            provider: 'cpu'
        });
    }
    return extractor;
}

// 提取音频文件的说话人特征；返回普通 Array（便于 JSON 持久化）
async function extractEmbedding(audioPath) {
    const { samples } = asr.readWavFile(audioPath);
    if (!samples || samples.length === 0) {
        throw new Error('音频数据为空');
    }
    const ex = getExtractor();
    const stream = ex.createStream();
    try {
        stream.acceptWaveform({ samples, sampleRate: 16000 });
        const emb = ex.compute(stream);
        return Array.from(emb);
    } finally {
        if (stream && stream.handle) stream.delete();
    }
}

function release() {
    if (extractor) {
        extractor = null;
    }
}

module.exports = { extractEmbedding, release, dim: () => getExtractor().dim };
```

- [ ] **Step 3: server-app.js 注册接口 + display 模式中转**

在 `/api/voiceprint/remove` 路由（Task 3）之后插入：

```js
// 声纹注册：控制端上传 audio+name；按 voiceprint.extraction 分派
const voiceprintUpload = multer({ dest: path.join(RES_DIR, 'temp', 'voiceprint') });
const voiceprintService = require('../modules/voiceprint/voiceprint-service');
let pendingVoiceprintExtracts = new Map();   // requestId -> {resolve, reject, timer}
let pendingVoiceprintRequestId = 0;

app.post('/api/voiceprint/register', voiceprintUpload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ status: 'error', message: '未收到音频文件' });
        const name = (req.body && req.body.name || '').trim();
        if (!name) {
            cleanupTempFile(req.file.path);
            return res.status(400).json({ status: 'error', message: '缺少名字' });
        }
        const extraction = config.get('voiceprint.extraction', 'server');
        let embedding;
        if (extraction === 'server') {
            try {
                embedding = await voiceprintService.extractEmbedding(req.file.path);
            } catch (e) {
                cleanupTempFile(req.file.path);
                return res.status(500).json({ status: 'error', message: '声纹提取失败: ' + e.message });
            }
        } else {
            // display 模式：中转在线 APK 提取
            const display = findDisplayWithVoiceprint();
            if (!display) {
                cleanupTempFile(req.file.path);
                return res.status(503).json({ status: 'error', message: '没有支持声纹的显示端在线' });
            }
            const audioBase64 = fs.readFileSync(req.file.path, { encoding: 'base64' });
            cleanupTempFile(req.file.path);
            const requestId = 'vp-' + Date.now() + '-' + (++pendingVoiceprintRequestId);
            embedding = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingVoiceprintExtracts.delete(requestId);
                    reject(new Error('显示端声纹提取超时'));
                }, 30000);
                pendingVoiceprintExtracts.set(requestId, { resolve, reject, timer });
                try {
                    sendToDisplay(display.id, { type: 'voiceprintExtract', requestId, audioBase64 });
                } catch (err) {
                    clearTimeout(timer);
                    pendingVoiceprintExtracts.delete(requestId);
                    reject(new Error('发送提取请求失败: ' + err.message));
                }
            });
        }
        voiceprintStore.add(name, embedding);
        res.json({ status: 'success', message: `已注册 ${name} 的声纹`, name, dim: embedding.length });
    } catch (e) {
        if (req.file && req.file.path) cleanupTempFile(req.file.path);
        res.status(500).json({ status: 'error', message: '注册失败: ' + e.message });
    }
});
```

在 `findDisplayWithAsr`（约 2206 行）之后加 `findDisplayWithVoiceprint`：

```js
function findDisplayWithVoiceprint() {
    for (const [displayId, displayData] of displayClients) {
        const caps = displayData.state?.capabilities;
        if (caps && caps.voiceprintAvailable) {
            return { id: displayId, ws: displayData.ws };
        }
    }
    return null;
}
```

- [ ] **Step 4: node --check + curl 验证（server 模式）**

```bash
node --check src/apps/server/boot/server-app.js && node --check src/apps/server/modules/voiceprint/voiceprint-service.js
curl -sk -X POST https://localhost:8081/api/restart   # 轮询恢复
# 用现有测试音频注册（res/models/sensevoice/zh.wav 是 wav）
curl -sk -X POST https://localhost:8081/api/voiceprint/register -F "name=测试人" -F "audio=@res/models/sensevoice/zh.wav"
#   → {status:success, name:"测试人", dim:512}
curl -sk https://localhost:8081/api/voiceprint/db   # speakers:{"测试人":[512个数]}
curl -sk -X POST https://localhost:8081/api/voiceprint/remove -H "Content-Type: application/json" -d '{"name":"测试人"}'
```

- [ ] **Step 5: 提交**

```bash
git add src/apps/server/modules/voiceprint/voiceprint-service.js src/apps/server/boot/server-app.js src/external/asr/asr-service.js
git commit -m "feat(server): 声纹注册接口（extraction=server 提取 / display 中转 APK）+ voiceprint-service"
```

---

### Task 5: 服务器 APK 回传处理 + /api/asr/recognize 升级 + voiceInput 声纹门控

**Files:**
- Modify: `src/apps/server/boot/server-app.js`

**Interfaces:**
- Consumes: `pendingVoiceprintExtracts`（Task 4）、`voiceprintStore`（Task 3）、`pendingDisplayAsrRequests`（现有）
- Produces: `asrResult` resolve 值升级为对象 `{text, speaker?, segments?}`；`voiceInput` 处理加 speaker 门控

- [ ] **Step 1: 处理 APK 回传 voiceprintExtracted**

在 `src/apps/server/boot/server-app.js` 的 WS 显示端消息处理（`asrResult` 分支约 2526 行附近）`if (data.type === 'asrResult') { ... }` 块之后加：

```js
                if (data.type === 'voiceprintExtracted') {
                    const pending = pendingVoiceprintExtracts.get(data.requestId);
                    if (pending) {
                        pendingVoiceprintExtracts.delete(data.requestId);
                        clearTimeout(pending.timer);
                        if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
                            pending.resolve(data.embedding);
                        } else {
                            pending.reject(new Error(data.error || '显示端声纹提取失败'));
                        }
                    }
                    return;
                }
```

- [ ] **Step 2: 升级 asrResult resolve 值为对象**

将 `asrResult` 分支内（约 2526-2538 行）的 `if (data.text) { pending.resolve(data.text); } else { ... }` 替换为：

```js
                if (data.type === 'asrResult') {
                    const pending = pendingDisplayAsrRequests.get(data.requestId);
                    if (pending) {
                        pendingDisplayAsrRequests.delete(data.requestId);
                        clearTimeout(pending.timer);
                        if (data.text || (data.segments && data.segments.length)) {
                            pending.resolve({
                                text: data.text || '',
                                speaker: data.speaker,       // undefined | null | 人名
                                segments: data.segments      // undefined | [{text,speaker,start,end}]
                            });
                        } else {
                            pending.reject(new Error(data.error || '显示端 ASR 识别失败'));
                        }
                    }
                    return;
                }
```

- [ ] **Step 3: 升级 /api/asr/recognize 的 display 分支**

将 `/api/asr/recognize`（约 1082-1096 行）display 分支的 `const text = await sendAudioToDisplayAsr(...)` 后续逻辑替换为：

```js
                const result = await sendAudioToDisplayAsr(displayWithAsr, audioBase64, requestId);
                cleanupTempFile(req.file.path);

                // 多人分割：只处理识别到声纹的段，逐段下发
                if (result.segments && result.segments.length) {
                    const segs = result.segments.filter(s => s.speaker);
                    if (segs.length === 0) {
                        return res.json({ status: 'ignored', reason: '未识别到已注册声纹', segments: [] });
                    }
                    return res.json({
                        status: 'success',
                        segments: segs.map(s => ({ text: (s.text || '').trim(), speaker: s.speaker }))
                    });
                }

                const text = (result.text || '').trim();
                if (!text) {
                    return res.json({ status: 'ignored', reason: '显示端未识别到有效语音', text: '' });
                }
                if (!hasValidContent(text)) {
                    log('语音', `忽略无效语音输入: ${text}`);
                    return res.json({ status: 'ignored', reason: '未检测到有效内容', text });
                }

                // speaker 语义：字段存在但为 null（声纹可用未匹配）→ 拦截；缺省 → 放行
                if (result.speaker !== undefined) {
                    if (!result.speaker) {
                        log('语音', `忽略未识别到声纹的语音: ${text}`);
                        return res.json({ status: 'ignored', reason: '未识别到已注册声纹', text });
                    }
                    return res.json({ status: 'success', text, speaker: result.speaker });
                }
                return res.json({ status: 'success', text });
```

- [ ] **Step 4: voiceInput 加 speaker 门控（防御性）**

在 WS 显示端消息处理 `else if (data.type === 'voiceInput' && displayData)` 分支（约 2757 行）开头加：

```js
    } else if (data.type === 'voiceInput' && displayData) {
        // 只处理声纹语音：声明了 speaker 但为 null（未注册/未匹配）的语音丢弃，不触发命令
        if (data.speaker !== undefined && data.speaker === null) {
            log('语音', `丢弃未识别到声纹的语音: "${data.text}"`);
            return;
        }
        broadcastToControls({
            type: 'voiceInput',
            displayId: displayId,
            text: data.text,
            isFinal: data.isFinal,
            fullText: data.fullText,
            ...(data.speaker !== undefined ? { speaker: data.speaker } : {})
        });
```

- [ ] **Step 5: node --check + curl 验证（忽略路径）**

```bash
node --check src/apps/server/boot/server-app.js
curl -sk -X POST https://localhost:8081/api/restart   # 轮询恢复
# display 模式 + 声纹：先注册，再确认 display 无在线 APK 时 register display 模式 503（跳过，需真机）
# server 模式 /api/asr/recognize：当前 asr.device 若非 display，行为不变（回归）
curl -sk https://localhost:8081/api/asr/status
```

- [ ] **Step 6: 提交**

```bash
git add src/apps/server/boot/server-app.js
git commit -m "feat(server): asrResult 升级 speaker/segments + /api/asr/recognize 声纹门控 + voiceInput 拦截"
```

---

### Task 6: APK ModelDownloader 抽取 + VoiceprintModelManager + VoiceprintDbCache

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/ModelDownloader.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelManager.kt`（downloadFile 改委托）
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintModelManager.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintDbCodec.kt`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/VoiceprintDbCodecTest.kt`

**Interfaces:**
- Consumes: 无（抽取自 AsrModelManager 的既有逻辑）
- Produces: `ModelDownloader.download(urlStr, dest, onProgress): Boolean`（SSL-trust）；`VoiceprintModelManager(context, uiHandler)`（`ensureModel(baseUrl, needSegmentation, onEvent): String`、`isReady`、`embeddingModelPath`、`segmentationModelPath`、`statusJson()`）；`VoiceprintDbCodec`（`toSpeakers(json: JSONObject): Map<String,FloatArray>`、`toJson(speakers): JSONObject`）

- [ ] **Step 1: 抽 ModelDownloader**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/ModelDownloader.kt`，把 AsrModelManager.downloadFile 的 SSL-trust 下载逻辑整体搬入：

```kotlin
package com.aasc.display

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import java.security.SecureRandom
import java.security.cert.X509Certificate

// 模型文件下载（共享）：SSL-trust 自签名证书 + .tmp 原子改名 + 失败日志
// 与 MainActivity.onReceivedSslError 的 WebView 放行保持同一安全姿态（服务器自签名证书）
object ModelDownloader {

    // 下载到 .tmp 后原子改名（整文件重下，不做断点续传）；失败返回 false 并记录原因
    fun download(urlStr: String, dest: File, onProgress: (Int) -> Unit): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            val raw = URL(urlStr).openConnection()
            conn = if (urlStr.startsWith("https://")) {
                val https = raw as HttpsURLConnection
                val tm = arrayOf<TrustManager>(object : X509TrustManager {
                    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
                })
                val sc = SSLContext.getInstance("TLS")
                sc.init(null, tm, SecureRandom())
                https.sslSocketFactory = sc.socketFactory
                https.hostnameVerifier = HostnameVerifier { _: String?, _: SSLSession? -> true }
                https
            } else raw as HttpURLConnection
            conn.apply { connectTimeout = 10000; readTimeout = 60000 }
            val total = conn.contentLengthLong
            val tmp = File(dest.parentFile, dest.name + ".tmp")
            conn.inputStream.use { input ->
                FileOutputStream(tmp).use { output ->
                    val buf = ByteArray(64 * 1024)
                    var downloaded = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        downloaded += n
                        if (total > 0) onProgress((downloaded * 100 / total).toInt())
                    }
                }
            }
            if (conn.responseCode !in 200..299) return false
            if (!tmp.renameTo(dest)) {
                tmp.copyTo(dest, overwrite = true)
                tmp.delete()
            }
            true
        } catch (e: Exception) {
            android.util.Log.e("ModelDownloader", "模型下载失败: ${urlStr} ${e.message}")
            false
        } finally {
            conn?.disconnect()
        }
    }
}
```

- [ ] **Step 2: AsrModelManager 委托 ModelDownloader**

修改 `src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelManager.kt`：
- 删除 `downloadFile` 方法体，改为 `private fun downloadFile(urlStr: String, dest: File, onProgress: (Int) -> Unit): Boolean = ModelDownloader.download(urlStr, dest, onProgress)`
- 删除不再使用的 import（`FileOutputStream`/`HttpURLConnection`/`URL`/SSL 相关），保留 `java.io.File`
- 编译验证 + 全量单测确认无回归

```bash
cd src/apps/android-display && ./gradlew :app:compileDebugKotlin
JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/mnt/AASC/src/apps/android-display/app/build/test-tmpdir" ./gradlew :app:testDebugUnitTest
```

- [ ] **Step 3: 写 VoiceprintDbCodec（纯逻辑，可单测）**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintDbCodec.kt`：

```kotlin
package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject

// 声纹库编解码（纯逻辑，JVM 单测）：{version, dim, speakers:{name:[512 个浮点]}}
object VoiceprintDbCodec {

    // 解析服务器 /api/voiceprint/db 响应里的 speakers 对象 → name -> embedding
    fun speakersFromDb(dbJson: JSONObject): Map<String, FloatArray> {
        val out = LinkedHashMap<String, FloatArray>()
        val speakers = dbJson.optJSONObject("speakers") ?: return out
        val keys = speakers.keys()
        while (keys.hasNext()) {
            val name = keys.next()
            val arr = speakers.optJSONArray(name) ?: continue
            val emb = FloatArray(arr.length())
            for (i in 0 until arr.length()) emb[i] = arr.optDouble(i).toFloat()
            out[name] = emb
        }
        return out
    }

    // 本机缓存序列化
    fun toJson(speakers: Map<String, FloatArray>): JSONObject {
        val obj = JSONObject()
        val speakersObj = JSONObject()
        for ((name, emb) in speakers) {
            val arr = JSONArray()
            for (v in emb) arr.put(v.toDouble())
            speakersObj.put(name, arr)
        }
        obj.put("version", 1)
        obj.put("dim", 512)
        obj.put("speakers", speakersObj)
        return obj
    }
}
```

- [ ] **Step 4: 写失败测试 VoiceprintDbCodecTest**

创建 `src/apps/android-display/app/src/test/java/com/aasc/display/VoiceprintDbCodecTest.kt`：

```kotlin
package com.aasc.display

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceprintDbCodecTest {

    @Test
    fun speakersFromDb_解析多说话人() {
        val db = JSONObject("""
            {"version":2,"dim":512,"speakers":{"妲己":[0.5,0.25,-0.125],"控制端":[1.0,-1.0,0.0]}}
        """.trimIndent())
        val speakers = VoiceprintDbCodec.speakersFromDb(db)
        assertEquals(2, speakers.size)
        assertArrayEquals(floatArrayOf(0.5f, 0.25f, -0.125f), speakers["妲己"], 1e-5f)
        assertArrayEquals(floatArrayOf(1.0f, -1.0f, 0.0f), speakers["控制端"], 1e-5f)
    }

    @Test
    fun speakersFromDb_空库返回空map() {
        val db = JSONObject("""{"version":1,"dim":512,"speakers":{}}""")
        assertTrue(VoiceprintDbCodec.speakersFromDb(db).isEmpty())
    }

    @Test
    fun toJson_与speakersFromDb往返一致() {
        val speakers = linkedMapOf("A" to floatArrayOf(0.1f, 0.2f), "B" to floatArrayOf(-0.3f, 0.4f))
        val json = VoiceprintDbCodec.toJson(speakers)
        val roundTrip = VoiceprintDbCodec.speakersFromDb(json)
        assertEquals(2, roundTrip.size)
        assertArrayEquals(floatArrayOf(0.1f, 0.2f), roundTrip["A"], 1e-6f)
        assertArrayEquals(floatArrayOf(-0.3f, 0.4f), roundTrip["B"], 1e-6f)
    }
}
```

- [ ] **Step 5: 跑测试验证 RED→GREEN**

```bash
cd src/apps/android-display
./gradlew :app:testDebugUnitTest --tests "com.aasc.display.VoiceprintDbCodecTest"   # 先 FAIL（VoiceprintDbCodec 未定义）
# Step 3 已建 VoiceprintDbCodec → 再跑 → PASS
JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/mnt/AASC/src/apps/android-display/app/build/test-tmpdir" ./gradlew :app:testDebugUnitTest
```

- [ ] **Step 6: 写 VoiceprintModelManager**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintModelManager.kt`：

```kotlin
package com.aasc.display

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// 声纹模型管理：embedding（必下）+ segmentation（multiSpeaker 才下），复用 ModelDownloader
class VoiceprintModelManager(
    private val context: Context,
    private val uiHandler: Handler = Handler(Looper.getMainLooper())
) {
    private val modelDir = File(context.filesDir, "models/voiceprint")
    val embeddingFile = File(modelDir, "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx")
    val segmentationFile = File(modelDir, "pyannote_segmentation_3_0_int8.onnx")
    private val downloadPool: ExecutorService = Executors.newSingleThreadExecutor()
    private val lock = Any()

    @Volatile var state: String = "not_ready"; private set
    @Volatile var progress: Int = 0; private set
    @Volatile var lastError: String = ""; private set

    val isReady: Boolean get() = state == "ready"
    val embeddingModelPath: String get() = embeddingFile.absolutePath
    val segmentationModelPath: String get() = segmentationFile.absolutePath

    fun statusJson(): JSONObject = JSONObject()
        .put("state", state).put("progress", progress).put("error", lastError)

    // 幂等触发：ready→"ready"；downloading→"downloading"；否则下载（embedding 必下，segmentation 按 needSegmentation）
    fun ensureModel(baseUrl: String, needSegmentation: Boolean, onModelEvent: (JSONObject) -> Unit): String {
        synchronized(lock) {
            if (state == "ready") return "ready"
            if (state == "downloading") return "downloading"
            state = "downloading"; progress = 0; lastError = ""
        }
        downloadPool.execute {
            try {
                modelDir.mkdirs()
                // 磁盘已有完整模型则跳过下载（下载一次即可，重启不重复拉取）
                val embeddingOk = embeddingFile.isFile && embeddingFile.length() > 5L * 1024 * 1024
                val segOk = !needSegmentation || (segmentationFile.isFile && segmentationFile.length() > 500 * 1024)
                val okEmbedding = embeddingOk || ModelDownloader.download(
                    "$baseUrl/api/voiceprint/model/${embeddingFile.name}", embeddingFile) { p ->
                    progress = p
                    postModelEvent(JSONObject().put("state", "downloading").put("progress", p), onModelEvent)
                }
                val okSegmentation = segOk || ModelDownloader.download(
                    "$baseUrl/api/voiceprint/model/${segmentationFile.name}", segmentationFile) { }
                if (okEmbedding && okSegmentation) {
                    state = "ready"
                    postModelEvent(JSONObject().put("state", "ready"), onModelEvent)
                } else {
                    state = "error"
                    lastError = if (okEmbedding) "分割模型下载失败" else "声纹模型下载失败"
                    postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
                }
            } catch (e: Exception) {
                state = "error"; lastError = e.message ?: "声纹模型下载异常"
                postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
            }
        }
        return "downloading"
    }

    private fun postModelEvent(json: JSONObject, onModelEvent: (JSONObject) -> Unit) {
        uiHandler.post { onModelEvent(json) }
    }
}
```

- [ ] **Step 7: 编译 + 全量单测 + 提交**

```bash
cd src/apps/android-display && ./gradlew :app:compileDebugKotlin
JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/mnt/AASC/src/apps/android-display/app/build/test-tmpdir" ./gradlew :app:testDebugUnitTest
git add src/apps/android-display/app/src/main/java/com/aasc/display/ModelDownloader.kt src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelManager.kt src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintModelManager.kt src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintDbCodec.kt src/apps/android-display/app/src/test/java/com/aasc/display/VoiceprintDbCodecTest.kt
git commit -m "feat(android): ModelDownloader 抽取 + VoiceprintModelManager + VoiceprintDbCodec"
```

---

### Task 7: APK VoiceprintEngine（提取/匹配/多人分割）+ 单测

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintEngine.kt`

**Interfaces:**
- Consumes: `VoiceprintModelManager.embeddingModelPath/segmentationModelPath`（Task 6）、AAR 声纹类
- Produces: `object VoiceprintEngine`（`load(embeddingModel, segmentationModel?, threshold, multiSpeaker): Boolean`、`setDb(Map<String,FloatArray>)`、`extract(samples): FloatArray`、`match(embedding): String?`、`diarize(samples): List<Segment>`、`val ready/dim/speakers`）— Task 8 桥调用

- [ ] **Step 1: 写实现**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintEngine.kt`：

```kotlin
package com.aasc.display

import com.k2fsa.sherpa.onnx.FastClusteringConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarization
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationPyannoteModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingManager
import android.content.Context

// 声纹引擎：特征提取 + 库匹配 + 多人分割（仿 AsrEngine 的 synchronized 防 use-after-free）
object VoiceprintEngine {
    private var extractor: SpeakerEmbeddingExtractor? = null
    private var manager: SpeakerEmbeddingManager? = null
    private var diarization: OfflineSpeakerDiarization? = null
    private var threshold: Float = 0.5f
    private var multiSpeaker: Boolean = false

    @Volatile var ready: Boolean = false; private set
    @Volatile var dim: Int = 0; private set
    @Volatile var speakers: List<String> = emptyList(); private set

    data class Segment(val start: Float, val end: Float, val speakerIndex: Int)

    // 加载引擎；segmentationModel 为 null 或 multiSpeaker=false 时不建 diarization
    fun load(context: Context, embeddingModel: String, segmentationModel: String?, threshold: Float, multiSpeaker: Boolean): Boolean {
        synchronized(this) {
            return try {
                val appContext = context.applicationContext
                extractor?.release()
                extractor = SpeakerEmbeddingExtractor(appContext.assets, SpeakerEmbeddingExtractorConfig(
                    model = embeddingModel, numThreads = 1, debug = false, provider = "cpu"))
                dim = extractor!!.dim()
                manager?.release()
                manager = SpeakerEmbeddingManager(dim)
                if (multiSpeaker && segmentationModel != null) {
                    diarization?.release()
                    diarization = OfflineSpeakerDiarization(appContext.assets, OfflineSpeakerDiarizationConfig(
                        segmentation = OfflineSpeakerSegmentationModelConfig(
                            pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(segmentationModel),
                            numThreads = 1, debug = false, provider = "cpu"),
                        embedding = SpeakerEmbeddingExtractorConfig(
                            model = embeddingModel, numThreads = 1, debug = false, provider = "cpu"),
                        clustering = FastClusteringConfig(numClusters = 0, threshold = 0.5f),
                        minDurationOn = 0.3f, minDurationOff = 0.5f))
                } else {
                    diarization?.release()
                    diarization = null
                }
                this.threshold = threshold
                this.multiSpeaker = multiSpeaker
                ready = true
                true
            } catch (e: Exception) {
                release()
                false
            }
        }
    }

    private fun release() {
        extractor?.release(); extractor = null
        manager?.release(); manager = null
        diarization?.release(); diarization = null
        ready = false
    }

    // 重建声纹库（服务器权威库同步后调用）
    fun setDb(newSpeakers: Map<String, FloatArray>) {
        synchronized(this) {
            val mgr = manager ?: return
            // 全量重建：避免部分删除残留
            for (name in speakers) mgr.remove(name)
            for ((name, emb) in newSpeakers) mgr.add(name, emb)
            speakers = newSpeakers.keys.toList()
        }
    }

    // 提取说话人特征（16k mono Float32 样本 → embedding）
    @Throws(Exception::class)
    fun extract(samples: FloatArray): FloatArray {
        val ex = extractor ?: throw IllegalStateException("声纹引擎未加载")
        if (samples.isEmpty()) throw IllegalArgumentException("音频数据为空")
        val stream = ex.createStream()
        try {
            stream.acceptWaveform(samples, 16000)
            stream.inputFinished()
            return ex.compute(stream)
        } finally {
            stream.release()
        }
    }

    // 匹配声纹库，返回人名；低于 threshold 返回 null
    @Throws(Exception::class)
    fun match(embedding: FloatArray): String? {
        val mgr = manager ?: throw IllegalStateException("声纹库未加载")
        val name = mgr.search(embedding, threshold)
        return if (name.isEmpty()) null else name
    }

    // 多人分割：返回 [start, end] 秒的分段（speakerIndex 为聚类编号，非人名）
    @Throws(Exception::class)
    fun diarize(samples: FloatArray): List<Segment> {
        val dz = diarization ?: throw IllegalStateException("分割模型未加载")
        val segs = dz.process(samples)
        return segs.map { Segment(it.start, it.end, it.speaker) }
    }
}
```

> **API 核对点**：`OfflineSpeakerDiarizationConfig`/`OfflineSpeakerSegmentationModelConfig`/`FastClusteringConfig` 的真实构造参数以 `./gradlew :app:compileDebugKotlin` 报错为准调整具名参数（参考 Task 4 的 AsrEngine 适配先例）。`OfflineSpeakerDiarizationSegment.getStart/getEnd/getSpeaker` 已由 javap 确认。

- [ ] **Step 2: 编译验证**

```bash
cd src/apps/android-display && ./gradlew :app:compileDebugKotlin
```
（若构造签名报错，按报错调整具名参数后重跑直到 BUILD SUCCESSFUL）

- [ ] **Step 3: 提交**

```bash
git add src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintEngine.kt
git commit -m "feat(android): VoiceprintEngine 特征提取/库匹配/多人分割"
```

---

### Task 8: NativeBridge 声纹桥方法 + onVoiceprintDb 回调

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`

**Interfaces:**
- Consumes: `VoiceprintModelManager`/`VoiceprintDbCodec`/`VoiceprintEngine`/`AsrEngine`/`AsrPcm`（Task 6/7/既有）、`serverBaseUrl()`（既有）
- Produces: 6 个桥方法 + `window.onVoiceprintDb` — Task 9/10 消费

- [ ] **Step 1: NativeBridge 加字段**

在 `NativeBridge.kt` 的 `asrModelManager` 字段（约 114 行）之后加：

```kotlin
    // ---- 声纹识别桥（speaker identification / 多人分割）----
    private val voiceprintModelManager = VoiceprintModelManager(webView.context)
    private var voiceprintEnabled = false
    private var voiceprintThreshold = 0.5f
    private var voiceprintMultiSpeaker = false
```

- [ ] **Step 2: 追加 6 个桥方法 + serverBaseUrl 复用**

在 `asrRecognize` 方法（约 236 行）之后追加：

```kotlin
    // 查询声纹引擎状态：{"ready":true|false,"dim":512,"speakers":["妲己"]}
    @JavascriptInterface
    fun voiceprintStatus(): String {
        return try {
            JSONObject()
                .put("ready", VoiceprintEngine.ready)
                .put("dim", VoiceprintEngine.dim)
                .put("speakers", VoiceprintEngine.speakers)
                .toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹状态异常").toString()
        }
    }

    // 配置声纹引擎：{"enabled":bool,"threshold":0.5,"multiSpeaker":bool}；触发模型下载+引擎加载
    // 结果经 window.onVoiceprintModel 回调（downloading/ready/error）
    @JavascriptInterface
    fun voiceprintConfigure(configJson: String): String {
        return try {
            val cfg = org.json.JSONObject(configJson)
            voiceprintEnabled = cfg.optBoolean("enabled", true)
            voiceprintThreshold = cfg.optDouble("threshold", 0.5).toFloat()
            voiceprintMultiSpeaker = cfg.optBoolean("multiSpeaker", true)
            if (!voiceprintEnabled) return JSONObject().put("ok", true).toString()
            val baseUrl = serverBaseUrl()
            if (baseUrl.isEmpty()) return JSONObject().put("error", "无法确定服务器地址").toString()
            voiceprintModelManager.ensureModel(baseUrl, voiceprintMultiSpeaker) { event ->
                if (event.optString("state") == "ready") {
                    val loaded = VoiceprintEngine.load(
                        webView.context, voiceprintModelManager.embeddingModelPath,
                        if (voiceprintMultiSpeaker) voiceprintModelManager.segmentationModelPath else null,
                        voiceprintThreshold, voiceprintMultiSpeaker)
                    event.put("engineReady", loaded)
                }
                val js = "window.onVoiceprintModel && window.onVoiceprintModel(${event.toString()});"
                webView.evaluateJavascript(js, null)
            }
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹配置异常").toString()
        }
    }

    // 单段声纹匹配：裸 PCM base64 → {"speaker":人名|null} 或 {"error":"..."}
    @JavascriptInterface
    fun voiceprintMatch(pcmBase64: String): String {
        return try {
            if (!voiceprintEnabled || !voiceprintModelManager.isReady || !VoiceprintEngine.ready) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
            val samples = AsrPcm.decodeS16(bytes)
            val embedding = asrExecutor.submit { VoiceprintEngine.extract(samples) }.get(20, TimeUnit.SECONDS)
            val speaker = VoiceprintEngine.match(embedding)
            JSONObject().put("speaker", speaker ?: JSONObject.NULL).put("dim", VoiceprintEngine.dim).toString()
        } catch (e: java.util.concurrent.TimeoutException) {
            JSONObject().put("error", "声纹识别超时").toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹识别失败").toString()
        }
    }

    // 多人分割+逐段识别：裸 PCM base64 → {"segments":[{start,end,text,speaker}]} 或 {"error":"..."}
    @JavascriptInterface
    fun voiceprintDiarize(pcmBase64: String): String {
        return try {
            if (!voiceprintEnabled || !voiceprintModelManager.isReady || !VoiceprintEngine.ready) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
            val samples = AsrPcm.decodeS16(bytes)
            val segJson = asrExecutor.submit<java.util.concurrent.Callable<org.json.JSONArray>> {
                val segments = VoiceprintEngine.diarize(samples)
                val arr = org.json.JSONArray()
                for (seg in segments) {
                    val startIdx = (seg.start * 16000).toInt().coerceIn(0, samples.size - 1)
                    val endIdx = (seg.end * 16000).toInt().coerceIn(startIdx + 1, samples.size)
                    val segSamples = samples.copyOfRange(startIdx, endIdx)
                    val text = if (segSamples.size >= 1600) AsrEngine.recognize(segSamples) else ""
                    val emb = VoiceprintEngine.extract(segSamples)
                    val speaker = VoiceprintEngine.match(emb)
                    arr.put(org.json.JSONObject()
                        .put("start", seg.start.toDouble())
                        .put("end", seg.end.toDouble())
                        .put("text", text)
                        .put("speaker", speaker ?: JSONObject.NULL))
                }
                arr
            }.get(30, TimeUnit.SECONDS)
            JSONObject().put("segments", segJson).toString()
        } catch (e: java.util.concurrent.TimeoutException) {
            JSONObject().put("error", "多人分割超时").toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "多人分割失败").toString()
        }
    }

    // 声纹特征提取（register display 模式中转用）：裸 PCM base64 → {"dim":512,"embedding":[...]} 或 {"error":"..."}
    @JavascriptInterface
    fun voiceprintExtract(pcmBase64: String): String {
        return try {
            if (!voiceprintModelManager.isReady || !VoiceprintEngine.ready) {
                return JSONObject().put("error", "模型未就绪").toString()
            }
            val bytes = Base64.decode(pcmBase64, Base64.DEFAULT)
            val samples = AsrPcm.decodeS16(bytes)
            val embedding = asrExecutor.submit { VoiceprintEngine.extract(samples) }.get(20, TimeUnit.SECONDS)
            val arr = org.json.JSONArray()
            for (v in embedding) arr.put(v.toDouble())
            JSONObject().put("dim", embedding.size).put("embedding", arr).toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "声纹提取失败").toString()
        }
    }

    // 重建本地声纹库（幂等）：display.html 已用 fetch 拉取权威库 JSON（WebView 信任自签名证书），
    // Kotlin 侧只负责解析+重建；结果触发 window.onVoiceprintDb
    @JavascriptInterface
    fun voiceprintSyncDb(dbJson: String): String {
        return try {
            val db = org.json.JSONObject(dbJson)
            val speakers = VoiceprintDbCodec.speakersFromDb(db)
            VoiceprintEngine.setDb(speakers)
            val msg = JSONObject().put("state", "ready").put("speakers", speakers.keys.toList())
            val js = "window.onVoiceprintDb && window.onVoiceprintDb(${msg.toString()});"
            webView.evaluateJavascript(js, null)
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) {
            val msg = JSONObject().put("state", "error").put("error", e.message ?: "声纹库同步失败")
            val js = "window.onVoiceprintDb && window.onVoiceprintDb(${msg.toString()});"
            webView.evaluateJavascript(js, null)
            JSONObject().put("error", e.message ?: "声纹库同步失败").toString()
        }
    }
```

- [ ] **Step 3: 编译验证**

```bash
cd src/apps/android-display && ./gradlew :app:compileDebugKotlin
```
（若 `OfflineSpeakerDiarizationConfig` 等 diarization 构造签名与 AAR 有出入，参照 Task 4 的 AsrEngine 适配先例，以编译报错为准调整具名参数直到 BUILD SUCCESSFUL）

- [ ] **Step 4: 提交**

```bash
git add src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt
git commit -m "feat(android): NativeBridge 声纹桥方法（match/diarize/extract/configure/status/syncDb）+ onVoiceprintDb"
```

---

### Task 9: display.html 接入声纹

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`

**Interfaces:**
- Consumes: NativeBridge 6 声纹桥方法 + `onVoiceprintModel`/`onVoiceprintDb` 回调（Task 8）、服务器 WS `voiceprintConfig`/`speakerDbUpdated`/`voiceprintExtract` 消息（Task 2/3/4）
- Produces: `voiceprintAvailable`/`voiceprintEnabled`/`voiceprintReady` 状态、`asrResult` 携带 speaker/segments、register display 模式中转、自录音路径带 speaker

- [ ] **Step 1: 全局常量与回调**

在 `display.html` 约 95 行（`let nativeAsrReady = false;` 之后）加：

```js
        // APK 原生声纹引擎：检测到桥方法即认为可用
        const nativeVoiceprintAvailable = !!(window.NativeDisplay && window.NativeDisplay.voiceprintMatch);
        let voiceprintEnabled = false;
        let voiceprintReady = false;
        let voiceprintMultiSpeaker = true;

        // 声纹模型下载/引擎加载事件（NativeBridge voiceprintConfigure 触发）
        window.onVoiceprintModel = function(payload) {
            if (!payload) return;
            if (payload.state === 'ready' && payload.engineReady) {
                voiceprintReady = true;
                updateVoiceTextDisplay('声纹引擎已就绪', true);
                setTimeout(() => updateVoiceTextDisplay('', true), 2000);
            } else if (payload.state === 'error') {
                voiceprintReady = false;
                updateVoiceTextDisplay('声纹模型下载失败: ' + (payload.error || '未知错误'), true);
                setTimeout(() => updateVoiceTextDisplay('', true), 4000);
            }
        };

        // 声纹库同步结果（NativeBridge voiceprintSyncDb 触发）
        window.onVoiceprintDb = function(payload) {
            if (!payload) return;
            if (payload.state === 'ready') {
                voiceprintReady = true;
                const n = (payload.speakers || []).length;
                console.log('[声纹] 声纹库已同步', n, '人');
            } else if (payload.state === 'error') {
                voiceprintReady = false;
                console.warn('[声纹] 声纹库同步失败:', payload.error);
            }
        };
```

- [ ] **Step 2: detectCapabilities 加 voiceprintAvailable**

在 `detectCapabilities` 的返回对象里（`crossOriginControlDegraded` 之后，约 2664 行）加：

```js
                voiceprintAvailable: nativeVoiceprintAvailable,
```

- [ ] **Step 3: 处理 voiceprintConfig / speakerDbUpdated / voiceprintExtract WS 消息**

在 `display.html` 的 WS 消息处理链里，`data.type === 'asrConfig'` 分支（约 2573 行）之前加：

```js
                    if (data.type === 'voiceprintConfig') {
                        voiceprintEnabled = !!data.enabled;
                        voiceprintMultiSpeaker = !!data.multiSpeaker;
                        if (nativeVoiceprintAvailable) {
                            nativeBridge.voiceprintConfigure(JSON.stringify({
                                enabled: voiceprintEnabled,
                                threshold: data.threshold || 0.5,
                                multiSpeaker: voiceprintMultiSpeaker
                            }));
                            if (voiceprintEnabled) {
                                // 拉取权威库重建本地声纹库（WebView 信任自签名证书，走 fetch）
                                fetch('/api/voiceprint/db')
                                    .then(r => r.json())
                                    .then(db => nativeBridge.voiceprintSyncDb(JSON.stringify(db)))
                                    .catch(e => console.warn('[声纹] 拉取声纹库失败:', e));
                            }
                        }
                        return;
                    }

                    if (data.type === 'speakerDbUpdated') {
                        // 声纹库变更 → 重拉重建（静默，不打扰）
                        if (nativeVoiceprintAvailable && voiceprintEnabled) {
                            fetch('/api/voiceprint/db')
                                .then(r => r.json())
                                .then(db => nativeBridge.voiceprintSyncDb(JSON.stringify(db)))
                                .catch(e => console.warn('[声纹] 重拉声纹库失败:', e));
                        }
                        return;
                    }

                    if (data.type === 'voiceprintExtract') {
                        // register display 模式：中转提取 → 回传 embedding
                        if (nativeVoiceprintAvailable) {
                            try {
                                const res = JSON.parse(nativeBridge.voiceprintExtract(data.audioBase64));
                                if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                                    displayWs.send(JSON.stringify({
                                        type: 'voiceprintExtracted',
                                        requestId: data.requestId,
                                        embedding: res.embedding || [],
                                        error: res.error || ''
                                    }));
                                }
                            } catch (e) {
                                if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                                    displayWs.send(JSON.stringify({
                                        type: 'voiceprintExtracted',
                                        requestId: data.requestId,
                                        embedding: [],
                                        error: e.message
                                    }));
                                }
                            }
                        } else {
                            if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                                displayWs.send(JSON.stringify({
                                    type: 'voiceprintExtracted',
                                    requestId: data.requestId,
                                    embedding: [],
                                    error: '声纹桥不可用'
                                }));
                            }
                        }
                        return;
                    }
```

- [ ] **Step 4: handleAsrAudio 原生路径加声纹分派**

将 `handleAsrAudio`（约 2991 行）中原生路径的 `asrRecognize` 调用段替换为（保留未就绪分支不变，只改就绪后的识别段）：

```js
                try {
                    const pcmBase64 = await decodeAudioToPcmBase64(data.audioData);
                    // 声纹分派：enabled+ready → 按 multiSpeaker 走单段匹配或多人分割；否则纯 ASR（speaker 缺省放行）
                    if (nativeVoiceprintAvailable && voiceprintEnabled && voiceprintReady) {
                        if (voiceprintMultiSpeaker) {
                            const res = JSON.parse(nativeBridge.voiceprintDiarize(pcmBase64));
                            if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                                displayWs.send(JSON.stringify({
                                    type: 'asrResult',
                                    requestId: data.requestId,
                                    segments: res.segments || [],
                                    error: res.error || ''
                                }));
                            }
                        } else {
                            const res = JSON.parse(nativeBridge.asrRecognize(pcmBase64));
                            const vp = JSON.parse(nativeBridge.voiceprintMatch(pcmBase64));
                            const msg = {
                                type: 'asrResult',
                                requestId: data.requestId,
                                text: res.text || '',
                                error: res.error || vp.error || ''
                            };
                            // speaker 语义：vp.error → 声纹未就绪/不可用 → 不带 speaker（放行）；vp.speaker null → 可用但未匹配 → speaker:null（拦截）
                            if (!vp.error) msg.speaker = vp.speaker || null;
                            if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                                displayWs.send(JSON.stringify(msg));
                            }
                        }
                    } else {
                        const res = JSON.parse(nativeBridge.asrRecognize(pcmBase64));
                        if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                            displayWs.send(JSON.stringify({
                                type: 'asrResult',
                                requestId: data.requestId,
                                text: res.text || '',
                                error: res.error || ''
                            }));
                        }
                    }
                } catch (e) {
```

- [ ] **Step 5: 自录音路径 sendAudioForRecognition 带 speaker / 逐段下发**

将 `sendAudioForRecognition`（约 3425 行）的 success 分支替换为：

```js
                if (data.status === 'success') {
                    // 多人分割：逐段独立触发命令（只含已识别声纹的段）
                    if (data.segments && data.segments.length) {
                        for (const seg of data.segments) {
                            const segText = (seg.text || '').trim();
                            if (!segText) continue;
                            console.log('显示端分段识别:', segText, '->', seg.speaker);
                            if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                                displayWs.send(JSON.stringify({
                                    type: 'voiceInput',
                                    text: segText,
                                    isFinal: true,
                                    fullText: segText,
                                    speaker: seg.speaker
                                }));
                            }
                        }
                        return;
                    }
                    if (!data.text) return;
                    const recognizedText = data.text.trim();
                    console.log('显示端识别结果:', recognizedText);

                    consecutiveIgnoreCount = 0;

                    updateVoiceTextDisplay(recognizedText, true);

                    if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                        const msg = {
                            type: 'voiceInput',
                            text: recognizedText,
                            isFinal: true,
                            fullText: recognizedText
                        };
                        if (data.speaker !== undefined) msg.speaker = data.speaker;
                        displayWs.send(JSON.stringify(msg));
                    }

                    setTimeout(() => {
                        updateVoiceTextDisplay('', true);
```

- [ ] **Step 6: 验证（语法 + 服务器重启回归）**

```bash
# 抽取内联 script 语法检查
awk 'NR>=42 && NR<=3944' src/apps/web-mediacenter/ui/public/display.html > /tmp/display-voiceprint.js
node --check /tmp/display-voiceprint.js   # SYNTAX OK
# 服务器已加载 voiceprint 路由（Task 1-5），重启一次确保 display.html 静态文件最新（APK 轮询 mtime）
node --check src/apps/server/boot/server-app.js
```

- [ ] **Step 7: 提交**

```bash
git add src/apps/web-mediacenter/ui/public/display.html
git commit -m "feat(display): display.html 声纹接入（能力/分派/中转/逐段命令/库同步）"
```

---

### Task 10: 控制端声纹管理面板 + chat.js 带 speaker

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Create: `src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/chat.js`

**Interfaces:**
- Consumes: `POST /api/voiceprint/register`、`GET /api/voiceprint/db`、`POST /api/voiceprint/remove`、`GET/POST /api/voiceprint/config`（Task 2/3/4）；`/api/asr/recognize` 返回 segments/speaker（Task 5）
- Produces: 控制端声纹管理 UI + 配置切换；chat.js 语音输入带 speaker/逐段

- [ ] **Step 1: upload.html 加声纹导航项**

在 `upload.html` 侧栏 nav（`data-target="task"` 按钮之后，约 61 行）加：

```html
            <button class="nav-item" data-target="voiceprint" title="声纹管理">🔊</button>
```

在对应 panel 容器区（参照现有 panel 结构）加面板容器（位置：任一个既有 `id="panel-task"` 附近）：

```html
            <div class="panel" id="panel-voiceprint" style="display:none;">
                <h2>声纹管理</h2>
                <div class="control-item">
                    <label>注册声纹</label>
                    <input type="text" id="vpNameInput" placeholder="输入名字（如：妲己）"
                        style="width:100%;padding:8px;margin-bottom:8px;box-sizing:border-box;">
                    <div class="control-buttons">
                        <button class="control-btn" id="vpRecordBtn" onclick="VoiceprintPanel.toggleRecord()">🎤 录音注册</button>
                        <button class="control-btn" id="vpStopBtn" onclick="VoiceprintPanel.stopRecord()" style="display:none;">停止</button>
                    </div>
                    <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.5);">
                        <span id="vpRecordStatus">输入名字后录音 3-10 秒</span>
                    </div>
                </div>
                <div class="control-item">
                    <label>已注册声纹</label>
                    <div id="vpSpeakerList"></div>
                </div>
                <div class="control-item">
                    <label>声纹识别设置</label>
                    <div style="margin-top:6px;font-size:13px;">
                        <label><input type="checkbox" id="vpEnabledCheck"> 启用声纹识别（只处理识别到声纹的语音）</label><br>
                        <label style="margin-top:4px;display:inline-block;"><input type="checkbox" id="vpMultiCheck"> 多人分割（一句话多个说话人逐段归属）</label>
                    </div>
                    <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.5);">
                        声纹提取位置：<select id="vpExtractionSel">
                            <option value="server">服务器</option>
                            <option value="display">显示端</option>
                        </select>
                    </div>
                </div>
            </div>
```

- [ ] **Step 2: 写 voiceprint-panel.js**

创建 `src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js`：

```js
// 控制端声纹管理面板：注册/列表/删除/配置切换
(function() {
    'use strict';
    const panel = {
        recording: false,
        mediaRecorder: null,
        audioChunks: [],
        speakers: {},

        init() {
            document.getElementById('vpNameInput').addEventListener('keydown', e => {
                if (e.key === 'Enter') this.toggleRecord();
            });
            document.getElementById('vpEnabledCheck').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpMultiCheck').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpExtractionSel').addEventListener('change', () => this.saveConfig());
            this.loadConfig();
            this.refreshList();
        },

        async loadConfig() {
            try {
                const r = await fetch('/api/voiceprint/config');
                const c = await r.json();
                document.getElementById('vpEnabledCheck').checked = !!c.enabled;
                document.getElementById('vpMultiCheck').checked = !!c.multiSpeaker;
                document.getElementById('vpExtractionSel').value = c.extraction || 'server';
            } catch (e) { console.warn('加载声纹配置失败:', e); }
        },

        async saveConfig() {
            const body = {
                enabled: document.getElementById('vpEnabledCheck').checked,
                multiSpeaker: document.getElementById('vpMultiCheck').checked,
                extraction: document.getElementById('vpExtractionSel').value
            };
            try {
                await fetch('/api/voiceprint/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            } catch (e) { console.warn('保存声纹配置失败:', e); }
        },

        async toggleRecord() {
            if (this.recording) { this.stopRecord(); return; }
            const name = document.getElementById('vpNameInput').value.trim();
            if (!name) {
                document.getElementById('vpRecordStatus').textContent = '请先输入名字';
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.mediaRecorder = new MediaRecorder(stream);
                this.audioChunks = [];
                this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.audioChunks.push(e.data); };
                this.mediaRecorder.onstop = () => this.register(name);
                this.mediaRecorder.start();
                this.recording = true;
                document.getElementById('vpRecordBtn').textContent = '录音中...点击停止';
                document.getElementById('vpStopBtn').style.display = '';
                document.getElementById('vpRecordStatus').textContent = '正在录音，请说出要注册的声音';
                stream.getTracks().forEach(t => t.addEventListener('ended', () => {
                    if (this.recording) this.stopRecord();
                }));
            } catch (e) {
                document.getElementById('vpRecordStatus').textContent = '录音失败: ' + e.message;
            }
        },

        stopRecord() {
            if (!this.recording) return;
            this.recording = false;
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') this.mediaRecorder.stop();
            if (this.mediaRecorder && this.mediaRecorder.stream) {
                this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
            }
            document.getElementById('vpRecordBtn').textContent = '🎤 录音注册';
            document.getElementById('vpStopBtn').style.display = 'none';
        },

        async register(name) {
            document.getElementById('vpRecordStatus').textContent = '正在注册...';
            try {
                const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('name', name);
                formData.append('audio', blob, 'voiceprint.webm');
                const r = await fetch('/api/voiceprint/register', { method: 'POST', body: formData });
                const data = await r.json();
                document.getElementById('vpRecordStatus').textContent = data.message || (data.status === 'success' ? '注册成功' : '注册失败');
                if (data.status === 'success') this.refreshList();
            } catch (e) {
                document.getElementById('vpRecordStatus').textContent = '注册失败: ' + e.message;
            }
        },

        async refreshList() {
            try {
                const r = await fetch('/api/voiceprint/db');
                const db = await r.json();
                this.speakers = db.speakers || {};
                const list = document.getElementById('vpSpeakerList');
                const names = Object.keys(this.speakers);
                if (names.length === 0) {
                    list.innerHTML = '<span style="font-size:12px;color:rgba(255,255,255,0.4);">暂无已注册声纹</span>';
                    return;
                }
                list.innerHTML = names.map(n =>
                    '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08);">' +
                    '<span>' + n + '</span>' +
                    '<button class="control-btn" onclick="VoiceprintPanel.remove(\'' + n.replace(/'/g, "\\'") + '\')">删除</button>' +
                    '</div>'
                ).join('');
            } catch (e) { console.warn('加载声纹列表失败:', e); }
        },

        async remove(name) {
            if (!confirm('确认删除 ' + name + ' 的声纹？')) return;
            try {
                await fetch('/api/voiceprint/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                this.refreshList();
            } catch (e) { console.warn('删除声纹失败:', e); }
        }
    };

    window.VoiceprintPanel = panel;
    // 面板切换到 voiceprint 时初始化
    document.addEventListener('DOMContentLoaded', () => {
        const observer = new MutationObserver(() => {
            const vp = document.getElementById('panel-voiceprint');
            if (vp && vp.style.display !== 'none') {
                panel.init();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });
        // 若已可见则直接初始化
        const vp = document.getElementById('panel-voiceprint');
        if (vp && vp.style.display !== 'none') panel.init();
    });
})();
```

在 `upload.html` 的 `</body>` 前引入脚本：

```html
    <script src="js/voiceprint-panel.js"></script>
```

- [ ] **Step 3: chat.js 语音识别带 speaker / 逐段**

将 `chat.js` 的 `sendAudioForRecognition` 成功分支（约 247 行）替换为：

```js
            if (data.status === 'success') {
                // 多人分割：逐段处理（每段可能是一条命令或聊天）
                if (data.segments && data.segments.length) {
                    for (const seg of data.segments) {
                        const segText = (seg.text || '').trim();
                        if (!segText) continue;
                        console.log('分段识别:', segText, '->', seg.speaker);
                        if (segText.startsWith('聊天')) {
                            const message = segText.substring(2).trim();
                            if (message) {
                                setTimeout(() => { this.sendVoiceMessage(message); }, 300);
                            }
                        } else {
                            this.handleAsrCommand(segText, seg.speaker);
                        }
                    }
                    return;
                }
                if (!data.text) return;
                const recognizedText = data.text.trim();
                console.log('识别结果:', recognizedText);

                if (input) {
                    input.value = recognizedText;
                }

                if (recognizedText.startsWith('聊天')) {
                    const message = recognizedText.substring(2).trim();
                    if (message) {
                        setTimeout(() => {
                            this.sendVoiceMessage(message);
                        }, 300);
                    }
                } else {
                    this.handleAsrCommand(recognizedText, data.speaker);
                }
            }
```

并新增 `handleAsrCommand`（在类内）：

```js
        // 处理非"聊天"开头的识别结果（语音命令），带 speaker 归属
        handleAsrCommand(text, speaker) {
            // 经服务器 voiceCommand 链路（广播已有逻辑），speaker 由服务器门控
            if (window.WebSocket) {
                // 若控制端有 WS 通道可发送语音命令则在此扩展；无则走现有 fetch 链路
                console.log('[语音命令]', text, speaker ? '（' + speaker + '）' : '');
            }
        }
```

> **实现提示**：若 chat.js 现有代码对非"聊天"文本已有处理逻辑（如调用某个 command API），`handleAsrCommand` 应复用该逻辑，仅补 `speaker` 归属；`console.log` 为占位示意，需按实际代码接合。

- [ ] **Step 4: 语法验证 + 页面加载**

```bash
node --check src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js
node --check src/apps/web-mediacenter/ui/public/js/chat.js
# 浏览器打开 upload.html → 切到声纹面板 → 录音注册/列表/删除/配置切换
```

- [ ] **Step 5: 提交**

```bash
git add src/apps/web-mediacenter/ui/public/upload.html src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js src/apps/web-mediacenter/ui/public/js/chat.js
git commit -m "feat(control): 声纹管理面板（注册/列表/删除/配置）+ chat.js 语音带 speaker/逐段"
```

---

### Task 11: 文档同步（spec 伪代码 + changelog + 索引）

**Files:**
- Create: `docs/spec/voiceprint.md`
- Modify: `docs/spec.md`、`changelog.md`

**Interfaces:**
- Consumes: 前序任务全部完成
- Produces: 符合项目规则的实现文档

- [ ] **Step 1: 写 spec 伪代码文档**

创建 `docs/spec/voiceprint.md`，结构参照 `docs/spec/android-native-asr.md`，内容为：

```markdown
# Android 显示端原生声纹识别实现文档（伪代码）

## 桥接口（window.NativeDisplay）

```
voiceprintStatus() -> String JSON          # {"ready":bool,"dim":512,"speakers":["妲己"]}
voiceprintConfigure(configJson) -> String  # {"enabled":bool,"threshold":0.5,"multiSpeaker":bool}；触发模型下载+引擎加载；异步经 onVoiceprintModel 回调
voiceprintMatch(pcmBase64) -> String JSON  # 单段匹配：{"speaker":人名|null} 或 {"error":""}；同步阻塞≤20s
voiceprintDiarize(pcmBase64) -> String JSON# 多人分割：{"segments":[{start,end,text,speaker}]} 或 {"error":""}；同步阻塞≤30s
voiceprintExtract(pcmBase64) -> String JSON# 注册中转：{"dim":512,"embedding":[...]} 或 {"error":""}
voiceprintSyncDb(dbJson) -> String         # 接收 display.html 拉取的权威库 JSON，重建本地库；结果经 onVoiceprintDb 回调
window.onVoiceprintModel({state,progress,error,engineReady})  # 模型下载/引擎加载
window.onVoiceprintDb({state:'ready'|'error', speakers, error})  # 声纹库同步结果
```

## VoiceprintDbCodec（纯逻辑，JVM 单测）

```
speakersFromDb(dbJson) -> Map<String,FloatArray>  # 解析 {version,dim,speakers:{name:[...]}}
toJson(speakers) -> JSONObject                    # 序列化
```

## VoiceprintModelManager（Kotlin）

```
模型: embedding 3dspeaker eres2net(512维, 必下) + segmentation pyannote int8(multiSpeaker 才下)
ensureModel(baseUrl, needSegmentation, onEvent):
  ready/downloading 短路；后台线程 ModelDownloader.download（SSL-trust）→ ready|error
```

## VoiceprintEngine（Kotlin 单例，synchronized）

```
load(context, embeddingModel, segmentationModel?, threshold, multiSpeaker) -> Boolean
  # SpeakerEmbeddingExtractor + SpeakerEmbeddingManager(dim) + 可选 OfflineSpeakerDiarization
setDb(speakers: Map<String,FloatArray>)  # 全量重建 manager
extract(samples) -> FloatArray           # createStream → acceptWaveform(16000) → inputFinished → compute → stream.release
match(embedding) -> String?              # manager.search(embedding, threshold)；低于 threshold → null
diarize(samples) -> [{start,end,speakerIndex}]  # OfflineSpeakerDiarization.process
```

## NativeBridge（6 桥方法）

```
voiceprintStatus()            → VoiceprintEngine.ready/dim/speakers
voiceprintConfigure(json)     → 存 enabled/threshold/multiSpeaker → voiceprintModelManager.ensureModel{ ready 时 VoiceprintEngine.load }
voiceprintMatch(pcm)          → 未就绪回 error；Base64.decode→AsrPcm.decodeS16→extract→match → {speaker|null,dim}
voiceprintDiarize(pcm)        → diarize→每段切片(≥1600样本)→AsrEngine.recognize+extract+match → {segments:[{start,end,text,speaker}]}
voiceprintExtract(pcm)        → extract → {dim, embedding:[]}
voiceprintSyncDb(dbJson)      → VoiceprintDbCodec.speakersFromDb→VoiceprintEngine.setDb→onVoiceprintDb
```

## display.html（接入点）

```
全局: nativeVoiceprintAvailable/nativeVoiceprintEnabled/nativeVoiceprintReady/nativeVoiceprintMultiSpeaker
onVoiceprintModel: ready+engineReady → voiceprintReady=true；error → false
onVoiceprintDb: ready → voiceprintReady=true，log 人数
detectCapabilities: voiceprintAvailable = nativeVoiceprintAvailable
WS voiceprintConfig → 存 enabled/multiSpeaker → voiceprintConfigure + fetch('/api/voiceprint/db')→voiceprintSyncDb
WS speakerDbUpdated → fetch db → voiceprintSyncDb（静默）
WS voiceprintExtract → voiceprintExtract(audioBase64) → 回 voiceprintExtracted{embedding}
handleAsrAudio 原生路径:
  voiceprint enabled+ready:
    multiSpeaker → voiceprintDiarize → asrResult{segments}
    单段 → asrRecognize + voiceprintMatch → asrResult{text, speaker: vp.error?缺省: (vp.speaker||null)}
  否则 → 纯 asrRecognize → asrResult{text}（speaker 缺省放行）
sendAudioForRecognition:
  data.segments → 逐段发 voiceInput{text, speaker}
  data.speaker !== undefined → voiceInput 带 speaker
```

## 服务器（server-app.js）

```
GET  /api/voiceprint/model/<file>       # 白名单 {embedding, pyannote int8}；流式 + Content-Length + error/close 清理
GET  /api/voiceprint/config             # {enabled, extraction, threshold, multiSpeaker}
POST /api/voiceprint/config             # 校验 + 保存 + 广播 voiceprintConfig
GET  /api/voiceprint/db                 # {version, dim, speakers}
POST /api/voiceprint/remove             # 删除某 name 声纹
POST /api/voiceprint/register           # multipart(audio+name)；extraction='server'→voiceprint-service 提取 / 'display'→中转 APK
WS  voiceprintExtract(requestId, audioBase64) → APK 回 voiceprintExtracted{embedding}
WS  speakerDbUpdated                     # 库变更广播
asrResult resolve 升级: {text, speaker?, segments?}
/api/asr/recognize display 分支:
  segments → 过滤 speaker null 段 → 空 ignored / 有则 {status:'success', segments:[{text,speaker}]}
  speaker 字段存在且 null → ignored('未识别到已注册声纹')；非 null → success{text,speaker}；缺省 → success{text}
voiceInput: speaker===null → 丢弃（防御性）；否则转发（带 speaker）
```

## voiceprint-service（服务器，extraction='server' 注册用）

```
懒加载 SpeakerEmbeddingExtractor(3dspeaker eres2net) → extractEmbedding(audioPath) → Array(512)
```

## 控制端（upload.html + voiceprint-panel.js）

```
输入名字 + getUserMedia 录音(3-10s) → POST /api/voiceprint/register → 列表刷新
GET /api/voiceprint/db → 列表显示 + 删除
GET/POST /api/voiceprint/config → enabled/multiSpeaker/extraction 切换
chat.js: sendAudioForRecognition → data.segments 逐段 / data.speaker 归属
```

## 数据流

```
识别（单段）: 录音→/api/asr/recognize→asrAudio→display.html [asrRecognize+voiceprintMatch]
  → asrResult{text,speaker}→服务器: speaker null→ignored；非 null→success{text,speaker}→上传端 voiceInput{text,speaker}→voiceCommand
识别（多人）: asrAudio→voiceprintDiarize→asrResult{segments}→服务器过滤 null 段
  → success{segments:[{text,speaker}]}→上传端逐段 voiceInput→逐段命令
注册（server）: 控制端录音→/api/voiceprint/register→voiceprint-service 提取→store.add→持久化+广播
注册（display）: 控制端录音→register→中转 APK voiceprintExtract→回 embedding→store.add→广播
库同步: APK connect/变更→fetch /api/voiceprint/db→voiceprintSyncDb→本地重建
```
```

- [ ] **Step 2: 更新 spec 索引**

`docs/spec.md` 功能模块表加一行：

```markdown
| Android 原生声纹识别 | [voiceprint.md](spec/voiceprint.md) | 说话人识别、多人分割、服务器权威库、声纹门控 |
```

- [ ] **Step 3: 更新 changelog.md**

追加变更记录（参照现有条目格式）：

```markdown
## [2026-08-16] Android 原生声纹识别（说话人识别 + 多人分割）
- 新增：APK VoiceprintEngine（embedding 提取/库匹配/OfflineSpeakerDiarization 多人分割）
- 新增：NativeBridge 6 声纹桥方法 + onVoiceprintModel/onVoiceprintDb 回调
- 新增：VoiceprintModelManager 模型按需下载（embedding 3d-speaker eres2net 512维 / pyannote int8）
- 新增：ModelDownloader 抽取共享（SSL-trust 自签名证书下载）
- 新增：服务器 voiceprint 权威库（持久化 db.json + speakerDbUpdated 广播）+ 注册/配置/模型下载接口
- 新增：voiceprint.extraction 可配置（server 提取 / display 中转 APK 提取）
- 新增：/api/asr/recognize 返回 speaker/segments 升级 + voiceInput 声纹门控（只处理声纹语音）
- 新增：控制端声纹管理面板（注册/列表/删除/配置）+ chat.js 语音带 speaker/逐段命令
- 识别链路：asrResult{text,speaker} / {segments:[{text,speaker,start,end}]}；speaker 缺省放行、null 拦截
- 改动文件：
  - src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintEngine.kt（新增）
  - src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintModelManager.kt（新增）
  - src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintDbCodec.kt（新增）
  - src/apps/android-display/app/src/main/java/com/aasc/display/ModelDownloader.kt（新增）
  - src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelManager.kt（downloadFile 委托 ModelDownloader）
  - src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt（6 声纹桥方法）
  - src/apps/web-mediacenter/ui/public/display.html（声纹接入）
  - src/apps/web-mediacenter/ui/public/upload.html + js/voiceprint-panel.js（控制端面板）
  - src/apps/web-mediacenter/ui/public/js/chat.js（语音带 speaker/逐段）
  - src/apps/server/boot/server-app.js（voiceprint 接口 + asrResult 升级 + 门控）
  - src/apps/server/modules/voiceprint/voiceprint-store.js（新增）
  - src/apps/server/modules/voiceprint/voiceprint-service.js（新增）
  - src/external/asr/asr-service.js（导出 readWavFile）
  - res/models/voiceprint/（embedding + segmentation 模型）
  - config/config.json（voiceprint 配置）
  - docs/spec/voiceprint.md（新增）
```

- [ ] **Step 4: 提交**

```bash
git add docs/spec/voiceprint.md docs/spec.md changelog.md
git commit -m "docs: 声纹识别实现文档 + changelog + spec 索引"
```

---

## 自审

- **Spec 覆盖**：设计文档全部有对应任务——模型（T1）、配置（T2）、权威库（T3）、注册双模式（T4）、服务器 asrResult 升级+门控（T5）、APK 模型/库（T6）、VoiceprintEngine（T7）、桥方法（T8）、display.html（T9）、控制端面板+chat.js（T10）、文档（T11）。
- **占位符扫描**：除 Task 10 的 `handleAsrCommand` 标注了"按实际代码接合"（chat.js 现有非聊天命令处理需实现者接合，合理验证点）外，所有代码步骤完整。Task 7 标注 AAR diarization 构造参数以编译报错为准调整（同 AsrEngine 先例）。
- **类型一致性**：`VoiceprintEngine.load(context, embeddingModel, segmentationModel?, threshold, multiSpeaker)`（T7）与 T8 `voiceprintConfigure` 调用一致；`VoiceprintEngine.extract/match/diarize` 签名跨 T8 使用一致；`asrResult` 对象 `{text, speaker?, segments?}` 在 T5 服务器与 T9 display.html 两侧一致；`segments:[{start,end,text,speaker}]` 桥输出与服务器消费一致。
- **关键语义一致**：`speaker` 三态（缺省/ null / 人名）在 T5（服务器）、T9（display.html）、T8（桥）三处一致——缺省放行、null 拦截、人名放行+归属。

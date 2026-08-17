// 声纹权威库：内存持库 + res/voiceprint/db.json 持久化（防抖落盘）+ 变更回调
const fs = require('fs');
const path = require('path');

// 从 src/apps/server/modules/voiceprint 上溯 5 级到达项目根目录 /mnt/AASC，
// 再进入 res/voiceprint/db.json（真实 res 在根目录，不在 src 下）。
const DB_PATH = path.join(__dirname, '../../../../../res/voiceprint/db.json');
// 声纹维度：必须与 embedding 模型实际输出维度一致。
// 3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx 真实输出为 512 维
//（onnxruntime 检查 output Gemmembedding_dim_0=512；sherpa-onnx SpeakerEmbeddingExtractor.dim 亦返回 512）。
// 注意：早期设计文档误记为 192 维，实际模型为 512，APK 端 SpeakerEmbeddingManager(dim) 必须用 512。
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
                // 防御性归一化：跳过原型链危险键（__proto__/constructor/prototype）防止原型污染，
                // 其余值即使持久化文件里混入类对象数据（如 {0:1,1:2}）也转回普通数组。
                const safe = {};
                for (const k of Object.keys(raw.speakers)) {
                    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
                    safe[k] = Array.from(raw.speakers[k] || []);
                }
                this.speakers = safe;
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
        // 拒绝原型链危险名，防止 __proto__/constructor/prototype 污染 speakers 容器
        if (name === '__proto__' || name === 'constructor' || name === 'prototype') return false;
        // 归一化为普通数组：Float32Array 经 JSON.stringify 会变成对象 {0:1,1:2,...} 而非数组，
        // 破坏 [192 floats] 数组契约（影响 getDb 载荷与 APK 同步）；Array.from 对普通数组只是复制。
        this.speakers[name] = Array.from(embeddingArray);
        this.version++;
        this._scheduleSave();
        this._notify();
    }

    remove(name) {
        // 用 hasOwnProperty 判断自身属性，避免 'toString' 等原型方法被误判为已存在
        if (!Object.prototype.hasOwnProperty.call(this.speakers, name)) return false;
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

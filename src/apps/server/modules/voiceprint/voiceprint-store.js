// 声纹权威库：内存持库 + res/voiceprint/db.json 持久化（防抖落盘）+ 变更回调
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../../res/voiceprint/db.json');
const VOICEPRINT_DIM = 192;
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

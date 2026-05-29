const fs = require('fs');
const path = require('path');

class LogFileWriter {
    constructor(logDir) {
        this.logDir = logDir;
        this._buffer = [];
        this._flushing = false;

        fs.mkdirSync(this.logDir, { recursive: true });
        this._rotate();
        this._flushTimer = setInterval(() => this._flush(), 10000);
    }

    _rotate() {
        const cur = path.join(this.logDir, 'server.jsonl');
        const bak = path.join(this.logDir, 'server.1.jsonl');

        try {
            if (fs.existsSync(bak)) fs.unlinkSync(bak);
        } catch (e) {}

        try {
            if (fs.existsSync(cur)) fs.renameSync(cur, bak);
        } catch (e) {}
    }

    add(entry) {
        const line = JSON.stringify({
            id: entry.id,
            ts: entry.timestamp,
            cat: entry.category,
            lvl: entry.level,
            dev: entry.device,
            src: entry.source || null,
            msg: entry.message
        }) + '\n';

        this._buffer.push(line);
        if (this._buffer.length >= 50) {
            this._flush();
        }
    }

    _flush() {
        if (this._flushing || this._buffer.length === 0) return;
        this._flushing = true;

        const lines = this._buffer.splice(0, this._buffer.length);
        const filePath = path.join(this.logDir, 'server.jsonl');

        try {
            fs.appendFileSync(filePath, lines.join(''), 'utf8');
        } catch (e) {
            console.error('[LogFileWriter] 写入失败:', e.message);
            this._buffer.unshift(...lines);
        }

        this._flushing = false;
    }

    stop() {
        clearInterval(this._flushTimer);
        this._flush();
    }
}

module.exports = LogFileWriter;

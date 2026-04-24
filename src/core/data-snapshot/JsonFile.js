const fs = require('fs');
const path = require('path');

class JsonFile {
    static read(filePath) {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    }

    static write(filePath, data) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const json = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, json, 'utf8');
    }

    static exists(filePath) {
        return fs.existsSync(filePath);
    }

    static delete(filePath) {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    static readOrDefault(filePath, defaultValue) {
        if (fs.existsSync(filePath)) {
            try {
                return this.read(filePath);
            } catch (err) {
                console.error(`[JsonFile] 读取失败: ${filePath}`, err.message);
                return defaultValue;
            }
        }
        return defaultValue;
    }
}

module.exports = JsonFile;

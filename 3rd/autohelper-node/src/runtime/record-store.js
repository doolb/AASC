import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/** 以 JSONL 保存识别动作，便于人工查看和后续回放。 */
export class RecordStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async append(entry) {
        try {
            await mkdir(dirname(this.filePath), { recursive: true });
            await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
        }
        catch (error) {
            throw new Error(`failed to append record: ${this.filePath}`, { cause: error });
        }
    }
    async read() {
        let content;
        try {
            content = await readFile(this.filePath, 'utf8');
        }
        catch (error) {
            if (isFileNotFoundError(error)) {
                return [];
            }
            throw new Error(`failed to read record: ${this.filePath}`, { cause: error });
        }
        return content.split('\n').filter(Boolean).map((line, index) => {
            try {
                return JSON.parse(line);
            }
            catch (error) {
                throw new Error(`invalid record line ${index + 1}: ${this.filePath}`, { cause: error });
            }
        });
    }
}
function isFileNotFoundError(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type RecordEntry = {
  timestamp: string;
  flowId: string;
  imageName: string;
  clicked: boolean;
  reason: string;
  point?: { x: number; y: number };
  gotoFlow?: string;
};

/** 以 JSONL 保存识别动作，便于人工查看和后续回放。 */
export class RecordStore {
  public constructor(private readonly filePath: string) {}

  public async append(entry: RecordEntry): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error: unknown) {
      throw new Error(`failed to append record: ${this.filePath}`, { cause: error });
    }
  }

  public async read(): Promise<RecordEntry[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error: unknown) {
      if (isFileNotFoundError(error)) {
        return [];
      }
      throw new Error(`failed to read record: ${this.filePath}`, { cause: error });
    }

    return content.split('\n').filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line) as RecordEntry;
      } catch (error: unknown) {
        throw new Error(`invalid record line ${index + 1}: ${this.filePath}`, { cause: error });
      }
    });
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

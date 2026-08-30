import { readdir as fsReaddir } from 'node:fs/promises';
import nodePath from 'node:path';

const FIND_DEFAULT_LIMIT = 1000;
const FIND_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);

function escapeRegExpCharacter(character) {
    return character.replace(/[\\^$+?.()|{}\[\]]/gu, '\\$&');
}

// 将常用 glob 转成正则，支持 basename、路径、*、? 和 **，避免依赖 Pi
// 原生 find 所需的 fd 下载。只读查找仍限制在当前项目的文件系统访问范围内。
function createFindMatcher(pattern) {
    const normalizedPattern = String(pattern || '*')
        .trim()
        .replaceAll('\\', '/')
        .replace(/^\.\//u, '');
    let expression = '^';
    for (let index = 0; index < normalizedPattern.length; index += 1) {
        const character = normalizedPattern[index];
        if (character === '*') {
            if (normalizedPattern[index + 1] === '*') {
                while (normalizedPattern[index + 1] === '*') index += 1;
                if (normalizedPattern[index + 1] === '/') {
                    expression += '(?:.*/)?';
                    index += 1;
                } else {
                    expression += '.*';
                }
            } else {
                expression += '[^/]*';
            }
            continue;
        }
        if (character === '?') {
            expression += '[^/]';
            continue;
        }
        expression += escapeRegExpCharacter(character);
    }
    const matcher = new RegExp(`${expression}$`, 'u');
    const matchesPath = normalizedPattern.includes('/');
    return (relativePath) => matcher.test(matchesPath
        ? relativePath
        : nodePath.posix.basename(relativePath));
}

/**
 * 在指定目录内执行受限的只读文件查找。
 *
 * @param {string} searchPath 已解析且已确认存在的目录
 * @param {string} pattern 文件 basename 或 glob 模式
 * @param {number} limit 最大返回数量
 * @param {AbortSignal} signal Pi 工具调用取消信号
 * @returns {Promise<string[]>} 相对于 searchPath 的匹配路径
 */
export async function findFiles(searchPath, pattern, limit = FIND_DEFAULT_LIMIT, signal) {
    const matches = [];
    const matchesPattern = createFindMatcher(pattern);

    const walk = async (directory, relativeDirectory) => {
        if (signal?.aborted) throw new Error('Operation aborted');
        if (matches.length >= limit) return;
        let entries;
        try {
            entries = await fsReaddir(directory, { withFileTypes: true });
        } catch (error) {
            return;
        }
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            if (signal?.aborted) throw new Error('Operation aborted');
            if (entry.isDirectory() && FIND_IGNORED_DIRECTORIES.has(entry.name)) continue;
            const relativePath = nodePath.posix.join(
                relativeDirectory,
                entry.name
            );
            if (matchesPattern(relativePath)) matches.push(relativePath);
            if (entry.isDirectory() && matches.length < limit) {
                await walk(nodePath.join(directory, entry.name), relativePath);
            }
            if (matches.length >= limit) return;
        }
    };

    await walk(searchPath, '');
    return matches;
}

export { FIND_DEFAULT_LIMIT };

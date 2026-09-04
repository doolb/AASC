import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const assertSafeId = (value, field) => {
    if (!SAFE_ID_PATTERN.test(value) || value === '.' || value === '..') {
        throw new Error(`invalid ${field}: ${value}`);
    }
};
const pad = (value) => String(value).padStart(2, '0');
const isoWeekKey = (date) => {
    const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = utcDate.getUTCDay() || 7;
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    return `${utcDate.getUTCFullYear()}-W${pad(week)}`;
};
export const periodKey = (type, date, version) => {
    if (type === 'daily') {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
    if (type === 'weekly') {
        return isoWeekKey(date);
    }
    if (!version) {
        throw new Error('version target requires period key');
    }
    return version;
};
const nowIso = () => new Date().toISOString();
const createProgress = (target, key) => ({
    targetId: target.id,
    periodKey: key,
    status: 'active',
    subgoals: {},
    updatedAt: nowIso(),
});
function assertProgress(value, filePath) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`invalid progress file: ${filePath}`);
    }
    const progress = value;
    if (typeof progress.targetId !== 'string'
        || typeof progress.periodKey !== 'string'
        || (progress.status !== 'active' && progress.status !== 'completed')
        || typeof progress.subgoals !== 'object'
        || progress.subgoals === null
        || Array.isArray(progress.subgoals)) {
        throw new Error(`invalid progress file: ${filePath}`);
    }
}
export class ProgressStore {
    rootDir;
    constructor(options) {
        this.rootDir = resolve(options.rootDir);
    }
    pathFor(gameId, target, date) {
        assertSafeId(gameId, 'game id');
        assertSafeId(target.id, 'target id');
        const key = periodKey(target.type, date, target.periodKey);
        return this.pathForPeriod(gameId, target, key);
    }
    pathForPeriod(gameId, target, key) {
        assertSafeId(gameId, 'game id');
        assertSafeId(target.id, 'target id');
        assertSafeId(key, 'period key');
        return join(this.rootDir, gameId, target.id, `${key}.json`);
    }
    async load(gameId, target, date = new Date()) {
        const filePath = this.pathFor(gameId, target, date);
        try {
            const contents = await readFile(filePath, 'utf8');
            const parsed = JSON.parse(contents);
            assertProgress(parsed, filePath);
            if (parsed.targetId !== target.id || parsed.periodKey !== periodKey(target.type, date, target.periodKey)) {
                return createProgress(target, periodKey(target.type, date, target.periodKey));
            }
            return parsed;
        }
        catch (error) {
            if (isFileNotFoundError(error)) {
                const progress = createProgress(target, periodKey(target.type, date, target.periodKey));
                await this.saveAt(filePath, progress);
                return progress;
            }
            throw new Error(`failed to load target progress: ${filePath}`, { cause: error });
        }
    }
    async save(progress, gameId, target) {
        if (progress.targetId !== target.id) {
            throw new Error(`progress target mismatch: ${progress.targetId}`);
        }
        const filePath = this.pathForPeriod(gameId, target, progress.periodKey);
        await this.saveAt(filePath, progress);
    }
    upsertSubgoal(progress, subgoal) {
        const existing = progress.subgoals[subgoal.id];
        progress.subgoals[subgoal.id] = {
            ...existing,
            ...subgoal,
            status: existing?.status ?? 'pending',
            discoveredAt: existing?.discoveredAt ?? nowIso(),
        };
        progress.updatedAt = nowIso();
        return progress;
    }
    markSubgoalCompleted(progress, id) {
        const subgoal = progress.subgoals[id];
        if (!subgoal) {
            throw new Error(`unknown subgoal: ${id}`);
        }
        subgoal.status = 'completed';
        subgoal.completedAt = nowIso();
        if (progress.activeSubgoalId === id) {
            progress.activeSubgoalId = undefined;
        }
        progress.updatedAt = nowIso();
        return progress;
    }
    hasPendingSubgoals(progress) {
        return Object.values(progress.subgoals).some((subgoal) => subgoal.status !== 'completed');
    }
    async saveAt(filePath, progress) {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
    }
}
function isFileNotFoundError(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

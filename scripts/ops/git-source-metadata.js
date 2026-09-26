'use strict';

const { execFileSync } = require('node:child_process');

const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

function unavailableSourceMetadata() {
    return { gitCommit: null, gitDirty: null };
}

function readGitSourceMetadata(projectRoot) {
    let gitCommit;
    try {
        gitCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch (error) {
        if (error.code === 'ENOENT' || error.status === 128) return unavailableSourceMetadata();
        throw new Error(`读取 Git 提交 hash 失败: ${error.message}`, { cause: error });
    }
    if (!GIT_COMMIT_PATTERN.test(gitCommit)) {
        throw new Error(`Git 返回的提交 hash 格式无效: ${gitCommit || '(空)'}`);
    }

    let status;
    try {
        status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
    } catch (error) {
        throw new Error(`读取 Git 工作区状态失败: ${error.message}`, { cause: error });
    }

    return {
        gitCommit,
        gitDirty: status.length > 0
    };
}

function validateGitSourceMetadata(source, fieldName = 'source') {
    if (source === undefined) return;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`${fieldName} 必须是 Git 来源对象`);
    }
    if (source.gitCommit === null) {
        if (source.gitDirty !== null) throw new Error(`${fieldName}.gitDirty 必须与空 gitCommit 同为空`);
        return;
    }
    if (typeof source.gitCommit !== 'string' || !GIT_COMMIT_PATTERN.test(source.gitCommit) ||
        typeof source.gitDirty !== 'boolean') {
        throw new Error(`${fieldName} 必须包含有效的完整 gitCommit 和布尔 gitDirty`);
    }
}

module.exports = {
    readGitSourceMetadata,
    validateGitSourceMetadata
};

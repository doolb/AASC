'use strict';

// 历史画像保留上限
const MAX_LEARNINGS = 30;   // 经验约定最多条数
const MAX_RECORDS = 100;    // 最近记录最多条数

function pad(n, len = 2) {
    return String(n).padStart(len, '0');
}

// 任务 id：YYYYMMDD-HHMM-SEQ
function genId(now, seq) {
    const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const t = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `${d}-${t}-${pad(seq, 3)}`;
}

// 成员/角色名合法性校验；返回错误信息或 null
function validateName(name) {
    if (!name || !name.trim()) return '名字不能为空';
    if (/[\/\\]/.test(name)) return '名字不能包含路径分隔符';
    return null;
}

// 新角色模板（交互「创新」时生成）
function roleTemplate(name) {
    return `# 角色：${name}

## 职责
- （填写该角色的职责边界：哪些类型的任务属于该角色）

## 负责目录/文件
- （填写该角色负责的目录或文件范围）

## 工作规范
- （填写工作规范：引用项目 CLAUDE.md 规则、design/spec 文档同步要求等）
`;
}

// 子 agent 执行任务的 prompt：注入角色总结，指示读任务/写结果
function buildPrompt({ role, name, summary, taskFile, resultFile }) {
    return `你是 workgroup 的「${role}」角色成员「${name}」。

【角色总结】
${summary || '（暂无总结）'}

【任务】
读取任务文件：${taskFile}
按任务文件中的 requirement 完成任务。
完成后把结果写入结果文件：${resultFile}
结果文件为 JSON，包含字段：
- status: "completed" 或 "failed"
- summary: 一句话摘要
- tags: 领域标签数组（如 ["前端","UI"]）
- learnings: 1-3 条项目约定/经验（供后续任务参考）
- output: 详细输出或说明
`;
}

module.exports = { genId, validateName, roleTemplate, buildPrompt, MAX_LEARNINGS, MAX_RECORDS };

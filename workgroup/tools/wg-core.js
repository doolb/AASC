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

// 成员/角色名合法性校验；返回错误信息或 null（合法）
function validateName(name) {
    if (!name || !name.trim()) return '名字不能为空';
    if (/[\/\\]/.test(name)) return '名字不能包含路径分隔符';
    // 拒绝 . / ..：无斜杠但会被 memberDir() 解析成上级目录，把文件写到错误位置
    if (/^\.\.?$/.test(name.trim())) return '名字不能是 . 或 ..';
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

// 解析 history.md 三段内容
function parseHistory(text) {
    const profile = {};
    const learnings = [];
    const records = [];
    if (!text) return { profile, learnings, records };
    // 按标题分割：# 专长画像 / ## 经验约定 / ## 最近记录
    const sections = text.split(/^(?=#)/m);
    for (const sec of sections) {
        if (sec.startsWith('# 专长画像')) {
            const json = sec.replace(/^# 专长画像\s*/, '').trim();
            try { Object.assign(profile, JSON.parse(json || '{}')); } catch (_) { /* 容错 */ }
        } else if (sec.startsWith('## 经验约定')) {
            const body = sec.replace(/^## 经验约定\s*/, '');
            for (const line of body.split('\n')) {
                const m = line.trim().match(/^-\s*(.+)$/);
                if (m) learnings.push(m[1]);
            }
        } else if (sec.startsWith('## 最近记录')) {
            const body = sec.replace(/^## 最近记录\s*/, '');
            for (const line of body.split('\n')) {
                const m = line.trim().match(/^-\s*(.+)$/);
                if (m) {
                    try { records.push(JSON.parse(m[1])); } catch (_) { /* 容错 */ }
                }
            }
        }
    }
    return { profile, learnings, records };
}

// 序列化 history.md（保持三段格式）
function serializeHistory({ profile, learnings, records }) {
    const learnLines = learnings.map((l) => `- ${l}`).join('\n');
    const recLines = records.map((r) => `- ${JSON.stringify(r)}`).join('\n');
    return `# 专长画像\n${JSON.stringify(profile)}\n\n## 经验约定\n${learnLines}\n\n## 最近记录\n${recLines}\n`;
}

// 增量更新：专长累加、经验约定去重追加、最近记录追加，超限删最旧
function updateHistory(oldText, { tags = [], learnings = [], record = null }) {
    const h = parseHistory(oldText);
    for (const tag of tags) {
        if (tag) h.profile[tag] = (h.profile[tag] || 0) + 1;
    }
    for (const l of learnings) {
        if (l && !h.learnings.includes(l)) h.learnings.push(l);
    }
    while (h.learnings.length > MAX_LEARNINGS) h.learnings.shift();
    if (record) h.records.push(record);
    while (h.records.length > MAX_RECORDS) h.records.shift();
    return serializeHistory(h);
}

// 启动总结：提取专长画像与经验约定，不含最近记录（避免旧任务解法带偏）
function buildSummary(text) {
    const h = parseHistory(text);
    const parts = [];
    const profileLine = JSON.stringify(h.profile);
    if (profileLine && profileLine !== '{}') parts.push(`专长画像：${profileLine}`);
    if (h.learnings.length) parts.push(`经验约定：\n- ${h.learnings.join('\n- ')}`);
    return parts.join('\n');
}

module.exports = { genId, validateName, roleTemplate, buildPrompt, parseHistory, updateHistory, buildSummary, MAX_LEARNINGS, MAX_RECORDS };

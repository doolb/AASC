'use strict';

const SUB_AI_PROMPT = [
    'SubAI 指令调用行,和本地游戏调用行写法一致,',
    '用户说生图或者画图时, 提示词含逗号用双引号，内部双引号写两次；没有参考图则省略。',
    'SubAI,生图, "提示词"[, 参考图 ID1, 参考图 ID2...]',
    '用户要求生成视频时同样调用，模型从生视频设置读取；参考图可省略。',
    'SubAI,生视频, "提示词"[, 参考图 ID1, 参考图 ID2...]'
].join('\n');

/** 位置参数采用CSV引号转义，不用字符串split破坏含逗号的提示词。 */
function parseCsv(line) {
    const fields = []; let value = ''; let quoted = false; let closed = false;
    for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (quoted) {
            if (c !== '"') { value += c; continue; }
            if (line[i + 1] === '"') { value += '"'; i += 1; continue; }
            quoted = false; closed = true; continue;
        }
        if (c === ',') { fields.push(value.trim()); value = ''; closed = false; continue; }
        if (c === '"' && !value.trim() && !closed) { quoted = true; value = ''; continue; }
        if (c === '"' || (closed && c.trim())) throw new Error('SubAI 参数引号格式无效');
        value += c;
    }
    if (quoted) throw new Error('SubAI 参数引号未闭合');
    fields.push(value.trim()); return fields;
}

function parseSubAiReply(text, complete = true) {
    const lines = String(text || '').split('\n'); const visible = []; const calls = [];
    let fence = false;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]; const trimmed = line.trim();
        if (/^(```|~~~)/.test(trimmed)) fence = !fence;
        const lastPartial = !complete && i === lines.length - 1;
        if (!fence && trimmed.startsWith('SubAI,')) {
            if (!lastPartial) {
                try {
                    const [, task, prompt, ...references] = parseCsv(trimmed);
                    if (!task || !prompt || references.some(ref => !ref)) throw new Error('SubAI 调用缺少参数');
                    calls.push({ task, prompt, references, raw: trimmed });
                } catch (error) { calls.push({ raw: trimmed, error: error.message }); }
            }
            continue;
        }
        if (!fence && lastPartial && trimmed && 'SubAI,'.startsWith(trimmed)) continue;
        visible.push(line);
    }
    if (calls.length > 8) return { text: visible.join('\n'), calls: [{ raw: 'SubAI,生图', error: '单次回复最多允许8条SubAI调用' }] };
    return { text: visible.join('\n'), calls };
}
module.exports = { SUB_AI_PROMPT, parseCsv, parseSubAiReply };

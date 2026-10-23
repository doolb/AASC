'use strict';

const SUB_AI_PROMPT = [
    '本应用生图的唯一入口是SubAI指令。用户要求生成、绘制或修改图片时，你必须输出下面的调用行，把实际生成交给应用；不得调用模型或官网自带的原生生图、绘图工具，也不得用Markdown图片或附件代替调用。',
    '独立一行 SubAI,生图,"提示词"[,参考图ID1,参考图ID2...]。字段只用英文逗号；提示词含逗号用双引号，内部双引号写两次；没有参考图则省略。',
    '示例：用户“画一只猫”→先输出 SubAI,生图,"一只可爱的小猫"，再另起行简短回答“我来画一只小猫。”；实际回复不要写示例说明或代码块。',
    '参考图只能使用当前上下文给出的图片ID。调用行不朗读，未收到应用生成结果不得声称已生成；普通聊天和只要求编写绘画提示词时不调用。动作任务不能使用生图指令。'
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

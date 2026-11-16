/** 解析单条 CSV 指令；引号内的双引号使用两个双引号表示。 */
export function parseCommand(input, { requireBrackets = true } = {}) {
  if (typeof input !== 'string') throw new Error('指令必须是文本');
  let text = input.trim();
  const wrapped = text.startsWith('[') && text.endsWith(']');
  if (requireBrackets && !wrapped) throw new Error('指令需要完整方括号');
  if (wrapped) text = text.slice(1, -1);
  const fields = [];
  let field = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; continue; }
      if (char === '"') { quoted = false; closed = true; continue; }
      field += char;
      continue;
    }
    if (char === ',') { fields.push(field.trim()); field = ''; closed = false; continue; }
    if (char === '"' && !field.trim() && !closed) { field = ''; quoted = true; continue; }
    if (char === '"' || (closed && !/\s/u.test(char)) || char === '\n' || char === '\r') throw new Error('CSV 格式无效');
    field += char;
  }
  if (quoted) throw new Error('引号未闭合');
  fields.push(field.trim());
  if (fields.length < 2 || !fields[0] || !fields[1]) throw new Error('角色和任务不能为空');
  return { role: fields[0], task: fields[1], args: fields.slice(2) };
}

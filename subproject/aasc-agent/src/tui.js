import { createInterface } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

// 模型和工具可能返回终端控制字符；显示前移除，避免覆盖界面或执行终端控制序列。
function display(value) {
  let text;
  if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(value, null, 2) ?? String(value); }
    catch (_) { text = String(value); }
  }
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function formatEvent(event) {
  const role = display(event.role);
  const labels = {
    'run:start': () => `[${role}] 开始`,
    decision: () => `[${role}] 模型选择：${display(event.tool)}`,
    delegate: () => `[${role}] 委派给：${display(event.target)}`,
    'tool:start': () => `[${role}] 执行：${display(event.tool)}`,
    'tool:complete': () => `[${role}] 完成：${display(event.tool)}`,
    'run:complete': () => `[${role}] 任务完成`,
    'run:error': () => `[${role}] 任务失败`,
  };
  return labels[event.type]?.();
}

/** 按行与已有 Agent 对话；输入输出可注入，方便宿主使用和自动化测试。 */
export async function runTui({ agent, input = process.stdin, output = process.stdout } = {}) {
  if (!agent || typeof agent.chat !== 'function') throw new Error('未提供可对话的 Agent');
  const terminal = Boolean(input.isTTY && output.isTTY);
  const rl = createInterface({ input, output, terminal, crlfDelay: Infinity });
  const write = text => output.write(text + '\n');
  let selectedRole = null;
  const listRoles = async () => {
    if (typeof agent.listRoles !== 'function') throw new Error('当前 Agent 不支持角色列表');
    const roles = await agent.listRoles();
    if (!Array.isArray(roles) || roles.some(role => !role || typeof role.name !== 'string')) {
      throw new Error('Agent 返回的角色列表无效');
    }
    return roles;
  };
  // Ctrl+C 关闭输入；已经提交的外部任务不在此处强行中断。
  rl.on('SIGINT', () => rl.close());
  write('AASC Agent 终端界面。输入消息与 AI 对话，/role 切换角色，/new 新建会话，/help 查看帮助，/exit 退出。');
  if (terminal) rl.setPrompt('> ');
  if (terminal) rl.prompt();
  try {
    for await (const line of rl) {
      const message = line.trim();
      if (message === '/exit' || message === '/quit') break;
      if (message === '/help') {
        write('直接输入自然语言消息；/role 查看角色，/role 名称 切换，/role --default 恢复默认；/new 新建会话；/exit 退出。');
      } else if (message === '/new') {
        try {
          if (typeof agent.resetChat !== 'function') throw new Error('当前 Agent 不支持新建会话');
          await agent.resetChat({ role: selectedRole });
          write('当前角色已开启新会话；原网页对话未删除。');
        } catch (error) {
          write('错误：' + display(error?.message ?? error));
        }
      } else if (/^\/role(?:\s|$)/u.test(message)) {
        try {
          const name = message.slice('/role'.length).trim();
          if (name === '--default') {
            selectedRole = null;
            write('当前角色：默认' + (agent.defaultRole ? `（${display(agent.defaultRole)}）` : ''));
          } else {
            const roles = await listRoles();
            if (!name) {
              write('当前角色：' + (selectedRole ? display(selectedRole) :
                '默认' + (agent.defaultRole ? `（${display(agent.defaultRole)}）` : '')));
              write('可用角色：' + (roles.length ? roles.map(role => display(role.name)).join('、') : '无'));
            } else if (!roles.some(role => role.name === name)) {
              write('错误：未知角色：' + display(name));
            } else {
              selectedRole = name;
              write('当前角色：' + display(selectedRole));
            }
          }
        } catch (error) {
          write('错误：' + display(error?.message ?? error));
        }
      } else if (message) {
        try {
          const result = await agent.chat(line, { role: selectedRole, onEvent: event => {
            const message = formatEvent(event);
            if (message) write(message);
          } });
          if (typeof result === 'string') write('AI：' + display(result));
          else {
            if (!result || typeof result !== 'object' ||
                (result.text != null && typeof result.text !== 'string') ||
                (result.results != null && !Array.isArray(result.results))) {
              throw new Error('Agent 返回无效回复');
            }
            if (result?.text) write('AI：' + display(result.text));
            for (const item of result?.results ?? []) write('本地结果：' + display(item.result));
          }
        } catch (error) {
          write('错误：' + display(error?.message ?? error));
        }
      }
      if (terminal) rl.prompt();
    }
  } finally {
    rl.close();
  }
}

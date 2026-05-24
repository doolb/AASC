// 测试用户任务 - 只输出输入的参数
// 用于验证远程任务系统的提交、执行、日志、结果返回完整流程

async function run(context) {
  const params = context.params || {};
  const refs = context.refs || {};

  console.log('=== 测试用户任务开始执行 ===');
  console.log('输入参数:', JSON.stringify(params, null, 2));

  if (Object.keys(refs).length > 0) {
    console.log('引用文件:', JSON.stringify(refs, null, 2));
  } else {
    console.log('引用文件: 无');
  }

  console.log('工作目录:', context.workDir);
  console.log('=== 测试用户任务执行完成 ===');

  return {
    echo: params,
    refs: Object.keys(refs).length > 0 ? refs : undefined,
    timestamp: Date.now(),
    message: '测试用户任务执行成功'
  };
}

const PARAMS = [
  { name: 'message', type: 'string', required: false, default: 'hello', label: '消息内容' },
  { name: 'count', type: 'number', required: false, default: 1, min: 1, max: 100, label: '重复次数' }
];

const WIDGET = {
  html: '<div style="display:flex;flex-direction:column;gap:10px">' +
    '<div style="display:flex;gap:6px;align-items:center">' +
      '<input class="task-widget-field" data-field="message" value="{{message}}" placeholder="输入消息..."' +
      ' style="flex:1;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:13px">' +
    '</div>' +
    '<div style="display:flex;gap:6px;align-items:center">' +
      '<span style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap;min-width:50px">重复</span>' +
      '<input type="number" class="task-widget-field" data-field="count" value="{{count}}" min="1" max="100"' +
      ' style="width:80px;padding:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px">' +
    '</div>' +
  '</div>'
};

module.exports = { run, params: PARAMS, widget: WIDGET };

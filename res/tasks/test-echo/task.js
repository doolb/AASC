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

module.exports = { run };

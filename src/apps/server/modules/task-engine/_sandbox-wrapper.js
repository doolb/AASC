process.on('message', async (msg) => {
  if (msg.type === 'run') {
    try {
      const result = eval(msg.code);
      if (result && typeof result.then === 'function') {
        const val = await result;
        if (val !== undefined) process.send({ type: 'result', data: val });
      } else if (result !== undefined) {
        process.send({ type: 'result', data: result });
      }
    } catch (err) {
      process.send({ type: 'error', error: err.message, stack: err.stack });
    }
    // 关闭 IPC 通道，子进程自然退出
    process.disconnect();
  }
});

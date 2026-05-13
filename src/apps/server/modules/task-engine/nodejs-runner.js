const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

class NodeJsRunner {
  async run(options) {
    const { entryFile, workDir, context = {}, timeout = 30000 } = options;
    const resolvedPath = path.resolve(workDir, entryFile);

    // 路径遍历防护
    if (!resolvedPath.startsWith(path.resolve(workDir) + path.sep)) {
      return { success: false, error: '入口文件路径越界', logs: [] };
    }

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: '入口文件不存在: ' + entryFile, logs: [] };
    }

    return new Promise((resolve) => {
      const logs = [];
      let completed = false;
      let resolvedViaIpc = false;
      let stdoutBuffer = '';
      let stderrBuffer = '';

      const runnerCode = `
        (async () => {
          const ctx = ${JSON.stringify(context)};
          const entry = require(${JSON.stringify(resolvedPath)});
          const run = typeof entry === 'function' ? entry : entry.run;
          if (typeof run !== 'function') {
            process.exitCode = 1;
            process.send({ type: 'error', error: '入口文件未导出 run 函数' });
            return;
          }
          try {
            const result = await run(ctx);
            process.send({ type: 'result', data: result || {} });
          } catch (err) {
            process.send({ type: 'error', error: err.message, stack: err.stack });
          }
        })();
      `;

      const child = fork(path.resolve(__dirname, '_sandbox-wrapper'), [], {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env }
      });

      const timer = setTimeout(() => {
        if (completed) return;
        completed = true;
        child.kill('SIGKILL');
        resolve({
          success: false, error: 'timeout',
          logs: [...logs, { stream: 'system', level: 'error', message: '执行超时 (' + timeout + 'ms)' }]
        });
      }, timeout);

      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          if (line) logs.push({ stream: 'stdout', level: 'info', message: line });
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() || '';
        for (const line of lines) {
          if (line) logs.push({ stream: 'stderr', level: 'error', message: line });
        }
      });

      child.on('message', (msg) => {
        if (completed) return;
        completed = true;
        resolvedViaIpc = true;
        clearTimeout(timer);
        if (msg.type === 'result') {
          resolve({ success: true, data: msg.data, logs });
        } else if (msg.type === 'error') {
          resolve({ success: false, error: msg.error, stack: msg.stack, logs });
        }
      });

      child.on('exit', (code) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (!resolvedViaIpc) {
          resolve({ success: false, error: '进程退出码: ' + code, logs });
        }
      });

      child.on('error', (err) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve({ success: false, error: err.message, logs });
      });

      child.send({ type: 'run', code: runnerCode });
    });
  }
}

module.exports = NodeJsRunner;

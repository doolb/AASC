// 主页面到推理 Worker 的 requestId 协议适配；大块 PCM 用 transferable 转移避免多次复制。
export function createWorkerClient(workerUrl, onEvent) {
  const worker = new Worker(workerUrl);
  const pending = new Map();
  let nextId = 0;

  worker.addEventListener('message', (event) => {
    const message = event.data || {};
    const waiter = pending.get(message.requestId);
    if (message.type === 'result' && waiter) {
      pending.delete(message.requestId);
      waiter.resolve(message.data);
      return;
    }
    if (message.type === 'request-error' && waiter) {
      pending.delete(message.requestId);
      waiter.reject(new Error(message.message || '推理失败'));
      return;
    }
    onEvent?.(message);
  });

  worker.addEventListener('error', (event) => {
    for (const waiter of pending.values()) waiter.reject(new Error(event.message || '推理 Worker 已停止'));
    pending.clear();
    onEvent?.({ type: 'worker-error', message: event.message || '推理 Worker 已停止' });
  });

  function request(type, payload = {}, transfer = []) {
    const requestId = `asr-web-${++nextId}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      worker.postMessage({ type, requestId, ...payload }, transfer);
    });
  }

  function send(type, payload = {}) {
    worker.postMessage({ type, ...payload });
  }

  return { request, send, terminate: () => worker.terminate() };
}

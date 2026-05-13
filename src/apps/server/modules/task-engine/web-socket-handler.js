/**
 * WebSocket Handler — Task 消息处理
 * 注册所有 task:* 类型的 WebSocket 消息处理函数，连接 TaskManager 和前端。
 *
 * 功能：
 *  - 处理控制端发来的 task:submit / task:stop / task:status 请求
 *  - 将 TaskManager 的事件（progress / result / log）广播到控制端
 */

/**
 * @param {import('./ws-server.js')} wsServer  — wsServer 实例，提供 registerHandler(type, handler)
 * @param {import('./task-manager.js')} taskManager — TaskManager 实例
 * @param {Function} sendToControl — (msg: object) => void，向所有控制端广播
 * @param {Function} sendToDisplay — (displayId: string, msg: object) => void，向指定显示端发送
 */
function registerTaskHandlers(wsServer, taskManager, sendToControl, sendToDisplay) {
  const controlTypes = ['task:submit', 'task:stop', 'task:status'];

  // ---------------------------------------------------------------
  // 统一消息处理器
  // ---------------------------------------------------------------
  const handler = async (data, ctx) => {
    const payload = data.payload || {};

    switch (data.type) {
      // ---- 提交 ----
      case 'task:submit': {
        try {
          const result = await taskManager.submit(payload);

          // 如果需要转发到显示端（例如由显示端本地执行），
          // 构造 task:execute 消息发送给目标 display
          if (result.status === 'pending_forward') {
            const targetPayload = {
              type: 'task:execute',
              payload: {
                taskName: payload.taskName,
                instanceId: result.instanceId,
                entryFile: payload.entryFile,
                files: payload.files,
                refs: payload.refs,
                env: payload.env,
                mode: payload.mode,
              },
            };
            const displayId = payload.displayId;
            if (displayId && sendToDisplay) {
              sendToDisplay(displayId, targetPayload);
            }
          }

          ctx.ws.send(JSON.stringify({
            type: 'task:submitted',
            payload: {
              taskName: payload.taskName,
              instanceId: result.instanceId,
              status: result.status,
            },
          }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, error: err.message },
          }));
        }
        break;
      }

      // ---- 停止 ----
      case 'task:stop': {
        const result = await taskManager.stopInstance(payload.taskName, payload.instanceId);
        ctx.ws.send(JSON.stringify({
          type: 'task:stopped',
          payload: {
            taskName: payload.taskName,
            instanceId: payload.instanceId,
            success: result.success,
          },
        }));
        break;
      }

      // ---- 状态查询 ----
      case 'task:status': {
        const status = await taskManager.getInstanceStatus(payload.taskName, payload.instanceId);
        ctx.ws.send(JSON.stringify({
          type: 'task:status',
          payload: {
            taskName: payload.taskName,
            instanceId: payload.instanceId,
            status,
          },
        }));
        break;
      }

      default:
        // 不做处理
        break;
    }
  };

  // 将同一 handler 注册到所有 task 控制类型上
  for (const type of controlTypes) {
    wsServer.registerHandler(type, handler);
  }

  // ---------------------------------------------------------------
  // TaskManager 事件 → 广播到控制端
  // ---------------------------------------------------------------

  taskManager.on('progress', (instanceId, stage, progress) => {
    sendToControl({
      type: 'task:progress',
      payload: { instanceId, stage, progress },
    });
  });

  taskManager.on('result', (instanceId, result) => {
    sendToControl({
      type: 'task:result',
      payload: { instanceId, ...result },
    });
  });

  taskManager.on('log', (instanceId, stream, level, message) => {
    sendToControl({
      type: 'task:log',
      payload: { instanceId, stream, level, message, timestamp: Date.now() },
    });
  });
}

module.exports = { registerTaskHandlers };

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
const path = require('path');

function registerTaskHandlers(wsServer, taskManager, sendToControl, sendToDisplay) {
  const controlTypes = ['task:submit', 'task:run', 'task:rerun', 'task:stop', 'task:status', 'task:result',
                        'task:list', 'task:update', 'task:delete', 'task:get_instance_logs',
                        'task:delete_instance', 'task:widget_action', 'task:update_instance_params',
                        'task:get_config', 'task:set_config', 'task:clear_instance_logs'];

  // 获取内置任务列表（格式化为前端所需结构）
  function getBuiltinTasks() {
    try {
      const registry = require('./builtin-tasks/registry');
      if (registry.listTasks) {
        return registry.listTasks().map(t => ({
          taskName: t.id,
          taskType: 'builtin',
          builtinId: t.id,
          name: t.name,
          params: t.params || [],
          target: t.target || 'server',
          mode: t.mode || 'one-shot',
          widget: t.widget || null,
          sidebar: t.sidebar || null,
          instances: []
        }));
      }
    } catch (e) { console.warn('[任务引擎] 内置任务不可用:', e.message); }
    return [];
  }

  // 获取侧边栏清单
  function getSidebarManifest() {
    try {
      const registry = require('./builtin-tasks/registry');
      if (registry.sidebarManifest) return registry.sidebarManifest;
    } catch (e) { /* 忽略 */ }
    return { groups: [], tabs: [] };
  }

  // ---------------------------------------------------------------
  // 统一消息处理器
  // ---------------------------------------------------------------
  const handler = async (data, ctx) => {
    const payload = data.payload || {};

    switch (data.type) {
      // ---- 提交 ----
      case 'task:submit': {
        console.log('[WS] >> task:submit:', payload.taskName, 'type:', payload.taskType, 'target:', payload.target);
        try {
          const result = await taskManager.submit(payload);

          console.log('[WS] << task:submitted:', result.instanceId, result.status);
          ctx.ws.send(JSON.stringify({
            type: 'task:submitted',
            payload: {
              taskName: payload.taskName,
              instanceId: result.instanceId,
              status: result.status,
            },
          }));
        } catch (err) {
          console.log('[WS] 提交失败:', err.message);
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, error: err.message },
          }));
        }
        break;
      }

      // ---- 运行已创建的实例 ----
      case 'task:run': {
        console.log('[WS] >> task:run:', payload.taskName, payload.instanceId);
        try {
          const result = await taskManager.runInstance(payload.taskName, payload.instanceId);
          ctx.ws.send(JSON.stringify({
            type: 'task:run_result',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, ...result }
          }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, error: err.message }
          }));
        }
        break;
      }

      // ---- 重置实例为草稿 ----
      case 'task:rerun': {
        console.log('[WS] >> task:rerun:', payload.taskName, payload.instanceId);
        try {
          const result = await taskManager.rerunInstance(payload.taskName, payload.instanceId);
          ctx.ws.send(JSON.stringify({
            type: 'task:rerun_result',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, ...result }
          }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, error: err.message }
          }));
        }
        break;
      }

      // ---- 停止 ----
      case 'task:stop': {
        console.log('[WS] >> task:stop:', payload.taskName, payload.instanceId);
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

      // ---- 来自显示端/子显示端的执行结果 ----
      case 'task:result': {
        console.log('[WS] >> task:result:', payload.instanceId, '成功:', payload.success, 'metrics:', payload.metrics ? 'yes' : 'no');
        // 将显示端返回的日志写入文件并广播
        if (payload.logs && Array.isArray(payload.logs)) {
          for (const log of payload.logs) {
            taskManager.emit('log', payload.instanceId, log.stream || 'stdout', log.level || 'info', log.message);
            taskManager.taskIO.writeInstanceLog(payload.taskName, payload.instanceId, log.stream || 'stdout', log.level || 'info', log.message);
          }
        }
        taskManager.handleForwardResult(payload.taskName, payload.instanceId, {
          success: payload.success,
          error: payload.error,
          outputFiles: payload.outputFiles,
          metrics: payload.metrics
        });
        sendToControl({
          type: 'task:result',
          payload: { taskName: payload.taskName, instanceId: payload.instanceId, ...payload }
        });
        break;
      }

      // ---- 任务列表 ----
      case 'task:list': {
        console.log('[WS] >> task:list: filter=' + payload.filter);
        try {
          const filter = payload.filter || 'all';
          if (filter === 'builtin') {
            ctx.ws.send(JSON.stringify({ type: 'task:list:result', payload: { tasks: getBuiltinTasks() } }));
          } else {
            const tasks = await taskManager.listTasks();
            const tasksWithMeta = tasks.map(t => {
              let params = [];
              let widget = null;
              try {
                const entryPath = path.join(taskManager.taskIO.tasksDir, t.taskName, 'task.js');
                const mod = require(entryPath);
                if (mod.params && Array.isArray(mod.params)) params = mod.params;
                if (mod.widget) widget = mod.widget;
              } catch (e) { /* 无法 require 时降级 */ }
              return { ...t, params, widget };
            });
            const manifest = getSidebarManifest();
            ctx.ws.send(JSON.stringify({
              type: 'task:list:result',
              payload: {
                tasks: [...getBuiltinTasks(), ...tasksWithMeta],
                sidebarGroups: manifest.groups,
                sidebarTabs: manifest.tabs
              }
            }));
          }
        } catch (err) {
          ctx.ws.send(JSON.stringify({ type: 'task:error', payload: { error: err.message } }));
        }
        break;
      }

      // ---- 更新任务 ----
      case 'task:update': {
        try {
          await taskManager.updateTask(payload.taskName, payload);
          ctx.ws.send(JSON.stringify({ type: 'task:updated', payload: { taskName: payload.taskName, success: true } }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({ type: 'task:error', payload: { taskName: payload.taskName, error: err.message } }));
        }
        break;
      }

      // ---- 删除任务 ----
      case 'task:delete': {
        try {
          await taskManager.deleteTask(payload.taskName);
          ctx.ws.send(JSON.stringify({ type: 'task:deleted', payload: { taskName: payload.taskName, success: true } }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({ type: 'task:error', payload: { taskName: payload.taskName, error: err.message } }));
        }
        break;
      }

      // ---- 删除实例 ----
      case 'task:delete_instance': {
        console.log('[WS] >> task:delete_instance:', payload.taskName, payload.instanceId);
        try {
          const result = await taskManager.deleteInstance(payload.taskName, payload.instanceId);
          ctx.ws.send(JSON.stringify({
            type: 'task:instance_deleted',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, success: result.success }
          }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, error: err.message }
          }));
        }
        break;
      }

      // ---- 获取实例日志 ----
      case 'task:get_instance_logs': {
        console.log('[WS] >> task:get_instance_logs:', payload.taskName, payload.instanceId);
        try {
          const logContent = await taskManager.getInstanceLog(payload.taskName, payload.instanceId);
          ctx.ws.send(JSON.stringify({
            type: 'task:instance_logs',
            payload: {
              taskName: payload.taskName,
              instanceId: payload.instanceId,
              logContent
            }
          }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, error: err.message }
          }));
        }
        break;
      }

      case 'task:clear_instance_logs': {
        console.log('[WS] >> task:clear_instance_logs:', payload.taskName, payload.instanceId);
        try {
          const result = await taskManager.clearInstanceLogs(payload.taskName, payload.instanceId);
          ctx.ws.send(JSON.stringify({
            type: 'task:instance_logs_cleared',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, ...result }
          }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, error: err.message }
          }));
        }
        break;
      }

      case 'task:widget_action': {
        console.log('[WS] >> task:widget_action:', payload.instanceId, payload.action);
        const wResult = await taskManager.handleWidgetAction(payload.instanceId, payload.action, payload.params);
        ctx.ws.send(JSON.stringify({
          type: 'task:widget_action_result',
          payload: { instanceId: payload.instanceId, action: payload.action, ...wResult }
        }));
        break;
      }

      case 'task:update_instance_params': {
        try {
          const idx = await taskManager.taskIO.getIndex(payload.taskName);
          const entry = idx.find(e => e.instanceId === payload.instanceId);
          if (!entry) {
            ctx.ws.send(JSON.stringify({
              type: 'task:error',
              payload: { taskName: payload.taskName, instanceId: payload.instanceId, error: '实例不存在' }
            }));
            break;
          }
          const newParams = { ...(entry.params || {}), ...(payload.params || {}) };
          await taskManager.taskIO.updateIndex(payload.taskName, {
            instanceId: payload.instanceId,
            params: newParams
          });
          ctx.ws.send(JSON.stringify({
            type: 'task:instance_params_updated',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, success: true }
          }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, instanceId: payload.instanceId, error: err.message }
          }));
        }
        break;
      }

      case 'task:get_config': {
        try {
          const config = await taskManager.taskIO.getTaskConfig(payload.taskName);
          ctx.ws.send(JSON.stringify({
            type: 'task:config_data',
            payload: { taskName: payload.taskName, config }
          }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, error: err.message }
          }));
        }
        break;
      }

      case 'task:set_config': {
        try {
          await taskManager.taskIO.setTaskConfig(payload.taskName, payload.config || {});
          ctx.ws.send(JSON.stringify({
            type: 'task:config_saved',
            payload: { taskName: payload.taskName, success: true }
          }));
        } catch (err) {
          ctx.ws.send(JSON.stringify({
            type: 'task:error',
            payload: { taskName: payload.taskName, error: err.message }
          }));
        }
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
    const inst = taskManager.getInstance(instanceId);
    console.log('[WS] << task:progress:', instanceId, stage, progress);
    sendToControl({
      type: 'task:progress',
      payload: { taskName: inst ? inst.taskName : null, instanceId, stage, progress },
    });
  });

  taskManager.on('result', (instanceId, result) => {
    const inst = taskManager.getInstance(instanceId);
    console.log('[WS] << task:result:', instanceId, result.success ? 'success' : 'fail');
    sendToControl({
      type: 'task:result',
      payload: { taskName: inst ? inst.taskName : null, instanceId, ...result },
    });
  });

  taskManager.on('log', (instanceId, stream, level, message) => {
    const inst = taskManager.getInstance(instanceId);
    console.log('[WS] << task:log:', instanceId, stream, level, message.substring(0, 80));
    sendToControl({
      type: 'task:log',
      payload: { taskName: inst ? inst.taskName : null, instanceId, stream, level, message, timestamp: Date.now() },
    });
  });

  taskManager.on('widgetUpdate', (instanceId, data) => {
    const inst = taskManager.getInstance(instanceId);
    sendToControl({
      type: 'task:widget_update',
      payload: { instanceId, taskName: inst ? inst.taskName : null, data }
    });
  });

  taskManager.on('stream', (instanceId, { chunk, index, done }) => {
    const inst = taskManager.getInstance(instanceId);
    sendToControl({
      type: 'task:stream',
      payload: { instanceId, taskName: inst ? inst.taskName : null, chunk, index: index || 0, done: done || false }
    });
  });
}

module.exports = { registerTaskHandlers };

'use strict';

// AI 角色管理消息的 WebSocket 适配层。
// 角色消息单独注册，避免依赖 server-app 的通用回退分支被遗漏时静默丢弃请求。

function getErrorMessage(error) {
    if (error instanceof Error) return error.message;
    return String(error || '操作失败');
}

function send(ws, message) {
    ws.send(JSON.stringify(message));
}

function sendError(ws, error) {
    send(ws, { type: 'roleError', message: getErrorMessage(error) });
}

function registerAiRoleHandlers(wsServer, { aiRoles, broadcastToControls }) {
    wsServer.registerHandler('roleList', async (data, { ws }) => {
        try {
            send(ws, { type: 'roleList', roles: aiRoles.list() });
        } catch (error) {
            sendError(ws, error);
        }
    });

    wsServer.registerHandler('roleAdd', async (data, { ws }) => {
        try {
            aiRoles.add(data.name);
            broadcastToControls({ type: 'roleList', roles: aiRoles.list() });
        } catch (error) {
            sendError(ws, error);
        }
    });

    wsServer.registerHandler('roleDelete', async (data, { ws }) => {
        try {
            if (!aiRoles.list().some((role) => role.name === data.role)) {
                sendError(ws, new Error('角色不存在'));
                return;
            }
            await aiRoles.remove(data.role);
            broadcastToControls({ type: 'roleList', roles: aiRoles.list() });
        } catch (error) {
            sendError(ws, error);
        }
    });

    wsServer.registerHandler('roleHistory', async (data, { ws }) => {
        try {
            if (!aiRoles.list().some((role) => role.name === data.role)) {
                sendError(ws, new Error('角色不存在'));
                return;
            }
            send(ws, {
                type: 'roleHistory',
                role: data.role,
                history: aiRoles.history(data.role)
            });
        } catch (error) {
            sendError(ws, error);
        }
    });
}

module.exports = registerAiRoleHandlers;

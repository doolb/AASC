'use strict';

/** 三种清空入口共用预检与顺序，棋局写盘失败时不先删除聊天历史。 */
function createChatHistoryClearService({ chat, gameService }) {
    function clear(data = {}) {
        const scope = chat.validateHistoryScope(data);
        const ids = data.displayIds ?? (data.displayId ? [data.displayId] : []);
        if (!Array.isArray(ids) || ids.length > 64 || ids.some(id =>
            typeof id !== 'string' || !id.trim() || id.length > 256)) {
            throw new Error('清空聊天的显示端参数无效');
        }
        gameService.clearForChat({ ...scope,
            // 临时清空入口可明确给出当前会话；原历史服务仍沿用原清空范围。
            ...(scope.mode === 'temporary' && data.sessionId ? { sessionId: data.sessionId } : {}) },
        { displayIds: [...new Set(ids.map(id => id.trim()))] });
        return chat.clearHistory(scope);
    }
    return { clear };
}

module.exports = { createChatHistoryClearService };

'use strict';

// 状态只携带固定文案，不能把签名、Cookie、原始异常或上游页面内容带到聊天界面。
const MESSAGES = Object.freeze({
    doubao_signature_getting: '正在获取豆包签名…',
    doubao_signature_refreshing: '正在重新获取豆包签名…',
    doubao_signature_ready: '签名已获取，正在发送…',
    doubao_signature_retrying: '签名已更新，正在重试…',
    doubao_signature_failed: '豆包签名获取失败',
});

function normalizeChatProgress(status) {
    const code = typeof status === 'string' ? status : status?.code;
    return typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? { code, message: MESSAGES[code] } : null;
}

module.exports = { normalizeChatProgress };

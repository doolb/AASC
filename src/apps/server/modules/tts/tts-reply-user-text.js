'use strict';

const { BUSINESS_TYPES } = require('./tts-provider-policy');
const MAX_REPLY_USER_TEXT_CHARS = 2000;

// 上一句原文只作为豆包AI语音的回合上下文；按Unicode字符限长，避免拆开emoji代理对。
function normalizeReplyUserText(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new Error('聊天语音上一句对话必须为文本');
    return Array.from(value.trim().slice(0, MAX_REPLY_USER_TEXT_CHARS * 2))
        .slice(0, MAX_REPLY_USER_TEXT_CHARS).join('') || null;
}

function isReplyBusiness(businessType) {
    return [BUSINESS_TYPES.AI_REPLY, BUSINESS_TYPES.AGENT_REPLY].includes(businessType);
}

function createDoubaoAdditions(request, settings) {
    if (!isReplyBusiness(request.businessType) || settings.resourceId !== 'seed-tts-2.0' || settings.model) return null;
    const userText = normalizeReplyUserText(request.userText);
    return userText ? JSON.stringify({ context_texts: [userText] }) : null;
}

module.exports = { MAX_REPLY_USER_TEXT_CHARS, normalizeReplyUserText, isReplyBusiness, createDoubaoAdditions };

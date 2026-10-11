'use strict';

const { BUSINESS_TYPES } = require('../tts/tts-provider-policy');
const { normalizeReplyUserText } = require('../tts/tts-reply-user-text');
const REPLY_BUSINESSES = new Set([BUSINESS_TYPES.AI_REPLY, BUSINESS_TYPES.AGENT_REPLY]);

// 对应.src/framework/tts-provider-configuration.md：手动回复播放只接受来源，配置取服务端权威模板。
function resolveChatReplyTtsOptions(context, { getTemplateByName } = {}) {
    if (context === undefined || context === null) return {};
    if (typeof context !== 'object' || Array.isArray(context) || !REPLY_BUSINESSES.has(context.businessType)) {
        throw new Error('聊天语音来源必须为AI或Agent回复');
    }
    const name = context.templateName ?? '';
    if (typeof name !== 'string' || name.length > 512 || /[\x00-\x1f\x7f]/u.test(name)) {
        throw new Error('聊天语音模板名称不合法');
    }
    const template = name.trim() ? getTemplateByName(name.trim()) : null;
    // 在请求开始时复制配置，同一批分句不受后续模板修改影响。
    const userText = normalizeReplyUserText(context.userText);
    return { businessType: context.businessType, templateTts: template?.tts ? { ...template.tts } : undefined,
        ...(userText ? { userText } : {}) };
}

module.exports = { resolveChatReplyTtsOptions };

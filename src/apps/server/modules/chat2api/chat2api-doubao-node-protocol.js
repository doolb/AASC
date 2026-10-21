const { randomUUID } = require('crypto');

const PROFILE_FIELDS = new Set(['deviceId', 'webId', 'fp', 'userAgent', 'pcVersion', 'msToken']);
const invalidProfile = () => Object.assign(new Error('豆包 Cookie 或 CSRF 格式无效，请检查网页登录凭据'), {
  statusCode: 422, code: 'doubao_invalid_credentials',
});

/**
 * Node 模式由账号凭据显式选择，身份参数必须属于该账号。只返回规范副本；禁止携带任意
 * URL、请求头或网页签名字段，避免账号导入成为跨来源请求或头部注入的入口。
 */
const normalizeDoubaoNodeProfile = (profile) => {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)
    || Object.keys(profile).some(key => !PROFILE_FIELDS.has(key))) throw invalidProfile();
  for (const key of ['deviceId', 'webId']) {
    if (typeof profile[key] !== 'string' || !/^[0-9]{1,32}$/u.test(profile[key])) throw invalidProfile();
  }
  if (typeof profile.fp !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/u.test(profile.fp)
    || typeof profile.userAgent !== 'string' || profile.userAgent.length > 512
    || !/^Mozilla\/5\.0 [\x20-\x7E]{10,}$/u.test(profile.userAgent)) throw invalidProfile();
  const pcVersion = Object.hasOwn(profile, 'pcVersion') ? profile.pcVersion : '3.41.0';
  if (typeof pcVersion !== 'string' || !/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/u.test(pcVersion)) throw invalidProfile();
  if (Object.hasOwn(profile, 'msToken') && (typeof profile.msToken !== 'string'
    || !/^[\x21-\x7E]{1,4096}$/u.test(profile.msToken))) throw invalidProfile();
  return { deviceId: profile.deviceId, webId: profile.webId, fp: profile.fp, userAgent: profile.userAgent,
    pcVersion, ...(profile.msToken !== undefined ? { msToken: profile.msToken } : {}) };
};

/**
 * 使用已由真实 Node 新会话验证的官网网页协议。设备元信息初始化后，发送完全在 Node
 * 内完成，不依赖 CDP、页面 fetch 或 a_bogus。真实 msToken 可选，不随机生成假令牌。
 */
const applyDoubaoNodeProtocol = ({ data, profile, cookieMap }) => {
  const params = new URLSearchParams({
    aid: '497858', real_aid: '497858', device_id: profile.deviceId,
    web_id: profile.webId, tea_uuid: profile.webId, device_platform: 'web',
    doubao_device_platform: 'web', web_platform: 'browser', language: 'zh',
    region: 'CN', sys_region: 'CN', pc_version: profile.pcVersion, doubao_pc_version: profile.pcVersion,
    pkg_type: 'release_version', version_code: '20800', samantha_web: '1',
    'use-olympus-account': '1', fp: profile.fp, web_tab_id: randomUUID(),
    tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  });
  const msToken = cookieMap.get('msToken') || profile.msToken;
  if (msToken) params.set('msToken', msToken);
  // 首轮为0；续接已由会话模块设置为真实验证的null，不得在此覆盖为旧索引。
  if (data.option.need_create_conversation && data.option.need_deep_think === 0) {
    const now = Date.now();
    data.client_meta.last_message_index = null;
    data.client_meta.local_permissions = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION']
      .map(permission_name => ({ permission_name, status: 3 }));
    data.messages[0].content_block[0].extra_info = {};
    const option = data.option;
    Object.assign(option, {
      create_time_ms: now, answer_with_suggest: false, agent_mode: 2,
      is_from_click_option: false, is_from_click_softlink: false, is_select_text: false,
      conversation_init_ext: { model_item_key: '0', reasoning_effort: '3', mode_id: '1' },
      is_old_user: true, general_task_param: { server_do_compare: true },
      recovery_option: { is_recovery: false, req_create_time_sec: Math.floor(now / 1000), append_sse_event_scene: 0 },
      message_storage_type: 0, related_deleted_message_ids: {}, connector_info_list: [],
      model_config: { model_item_key: '0', model_extra_params: {}, reasoning_effort: 3 },
      aggregate_params: { mention_skill_list: '[]', mention_plugin_list: '[]', mention_ext: '[{}]',
        conversation_mode: '1', mode_id: '1', model_item_key: '0', agent_mode: '2', reasoning_effort: '3', provider_id: '' },
      conversation_mode: 1, sse_recv_event_options: { support_chunk_delta: true },
    });
    data.user_context = [];
    Object.assign(data.ext, { agent_mode: '2', general_task_param: '{"server_do_compare":true}',
      is_finish: '1', conversation_init_option: '{"need_ack_conversation":true}' });
  } else {
    if (data.option.need_create_conversation !== false) data.client_meta.last_message_index = 0;
    Object.assign(data.messages[0].content_block[0], { is_finish: true, patch_type: 2 });
    Object.assign(data.option, { create_time_ms: 0, answer_with_suggest: true, action_bar_skill_id: 0,
      sse_recv_event_options: { support_chunk_delta: true } });
    data.chat_ability = {};
    Object.assign(data.ext, { fp: profile.fp, use_submit_pipeline: '1' });
  }
  return { url: `https://www.doubao.com/chat/completion?${params.toString()}`,
    headers: { 'User-Agent': profile.userAgent, Referer: 'https://www.doubao.com/chat' } };
};

module.exports = { normalizeDoubaoNodeProfile, applyDoubaoNodeProtocol };

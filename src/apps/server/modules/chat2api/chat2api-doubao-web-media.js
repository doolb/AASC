'use strict';

const { randomUUID } = require('node:crypto');
const { parseDoubaoCookieHeader } = require('./chat2api-doubao-cookie-snapshot');

const ORIGIN = 'https://www.doubao.com';
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const parseRecord = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
};
const publicError = (code, message, statusCode = 502) => Object.assign(new Error(message), { code, statusCode });
const checkPrompt = value => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 16 * 1024) {
    throw publicError('doubao_media_prompt', '豆包媒体描述无效', 400);
  }
  return value.trim();
};
const checkKeys = input => {
  const source = input == null ? [] : Array.isArray(input) ? input : [input];
  if (source.length > 8 || source.some(key => typeof key !== 'string'
    || !/^[\w/.-]{1,512}$/u.test(key) || key.includes('..'))) {
    throw publicError('doubao_media_reference', '豆包参考图片标识无效', 400);
  }
  return [...new Set(source)];
};
const parseSamanthaEvents = raw => {
  const events = [];
  for (const block of raw.split(/\r?\n\r?\n/u)) {
    const data = block.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!data) continue;
    const parsed = parseRecord(data);
    if (Object.keys(parsed).length) events.push(parsed);
  }
  return events;
};
const eventMessages = events => {
  const result = [];
  for (const event of events) {
    if (Number(event.event_type) === 2005) throw publicError('doubao_media_upstream', '豆包媒体生成失败');
    if (Number(event.event_type) !== 2001) continue;
    const detail = parseRecord(event.event_data);
    result.push({ detail, message: parseRecord(detail.message), content: parseRecord(parseRecord(detail.message).content) });
  }
  return result;
};
const mediaQuery = account => {
  const profile = account?.credentials?.nodeProfile;
  if (!profile?.deviceId || !profile?.webId || !profile?.fp) {
    throw publicError('doubao_media_profile', '豆包账号缺少网页设备资料', 422);
  }
  const cookies = new Map(parseDoubaoCookieHeader(account.credentials.cookie)
    .map(({ name, value }) => [name, value]));
  const params = new URLSearchParams({ aid: '497858', device_id: profile.deviceId,
    device_platform: 'web', doubao_device_platform: 'web', web_platform: 'browser', fp: profile.fp,
    language: 'zh', pc_version: profile.pcVersion || '3.41.0',
    doubao_pc_version: profile.pcVersion || '3.41.0', pkg_type: 'release_version',
    real_aid: '497858', region: 'CN', sys_region: 'CN', samantha_web: '1', tea_uuid: profile.webId,
    tz_name: 'Asia/Shanghai', 'use-olympus-account': '1', version_code: '20800',
    web_id: profile.webId, web_tab_id: randomUUID() });
  if (cookies.get('msToken')) params.set('msToken', cookies.get('msToken'));
  return `${ORIGIN}/samantha/chat/completion?${params.toString()}`;
};
const makePayload = (kind, input) => {
  const prompt = checkPrompt(input.prompt);
  const definitions = {
    image: { contentType: 2009, skill: 3 },
    music: { contentType: 2005, skill: 9 },
    video: { contentType: 2020, skill: 17 },
  };
  const definition = definitions[kind];
  if (!definition) throw publicError('doubao_media_operation', '豆包媒体操作无效', 400);
  const content = { text: prompt };
  if (input.ratio) {
    if (!['1:1', '16:9', '9:16', '4:3', '3:4'].includes(input.ratio)) {
      throw publicError('doubao_media_ratio', '豆包媒体画幅比例无效', 400);
    }
    content.ratio = input.ratio;
  }
  if (kind === 'music' && input.lyric) content.lyric = checkPrompt(input.lyric);
  if (kind === 'music' && input.genre) content.genre = checkPrompt(input.genre);
  const references = checkKeys(input.refImageKeys || input.refImageKey);
  if (input.memoryType !== undefined && ![0, 2].includes(input.memoryType)) {
    throw publicError('doubao_media_memory', '豆包媒体历史选项无效', 400);
  }
  if (input.saveHistory !== undefined && typeof input.saveHistory !== 'boolean') {
    throw publicError('doubao_media_memory', '豆包媒体历史选项无效', 400);
  }
  const memoryType = input.memoryType ?? (input.saveHistory === false ? 2 : 0);
  const attachments = kind === 'music' ? [] : references.map(key => ({ type: 'image', key,
    ...(kind === 'image' ? { extra: { refer_types: 'overall' } } : {}) }));
  return {
    messages: [{ content: JSON.stringify(content), content_type: definition.contentType,
      attachments, references: [], skill: {
        skill_type: definition.skill, skill_type_no_default: definition.skill,
        skill_id: String(definition.skill), skill_id_no_default: String(definition.skill),
      } }],
    completion_option: { is_regen: false, with_suggest: true, need_create_conversation: true,
      launch_stage: 1, is_replace: false, is_delete: false, is_ai_playground: false,
      memory_type: memoryType, message_from: 0, use_deep_think: false, use_auto_cot: false,
      resend_for_regen: false, enable_commerce_credit: false, action_bar_skill_id: definition.skill },
    evaluate_option: { web_ab_params: '' }, local_conversation_id: randomUUID(),
    local_message_id: randomUUID(),
  };
};
const collectResponse = async response => {
  if (response.status !== 200) {
    response.data?.destroy?.();
    throw publicError('doubao_media_upstream', '豆包媒体请求失败', response.status);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.data) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_MEDIA_BYTES) throw publicError('doubao_media_limit', '豆包媒体结果超过容量限制');
    chunks.push(Buffer.from(chunk));
  }
  return parseSamanthaEvents(Buffer.concat(chunks).toString('utf8'));
};
const decodeUrl = value => {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = Buffer.from(value, 'base64').toString('utf8');
    return /^https:\/\//u.test(url) ? url : '';
  } catch { return ''; }
};
const extractImage = messages => messages.flatMap(({ message, content }) => {
  if (Number(message.content_type) !== 2010) return [];
  return (Array.isArray(content.data) ? content.data : []).filter(item => item && typeof item === 'object').map(item => ({
    key: item.key || '', url: item.image_ori?.url || item.image_raw?.url || item.image_thumb?.url || '',
    width: item.image_ori?.width || item.image_thumb?.width || 0,
    height: item.image_ori?.height || item.image_thumb?.height || 0,
    format: item.image_ori?.format || item.image_thumb?.format || '',
  })).filter(item => /^https:\/\//u.test(item.url));
});
const extractMusic = messages => {
  const last = messages.filter(({ message }) => [2006, 2004].includes(Number(message.content_type))).at(-1)?.content;
  const tasks = last?.tasks && typeof last.tasks === 'object' ? Object.values(last.tasks) : [];
  return tasks.map(task => {
    const videoModel = parseRecord(task.video_model);
    const firstVideo = Object.values(videoModel.video_list || {})[0];
    return { audio_url: decodeUrl(firstVideo?.main_url), title: task.title || '',
      lyrics: task.lyric || '', duration: videoModel.video_duration || 0,
      cover_url: task.cover?.image_ori?.url || '' };
  }).filter(track => track.audio_url || track.title);
};
const extractVideo = messages => messages.flatMap(({ message, content }) => {
  if (Number(message.content_type) !== 2021) return [];
  const items = (Array.isArray(content.data) ? content.data : [content])
    .filter(item => item && typeof item === 'object');
  return items.map(item => {
    const model = parseRecord(item.video_model);
    const firstVideo = Object.values(model.video_list || {})[0];
    return { video_url: item.video_url || item.url || decodeUrl(firstVideo?.main_url),
      cover_url: item.cover_url || item.cover?.url || '', width: item.width || 0,
      height: item.height || 0, duration: item.duration || 0 };
  }).filter(video => /^https:\/\//u.test(video.video_url));
});

/** 媒体任务沿用当前账号浏览器；视频任务第二阶段仍固定同一账号，不自动切号。 */
const createDoubaoWebMediaService = ({ bridge, dataStore, accountId = '' }) => {
  const chooseAccount = async () => {
    const accounts = await dataStore.readCollection('accounts', []);
    const candidates = accounts.filter(item => item.providerId === 'doubaochat'
      && item.enabled !== false && (!item.status || item.status === 'active')
      && (!accountId || item.accountId === accountId));
    if (candidates.length !== 1) throw publicError('doubao_media_account',
      '请选择唯一可用的豆包网页账号', 409);
    return candidates[0];
  };
  const send = async (account, payload, signal, timeoutMs = 120_000) => collectResponse(await bridge.request({ account,
    sessionKey: `media-${randomUUID()}`, ephemeral: true,
    prepared: { url: mediaQuery(account), data: payload },
    signal, limits: { timeoutMs, streamBytes: MAX_MEDIA_BYTES } }));
  const uploadImage = async ({ filename = 'image.png', data }, { signal } = {}) => {
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > 10 * 1024 * 1024
      || typeof filename !== 'string' || !/^[\w.-]{1,128}$/u.test(filename)) {
      throw publicError('doubao_image_input', '豆包图片上传数据无效', 400);
    }
    const extension = filename.split('.').at(-1).toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(extension)) {
      throw publicError('doubao_image_input', '豆包图片格式无效', 400);
    }
    const account = await chooseAccount();
    const baseUrl = mediaQuery(account);
    const requestJson = async (path, payload, bodyType = 'json') => {
      const response = await bridge.request({ account, sessionKey: `upload-${randomUUID()}`,
        ephemeral: true, prepared: { url: baseUrl.replace('/samantha/chat/completion', path), data: payload, bodyType },
        signal, limits: { timeoutMs: 60_000, streamBytes: 1024 * 1024 } });
      if (response.status !== 200) {
        response.data?.destroy?.();
        throw publicError('doubao_image_upstream', '豆包图片上传失败', response.status);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.data) {
        size += Buffer.byteLength(chunk);
        if (size > 1024 * 1024) throw publicError('doubao_image_limit', '豆包图片上传响应过大');
        chunks.push(Buffer.from(chunk));
      }
      const result = parseRecord(Buffer.concat(chunks).toString('utf8'));
      if (Number(result.code) !== 0) throw publicError('doubao_image_upstream', '豆包图片上传失败');
      return result.data || {};
    };
    const uploaded = await requestJson('/samantha/pages/upload_image', {
      filename, extension, base64: data.toString('base64') }, 'image-upload');
    const uri = uploaded.uri;
    if (typeof uri !== 'string' || !uri || uri.length > 1024) {
      throw publicError('doubao_image_protocol', '豆包图片上传未返回标识');
    }
    const resolved = await requestJson('/alice/message/get_file_url', {
      uris: [uri], type: 'image', format: extension, expire_second: 3600,
    });
    const info = resolved.file_urls?.[0] || {};
    const cdnUrl = info.main_url || info.url || '';
    if (!/^https:\/\//u.test(cdnUrl)) throw publicError('doubao_image_protocol', '豆包图片下载地址无效');
    return { uri: info.uri || uri, cdn_url: cdnUrl, name: filename, format: extension,
      width: Number(info.width) || 0, height: Number(info.height) || 0 };
  };
  const generate = async (kind, input, { signal } = {}) => {
    const account = await chooseAccount();
    const prompt = checkPrompt(input?.prompt);
    const messages = eventMessages(await send(account, makePayload(kind, { ...input, prompt }), signal));
    if (kind === 'image') return { images: extractImage(messages), prompt };
    if (kind === 'music') return { tracks: extractMusic(messages), prompt };
    const taskId = messages.find(({ detail }) => detail.fin_reason?.reason === 1)?.detail.fin_reason?.async_task?.id;
    if (!taskId) return { videos: extractVideo(messages), prompt };
    if (typeof taskId !== 'string' || taskId.length > 256) throw publicError('doubao_media_protocol', '豆包视频任务标识无效');
    const polled = eventMessages(await send(account, { task_id: taskId, event_id: 0 }, signal, 300_000));
    return { videos: extractVideo(polled), prompt };
  };
  return { generate, uploadImage };
};

module.exports = { createDoubaoWebMediaService, makePayload, parseSamanthaEvents,
  extractImage, extractMusic, extractVideo, mediaQuery };

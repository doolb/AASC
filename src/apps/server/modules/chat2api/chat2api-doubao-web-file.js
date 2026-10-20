'use strict';

const { randomUUID, createHash, createHmac } = require('node:crypto');
const { mediaQuery } = require('./chat2api-doubao-web-media');
const { buildDoubaoRequest, DOUBAO_LIMITS, DOUBAO_MODEL_MODES,
  createRequestControl, consumeDoubaoStream } = require('./chat2api-doubao-chat-adapter');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['txt', 'pdf', 'docx', 'doc', 'csv', 'xlsx', 'xls', 'pptx', 'ppt',
  'md', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp',
  'mp3', 'wav', 'm4a', 'ogg', 'aac', 'mp4', 'mov', 'avi', 'webm', 'mkv']);
const fileError = (code, message, statusCode = 502) => Object.assign(new Error(message), { code, statusCode });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sign = (key, value) => createHmac('sha256', key).update(value).digest();
const crc32 = bytes => {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, '0');
};
const awsHeaders = ({ method, url: value, body = '', accessKey, secretKey, sessionToken, now = new Date() }) => {
  const url = new URL(value);
  if (url.origin !== 'https://www.doubao.com' || url.pathname !== '/top/v1') {
    throw fileError('doubao_file_endpoint', '豆包文件接口地址无效');
  }
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/gu, '');
  const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replace(/:/gu, '')}Z`;
  // AWS V4 与参考实现按字符码位排序；localeCompare 会把小写 s 排到大写 ServiceId 前面。
  const canonicalQuery = [...url.searchParams.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`).join('&');
  const signed = { host: url.hostname, 'x-amz-date': amzDate };
  if (sessionToken) signed['x-amz-security-token'] = sessionToken;
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map(name => `${name}:${signed[name]}\n`).join('');
  const signedHeaders = names.join(';');
  const payloadHash = sha256(body);
  const canonicalRequest = `${method}\n${url.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/cn-north-1/imagex/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const signingKey = sign(sign(sign(sign(Buffer.from(`AWS4${secretKey}`), dateStamp),
    'cn-north-1'), 'imagex'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return { Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}) };
};
const parseResponse = async (response, limit = 1024 * 1024) => {
  if (response.status !== 200) {
    response.data?.destroy?.();
    throw fileError('doubao_file_upstream', '豆包文件请求失败', response.status);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.data) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw fileError('doubao_file_limit', '豆包文件响应过大');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fileError('doubao_file_protocol', '豆包文件响应格式无效'); }
};
const validateUri = value => {
  if (typeof value !== 'string' || !/^[\w/.-]{1,1024}$/u.test(value) || value.includes('..')) {
    throw fileError('doubao_file_uri', '豆包文件标识无效', 400);
  }
  return value;
};

/** 与参考仓库一致的 Prepare→Apply→TOS→Commit 流程，账号始终固定。 */
const createDoubaoWebFileService = ({ bridge, dataStore, accountId = '', fetchClient = globalThis.fetch }) => {
  const chooseAccount = async () => {
    const accounts = await dataStore.readCollection('accounts', []);
    const matches = accounts.filter(item => item.providerId === 'doubaochat' && item.enabled !== false
      && (!item.status || item.status === 'active') && (!accountId || item.accountId === accountId));
    if (matches.length !== 1) throw fileError('doubao_file_account', '请选择唯一可用的豆包网页账号', 409);
    return matches[0];
  };
  const pageRequest = async (account, path, data, { method = 'POST', customHeaders = {}, signal } = {}) => {
    const url = mediaQuery(account).replace('/samantha/chat/completion', path);
    return parseResponse(await bridge.request({ account, sessionKey: `file-${randomUUID()}`,
      ephemeral: true,
      prepared: { url, data, method, bodyType: method === 'GET' ? 'none' : 'json', customHeaders },
      signal, limits: { timeoutMs: 60_000, streamBytes: 1024 * 1024 } }));
  };
  const upload = async ({ filename, data }, { signal } = {}) => {
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_FILE_BYTES
      || typeof filename !== 'string' || filename.length > 128 || /[\/\\\x00-\x1f]/u.test(filename)) {
      throw fileError('doubao_file_input', '豆包文件上传数据无效', 400);
    }
    const extension = filename.includes('.') ? filename.split('.').at(-1).toLowerCase() : '';
    if (extension && !ALLOWED_EXTENSIONS.has(extension)) {
      throw fileError('doubao_file_input', '豆包文件格式不受支持', 400);
    }
    const account = await chooseAccount();
    const prepared = await pageRequest(account, '/alice/resource/prepare_upload',
      { tenant_id: '5', scene_id: '5', resource_type: 1 }, { signal });
    if (Number(prepared.code) !== 0 || !prepared.data?.service_id || !prepared.data?.upload_auth_token) {
      throw fileError('doubao_file_protocol', '豆包文件准备上传失败');
    }
    const { service_id: serviceId, upload_auth_token: token } = prepared.data;
    if (!token.access_key || !token.secret_key) throw fileError('doubao_file_protocol', '豆包文件上传授权无效');
    const query = new URLSearchParams({ Action: 'ApplyImageUpload', Version: '2018-08-01',
      ServiceId: String(serviceId), NeedFallback: 'true', FileSize: String(data.length),
      FileExtension: extension ? `.${extension}` : '', s: 'jdnfglwfkl' });
    const applyUrl = `https://www.doubao.com/top/v1?${query.toString()}`;
    const auth = { accessKey: token.access_key, secretKey: token.secret_key,
      sessionToken: token.session_token };
    const applied = await parseResponse(await bridge.request({ account,
      ephemeral: true,
      sessionKey: `file-apply-${randomUUID()}`, prepared: { url: applyUrl, data: null,
        method: 'GET', bodyType: 'none', customHeaders: awsHeaders({ method: 'GET', url: applyUrl, ...auth }) },
      signal, limits: { timeoutMs: 60_000, streamBytes: 1024 * 1024 } }));
    const address = applied.Result?.UploadAddress;
    const store = address?.StoreInfos?.[0];
    const host = address?.UploadHosts?.[0];
    if (!store?.StoreUri || !store?.Auth || !address?.SessionKey || typeof host !== 'string'
      || !/^[a-z0-9.-]+\.vodupload\.com$/u.test(host)) {
      throw fileError('doubao_file_protocol', '豆包文件上传地址无效');
    }
    validateUri(store.StoreUri);
    const uploadUrl = `https://${host}/upload/v1/${store.StoreUri}`;
    const uploaded = await fetchClient(uploadUrl, { method: 'POST', signal, body: data,
      redirect: 'error', headers: { Authorization: store.Auth, 'Content-CRC32': crc32(data) } });
    if (!uploaded.ok || Number((await uploaded.json()).code) !== 2000) {
      throw fileError('doubao_file_upstream', '豆包文件存储上传失败');
    }
    const commitBody = JSON.stringify({ SessionKey: address.SessionKey });
    const commitUrl = `https://www.doubao.com/top/v1?${new URLSearchParams({
      Action: 'CommitImageUpload', Version: '2018-08-01', ServiceId: String(serviceId),
    })}`;
    const committed = await parseResponse(await bridge.request({ account,
      ephemeral: true,
      sessionKey: `file-commit-${randomUUID()}`, prepared: { url: commitUrl,
        data: { SessionKey: address.SessionKey }, customHeaders: awsHeaders({
          method: 'POST', url: commitUrl, body: commitBody, ...auth,
        }) }, signal, limits: { timeoutMs: 60_000, streamBytes: 1024 * 1024 } }));
    if (Number(committed.Result?.Results?.[0]?.UriStatus) !== 2000) {
      throw fileError('doubao_file_upstream', '豆包文件提交失败');
    }
    return { uri: validateUri(store.StoreUri), name: filename, size: data.length, file_type: extension };
  };
  const downloadUrl = async (uri, expire = 3600, { signal } = {}) => {
    validateUri(uri);
    if (!Number.isInteger(expire) || expire < 60 || expire > 86_400) {
      throw fileError('doubao_file_expiry', '豆包文件地址有效期无效', 400);
    }
    const account = await chooseAccount();
    const result = await pageRequest(account, '/alice/message/get_file_url', {
      uris: [uri], type: 'file', format: uri.includes('.') ? uri.split('.').at(-1) : '', expire_second: expire,
    }, { signal });
    const url = result.data?.file_urls?.[0]?.main_url;
    if (Number(result.code) !== 0 || typeof url !== 'string' || !/^https:\/\//u.test(url)) {
      throw fileError('doubao_file_protocol', '豆包文件下载地址无效');
    }
    return { url, uri, expires_in: expire };
  };
  const chatWithFile = async ({ fileId, prompt, fileName = 'file.txt', fileSize = 0,
    model = 'doubao' }, { signal } = {}) => {
    validateUri(fileId);
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 16 * 1024
      || typeof fileName !== 'string' || !fileName || fileName.length > 128
      || !Number.isInteger(fileSize) || fileSize < 0 || fileSize > MAX_FILE_BYTES
      || !Object.hasOwn(DOUBAO_MODEL_MODES, model)) {
      throw fileError('doubao_file_chat_input', '豆包文件提问参数无效', 400);
    }
    const account = await chooseAccount();
    const prepared = buildDoubaoRequest({ request: { model, messages: [{ role: 'user', content: prompt }] },
      account, provider: { id: 'doubaochat' } });
    const isImage = /\.(?:png|jpe?g|webp|gif|bmp)$/iu.test(fileName);
    const attachment = isImage ? { type: 1, identifier: randomUUID(), image: {
      name: fileName, uri: fileId, image_ori: { url: '', width: 1024, height: 1024,
        format: fileName.split('.').at(-1).toLowerCase(), url_formats: {} },
      parse_state: 0, review_state: 0,
    } } : { type: 3, identifier: randomUUID(), file: {
      uri: fileId, url: '', file_type: 0, name: fileName, size: fileSize },
      parse_state: 1, review_state: 1, upload_status: 1, progress: 100, src: '',
    };
    prepared.data.messages[0].content_block.unshift({ block_type: 10052, block_id: randomUUID(),
      parent_id: '', meta_info: [], append_fields: [], content: {
        attachment_block: { attachments: [attachment] }, pc_event_block: '',
      } });
    const control = createRequestControl(signal, DOUBAO_LIMITS.timeoutMs);
    const nativeState = {};
    try {
      const response = await control.wait(bridge.request({ account,
        ephemeral: true,
        sessionKey: `file-chat-${randomUUID()}`, prepared, signal: control.signal,
        limits: DOUBAO_LIMITS }).then(value => { control.attach(value?.data); return value; }));
      if (response.status !== 200 || !/^text\/event-stream(?:\s*;|$)/iu.test(response.headers?.['content-type'] || '')) {
        throw fileError('doubao_file_chat_upstream', '豆包文件问答请求失败', response.status);
      }
      let text = '';
      let id = '';
      for await (const chunk of consumeDoubaoStream({ source: response.data, model,
        mode: DOUBAO_MODEL_MODES[model], nativeState, limits: DOUBAO_LIMITS, control })) {
        id = chunk.id;
        text += chunk.choices[0].delta.content || '';
      }
      return { id, text, conversationId: nativeState.observedConversationId || '' };
    } finally { control.cleanup(); }
  };
  return { upload, downloadUrl, chatWithFile };
};

module.exports = { createDoubaoWebFileService, awsHeaders, crc32 };

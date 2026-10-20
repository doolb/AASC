'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');
const { createDoubaoWebMediaService, makePayload, parseSamanthaEvents, mediaQuery } = require('./chat2api-doubao-web-media');

const account = { accountId: 'media-account', providerId: 'doubaochat', credentials: {
  cookie: 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; msToken=mock_token',
  nodeProfile: { deviceId: '1234567890123456789', webId: '9876543210123456789', fp: 'verify_mock_123456789' },
} };
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const wrap = (contentType, content, detail = {}) => event({ event_type: 2001,
  event_data: { ...detail, message: { content_type: contentType, content: JSON.stringify(content) } } });

test('媒体正文按官网 skill 构造，默认保留网页历史并校验画幅', () => {
  const image = makePayload('image', { prompt: '画一只猫', ratio: '1:1', refImageKeys: ['image/key1'] });
  assert.equal(image.messages[0].skill.skill_type, 3);
  assert.equal(image.messages[0].attachments[0].key, 'image/key1');
  assert.equal(image.completion_option.memory_type, 0);
  assert.equal(makePayload('image', { prompt: '猫', saveHistory: false }).completion_option.memory_type, 2);
  assert.equal(makePayload('image', { prompt: '猫', saveHistory: false, memoryType: 0 }).completion_option.memory_type, 0);
  assert.throws(() => makePayload('image', { prompt: '猫', memoryType: 1 }), { code: 'doubao_media_memory' });
  assert.equal(makePayload('music', { prompt: '一首歌' }).messages[0].content_type, 2005);
  assert.equal(makePayload('video', { prompt: '海边' }).messages[0].skill.skill_type, 17);
  assert.throws(() => makePayload('image', { prompt: '猫', ratio: '2:3' }), { code: 'doubao_media_ratio' });
  const url = new URL(mediaQuery(account));
  assert.equal(url.pathname, '/samantha/chat/completion');
  assert.equal(url.searchParams.get('device_id'), account.credentials.nodeProfile.deviceId);
});

test('图片、音乐和异步视频均从同一账号的官网 SSE 解析', async () => {
  const image = wrap(2010, { data: [{ key: 'image/key1', image_ori: {
    url: 'https://example.test/image.png', width: 512, height: 512 } }] });
  const musicUrl = Buffer.from('https://example.test/song.mp3').toString('base64');
  const music = wrap(2006, { tasks: { one: { title: '歌', video_model: JSON.stringify({
    video_list: { one: { main_url: musicUrl } }, video_duration: 15 }) } } });
  const videoStart = wrap(2001, { text: '处理中' }, { fin_reason: { reason: 1, async_task: { id: 'task-1' } } });
  const video = wrap(2021, { data: [{ video_url: 'https://example.test/video.mp4' }] });
  const bodies = [image, music, videoStart, video];
  const requests = [];
  const service = createDoubaoWebMediaService({ accountId: account.accountId,
    dataStore: { readCollection: async () => [account] },
    bridge: { request: async request => {
      requests.push(request);
      return { status: 200, data: Readable.from([bodies.shift()]) };
    } } });
  assert.equal((await service.generate('image', { prompt: '猫' })).images[0].key, 'image/key1');
  assert.equal((await service.generate('music', { prompt: '歌' })).tracks[0].audio_url, 'https://example.test/song.mp3');
  assert.equal((await service.generate('video', { prompt: '海边' })).videos[0].video_url, 'https://example.test/video.mp4');
  assert.equal(requests[3].prepared.data.task_id, 'task-1');
  assert.equal(requests.every(item => item.account.accountId === account.accountId), true);
  assert.equal(parseSamanthaEvents('data: {}\n\n').length, 0);
});

test('图片上传在官网页完成上传和临时 URL 查询，数据不进入日志', async () => {
  const requests = [];
  const answers = [{ code: 0, data: { uri: 'image/key1' } },
    { code: 0, data: { file_urls: [{ uri: 'image/key1', main_url: 'https://example.test/image.png' }] } }];
  const service = createDoubaoWebMediaService({ accountId: account.accountId,
    dataStore: { readCollection: async () => [account] },
    bridge: { request: async request => {
      requests.push(request);
      return { status: 200, data: Readable.from([JSON.stringify(answers.shift())]) };
    } } });
  const result = await service.uploadImage({ filename: 'cat.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  assert.equal(result.uri, 'image/key1');
  assert.equal(requests[0].prepared.bodyType, 'image-upload');
  assert.equal(new URL(requests[0].prepared.url).pathname, '/samantha/pages/upload_image');
  assert.equal(new URL(requests[1].prepared.url).pathname, '/alice/message/get_file_url');
  await assert.rejects(() => service.uploadImage({ filename: 'bad.exe', data: Buffer.from('x') }),
    { code: 'doubao_image_input' });
});

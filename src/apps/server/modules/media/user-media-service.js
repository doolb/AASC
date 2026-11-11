'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { spawn } = require('node:child_process');

const blocked = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(address, prefix, 'ipv4');
function name(value, fallback) {
  const text = String(value || '').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').trim().replace(/^\.+$/, '').slice(0, 80);
  return text || fallback;
}
function externalUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('媒体地址无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || net.isIP(url.hostname) || !url.hostname.includes('.') || /(?:^|\.)(?:local|localhost|internal)$/i.test(url.hostname) || url.href.length > 8192) throw new Error('媒体地址无效');
  return url.href;
}
function decodeId(value) {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(String(value || ''))) throw new Error('媒体标识无效');
  let data;
  try { data = JSON.parse(Buffer.from(value, 'base64url').toString()); } catch { throw new Error('媒体标识无效'); }
  if (!Array.isArray(data) || data.some(item => typeof item !== 'string' || !item || item === '.' || item === '..' || item.includes('/') || item.includes('\\') || item.includes('\0'))) throw new Error('媒体标识无效');
  return data;
}
const encodeId = value => Buffer.from(JSON.stringify(value)).toString('base64url');

// 解析 DNS 后固定连接到校验过的公网 IPv4；重定向逐跳重新校验，避免 DNS 重绑定。
async function openExternal(value, range, dependencies = {}) {
  let current = externalUrl(value);
  for (let i = 0; i <= 4; i++) {
    const url = new URL(current);
    const addresses = await (dependencies.lookup || dns.lookup)(url.hostname, { all: true, family: 4 });
    if (!addresses.length || addresses.some(entry => blocked.check(entry.address, 'ipv4'))) throw new Error('媒体地址不可访问');
    const address = addresses[0].address;
    const headers = range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {};
    const response = await new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? (dependencies.https || https) : (dependencies.http || http);
      const req = client.get(url, { headers, family: 4, lookup: (_host, _options, callback) => callback(null, address, 4), timeout: 30000 }, resolve);
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('媒体请求超时')));
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const next = response.headers.location && new URL(response.headers.location, current);
      response.destroy();
      if (!next || (url.protocol === 'https:' && next.protocol !== 'https:')) throw new Error('媒体重定向无效');
      current = externalUrl(next.href);
      continue;
    }
    if (![200, 206, 416].includes(response.statusCode)) { response.destroy(); throw new Error('媒体请求失败'); }
    return { stream: response, statusCode: response.statusCode, headers: response.headers, finalUrl: current };
  }
  throw new Error('媒体重定向次数过多');
}

function createUserMediaService({ root, open = openExternal }) {
  let pendingSave = Promise.resolve();
  async function directory(parts, create = false) {
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
    let current = await fs.promises.realpath(root);
    for (const part of parts) {
      if (!part || part === '.' || part === '..' || part.includes('/') || part.includes('\\')) throw new Error('媒体目录无效');
      const next = path.join(current, part);
      if (create) { try { await fs.promises.mkdir(next, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
      const stat = await fs.promises.lstat(next);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('媒体目录无效');
      current = next;
    }
    return current;
  }
  async function read(parts) {
    if (parts.length !== 3 || !parts[2].endsWith('.json')) throw new Error('播放列表无效');
    const dir = await directory(parts.slice(0, 2));
    const file = path.join(dir, parts[2]);
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('播放列表无效');
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  }
  async function saveOne(input) {
    const sourceUrl = externalUrl(input?.sourceUrl);
    const site = name(new URL(sourceUrl).hostname, '未知站点');
    const content = name(input?.content, '未命名内容');
    const title = name(input?.title, '播放列表');
    if (!Array.isArray(input?.items) || !input.items.length || input.items.length > 200) throw new Error('播放列表项目数量无效');
    const items = input.items.map((item, index) => ({ title: name(item.title, `第 ${index + 1} 项`), url: externalUrl(item.url), mediaType: ['video', 'audio', 'image'].includes(item.mediaType) ? item.mediaType : 'video' }));
    const dir = await directory([site, content], true);
    const fileName = title + '.json';
    const target = path.join(dir, fileName);
    let previous = [];
    try {
      const stat = await fs.promises.lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('播放列表目标无效');
      const existing = JSON.parse(await fs.promises.readFile(target, 'utf8'));
      if (!Array.isArray(existing.items)) throw new Error('已有播放列表格式无效');
      previous = existing.items;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const combined = [...previous];
    for (const item of items) if (!combined.some(old => old.url === item.url)) combined.push(item);
    if (combined.length > 200) throw new Error('播放列表项目数量超限');
    const temp = path.join(dir, `.capture-${crypto.randomUUID()}.tmp`);
    try { await fs.promises.writeFile(temp, JSON.stringify({ sourceUrl, title, items: combined }, null, 2), { mode: 0o600, flag: 'wx' }); await fs.promises.rename(temp, target); }
    finally { await fs.promises.unlink(temp).catch(() => {}); }
    return { site, content, title, count: items.length };
  }
  function save(input) {
    const result = pendingSave.then(() => saveOne(input));
    pendingSave = result.catch(() => {});
    return result;
  }
  async function browse(parts) {
    if (parts.length < 2) {
      const dir = await directory(parts);
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => ({ id: encodeId([...parts, entry.name]), url: encodeId([...parts, entry.name]), title: entry.name, mediaType: 'collection', downloadable: false }));
    }
    if (parts.length === 2) {
      const dir = await directory(parts);
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => ({ id: encodeId([...parts, entry.name]), url: encodeId([...parts, entry.name]), title: entry.name.slice(0, -5), mediaType: 'collection', downloadable: false }));
    }
    const playlist = await read(parts);
    return Promise.all((Array.isArray(playlist.items) ? playlist.items : []).map(async (item, i) => {
      const hls = /\.m3u8(?:[?#]|$)/i.test(item.url);
      let ready = false;
      if (hls) { try { const dir = await directory([parts[0], parts[1], '下载']); const stat = await fs.promises.lstat(path.join(dir, downloadName(item))); ready = stat.isFile() && !stat.isSymbolicLink(); } catch {} }
      return { id: encodeId([...parts, String(i)]), title: String(item.title || ''), mediaType: item.mediaType || 'video', downloadable: true, playable: !hls || ready, playbackMessage: 'M3U8 请先下载' };
    }));
  }
  function downloadName(item) {
    const ext = path.extname(new URL(item.url).pathname).toLowerCase();
    const fallback = { audio: '.mp3', image: '.jpg', video: '.mp4' };
    const suffix = ext === '.m3u8' ? '.mp4' : (/^\.[a-z0-9]{1,8}$/.test(ext) ? ext : (fallback[item.mediaType] || '.mp4'));
    return name(item.title, '媒体') + suffix;
  }
  async function hlsDownload(url, output) {
    const tempDir = await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(), 'aasc-user-hls-'));
    let total = 0, requests = 0;
    const deadline = Date.now() + 120000;
    async function fetchLimited(target, max, outputFile) {
      if (++requests > 110 || Date.now() > deadline) throw new Error('HLS 请求超限');
      const result = await open(target);
      if (result.statusCode !== 200) { result.stream.destroy(); throw new Error('HLS 请求失败'); }
      let size = 0;
      const chunks = [];
      try {
        for await (const chunk of result.stream) {
          size += chunk.length; total += chunk.length;
          if (size > max || total > 512 * 1024 * 1024 || Date.now() > deadline) throw new Error('HLS 数据超限');
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        if (outputFile) await fs.promises.writeFile(outputFile, data, { flag: 'wx', mode: 0o600 });
        return { data, url: result.finalUrl || target };
      } finally { result.stream.destroy(); }
    }
    async function segments(target, depth) {
      if (depth > 3) throw new Error('HLS 列表嵌套过深');
      const fetched = await fetchLimited(target, 1024 * 1024);
      const text = fetched.data.toString('utf8');
      if (!text.startsWith('#EXTM3U') || /#EXT-X-(?:KEY|SESSION-KEY|MAP|BYTERANGE|DISCONTINUITY|I-FRAME-STREAM-INF)/i.test(text)) throw new Error('HLS 加密或格式不支持');
      const lines = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      const refs = lines.filter(value => !value.startsWith('#'));
      if (!refs.length || refs.length > 100) throw new Error('HLS 分段数量无效');
      if (lines.some(value => value.startsWith('#EXT-X-STREAM-INF:'))) return segments(externalUrl(new URL(refs[0], fetched.url).href), depth + 1);
      if (!lines.includes('#EXT-X-ENDLIST')) throw new Error('HLS 直播暂不支持');
      return refs.map(ref => { const next = externalUrl(new URL(ref, fetched.url).href); if (!/\.ts$/i.test(new URL(next).pathname)) throw new Error('HLS 分段格式不支持'); return next; });
    }
    try {
      const refs = await segments(url, 0); const entries = [];
      for (const [index, ref] of refs.entries()) {
        const filename = `segment${index}.ts`;
        await fetchLimited(ref, 20 * 1024 * 1024, path.join(tempDir, filename));
        entries.push(`file '${filename}'`);
      }
      await fs.promises.writeFile(path.join(tempDir, 'segments.txt'), entries.join('\n'), { flag: 'wx', mode: 0o600 });
      const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-f', 'concat', '-safe', '1', '-i', 'segments.txt', '-c', 'copy', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { cwd: tempDir, stdio: ['ignore', 'pipe', 'ignore'] });
      let written = 0;
      const limit = new Transform({ transform(chunk, encoding, callback) { written += chunk.length; callback(written > 512 * 1024 * 1024 ? new Error('HLS 输出超限') : null, chunk); } });
      const timer = setTimeout(() => child.kill('SIGKILL'), Math.max(1, deadline - Date.now()));
      try {
        const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('HLS 转封装失败'))); });
        const writing = pipeline(child.stdout, limit, fs.createWriteStream(output, { flags: 'wx', mode: 0o600 }));
        writing.catch(() => child.kill('SIGKILL'));
        const results = await Promise.allSettled([exited, writing]);
        if (results.some(result => result.status === 'rejected') || !written) throw new Error('HLS 转封装失败');
      } finally { clearTimeout(timer); }
    } finally { await fs.promises.rm(tempDir, { recursive: true, force: true }); }
  }
  const provider = {
    async home() { return { items: await browse([]) }; },
    async resolveLink({ url }) { return { items: await browse(decodeId(url)) }; },
    async list() { return []; },
    async getFile() { throw new Error('请通过用户文件来源浏览'); },
    async getFileStream() { throw new Error('请通过用户文件来源浏览'); },
    async getStream(id, range) {
      const parts = decodeId(id);
      if (parts.length !== 4 || !/^\d{1,3}$/.test(parts[3])) throw new Error('媒体标识无效');
      const playlist = await read(parts.slice(0, 3));
      const item = playlist.items?.[Number(parts[3])];
      if (!item) throw new Error('媒体不可播放');
      if (/\.m3u8(?:[?#]|$)/i.test(item.url)) {
        const dir = await directory([parts[0], parts[1], '下载']);
        const file = path.join(dir, downloadName(item));
        const stat = await fs.promises.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('媒体文件无效');
        const start = range?.start || 0, end = Math.min(range?.end ?? stat.size - 1, stat.size - 1);
        if (start > end || start >= stat.size) throw new Error('Range 无效');
        return { stream: fs.createReadStream(file, { start, end }), statusCode: range ? 206 : 200, headers: { 'content-type': 'video/mp4', 'content-length': String(end - start + 1), 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${stat.size}` } : {}) } };
      }
      return open(item.url, range);
    }
  };
  async function download(id) {
    const parts = decodeId(id);
    if (parts.length !== 4 || !/^\d{1,3}$/.test(parts[3])) throw new Error('媒体标识无效');
    const playlist = await read(parts.slice(0, 3));
    const item = playlist.items?.[Number(parts[3])];
    if (!item) throw new Error('此媒体暂不支持下载');
    const dir = await directory([parts[0], parts[1], '下载'], true);
    const fileName = downloadName(item);
    const target = path.join(dir, fileName);
    const temp = path.join(dir, `.download-${crypto.randomUUID()}.part`);
    let result;
    try {
      if (/\.m3u8(?:[?#]|$)/i.test(item.url)) await hlsDownload(item.url, temp);
      else {
        result = await open(item.url);
        if (result.statusCode !== 200) throw new Error('下载响应无效');
        await pipeline(result.stream, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
      }
      // link 保证已有文件不会被覆盖，临时文件与目标在同一文件系统。
      await fs.promises.link(temp, target);
      return { fileName };
    } finally { result?.stream?.destroy(); await fs.promises.unlink(temp).catch(() => {}); }
  }
  return { save, provider, download };
}
module.exports = { createUserMediaService, openExternal, externalUrl };

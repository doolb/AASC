// 本机试验服务：复用只读静态报告，仅为自选图片开放一次性HMR推理。
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { start: startStatic } = require('../server.cjs');

const MAX_BYTES = 20 * 1024 * 1024;
const PYTHON = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
const RUNNER = path.join(__dirname, 'run-hmr2.py');

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) { reject(new Error('图片超过20 MiB')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function validate(buffer, rawBox) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) throw new Error('仅接收浏览器处理后的PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 1600 || height > 1600 || width * height > 4_000_000) throw new Error('图片尺寸超限');
  let box;
  try { box = JSON.parse(rawBox); } catch { throw new Error('人物框格式错误'); }
  if (!Array.isArray(box) || box.length !== 4 || !box.every((value) => Number.isSafeInteger(value))) throw new Error('人物框必须为四个整数');
  const [x, y, w, h] = box;
  if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height) throw new Error('人物框超出图片');
  return box;
}

async function inferCustom(file, box, output) {
  const args = [RUNNER, '--custom-image', file, '--custom-box', ...box.map(String), '--custom-output', output];
  await new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { cwd: __dirname, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('HMR推理超时')); }, 120000);
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HMR推理失败 (${code}): ${stderr.slice(-500)}`));
    });
  });
  return JSON.parse(await fs.readFile(output, 'utf8'));
}

async function start(options = {}) {
  const { server: upstream, url: upstreamUrl } = await startStatic();
  let busy = false;
  const server = http.createServer(async (request, response) => {
    if (request.url !== '/api/hmr2-custom' || request.method !== 'POST') {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      // 明确固定代理目标为本机静态服务，客户端URL只提供路径与查询参数。
      const target = new URL(upstreamUrl);
      const requested = new URL(request.url, 'http://127.0.0.1');
      target.pathname = requested.pathname;
      target.search = requested.search;
      const upstreamRequest = http.request(target, { method: request.method }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstreamRequest.on('error', () => response.writeHead(502).end());
      upstreamRequest.end();
      return;
    }
    if (busy) { response.writeHead(429).end('已有推理任务'); return; }
    busy = true;
    let directory;
    try {
      if (request.headers['content-type'] !== 'image/png') throw new Error('需要PNG图片');
      if (Number(request.headers['content-length'] || 0) > MAX_BYTES) throw new Error('图片超过20 MiB');
      const buffer = await readBody(request);
      const box = validate(buffer, request.headers['x-person-box']);
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-hmr-custom-'));
      const file = path.join(directory, 'input.png');
      const output = path.join(directory, 'output.json');
      await fs.writeFile(file, buffer);
      const result = await (options.inferCustom || inferCustom)(file, box, output);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(result));
    } catch (error) {
      if (!response.destroyed) {
        response.writeHead(error.message.includes('推理失败') || error.message.includes('超时') ? 500 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
      }
    } finally {
      if (directory) {
        for (const filename of ['input.png', 'output.json']) await fs.unlink(path.join(directory, filename)).catch(() => {});
        await fs.rmdir(directory).catch(() => {});
      }
      busy = false;
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, upstream, url: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { start, validate };
if (require.main === module) start().then(({ url }) => console.log(`${url}/_depth/hmr2-sam3d/report.html`)).catch((error) => { console.error(error); process.exitCode = 1; });

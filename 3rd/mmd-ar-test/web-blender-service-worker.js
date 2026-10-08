/* Blender WebAssembly 的同源适配入口；工程文件始终来自用户本地目录。 */
'use strict';

const DB_NAME = 'mmd-ar-blender-project';
const DB_VERSION = 2;
const HANDLE_STORE = 'handles';
const CHUNK_STORE = 'chunks';
const HANDLE_KEY = 'active-project';
const PROJECT_ROOT = '/mmd-ar-project';
const ENGINE_VERSION = '__BLENDER_VERSION__';
const BROTLI_ARTIFACTS = new Set(['blender_browser.wasm', 'blender_browser.data', 'essentials.bin']);
const ROUTES = Object.freeze({
  status: '/__editor/blender-wasm/status',
  wasm: '/__editor/blender-wasm/',
  index: '/__editor/blender-project-index',
  file: '/__editor/blender-project-file',
  document: '/__editor/blender-document',
  chunk: '/__editor/blender-document-chunk',
});

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === ROUTES.status) event.respondWith(engineAsset('status'));
  else if (url.pathname.startsWith(ROUTES.wasm)) event.respondWith(engineAsset(url.pathname.slice(ROUTES.wasm.length)));
  else if (url.pathname === ROUTES.index) event.respondWith(projectIndex());
  else if (url.pathname === ROUTES.file) event.respondWith(projectFile(url));
  else if (url.pathname === ROUTES.document && event.request.method === 'POST') event.respondWith(saveManifest(url, event.request));
  else if (url.pathname === ROUTES.chunk && event.request.method === 'POST') event.respondWith(saveChunk(url, event.request));
});

function reply(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

function safePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')) return null;
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  return parts;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HANDLE_STORE)) database.createObjectStore(HANDLE_STORE);
      if (!database.objectStoreNames.contains(CHUNK_STORE)) database.createObjectStore(CHUNK_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function storeRequest(storeName, mode, action) {
  const database = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || transaction.error || new Error('IndexedDB request failed'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
  } finally { database.close(); }
}

async function projectHandle() {
  const handle = await storeRequest(HANDLE_STORE, 'readonly', store => store.get(HANDLE_KEY));
  if (!handle) throw new Error('没有可用的本地工程目录；请重新选择目录');
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('本地工程目录读写权限已失效；请重新授权后重试');
  return handle;
}

async function getFileHandle(root, relative, create = false) {
  const parts = safePath(relative);
  if (!parts) throw new Error(`拒绝非法工程路径：${relative}`);
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create });
  return directory.getFileHandle(parts.at(-1), { create });
}

async function engineAsset(relative) {
  const parts = safePath(relative);
  if (!parts || parts.length !== 1) return new Response('Invalid Blender asset path', { status: 400 });
  const filename = BROTLI_ARTIFACTS.has(parts[0]) ? `${parts[0]}.br` : parts[0];
  const target = new URL(`assets/blender-engine/${ENGINE_VERSION}/${filename}`, self.registration.scope);
  return fetch(target, { cache: 'force-cache' });
}

async function projectIndex() {
  try {
    const root = await projectHandle();
    const files = [];
    const walk = async (directory, prefix = '') => {
      for await (const [name, entry] of directory.entries()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'directory') await walk(entry, relative);
        else {
          const file = await entry.getFile();
          files.push({ path: relative, size: file.size, mtime: file.lastModified });
        }
      }
    };
    await walk(root);
    return reply({ root: PROJECT_ROOT, files });
  } catch (error) { return reply({ error: error.message }, 403); }
}

async function projectFile(url) {
  try {
    const path = url.searchParams.get('path');
    const handle = await getFileHandle(await projectHandle(), path);
    const file = await handle.getFile();
    return new Response(file, { headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(file.size),
      'last-modified': new Date(file.lastModified).toUTCString(),
    } });
  } catch (error) { return new Response(error.message, { status: 404 }); }
}

async function saveChunk(url, request) {
  try {
    await projectHandle();
    const hash = url.searchParams.get('hash');
    if (!/^[a-f0-9]{64}$/u.test(hash || '')) return reply({ error: 'Invalid chunk hash' }, 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 4 * 1024 * 1024) return reply({ error: 'Chunk exceeds 4 MiB' }, 413);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== hash) return reply({ error: 'Chunk SHA-256 mismatch' }, 400);
    await storeRequest(CHUNK_STORE, 'readwrite', store => store.put(bytes, hash));
    return reply({ ok: true });
  } catch (error) { return reply({ error: error.message }, 403); }
}

async function saveManifest(url, request) {
  try {
    const root = await projectHandle();
    const relative = url.searchParams.get('path');
    if (!safePath(relative) || !relative.toLowerCase().endsWith('.blend')) return reply({ error: 'Invalid Blender document path' }, 400);
    const manifest = await request.json();
    if (!Array.isArray(manifest?.chunks) || manifest.chunks.some(row =>
      !Array.isArray(row) || !/^[a-f0-9]{64}$/u.test(row[0]) || !Number.isSafeInteger(row[1]) || row[1] < 0 || row[1] > 4 * 1024 * 1024))
      return reply({ error: 'Invalid Blender document manifest' }, 400);

    const chunks = [];
    const missing = [];
    for (const [hash, size] of manifest.chunks) {
      const bytes = await storeRequest(CHUNK_STORE, 'readonly', store => store.get(hash));
      if (!bytes) {
        missing.push(hash);
        continue;
      }
      if (bytes.byteLength !== size) return reply({ error: `Saved chunk size mismatch: ${hash}` }, 400);
      chunks.push([hash, bytes]);
    }
    if (missing.length) return reply({ ok: false, missing });

    const fileHandle = await getFileHandle(root, relative, true);
    const writable = await fileHandle.createWritable();
    try {
      for (const [, bytes] of chunks) await writable.write(new Uint8Array(bytes));
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    await Promise.all(chunks.map(([hash]) => storeRequest(CHUNK_STORE, 'readwrite', store => store.delete(hash))));
    return reply({ ok: true, ms: { write: 0 } });
  } catch (error) { return reply({ error: error.message }, 403); }
}

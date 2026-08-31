const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_ENGINE = 'wine';
const DEFAULT_PORT = 3001;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const START_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 250;
const HEALTH_TIMEOUT_MS = 1000;
const STOP_TIMEOUT_MS = 3000;
const PROJECT_ROOT = path.resolve(__dirname, '../../../../../../');

function normalizeEngine(value = DEFAULT_ENGINE) {
  const engine = String(value).trim().toLowerCase();
  if (engine !== 'wine' && engine !== 'linux') {
    throw new Error('engine 必须是 wine 或 linux');
  }
  return engine;
}

function normalizePort(value = DEFAULT_PORT) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`port 必须是 ${MIN_PORT} 到 ${MAX_PORT} 的整数`);
  }
  return port;
}

function resolveRuntimeConfig(params = {}, projectRoot = PROJECT_ROOT) {
  const engine = normalizeEngine(params.engine);
  const port = normalizePort(params.port);
  const ttsRoot = path.join(projectRoot, '3rd', 'tts-server');
  const commonEnvironment = {
    PORT: String(port)
  };

  if (engine === 'wine') {
    return {
      engine,
      port,
      host: '127.0.0.1',
      serviceUrl: `http://127.0.0.1:${port}/api/tts`,
      statusUrl: `http://127.0.0.1:${port}/api/tts/status`,
      entryPath: path.join(ttsRoot, 'tts-wine.js'),
      cwd: ttsRoot,
      environment: {
        ...commonEnvironment,
        WINEPREFIX: path.join(ttsRoot, 'wine', 'runtime', 'prefix'),
        WINE_BIN_DIR: path.join(ttsRoot, 'wine', 'bin')
      }
    };
  }

  return {
    engine,
    port,
    host: '127.0.0.1',
    serviceUrl: `http://127.0.0.1:${port}/api/tts`,
    statusUrl: `http://127.0.0.1:${port}/api/tts/status`,
    entryPath: path.join(ttsRoot, 'tts-linux.js'),
    cwd: ttsRoot,
    environment: {
      ...commonEnvironment,
      TTS_LINUX_BIN: path.join(ttsRoot, 'linux', 'bin', 'tts_linux'),
      TTS_LINUX_MODEL_DIR: path.join(ttsRoot, 'models', 'extracted'),
      TTS_LINUX_SDK_DIR: path.join(ttsRoot, 'linux', 'lib')
    }
  };
}

function checkHttpReady(url, timeoutMs = HEALTH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      resolve(ready);
    };

    const request = http.get(url, (response) => {
      response.resume();
      finish(response.statusCode === 200);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      finish(false);
    });
    request.once('error', () => finish(false));
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createTtsServerRuntime(options = {}) {
  const runtime = resolveRuntimeConfig(options.params || options, options.projectRoot || PROJECT_ROOT);
  const spawnProcess = options.spawnProcess || spawn;
  const checkReady = options.checkReady || checkHttpReady;
  const startTimeoutMs = options.startTimeoutMs || START_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
  const log = typeof options.log === 'function' ? options.log : (message) => console.log(message);
  let child = null;
  let status = 'stopped';
  let stopping = false;
  let spawnError = null;

  function getStatus() {
    return {
      status,
      engine: runtime.engine,
      port: runtime.port,
      serviceUrl: runtime.serviceUrl
    };
  }

  function attachChildLogs(processChild) {
    if (processChild.stdout && typeof processChild.stdout.on === 'function') {
      processChild.stdout.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) log(`[tts.server/${runtime.engine}] ${text}`);
      });
    }
    if (processChild.stderr && typeof processChild.stderr.on === 'function') {
      processChild.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) log(`[tts.server/${runtime.engine}] ${text}`);
      });
    }
  }

  async function waitForReady() {
    const deadline = Date.now() + startTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) throw new Error(`TTS ${runtime.engine} 进程启动失败: ${spawnError.message}`);
      if (await checkReady(runtime.statusUrl, HEALTH_TIMEOUT_MS)) return;
      await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    }
    throw new Error(`TTS 服务启动超时: ${runtime.serviceUrl}`);
  }

  async function stop() {
    stopping = true;
    status = 'stopping';
    if (!child || child.exitCode !== null && child.exitCode !== undefined) {
      status = 'stopped';
      return;
    }

    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(forceTimer);
        status = 'stopped';
        resolve();
      };
      const forceTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (error) {
          log(`[tts.server/${runtime.engine}] 强制停止失败: ${error.message}`);
        }
        finish();
      }, STOP_TIMEOUT_MS);

      child.once('exit', finish);
      try {
        child.kill('SIGTERM');
      } catch (error) {
        log(`[tts.server/${runtime.engine}] 停止失败: ${error.message}`);
        finish();
      }
    });
    child = null;
  }

  async function start() {
    if (status === 'running') return getStatus();
    stopping = false;
    spawnError = null;
    status = 'starting';
    try {
      child = spawnProcess(process.execPath, [runtime.entryPath], {
        cwd: runtime.cwd,
        env: { ...process.env, ...runtime.environment },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      attachChildLogs(child);
      child.once('error', (error) => {
        spawnError = error;
        if (!stopping) status = 'failed';
      });
      child.once('exit', (code, signal) => {
        if (!stopping) {
          status = 'failed';
          log(`[tts.server/${runtime.engine}] 子进程退出 code=${code} signal=${signal}`);
        }
      });

      await waitForReady();
      status = 'running';
      return getStatus();
    } catch (error) {
      await stop();
      status = 'failed';
      throw error;
    }
  }

  return {
    ...runtime,
    start,
    stop,
    getStatus
  };
}

function buildWidgetData(status) {
  return {
    statusText: status.status === 'running' ? '运行中' : status.status === 'starting' ? '启动中' : '已停止',
    _statusColor: status.status === 'running' ? '#4ade80' : status.status === 'failed' ? '#f87171' : '#facc15',
    engineText: status.engine,
    portText: String(status.port),
    addressText: status.serviceUrl
  };
}

module.exports = {
  id: 'tts.server',
  name: 'TTS 服务',
  description: '启动本机 Wine/Linux TTS HTTP 服务',
  target: 'server',
  mode: 'service',
  sidebar: { group: 'voiceService', tab: 'announce', label: 'TTS服务', icon: '🗣️', priority: 20 },
  params: [
    { name: 'engine', type: 'select', required: false, default: DEFAULT_ENGINE, options: ['wine', 'linux'], label: 'TTS引擎' },
    { name: 'port', type: 'number', required: false, default: DEFAULT_PORT, label: 'HTTP端口' }
  ],
  widget: {
    html: '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<div>状态：<strong style="color:{{_statusColor}}">{{statusText}}</strong></div>' +
      '<div>引擎：{{engineText}}　端口：{{portText}}</div>' +
      '<div style="font-size:12px">地址：{{addressText}}</div>' +
      '<div><button class="task-card-btn" onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'widgetRefresh\')">刷新</button>' +
      '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'{{instanceId}}\')">停止服务</button></div>' +
    '</div>',
    actions: [{ id: 'widgetRefresh', label: '刷新' }]
  },
  async run(context) {
    const previousUrl = typeof context.getTtsServiceUrl === 'function'
      ? context.getTtsServiceUrl()
      : undefined;
    const factory = context.ttsServerRuntimeFactory || createTtsServerRuntime;
    const runtime = factory({
      params: context.params || {},
      projectRoot: context.projectRoot || PROJECT_ROOT,
      spawnProcess: context.ttsServerSpawn,
      checkReady: context.ttsServerCheckReady,
      startTimeoutMs: context.ttsServerStartTimeoutMs,
      pollIntervalMs: context.ttsServerPollIntervalMs,
      log: context.log
    });
    const pushWidgetUpdate = () => {
      if (typeof context.postWidgetUpdate !== 'function') return;
      context.postWidgetUpdate(buildWidgetData(runtime.getStatus()));
    };

    await runtime.start();
    if (typeof context.setTtsServiceUrl === 'function') {
      context.setTtsServiceUrl(runtime.serviceUrl);
    }
    if (typeof context.onWidgetAction === 'function') {
      context.onWidgetAction('widgetRefresh', async () => {
        pushWidgetUpdate();
        return { success: true, data: runtime.getStatus() };
      });
    }
    pushWidgetUpdate();

    return {
      type: 'service',
      stop: async () => {
        await runtime.stop();
        if (typeof context.setTtsServiceUrl === 'function' && previousUrl !== undefined) {
          context.setTtsServiceUrl(previousUrl);
        }
        pushWidgetUpdate();
      }
    };
  },
  normalizeEngine,
  normalizePort,
  resolveRuntimeConfig,
  createTtsServerRuntime
};

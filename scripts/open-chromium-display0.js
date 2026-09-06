#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const display = ':0';
const displayUrl = 'https://192.168.1.39:8081/display';
const baseEnv = { ...process.env, DISPLAY: display };

function findXauthority() {
  const searchDirectories = ['/tmp', process.env.HOME].filter(Boolean);
  const candidates = [];
  const seen = new Set();

  for (const directory of searchDirectories) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() ||
          !(entry.name === '.Xauthority' || entry.name.startsWith('xauth_'))) {
        continue;
      }

      const candidate = path.join(directory, entry.name);
      if (seen.has(candidate)) {
        continue;
      }

      try {
        fs.accessSync(candidate, fs.constants.R_OK);
      } catch {
        continue;
      }

      seen.add(candidate);
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates) {
    const probe = spawnSync('xdpyinfo', {
      env: { ...baseEnv, XAUTHORITY: candidate },
      stdio: 'ignore',
    });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  return null;
}

const xauthFile = findXauthority();
if (!xauthFile) {
  console.error(`找不到可访问 DISPLAY=${display} 的 XAUTHORITY 文件`);
  process.exit(1);
}

const env = { ...baseEnv, XAUTHORITY: xauthFile };
let keepAwakeTimer = null;
let xsetProcess = null;

function keepDisplayAwake() {
  if (xsetProcess) {
    return;
  }

  let processHandle;
  try {
    processHandle = spawn('xset', ['-dpms'], {
      env: { ...env, DISPLAY: display },
      stdio: 'ignore',
    });
  } catch {
    return;
  }

  xsetProcess = processHandle;
  processHandle.on('error', () => {});
  processHandle.on('close', () => {
    if (xsetProcess === processHandle) {
      xsetProcess = null;
    }
  });
}

function stopKeepDisplayAwake() {
  if (keepAwakeTimer !== null) {
    clearInterval(keepAwakeTimer);
    keepAwakeTimer = null;
  }

  if (xsetProcess) {
    xsetProcess.kill('SIGTERM');
    xsetProcess = null;
  }
}

keepDisplayAwake();
keepAwakeTimer = setInterval(keepDisplayAwake, 10_000);

const chromium = spawn('chromium', [
  '--kiosk',
  '--start-fullscreen',
  '--ignore-certificate-errors',
  '--no-first-run',
  '--no-default-browser-check',
  displayUrl,
], {
  env,
  stdio: 'inherit',
});

let chromiumExited = false;
let shutdownStarted = false;
let shutdownCode = 0;
let forceKillTimer = null;

function finish(code) {
  stopKeepDisplayAwake();
  if (forceKillTimer !== null) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }
  process.exitCode = code;
}

function shutdown(code) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  shutdownCode = code;
  stopKeepDisplayAwake();

  if (chromiumExited) {
    finish(code);
    return;
  }

  chromium.kill('SIGTERM');
  forceKillTimer = setTimeout(() => {
    if (!chromiumExited) {
      chromium.kill('SIGKILL');
    }
  }, 2000);
  forceKillTimer.unref();
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

chromium.on('error', (error) => {
  if (chromiumExited) {
    return;
  }

  chromiumExited = true;
  if (!shutdownStarted) {
    console.error(`启动 Chromium 失败: ${error.message}`);
    finish(1);
  } else {
    finish(shutdownCode);
  }
});

chromium.on('close', (code, signal) => {
  if (chromiumExited) {
    return;
  }

  chromiumExited = true;
  if (shutdownStarted) {
    finish(shutdownCode);
  } else if (signal) {
    finish(128 + (signal === 'SIGINT' ? 2 : 15));
  } else {
    finish(code ?? 1);
  }
});

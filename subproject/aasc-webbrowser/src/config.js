'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3090;
const DEFAULT_BROWSER = 'chromium';
const BROWSER_TYPES = new Set(['vivaldi', 'chromium']);

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function parseArgs(argv = []) {
  let configPath;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--config') {
      throw new Error(`unknown argument ${argv[index]}`);
    }
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('--config requires a value');
    }
    configPath = argv[++index];
  }
  return configPath ? { configPath } : {};
}

function loadConfig(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config must be an object');
  }
  const config = {
    host: raw.host ?? DEFAULT_HOST,
    port: raw.port ?? DEFAULT_PORT,
    browsers: raw.browsers,
    businesses: raw.businesses
  };
  if (typeof config.host !== 'string' || !config.host) throw new Error('host must be a non-empty string');
  config.port = positiveInteger(config.port, 'port');
  if (!config.browsers || typeof config.browsers !== 'object' || Array.isArray(config.browsers) || !Object.keys(config.browsers).length) {
    throw new Error('browsers must be a non-empty object');
  }
  if (!config.businesses || typeof config.businesses !== 'object' || Array.isArray(config.businesses) || !Object.keys(config.businesses).length) {
    throw new Error('businesses must be a non-empty object');
  }

  const profiles = new Map();
  config.browsers = Object.fromEntries(Object.entries(config.browsers).map(([id, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`browser ${id} must be an object`);
    const browser = value.browser ?? DEFAULT_BROWSER;
    if (!BROWSER_TYPES.has(browser)) throw new Error(`browser ${id} must use vivaldi or chromium`);
    const debugPort = positiveInteger(value.debugPort, `browser ${id} debugPort`);
    if (value.profile !== undefined) {
      if (typeof value.profile !== 'string' || !value.profile) throw new Error(`browser ${id} profile must be a path`);
      const profile = path.resolve(value.profile);
      if (profiles.has(profile)) throw new Error(`profile ${profile} is used by multiple browsers`);
      profiles.set(profile, id);
    }
    return [id, {
      ...value,
      browser,
      debugPort,
      ...(value.profile === undefined ? {} : { profile: path.resolve(value.profile) })
    }];
  }));

  config.businesses = Object.fromEntries(Object.entries(config.businesses).map(([id, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`business ${id} must be an object`);
    if (typeof value.browser !== 'string' || !config.browsers[value.browser]) {
      throw new Error(`business ${id} references an unknown browser ${value.browser}`);
    }
    return [id, { ...value }];
  }));
  return config;
}

module.exports = { loadConfig, parseArgs, positiveInteger };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, parseArgs } = require('../src/config');

function writeConfig(value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-webbrowser-config-'));
  const filePath = path.join(directory, 'config.json');
  fs.writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

const baseConfig = {
  browsers: {
    main: { debugPort: 9222 }
  },
  businesses: {
    first: { browser: 'main' },
    second: { browser: 'main' }
  }
};

test('loads defaults and permits multiple businesses on one browser', () => {
  const config = loadConfig(writeConfig(baseConfig));

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3090);
  assert.equal(config.browsers.main.browser, 'chromium');
  assert.equal(config.browsers.main.debugPort, 9222);
  assert.deepEqual(config.businesses, baseConfig.businesses);
});

test('rejects an invalid browser type', () => {
  assert.throws(
    () => loadConfig(writeConfig({
      browsers: { main: { browser: 'firefox', debugPort: 9222 } },
      businesses: { first: { browser: 'main' } }
    })),
    /browser.*vivaldi.*chromium/i
  );
});

test('rejects a non-positive or non-integer debug port', () => {
  for (const debugPort of [0, -1, 9222.5, '9222']) {
    assert.throws(
      () => loadConfig(writeConfig({
        browsers: { main: { debugPort } },
        businesses: { first: { browser: 'main' } }
      })),
      /debugPort/i
    );
  }
});

test('rejects businesses that reference an unknown browser', () => {
  assert.throws(
    () => loadConfig(writeConfig({
      browsers: { main: { debugPort: 9222 } },
      businesses: { first: { browser: 'missing' } }
    })),
    /unknown browser|does not exist|reference/i
  );
});

test('rejects duplicate configured profile paths', () => {
  assert.throws(
    () => loadConfig(writeConfig({
      browsers: {
        first: { debugPort: 9222, profile: '/tmp/shared-profile' },
        second: { debugPort: 9333, profile: '/tmp/shared-profile' }
      },
      businesses: {
        one: { browser: 'first' },
        two: { browser: 'second' }
      }
    })),
    /profile.*(duplicate|used|multiple)/i
  );
});

test('parses an explicit config path argument', () => {
  const configPath = '/tmp/custom-config.json';
  assert.deepEqual(parseArgs(['--config', configPath]), { configPath });
});

test('rejects unknown and incomplete command-line arguments', () => {
  assert.throws(() => parseArgs(['--unknown']), /unknown|未知/i);
  assert.throws(() => parseArgs(['--config']), /value|参数/i);
});

test('shipped default config includes the four standard businesses', () => {
  const config = loadConfig(path.join(__dirname, '..', 'config.json'));
  for (const businessId of ['main-ai', 'special-ai', 'media', 'daily']) {
    assert.ok(config.businesses[businessId]);
  }
});

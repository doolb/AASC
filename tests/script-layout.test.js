const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

test('test cases stay outside scripts and executable scripts use the unified taxonomy', () => {
    assert.equal(exists('tests'), true);
    assert.equal(exists('src/scripts'), false);
    assert.equal(exists('scripts/api-tests'), false);
    assert.equal(exists('scripts/api-sh'), false);
    assert.equal(exists('scripts/test'), false);

    assert.equal(exists('scripts/test-runners/run-log-brain-tests.js'), true);
    assert.equal(exists('scripts/test-runners/test-tui-integration.js'), true);
    assert.equal(exists('scripts/api/run-all.js'), true);
    assert.equal(exists('scripts/api/api-request.js'), true);
    assert.equal(exists('scripts/api/vision-tui.js'), true);
    assert.equal(exists('scripts/ops/restart-server.js'), true);
    assert.equal(exists('scripts/ops/apk-deploy.js'), true);
    assert.equal(exists('scripts/stress/asr-stress-test.js'), true);
    assert.equal(exists('scripts/stress/tts-stress-test.js'), true);
    assert.equal(exists('scripts/models/download-lfm-vl-model.js'), true);
    assert.equal(exists('scripts/models/download-sensevoice-model.js'), true);

    const testFiles = fs.readdirSync(path.join(ROOT, 'tests'))
        .filter((file) => file.endsWith('.test.js'));
    assert.ok(testFiles.length >= 100, `expected migrated test cases, got ${testFiles.length}`);

    const scriptTestFiles = [];
    function collectScriptTestFiles(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                collectScriptTestFiles(entryPath);
            } else if (entry.name.endsWith('.test.js')) {
                scriptTestFiles.push(entryPath);
            }
        }
    }
    collectScriptTestFiles(path.join(ROOT, 'scripts'));
    assert.deepEqual(scriptTestFiles, [], 'scripts/ 不应包含自动化测试文件');

    const apiShellFiles = fs.readdirSync(path.join(ROOT, 'scripts', 'api'))
        .filter((file) => file.endsWith('.sh'));
    assert.deepEqual(apiShellFiles, [], 'scripts/api/ 不应包含 Shell 脚本');

    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts['restart:server'], 'node scripts/ops/restart-server.js');
    assert.equal(packageJson.scripts.test, 'node --test tests/*.test.js');
    assert.equal(packageJson.scripts['test:log-brain'], 'node scripts/test-runners/run-log-brain-tests.js');
    assert.equal(packageJson.scripts['api:test'], 'node scripts/api/run-all.js');
    assert.equal(packageJson.scripts['stress:tts'], 'node scripts/stress/tts-stress-test.js');
    assert.equal(packageJson.scripts['upload:apk'], 'npm run build:apk && node scripts/ops/apk-deploy.js');
    assert.equal(packageJson.scripts['start:apk:display'], 'node scripts/ops/apk-start.js');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const hashSourcePath = path.join(
    root,
    'src',
    'apps',
    'android-display',
    'app',
    'src',
    'main',
    'java',
    'com',
    'aasc',
    'display',
    'ModelHash.kt'
);
const downloaderPath = path.join(
    root,
    'src',
    'apps',
    'android-display',
    'app',
    'src',
    'main',
    'java',
    'com',
    'aasc',
    'display',
    'ModelDownloader.kt'
);
const managerPath = path.join(
    root,
    'src',
    'apps',
    'android-display',
    'app',
    'src',
    'main',
    'java',
    'com',
    'aasc',
    'display',
    'AsrModelManager.kt'
);
const serverPath = path.join(root, 'src', 'apps', 'server', 'boot', 'server-app.js');
const modelDir = path.join(root, 'res', 'models', 'sensevoice');

test('服务器应提供 ASR 模型及对应 sha256 文件', () => {
    const source = fs.readFileSync(serverPath, 'utf8');
    assert.match(source, /model\.int8\.onnx\.sha256/, '服务端白名单应包含模型 hash 文件');
    assert.match(source, /tokens\.txt\.sha256/, '服务端白名单应包含 tokens hash 文件');
    assert.ok(fs.existsSync(path.join(modelDir, 'model.int8.onnx.sha256')), '模型 hash 文件不存在');
    assert.ok(fs.existsSync(path.join(modelDir, 'tokens.txt.sha256')), 'tokens hash 文件不存在');
});

test('APK 下载完成后应校验 hash，启动时只比较缓存 hash', () => {
    const hashSource = fs.readFileSync(hashSourcePath, 'utf8');
    const downloaderSource = fs.readFileSync(downloaderPath, 'utf8');
    const managerSource = fs.readFileSync(managerPath, 'utf8');

    assert.match(hashSource, /MessageDigest\.getInstance\("SHA-256"\)/, '应使用 SHA-256 计算文件 hash');
    assert.match(downloaderSource, /expectedSha256/, '下载器应接收服务端期望 hash');
    assert.match(downloaderSource, /ModelHash\.matches\(/, '下载完成后应校验临时文件 hash');
    assert.match(managerSource, /modelHashFile/, '管理器应保存模型本地 hash');
    assert.match(managerSource, /tokensHashFile/, '管理器应保存 tokens 本地 hash');
    assert.match(managerSource, /\.sha256/, '启动检查应读取本地 hash 文件');
    assert.match(managerSource, /serverHashes/, '启动检查应读取服务端 hash');
    assert.doesNotMatch(managerSource, /localVerified[\s\S]{0,500}ModelHash\.sha256/, '已有本地验证记录时不应重新计算模型 hash');
});

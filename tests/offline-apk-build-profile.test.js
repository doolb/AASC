'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { prepareRuntimeForProfile } = require('../scripts/ops/build-apk');

test('update-only APK build skips full Android server packaging and passes only update runtime settings', async (t) => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-min-profile-build-'));
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));
    const calls = [];
    const profile = {
        profile: 'allserver-min',
        offline: true,
        embeddedNode: true,
        updateOnly: true,
        features: ['display', 'native-update'],
        models: [],
        verifyRuntime: true,
        versionCode: 3,
        versionName: '0.2.1-offline-min'
    };

    const result = await prepareRuntimeForProfile({
        projectRoot,
        profile,
        plan: {
            packageDir: path.join(projectRoot, 'package'),
            runtimeAssetsDir: path.join(projectRoot, 'runtime/assets'),
            runtimeJniLibsDir: path.join(projectRoot, 'runtime/jniLibs')
        },
        offlineUpdatePublicKeyPem: 'offline-update-public-key-fixture',
        prepareServerPackage: async () => {
            calls.push('server-package');
            throw new Error('min must not prepare the Node server package');
        },
        prepareRuntime: async (options) => {
            calls.push(options);
            return { manifest: { updateOnly: true } };
        }
    });

    assert.deepEqual(calls.map((item) => typeof item === 'string' ? item : 'runtime'), ['runtime']);
    assert.equal(calls[0].updateOnly, true);
    assert.equal(Object.hasOwn(calls[0], 'packageDir'), false);
    assert.deepEqual(calls[0].modelIds, []);
    assert.equal(calls[0].offlineUpdatePublicKeyPem, 'offline-update-public-key-fixture');
    assert.equal(result.manifest.updateOnly, true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileImageTargets } = require('../3rd/mmd-ar-test/display-mmd-ar-benchmark-compiler');

test('MindAR 编译适配器把必需的进度回调传给编译器', async () => {
    const progressValues = [];
    const images = [{ width: 256, height: 192 }];
    const expectedResult = [{ target: 'compiled' }];
    const compiler = {
        async compileImageTargets(receivedImages, onProgress) {
            assert.equal(receivedImages, images);
            assert.equal(typeof onProgress, 'function');
            onProgress(25);
            onProgress(100);
            return expectedResult;
        }
    };

    const result = await compileImageTargets(compiler, images, (progress) => progressValues.push(progress));

    assert.equal(result, expectedResult);
    assert.deepEqual(progressValues, [25, 100]);
});

test('MindAR 编译适配器在缺少进度回调时不启动编译', async () => {
    let compileStarted = false;
    const compiler = {
        async compileImageTargets() {
            compileStarted = true;
        }
    };

    await assert.rejects(
        compileImageTargets(compiler, [{}], null),
        /必须提供进度回调/u
    );
    assert.equal(compileStarted, false);
});

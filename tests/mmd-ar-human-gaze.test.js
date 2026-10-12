'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('Human眼球手动角度使用独立范围并默认关闭', async () => {
  const { DEFAULT_GAZE, normalizeHumanGaze } = await import('../3rd/mmd-ar-test/web-human-gaze.mjs');
  assert.deepEqual({ manual: DEFAULT_GAZE.manual, manualYaw: DEFAULT_GAZE.manualYaw, manualPitch: DEFAULT_GAZE.manualPitch },
    { manual: false, manualYaw: 0, manualPitch: 0 });
  assert.deepEqual(normalizeHumanGaze({ manual: true, manualYaw: -30, manualPitch: 20 }),
    { ...DEFAULT_GAZE, manual: true, manualYaw: -30, manualPitch: 20 });
});

test('Human眼球手动角度拒绝越界值', async () => {
  const { normalizeHumanGaze } = await import('../3rd/mmd-ar-test/web-human-gaze.mjs');
  assert.throws(() => normalizeHumanGaze({ manualYaw: -30.1 }), /manualYaw/u);
  assert.throws(() => normalizeHumanGaze({ manualPitch: 20.1 }), /manualPitch/u);
});

test('Human眼球绑定识别左目先和右目先', async () => {
  const { humanGazeBinding } = await import('../3rd/mmd-ar-test/web-human-gaze.mjs');
  const bones = ['頭', '両目', '左目', '右目'].map((name, index) => ({ index, name, dynamic: false,
    bone: { parent: null } }));
  const model = { bindings: { 'bones:head': bones[0], 'bones:neck': null,
    'bones:eyes': bones[1], 'bones:leftEye': bones[2], 'bones:rightEye': bones[3] },
    mesh: { geometry: { userData: { MMD: { bones: [
      {}, {}, { grant: { affectRotation: true, parentIndex: 1, isLocal: false, ratio: 1 } },
      { grant: { affectRotation: true, parentIndex: 1, isLocal: false, ratio: 1 } }
    ] } } } }, bones };
  assert.deepEqual(humanGazeBinding(model).eyeNames, ['両目']);
});

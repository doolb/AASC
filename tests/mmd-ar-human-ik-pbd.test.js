'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('PBD末端误差按杠杆梯度分给整条旋转链并限制单轮角度', async () => {
    const THREE = await import('three');
    const { calculatePbdAngularCorrections } = await import('../3rd/mmd-ar-test/web-human-ik-pbd.mjs');
    const corrections = calculatePbdAngularCorrections(
        new THREE.Vector3(2, 0, 0),
        new THREE.Vector3(0, 2, 0),
        [
            { bone: 'rootward', position: new THREE.Vector3(0, 0, 0), inverseRotationalMass: 1 },
            { bone: 'distal', position: new THREE.Vector3(1, 0, 0), inverseRotationalMass: 2 }
        ],
        { maxStep: Math.PI / 12 }
    );

    assert.equal(corrections.length, 2);
    for (const correction of corrections) {
        assert.equal(correction.axis.z, 1);
        assert.ok(correction.angle > 0 && correction.angle <= Math.PI / 12);
    }
    assert.deepEqual(calculatePbdAngularCorrections(
        new THREE.Vector3(), new THREE.Vector3(0, 1, 0), [], {}), []);
});

test('膝盖偏好点沿基准屈曲侧投影到新的髋踝轴，伸直姿势不生成软约束', async () => {
    const THREE = await import('three');
    const { calculateKneePoleTarget } = await import('../3rd/mmd-ar-test/web-human-ik-pbd.mjs');
    const hip = new THREE.Vector3(0, 1, 0);
    const knee = new THREE.Vector3(0.35, 0, 0.22);
    const ankle = new THREE.Vector3(0, -1, 0);
    const targetAnkle = new THREE.Vector3(0.6, -0.7, 0);
    const pole = calculateKneePoleTarget(hip, knee, ankle, targetAnkle);

    assert.ok(pole);
    const newAxis = targetAnkle.clone().sub(hip).normalize();
    const poleOffset = pole.clone().sub(hip);
    poleOffset.addScaledVector(newAxis, -poleOffset.dot(newAxis));
    assert.ok(poleOffset.length() > 0.1);
    assert.equal(calculateKneePoleTarget(
        hip, new THREE.Vector3(0, 0, 0), ankle, targetAnkle), null);
});

test('PBD位置约束输入异常或退化杠杆时返回安全空结果', async () => {
    const THREE = await import('three');
    const { calculateInverseRotationalMass, calculatePbdAngularCorrections } = await import('../3rd/mmd-ar-test/web-human-ik-pbd.mjs');
    const end = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(0, 1, 0);
    const corrections = calculatePbdAngularCorrections(end, target, [
        { position: new THREE.Vector3(0, -1, 0), inverseRotationalMass: 1 }
    ]);
    assert.deepEqual(corrections, []);
    assert.deepEqual(calculatePbdAngularCorrections(end, target, [
        { position: new THREE.Vector3(1, 0, 0), inverseRotationalMass: Infinity }
    ]), []);
    assert.equal(calculateInverseRotationalMass(0), 4);
    assert.equal(calculateInverseRotationalMass(1), 1);
    assert.equal(calculateInverseRotationalMass(100), 0.25);
    assert.equal(calculateInverseRotationalMass(NaN), 1);
});

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

// 只读取本地已校验资源，复现MMDLoader的父空间pos和左手坐标限位契约。
// 此夹具覆盖真实骨架与Ammo；完整蒙皮、grant、服饰和帧序由浏览器回归验证。
async function makeModel(idle = true) {
    const T = await import('three');
    const { Parser } = await import(root + '/src/apps/web-mediacenter/ui/public/js/vendor/three/libs/mmdparser.module.js');
    const { STATIC_MMD_RELEASE } = require(root + '/src/apps/server/modules/mmd/mmd-resource-service');
    const read = file => {
        const buffer = fs.readFileSync(file);
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    };
    const parser = new Parser();
    const pmx = parser.parsePmx(read(path.join(root, '3rd/mmd-ar-test/model-cache',
        STATIC_MMD_RELEASE.version, 'mmd/miya/miya.pmx')), true);
    const mesh = new T.Group();
    const bones = pmx.bones.map(item => {
        const bone = new T.Bone(); bone.name = item.name; bone.position.fromArray(item.position); return bone;
    });
    pmx.bones.forEach((item, index) => {
        if (item.parentIndex < 0) { mesh.add(bones[index]); return; }
        bones[index].position.sub(new T.Vector3().fromArray(pmx.bones[item.parentIndex].position));
        bones[item.parentIndex].add(bones[index]);
    });
    const data = pmx.bones.map((item, index) => ({ name: item.name, parent: item.parentIndex,
        pos: bones[index].position.toArray(), rotq: [0, 0, 0, 1],
        rigidBodyType: Math.max(-1, ...pmx.rigidBodies.filter(body => body.boneIndex === index).map(body => body.type)) }));
    const iks = pmx.bones.filter(item => item.ik).map(item => ({ links: item.ik.links.map(value => {
        const link = { index: value.index };
        if (value.angleLimitation === 1) {
            const low = value.lowerLimitationAngle, high = value.upperLimitationAngle;
            link.rotationMin = [-high[0], -high[1], low[2]];
            link.rotationMax = [-low[0], -low[1], high[2]];
        }
        return link;
    }) }));
    mesh.geometry = new T.BufferGeometry();
    mesh.geometry.userData.MMD = { bones: data, morphs: [], iks }; mesh.skeleton = { bones };
    if (idle) {
        const vmd = parser.parseVmd(read(path.join(root, '3rd/mmd-ar-test/web-dist/mmd/motions/miya-idle.vmd')), true);
        for (const motion of vmd.motions.filter(item => item.frameNum === 0)) {
            bones.find(bone => bone.name === motion.boneName)?.quaternion.fromArray(motion.rotation);
        }
    }
    mesh.updateWorldMatrix(true, true);
    const { createHumanModel } = await import(root + '/3rd/mmd-ar-test/web-human-model.mjs');
    return { T, model: createHumanModel(mesh, { items: [] }) };
}

module.exports = { makeModel };

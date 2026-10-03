'use strict';

// 逐层写入自写XPBD模块并计算内容指纹；构建只依赖本地源码，不需要联网或编译第三方核心。
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');

async function stageXpbdPhysics({ generatedAssets, physicsWindUrl, physicsRateUrl }) {
    const js = path.join(generatedAssets, 'js');
    const version = async (name) => (await hashFile(path.join(js, name))).sha256.slice(0, 12);
    const write = async (name, replacements = []) => {
        let source = await fs.readFile(path.join(__dirname, name), 'utf8');
        for (const [anchor, replacement] of replacements) {
            if (!source.includes(anchor)) throw new Error('物理构建缺少依赖导入：' + anchor);
            source = source.replaceAll(anchor, replacement);
        }
        await fs.writeFile(path.join(js, name), source);
        return './' + name + '?v=' + await version(name);
    };
    const collisionUrl = await write('web-xpbd-collision.mjs');
    const rigidUrl = await write('web-xpbd-rigid.mjs', [['./web-xpbd-collision.mjs', collisionUrl]]);
    await write('web-xpbd-physics.mjs', [['./web-xpbd-rigid.mjs', rigidUrl],
        ['./web-physics-wind.mjs', physicsWindUrl], ['./web-physics-rate.mjs', physicsRateUrl]]);
    const shadersUrl = await write('web-xpbd-webgl-shaders.mjs');
    const stateUrl = await write('web-xpbd-webgl-state.mjs');
    const jointsUrl = await write('web-xpbd-webgl-joints.mjs', [['./web-xpbd-webgl-shaders.mjs', shadersUrl]]);
    const contactUrl = await write('web-xpbd-webgl-collision.mjs', [['./web-xpbd-webgl-shaders.mjs', shadersUrl]]);
    const solverUrl = await write('web-xpbd-webgl-solver.mjs', [['./web-xpbd-webgl-state.mjs', stateUrl],
        ['./web-xpbd-webgl-shaders.mjs', shadersUrl], ['./web-xpbd-webgl-joints.mjs', jointsUrl],
        ['./web-xpbd-webgl-collision.mjs', contactUrl], ['./web-physics-wind.mjs', physicsWindUrl]]);
    const xpbdPhysicsVersion = await version('web-xpbd-physics.mjs');
    const webglUrl = await write('web-xpbd-webgl-physics.mjs', [['./web-xpbd-physics.mjs', './web-xpbd-physics.mjs?v=' + xpbdPhysicsVersion],
        ['./web-xpbd-rigid.mjs', rigidUrl], ['./web-physics-rate.mjs', physicsRateUrl], ['./web-xpbd-webgl-solver.mjs', solverUrl]]);
    return { xpbdPhysicsVersion, webglUrl };
}

module.exports = { stageXpbdPhysics };

'use strict';

// 构建时仅复制已固定的本地ESM；浏览器、APK和正常网页构建均无需联网或TypeScript工具链。
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { hashFile } = require('./apk-artifact');

async function stagePhysicsBackends({ generatedAssets, physicsWindUrl, physicsRateUrl }) {
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
    const physicsUrl = await write('web-xpbd-physics.mjs', [['./web-xpbd-rigid.mjs', rigidUrl],
        ['./web-physics-wind.mjs', physicsWindUrl], ['./web-physics-rate.mjs', physicsRateUrl]]);
    const vendor = path.join(__dirname, 'vendor/three-xpbd');
    const manifest = JSON.parse(await fs.readFile(path.join(vendor, 'RUNTIME.json'), 'utf8'));
    const provenance = JSON.parse(await fs.readFile(path.join(vendor, 'SOURCE.json'), 'utf8'));
    if (manifest.commit !== provenance.commit) throw new Error('THREE-XPBD源码与转换产物版本不一致，请重建');
    const digest = createHash('sha256');
    const vendorFiles = [...Object.keys(manifest.files), 'LICENSE', 'THREE-LICENSE', 'SOURCE.json', 'RUNTIME.json', 'ADAPTATION.md'].sort();
    for (const name of vendorFiles) {
        const bytes = await fs.readFile(path.join(vendor, name));
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (manifest.files[name] && hash !== manifest.files[name]) throw new Error('THREE-XPBD本地转换产物哈希不符，请重建：' + name);
        digest.update(name + '\0' + hash + '\n');
    }
    const vendorDirectory = 'vendor/three-xpbd-' + digest.digest('hex').slice(0, 12);
    for (const name of vendorFiles) {
        const destination = path.join(js, vendorDirectory, name);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(vendor, name), destination);
    }
    const vendorReplacement = ['./vendor/three-xpbd/', './' + vendorDirectory + '/'];
    const jointUrl = await write('web-three-xpbd-joint.mjs', [vendorReplacement, ['./web-xpbd-rigid.mjs', rigidUrl]]);
    await write('web-three-xpbd-physics.mjs', [vendorReplacement, ['./web-xpbd-rigid.mjs', rigidUrl],
        ['./web-xpbd-physics.mjs', physicsUrl], ['./web-three-xpbd-joint.mjs', jointUrl]]);
    return { xpbdPhysicsVersion: await version('web-xpbd-physics.mjs'),
        threeXpbdPhysicsVersion: await version('web-three-xpbd-physics.mjs') };
}

module.exports = { stagePhysicsBackends };

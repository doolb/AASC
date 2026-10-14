'use strict';

const crypto = require('node:crypto');
const GROUPS = Object.freeze(['common', 'android', 'linux64', 'win64']);
const TARGETS = Object.freeze({
    android: { os: 'android', arch: 'arm64', libc: 'bionic', nodeMajor: 26 },
    linux64: { os: 'linux', arch: 'x64', libc: 'glibc' },
    win64: { os: 'win32', arch: 'x64', libc: 'none' }
});
const SHA256 = /^[a-f0-9]{64}$/;
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAqoSGGeF8nGNdIfC8I/jP
K5Jb0Rsk56+yAy1Cs+xlUGQ9oyTaXBzhxNZORUVS/EiXyQ9FuKRLGYnTo4hplNa8
4GzFANgz2/TOPlgHtgqPntOYPsw3DqySiWuRn5K9A96+EMPhoqi0gGaSU1jlAPXV
Hnw6xXYE3Eb5VL55cAzVOW2IJagSc/rR4cQil3uxOaOhZfEK0GHs2w9QnzqSAEF/
hAck3/njAIxAPIH5y+wuHOzNo/+AxuUou9v+ZkzjX2tsY1/n8K4fV/oINhhacJvc
YJto+kc8ia/XOcXuSkHNmiiIy/yo6qewVR+gUUmyGpYh+hNloiHNhWsaHNvbnpiO
3hDziUQnvFyclcsPsYb0JCpSzkhyUJs1SMYVvTSyhVFyxomgSXM7SJYvRqlMqYI9
gVo5FX3kx+tH3wee/CWPu1VhI+l/xm+dI6Znb5yy2FfKfdvHyEkzXD0xej4AGU0c
WQH09xffI1ABdZep6ug19dcjUUiF+FfgaB79aOLm8sARAgMBAAE=
-----END PUBLIC KEY-----`;

function canonicalJson(value) {
    const normalize = item => {
        if (Array.isArray(item)) return item.map(normalize);
        if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]));
        return item;
    };
    return JSON.stringify(normalize(value));
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function artifact(entry, expectedPath) {
    if (!entry || !positive(entry.version) || !positive(entry.size) || entry.size > 8 * 1024 ** 3 ||
        !SHA256.test(entry.sha256) || entry.relativeUrl !== expectedPath(entry.version)) throw new Error('共享清单组件路径/版本/大小/SHA-256无效');
}
function validateDependencies(dependencies) {
    if (!dependencies || !positive(dependencies.version) || !SHA256.test(dependencies.lockSha256)) throw new Error('共享依赖组合版本/锁指纹无效');
    const groups = dependencies.groups;
    if (!groups || Object.keys(groups).length !== GROUPS.length || GROUPS.some(name => !Object.hasOwn(groups, name))) throw new Error('依赖清单必须包含common/android/linux64/win64四组');
    for (const name of GROUPS) {
        const entry = groups[name];
        artifact(entry, version => `dependencies/${name}/dependencies-v${version}.zip`);
        if (!SHA256.test(entry.contentSha256)) throw new Error(`依赖组${name}内容指纹无效`);
        if (name === 'common') {
            if (entry.target !== null) throw new Error('common依赖不得绑定平台');
            continue;
        }
        const target = entry.target;
        if (!target || Object.entries(TARGETS[name]).some(([key, value]) => target[key] !== value) ||
            (target.nodeAbi !== undefined && !/^[1-9][0-9]{0,4}$/.test(String(target.nodeAbi))) ||
            (target.napiVersion !== undefined && !positive(target.napiVersion))) throw new Error(`依赖组${name}平台/ABI契约无效`);
    }
    if (dependencies.sha256 !== hash(canonicalJson(groups)) || dependencies.size !== GROUPS.reduce((sum, name) => sum + groups[name].size, 0)) throw new Error('依赖组合指纹/大小不匹配');
    return dependencies;
}
function verifyManifest(manifest, publicKey = PUBLIC_KEY, options = {}) {
    if (!manifest?.payload || manifest.signature?.algorithm !== 'SHA256withRSA' ||
        typeof manifest.signature.value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.signature.value) ||
        !crypto.verify('RSA-SHA256', Buffer.from(canonicalJson(manifest.payload)), publicKey, Buffer.from(manifest.signature.value, 'base64'))) throw new Error('共享更新清单签名验证失败');
    const { schemaVersion, components } = manifest.payload;
    if (schemaVersion !== 1 || !components) throw new Error('共享更新清单schemaVersion/components无效');
    artifact(components.code, version => `code/code-v${version}.zip`);
    const dependencies = components.dependencies;
    // 已发布的单依赖包仍可供旧Offline读取；新版普通节点必须使用平台分组。
    if (dependencies?.groups) validateDependencies(dependencies);
    else {
        if (options.requireGroups) throw new Error('当前共享清单尚未发布四组依赖，请构建并发布all更新');
        artifact(dependencies, version => `dependencies/dependencies-v${version}.zip`);
    }
    if (components.code.requiredDependencyVersion !== dependencies.version || !SHA256.test(dependencies.lockSha256) ||
        components.code.requiredLockSha256 !== dependencies.lockSha256) throw new Error('共享代码与依赖组合/锁指纹不匹配');
    return manifest;
}
function selectTarget(options = {}) {
    const os = options.android ? 'android' : options.platform || process.platform;
    const arch = options.arch || process.arch;
    const name = Object.keys(TARGETS).find(key => TARGETS[key].os === os && TARGETS[key].arch === arch);
    if (!name) throw new Error(`没有${os}/${arch}对应依赖组`);
    if (name === 'linux64' && !(options.libc || process.report?.getReport().header.glibcVersionRuntime)) throw new Error('linux64依赖仅支持glibc');
    return name;
}
function assertRuntime(target, options = {}) {
    const os = options.android ? 'android' : options.platform || process.platform;
    const libc = options.libc || (os === 'android' ? 'bionic' : os === 'win32' ? 'none' : process.report?.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl');
    if (target.os !== os || target.arch !== (options.arch || process.arch) || target.libc !== libc ||
        (target.nodeMajor && target.nodeMajor !== Number(options.nodeMajor || process.versions.node.split('.')[0])) ||
        (target.nodeAbi && String(target.nodeAbi) !== String(options.nodeAbi || process.versions.modules)) ||
        (target.napiVersion && target.napiVersion > Number(options.napiVersion || process.versions.napi))) throw new Error('目标依赖平台/Node ABI不兼容，保留当前版本');
}
function dependencyArtifacts(dependencies) { return dependencies.groups ? GROUPS.map(name => dependencies.groups[name]) : [dependencies]; }
module.exports = { GROUPS, TARGETS, PUBLIC_KEY, canonicalJson, hash, artifact, validateDependencies, verifyManifest, selectTarget, assertRuntime, dependencyArtifacts };

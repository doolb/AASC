'use strict';

// 正式显示端与独立构建共用实现；标记由合并时写入，源锚点检查仍适用于未合并的源码。
const MODULE_NAMES = Object.freeze([
    'physics-rate', 'physics-wind', 'xpbd-physics', 'xpbd-rigid', 'xpbd-collision',
    'gravity-filter', 'local-assets', 'local-assets-ui', 'motion-switch',
    'screen-lighting', 'screen-lighting-shader', 'screen-lighting-panel', 'render-settings', 'temporal-aa', 'temporal-aa-shader'
]);
const GLOBAL_NAMES = Object.freeze([
    'KeyShadowSettings', 'ShadowMapSettings', 'ShadowMapLimit', 'FillFacingRange', 'AoConcavityAngle'
]);

function toTestSource(source) {
    for (const name of ['ScreenLightingSupported', 'ScreenLighting', 'RenderSettings', 'RenderInfo']) {
        source = source.replaceAll(`DisplayMmd${name}`, `MmdAr${name}`);
    }
    // 骨骼/碰撞体诊断需要挂在模型提交点；只在构建副本展开共享模型流程。
    const modelModule = 'mmd-model-runtime.mjs';
    if (source.includes(`/* aasc-module-start:${modelModule} */`)) {
        const fs = require('node:fs'), path = require('node:path');
        const moduleSource = fs.readFileSync(path.join(__dirname,
            '../../src/apps/web-mediacenter/ui/public/js', modelModule), 'utf8');
        const body = moduleSource.split('/* aasc-module-body-begin */\n')[1]?.split('/* aasc-module-body-end */')[0];
        if (!body) throw new Error('正式模型共享模块边界缺失');
        source = source.replace(/\/\* aasc-module-start:mmd-model-runtime\.mjs \*\/[\s\S]*?\/\* aasc-module-end:mmd-model-runtime\.mjs \*\//u,
            () => body.replaceAll('context.', ''))
            .replace("import { createPmxModelResources } from './mmd-model-runtime.mjs';\n", '');
    }
    for (const name of MODULE_NAMES) source = source.replaceAll(`mmd-${name}.mjs`, `web-${name}.mjs`);
    for (const name of GLOBAL_NAMES) source = source.replaceAll(`DisplayMmd${name}`, `MmdArTest${name}`);
    return source.replaceAll('aasc.display.mmd.', 'aasc.mmdArTest.')
        .replaceAll('root.DisplayMmdImuCore', 'root.MindBasicImu')
        .replaceAll('root.DisplayMmdGravityCamera', 'root.MmdArGravityCamera');
}

function reuseAdapters(adapters) {
    const result = { ...adapters };
    for (const [name, operation] of Object.entries(adapters)) {
        if (!/^(?:add|align|fix)/u.test(name) || typeof operation !== 'function') continue;
        result[name] = (source, ...args) => {
            const marker = `/* aasc-shared:${name} */`;
            if (typeof source !== 'string' || !source.includes(marker)) return operation(source, ...args);
            let output = toTestSource(source);
            // 内容指纹以当前构建为准，不能复用正式源码中的旧版本查询串。
            for (const url of args.filter(value => typeof value === 'string' && /\.(?:mjs|js)(?:\?|$)/u.test(value))) {
                const file = url.split('/').at(-1).split('?')[0];
                output = output.replace(new RegExp(`(['"])[^'"\\n]*?${file.replaceAll('.', '\\.')}[^'"\\n]*?\\1`, 'gu'),
                    () => JSON.stringify(url));
            }
            if (name.startsWith('addSolver')) {
                return require('./web-production-test-extras').addClothSupport(output, name, args);
            }
            if (name === 'addShadowMapRuntime') {
                return require('./web-production-test-extras').addShadowDiagnostics(output, args[0]);
            }
            return output;
        };
    }
    return result;
}

module.exports = { MODULE_NAMES, GLOBAL_NAMES, toTestSource, reuseAdapters };

// 正式渲染已经接入时，仅转换构建副本的命名空间及指纹，避免重复插入合成/TAA。
module.exports.reuseRenderStage = async (root, names) => {
    const fs = require('node:fs/promises'), path = require('node:path');
    const { hashFile } = require('./apk-artifact');
    for (const file of ['display-pmx-ao.mjs', 'display-pmx-runtime.js']) {
        const target = path.join(root, 'js', file);
        let source = toTestSource(await fs.readFile(target, 'utf8'));
        for (const name of names) {
            const url = `./${name}?v=${(await hashFile(path.join(root, 'js', name))).sha256.slice(0, 12)}`;
            source = source.replace(new RegExp(`(['"])\\./${name.replaceAll('.', '\\.')}[^'"]*\\1`, 'gu'), () => JSON.stringify(url));
        }
        await fs.writeFile(target, source);
    }
};

// 新拆分模块与当前 runtime 同时发布；独立站点的缓存按模块内容失效。
module.exports.fingerprintProductionImports = async (source, generatedAssets) => {
    const fs = require('node:fs/promises'), path = require('node:path');
    const { createHash } = require('node:crypto');
    for (const match of [...source.matchAll(/from ['"](\.\/mmd-[^'"?]+\.mjs)['"]/gu)]) {
        const bytes = await fs.readFile(path.join(generatedAssets, 'js', match[1]));
        const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
        source = source.replaceAll(match[1], `${match[1]}?v=${version}`);
    }
    return source;
};

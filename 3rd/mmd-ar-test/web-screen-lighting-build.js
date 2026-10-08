'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`屏幕光照缺少唯一锚点：${anchor.slice(0, 80)}`);
    return source.replace(anchor, replacement);
}
async function stage(root) {
    const folder = path.join(root, 'js');
    for (const name of ['web-screen-lighting-shader.mjs', 'web-screen-lighting-panel.mjs']) await fs.copyFile(path.join(__dirname, name), path.join(folder, name));
    const shaderUrl = `./web-screen-lighting-shader.mjs?v=${(await hashFile(path.join(folder, 'web-screen-lighting-shader.mjs'))).sha256.slice(0, 12)}`;
    const runtime = (await fs.readFile(path.join(__dirname, 'web-screen-lighting.mjs'), 'utf8')).replace('./web-screen-lighting-shader.mjs', shaderUrl);
    await fs.writeFile(path.join(folder, 'web-screen-lighting.mjs'), runtime);
    const runtimeUrl = `./web-screen-lighting.mjs?v=${(await hashFile(path.join(folder, 'web-screen-lighting.mjs'))).sha256.slice(0, 12)}`;
    const aoPath = path.join(folder, 'display-pmx-ao.mjs');
    let source = await fs.readFile(aoPath, 'utf8');
    source = `import { createScreenLighting } from '${runtimeUrl}';\nimport { compositeChunk } from '${shaderUrl}';\n` + source;
    source = once(source, 'createPmxAmbientOcclusion({ THREE, renderer, scene, camera })', 'createPmxAmbientOcclusion({ THREE, renderer, scene, camera, keyLight })');
    source = once(source, '    let resources = null;', `    let resources = null;
    const screenLighting = createScreenLighting({ THREE, renderer, camera, keyLight });
    window.MmdArScreenLightingSupported = supported;
    window.dispatchEvent(new Event('mmd-ar-screen-lighting-capability'));`);
    source = once(source, 'void main() {\n    vec4 color = texture2D(tColor, vUv);', '${compositeChunk}\nvoid main() {\n    vec4 color = texture2D(tColor, vUv);');
    source = once(source, '        float visibility;', `        if (screenLightingEnabled) {
            vec4 effect = resolveScreenLighting(vUv, depth);
            color.rgb = color.rgb * (1.0 - effect.a) + effect.rgb;
        }
        float visibility;`);
    source = once(source, 'float amount = clamp((1.0 - visibility) * intensity, 0.0, 1.0);', 'float amount = clamp((1.0 - visibility) * intensity * screenAoEnabled, 0.0, 1.0);');
    source = once(source, '        const geometry = new THREE.PlaneGeometry(2, 2);', `        Object.assign(compositeMaterial.uniforms, {
            screenLightingTexture: { value: colorTarget.texture }, screenLightingEnabled: { value: false },
            screenLightingSize: { value: new THREE.Vector2(1, 1) }, screenLightingFullSize: { value: new THREE.Vector2(1, 1) }, screenAoEnabled: { value: 1 }
        });
        const geometry = new THREE.PlaneGeometry(2, 2);`);
    source = once(source, 'if ((!enabled && !normalPreview) || !supported) {', 'if ((!enabled && !normalPreview && !screenLighting.active()) || !supported) {\n            screenLighting.dispose();');
    source = once(source, '            resources.quad.material = resources.aoMaterial;', '            if (enabled || normalPreview) {\n            resources.quad.material = resources.aoMaterial;');
    source = once(source, '            resources.quad.material = resources.compositeMaterial;', `            }
            screenLighting.prepare(resources, fullWidth, fullHeight, normalPreview, enabled);
            resources.quad.material = resources.compositeMaterial;`);
    source = once(source, '    const dispose = () => {', '    const dispose = () => {\n        screenLighting.dispose();');
    await fs.writeFile(aoPath, source);
    const runtimePath = path.join(folder, 'display-pmx-runtime.js');
    let pmx = await fs.readFile(runtimePath, 'utf8');
    const keyDeclaration = '    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);';
    pmx = once(pmx, keyDeclaration + '\n', '');
    pmx = once(pmx, '    const ambientOcclusion =', keyDeclaration + '\n    const ambientOcclusion =');
    // 主光须先声明，再传入AO构造器；后续构建钩子同步使用新锚点。
    await fs.writeFile(runtimePath, once(pmx, 'const ambientOcclusion = createPmxAmbientOcclusion({ THREE, renderer, scene, camera });',
        'const ambientOcclusion = createPmxAmbientOcclusion({ THREE, renderer, scene, camera, keyLight });'));
}
function panel($) {
    const range = (name, label, min, max, step, value) => `<label class="mind-basic-field"><span>${label} <output data-screen-value="${name}">${value}</output></span><input type="range" data-screen-lighting="${name}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
    const blurRadius = index => `<label class="mind-basic-field" data-screen-blur-round="${index}"${index > 1 ? ' hidden' : ''}><span>SSGI第${index}轮模糊半径 <output data-screen-value="giBlurRadius${index}">3 px</output></span><input type="range" data-screen-lighting="giBlurRadius${index}" min="1" max="5" step="1" value="3"></label>`;
    $('#displayMmdLightingReset').before(`<details id="mmdArScreenLighting"><summary>接触阴影 / 间接光（实验）</summary>
    <label><input type="checkbox" data-screen-lighting="contactEnabled">接触阴影</label>
    ${range('contactStrength', '阴影强度', 0, 1, .05, .5)}${range('contactDistance', '阴影距离', .02, 3, .02, .3)}
    <label><input type="checkbox" data-screen-lighting="giEnabled">间接光（SSGI）</label>
    ${range('giStrength', '反弹光强度', 0, 4, .05, 1)}${range('giRadius', '反弹光半径', .1, 10, .1, 2)}
    <label>SSGI模糊轮数 <select data-screen-lighting="giBlurPassCount"><option value="0">0</option><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option></select></label>
     ${[1, 2, 3].map(blurRadius).join('')}
     <label>质量 <select data-screen-lighting="quality"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
    <p data-screen-status style="font-size:12px">实验效果，默认关闭。</p><p style="font-size:12px">模糊只作用于SSGI反弹光颜色；接触阴影alpha不参与模糊。半径按SSGI低分辨率效果像素计，增加轮数会增加GPU开销。</p></details>`);
}
module.exports = { stage, panel };

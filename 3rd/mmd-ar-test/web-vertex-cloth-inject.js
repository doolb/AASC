'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');

// 拓扑/接缝、CPU/GPU求解、渲染及PMX桥接分离，依赖按内容指纹逐级写入。
async function stageVertexCloth({ generatedAssets, physicsWindUrl, physicsRateUrl }) {
    const js = path.join(generatedAssets, 'js');
    const write = async (name, replacements = []) => {
        let source = await fs.readFile(path.join(__dirname, name), 'utf8');
        for (const [anchor, replacement] of replacements) {
            if (source.split(anchor).length !== 2) throw new Error('顶点布料依赖缺少唯一锚点：' + anchor);
            source = source.replace(anchor, replacement);
        }
        await fs.writeFile(path.join(js, name), source);
        return './' + name + '?v=' + (await hashFile(path.join(js, name))).sha256.slice(0, 12);
    };
    const seams = await write('web-vertex-cloth-seams.mjs');
    const topology = await write('web-vertex-cloth-topology.mjs', [['./web-vertex-cloth-seams.mjs', seams]]);
    const contact = await write('web-vertex-cloth-contact.mjs');
    const bvh = await write('web-vertex-cloth-bvh.mjs');
    const surface = await write('web-vertex-cloth-surface.mjs', [['./web-vertex-cloth-contact.mjs', contact], ['./web-vertex-cloth-bvh.mjs', bvh]]);
    const self = await write('web-vertex-cloth-self.mjs', [['./web-vertex-cloth-contact.mjs', contact]]);
    const selfShaders = await write('web-vertex-cloth-self-shaders.mjs');
    const gpuShaders = await write('web-vertex-cloth-gpu-shaders.mjs');
    const gpuData = await write('web-vertex-cloth-gpu-data.mjs');
    const gpuRender = await write('web-vertex-cloth-gpu-render.mjs');
    const gpuSelf = await write('web-vertex-cloth-gpu-self.mjs', [['./web-vertex-cloth-gpu-shaders.mjs', gpuShaders],
        ['./web-vertex-cloth-gpu-data.mjs', gpuData], ['./web-vertex-cloth-self-shaders.mjs', selfShaders]]);
    const budget = await write('web-vertex-cloth-gpu-budget.mjs');
    const gpu = await write('web-vertex-cloth-webgl.mjs', [['./web-vertex-cloth-gpu-budget.mjs', budget], ['./web-vertex-cloth-gpu-shaders.mjs', gpuShaders],
        ['./web-vertex-cloth-gpu-data.mjs', gpuData], ['./web-vertex-cloth-gpu-render.mjs', gpuRender], ['./web-vertex-cloth-gpu-self.mjs', gpuSelf]]);
    const solver = await write('web-vertex-cloth.mjs', [['./web-vertex-cloth-self.mjs', self]]);
    const bridge = await write('web-vertex-cloth-pmx.mjs', [['./web-vertex-cloth-topology.mjs', topology],
        ['./web-vertex-cloth.mjs', solver], ['./web-vertex-cloth-surface.mjs', surface], ['./web-vertex-cloth-webgl.mjs', gpu], ['./web-physics-rate.mjs', physicsRateUrl], ['./web-physics-wind.mjs', physicsWindUrl]]);
    return bridge.replace('./', '../../../');
}
// 换VMD路径也需要Ammo以及顶点速度复位；锚点改变时构建直接报错。
function addClothMotionSwitch(source) {
    for (const [anchor, replacement] of [["physicsSolver === 'ammo'", "physicsSolver !== 'xpbd'"],
        ["physics.engine === 'xpbd'", "physics.engine === 'xpbd' || ['vertex-cloth', 'vertex-cloth-gpu'].includes(physics.engine)"]]) {
        if (source.split(anchor).length !== 2) throw new Error('顶点布料动作切换缺少唯一锚点：' + anchor);
        source = source.replace(anchor, replacement);
    }
    return source;
}
const CLOTH_CONTROL_IDS = ['mmdArVertexClothPanel', 'mmdArVertexClothPreview', 'mmdArVertexClothGroups', 'mmdArVertexClothStatus'];
const CLOTH_PANEL_HTML = `<div id="mmdArVertexClothPanel" hidden>
    <label class="display-mmd-lighting-field"><input id="mmdArVertexClothPreview" type="checkbox"><span>预览固定点 / 自由点</span></label>
    <p class="mind-basic-note">青色固定，橙色可作局部修正。保留原骨骼物理，顶点处理形状跟随与自碰撞；关联附件同步开关。关闭组仍跟随骨骼，作为接触表面。</p>
    <div id="mmdArVertexClothGroups" style="max-height:260px;overflow:auto"></div>
    <p id="mmdArVertexClothStatus" class="mind-basic-note" role="status"></p>
</div>`;
const CLOTH_PANEL_JS = `
    (() => {
        const root = document.getElementById('mmdArVertexClothPanel');
        const list = document.getElementById('mmdArVertexClothGroups');
        const preview = document.getElementById('mmdArVertexClothPreview');
        const status = document.getElementById('mmdArVertexClothStatus');
        const panel = document.getElementById('mmdArMotionPanel');
        if (!root || !list || !preview || !status) return;
        const inputs = new Map(); let key = '', timer = null;
        const update = () => {
            root.hidden = !['vertex-cloth', 'vertex-cloth-gpu'].includes(window.DisplayMmd?.getPhysicsSolver?.());
            if (root.hidden) return;
            const state = window.DisplayMmd?.getPhysicsSolverState?.(), groups = state?.groups || [];
            const nextKey = state?.modelKey + ':' + groups.map((group) => group.id).join(',');
            if (nextKey !== key) {
                key = nextKey; inputs.clear(); const fragment = document.createDocumentFragment();
                groups.forEach((group, index) => {
                    const row = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
                    row.className = 'display-mmd-lighting-field'; input.type = 'checkbox'; input.dataset.clothGroup = group.id;
                    text.textContent = (index + 1) + '. ' + group.name + ' · ' + group.particles + ' 点 / 固定 ' + group.fixed
                        + (group.fixed === 0 ? '（跟随骨骼）' : '')
                        + (group.relatedGroupCount > 1 ? ' · 关联' + group.relatedGroupCount + '组' : '')
                        + (group.blockedReason ? ' · ' + group.blockedReason : '');
                    row.append(input, text); fragment.append(row); inputs.set(group.id, input);
                });
                list.replaceChildren(fragment);
            }
            for (const group of groups) { const input = inputs.get(group.id); if (input) { input.checked = group.enabled; input.disabled = !state.active || Boolean(group.blockedReason); input.title = group.blockedReason || '关联组同步启用骨骼跟随与自碰撞'; } }
            preview.checked = state?.preview === true; preview.disabled = !state?.active;
            status.textContent = !state?.active ? '启用物理并加载模型后显示自动分组。'
                : groups.length === 0 ? '没有达到物理蒙皮权重阈值的网格区域。'
                : groups.length + ' 组 · 启用 ' + groups.filter((group) => group.enabled).length + ' 组 · '
                    + state.particleCount + ' 粒子（固定 ' + state.fixedCount + '）· ' + state.constraintCount
                    + ' 约束 · 骨骼驱动 · 自碰撞（点-面/边-边）· 附着 ' + (state.attachmentCount || 0) + ' · 接缝 ' + (state.seamCount || 0)
                    + (state.backend === 'webgl2' ? ' · WebGL2 GPU' : ' · CPU') + (state.gpuFallback ? '（' + state.gpuFallback + '）' : '');
        };
        list.addEventListener('change', (event) => {
            const input = event.target; if (!input.dataset.clothGroup) return;
            try {
                if (window.DisplayMmd?.setVertexClothGroup?.(input.dataset.clothGroup, input.checked) !== true) throw new Error('当前物理不可用');
                update();
            } catch (error) { update(); status.textContent += ' · 分组切换失败：' + error.message; }
        });
        preview.addEventListener('change', () => { window.DisplayMmd?.setVertexClothPreview?.(preview.checked); update(); });
        const sync = () => {
            if (timer !== null) clearInterval(timer); timer = null;
            if (panel && !panel.hidden) { update(); timer = setInterval(update, 500); }
        };
        if (panel) new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
        window.addEventListener('pagehide', () => { if (timer !== null) clearInterval(timer); }, { once: true }); sync();
    })();
`;
module.exports = { stageVertexCloth, addClothMotionSwitch, CLOTH_CONTROL_IDS, CLOTH_PANEL_HTML, CLOTH_PANEL_JS };

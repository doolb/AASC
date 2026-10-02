'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');

// 四个源模块分别承担拓扑、求解、PMX桥接、构建/面板；依赖按内容指纹逐级写入。
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
    const topology = await write('web-vertex-cloth-topology.mjs');
    const solver = await write('web-vertex-cloth.mjs');
    const bridge = await write('web-vertex-cloth-pmx.mjs', [['./web-vertex-cloth-topology.mjs', topology],
        ['./web-vertex-cloth.mjs', solver], ['./web-physics-rate.mjs', physicsRateUrl], ['./web-physics-wind.mjs', physicsWindUrl]]);
    return bridge.replace('./', '../../../');
}
// 换VMD路径也需要Ammo以及顶点速度复位；锚点改变时构建直接报错。
function addClothMotionSwitch(source) {
    for (const [anchor, replacement] of [["physicsSolver === 'ammo'", "physicsSolver !== 'xpbd'"],
        ["physics.engine === 'xpbd'", "physics.engine === 'xpbd' || physics.engine === 'vertex-cloth'"]]) {
        if (source.split(anchor).length !== 2) throw new Error('顶点布料动作切换缺少唯一锚点：' + anchor);
        source = source.replace(anchor, replacement);
    }
    return source;
}
const CLOTH_CONTROL_IDS = ['mmdArVertexClothPanel', 'mmdArVertexClothPreview', 'mmdArVertexClothGroups', 'mmdArVertexClothStatus'];
const CLOTH_PANEL_HTML = `<div id="mmdArVertexClothPanel" hidden>
    <label class="display-mmd-lighting-field"><input id="mmdArVertexClothPreview" type="checkbox"><span>预览固定点 / 自由点</span></label>
    <p class="mind-basic-note">青色固定，橙色自由。按物理骨骼自动分组，包和金属附件也可能入选，可单独关闭。无固定点的组默认关闭。首版不含布料自碰撞。</p>
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
            root.hidden = window.DisplayMmd?.getPhysicsSolver?.() !== 'vertex-cloth';
            if (root.hidden) return;
            const state = window.DisplayMmd?.getPhysicsSolverState?.(), groups = state?.groups || [];
            const nextKey = state?.modelKey + ':' + groups.map((group) => group.id).join(',');
            if (nextKey !== key) {
                key = nextKey; inputs.clear(); const fragment = document.createDocumentFragment();
                groups.forEach((group, index) => {
                    const row = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
                    row.className = 'display-mmd-lighting-field'; input.type = 'checkbox'; input.dataset.clothGroup = group.id;
                    text.textContent = (index + 1) + '. ' + group.name + ' · ' + group.particles + ' 点 / 固定 ' + group.fixed
                        + (group.fixed === 0 ? '（无固定点）' : '');
                    row.append(input, text); fragment.append(row); inputs.set(group.id, input);
                });
                list.replaceChildren(fragment);
            }
            for (const group of groups) { const input = inputs.get(group.id); if (input) { input.checked = group.enabled; input.disabled = !state.active; } }
            preview.checked = state?.preview === true; preview.disabled = !state?.active;
            status.textContent = !state?.active ? '启用物理并加载模型后显示自动分组。'
                : groups.length === 0 ? '没有达到物理蒙皮权重阈值的网格区域。'
                : groups.length + ' 组 · 启用 ' + groups.filter((group) => group.enabled).length + ' 组 · '
                    + state.particleCount + ' 粒子（固定 ' + state.fixedCount + '）· ' + state.constraintCount
                    + ' 约束 · 替换 ' + state.replacedBodyCount + ' 刚体';
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

import { Euler, Quaternion } from 'three';
import { BODY_DAMPING_PARTS, normalizeDampingMultipliers } from './web-human-body-damping.mjs';

function initIKPanel() {
    const panel = document.getElementById('mmdArIKPanel'), toggle = document.getElementById('mmdArIKToggle');
    if (!panel || !toggle) return;
    const human = () => {
        const api = window.DisplayMmd?.getHumanInterface?.();
        if (!api) throw new Error('请先加载PMX模型');
        return api;
    };
    const message = panel.querySelector('[data-ik-message]'), size = panel.querySelector('[data-ik-size]');
    const report = text => { message.textContent = text; };
    let busy = false, closed = false, timer = null;
    function options(select, choices) {
        const fragment = document.createDocumentFragment();
        for (const [value, label] of choices) {
            const option = document.createElement('option'); option.value = value; option.textContent = label; fragment.append(option);
        }
        select.replaceChildren(fragment);
    }
    // 专用IK面板直接同步当前Human实例，收起界面不解除目标或关闭物理。
    const bodyPanel = document.createElement('div');
    bodyPanel.innerHTML = `<label>求解模式 <select data-body="mode"><option value="pbd">PBD 姿态</option><option value="physics">身体物理（VaM式）</option></select></label>
        <div data-body="settings" hidden>
        <label>牵引强度 <input data-body="strength" type="range" min="0.05" max="1" step="0.05" value="0.85"></label>
        <label>全局阻尼 <input data-body="damping" type="range" min="0.2" max="2.5" step="0.1" value="1"></label>
        <details data-body="damping-parts"><summary>分部位阻尼系数</summary>
        <p>各部位系数叠加全局阻尼；数值越大，运动耗散越强。左右共用，设置保留至页面关闭。</p>
        ${BODY_DAMPING_PARTS.map(part => `<label style="display:flex;align-items:center;gap:0.4em;flex-wrap:wrap">${part.label}
            <input data-damping-part="${part.key}" aria-label="${part.label}阻尼系数" type="range" min="0.2" max="2.5" step="0.05" value="${part.factor}" style="flex:1;min-width:5em;width:8em">
            <output data-damping-output="${part.key}">${part.factor.toFixed(2)}×</output></label>`).join('')}
        <button type="button" class="display-mmd-ar-action" data-body="reset-damping">恢复部位默认</button></details>
        <label><input data-body="gravity" type="checkbox">重力</label>
        <label><input data-body="freePelvis" type="checkbox">骨盆自由（允许身体受力移动与转动）</label>
        <label>控制点 <select data-body="target"></select></label>
        <label>位置状态 <select data-body="positionState"><option>Off</option><option>On</option><option>Hold</option><option>Comply</option></select></label>
        <label>旋转状态 <select data-body="rotationState"><option>Off</option><option>On</option><option>Hold</option><option>Comply</option></select></label>
        <div>目标世界旋转（°） <label>X <input data-body="rotationX" type="number" min="-180" max="180" step="5" value="0" style="width:5em"></label>
        <label>Y <input data-body="rotationY" type="number" min="-180" max="180" step="5" value="0" style="width:5em"></label>
        <label>Z <input data-body="rotationZ" type="number" min="-180" max="180" step="5" value="0" style="width:5em"></label></div>
        <p>On牵引；Hold保持目标；Off放开；Comply受力让步。默认保持骨盆位置与朝向；拖骨盆可移动，旋转目标可转动。人体模拟由全身IK开关控制。人体碰撞使用简化形状，衣物暂不向身体反向施力。</p>
        <p data-body="status" role="status"></p></div>`;
    panel.querySelector('[data-human-ik-status]').insertAdjacentElement('afterend', bodyPanel);
    const bodyField = key => bodyPanel.querySelector('[data-body="' + key + '"]');
    function syncBody(ik, ready) {
        bodyField('mode').value = ik.mode || 'pbd'; bodyField('mode').disabled = busy || !ready;
        bodyField('settings').hidden = ik.mode !== 'physics';
        if (!ik.settings) return;
        for (const key of ['strength', 'damping']) if (document.activeElement !== bodyField(key)) bodyField(key).value = ik.settings[key];
        for (const { key, factor } of BODY_DAMPING_PARTS) {
            const field = bodyPanel.querySelector('[data-damping-part="' + key + '"]');
            const value = ik.settings.dampingMultipliers?.[key] ?? factor;
            field.disabled = busy || !ready;
            if (document.activeElement !== field) field.value = value;
            bodyPanel.querySelector('[data-damping-output="' + key + '"]').textContent = Number(field.value).toFixed(2) + '×';
        }
        bodyField('reset-damping').disabled = busy || !ready;
        for (const key of ['gravity', 'freePelvis']) bodyField(key).checked = ik.settings[key];
        const controls = ik.controls || [];
        const select = bodyField('target'), keys = controls.map(item => item.key).join(',');
        if (select.dataset.keys !== keys) {
            options(select, controls.map(item => [item.key, item.label])); select.dataset.keys = keys;
        }
        select.value = ik.selected;
        const selected = controls.find(item => item.key === ik.selected);
        for (const key of ['target', 'positionState', 'rotationState']) bodyField(key).disabled = busy || !ready || !ik.enabled || !selected;
        for (const key of ['positionState', 'rotationState']) if (selected) bodyField(key).value = selected[key];
        const euler = selected && new Euler().setFromQuaternion(new Quaternion().fromArray(selected.rotation), 'XYZ');
        for (const axis of ['X', 'Y', 'Z']) {
            const field = bodyField('rotation' + axis);
            field.disabled = busy || !selected || ['Off', 'Hold'].includes(selected.rotationState);
            if (euler && document.activeElement !== field) field.value = (euler[axis.toLowerCase()] * 180 / Math.PI).toFixed(1);
        }
        bodyField('status').textContent = ik.physics ? '人体刚体：' + ik.physics.bodyCount + ' · 本帧 ' + ik.physics.frameMs.toFixed(2) + ' ms' : '启用全身 IK 后建立人体物理';
    }
    function sync() {
        if (closed) return;
        let api, ready = false, ik;
        try { api = human(); ready = api.getState().ready; ik = api.getInteractiveIKState(); }
        catch { ik = { enabled: false, controls: [], mode: 'pbd', reason: '请先加载PMX模型', markerDiameter: 32 }; }
        for (const button of panel.querySelectorAll('[data-ik-action]')) button.disabled = busy || !ready;
        const enable = panel.querySelector('[data-ik-action="enable"]'), reset = panel.querySelector('[data-ik-action="reset"]');
        enable.textContent = ik.enabled ? '关闭全身 IK' : '启用全身 IK';
        reset.disabled = busy || !ready || !ik.enabled;
        panel.querySelector('[data-human-ik-status]').textContent = ik.enabled
            ? '控制点：' + ik.targets + ' · 固定目标：' + ik.activeTargets + (ik.reason ? '\n' + ik.reason : '')
            : '全身 IK 已关闭' + (ik.reason && ik.reason !== '已关闭' ? '\n' + ik.reason : '');
        size.disabled = busy || !ready;
        if (document.activeElement !== size) size.value = ik.markerDiameter;
        panel.querySelector('[data-ik-size-output]').textContent = ik.markerDiameter + 'px';
        syncBody(ik, ready);
    }
    function setOpen(open) {
        if (timer !== null) { clearInterval(timer); timer = null; }
        if (open) {
            window.DisplayMmdLighting?.close?.(); window.DisplayMmdAr?.closePanel?.();
            for (const [button, panelId] of [['mmdArMotionToggle', 'mmdArMotionPanel'], ['mmdArCharacterToggle', 'mmdArCharacterPanel']]) {
                if (document.getElementById(panelId)?.hidden === false) document.getElementById(button)?.click();
            }
        }
        panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
        if (open) { sync(); timer = setInterval(sync, 500); }
    }
    toggle.addEventListener('click', event => { event.stopPropagation(); setOpen(panel.hidden); });
    document.getElementById('mmdArIKClose').addEventListener('click', () => setOpen(false));
    panel.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', event => {
        if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
    for (const id of ['displayMmdLightingToggle', 'mmdArMotionToggle', 'displayArTargetToggle', 'mmdArCharacterToggle']) {
        document.getElementById(id)?.addEventListener('click', () => setOpen(false));
    }
    for (const button of panel.querySelectorAll('[data-ik-action]')) button.addEventListener('click', () => {
        try {
            const api = human();
            if (button.dataset.ikAction === 'enable') api.setInteractiveIKEnabled(!api.getInteractiveIKState().enabled);
            if (button.dataset.ikAction === 'reset') api.resetInteractiveIK();
            sync();
        } catch (error) { report(error.message); }
    });
    size.addEventListener('input', () => {
        try {
            const ik = human().setInteractiveMarkerDiameter(Number(size.value));
            panel.querySelector('[data-ik-size-output]').textContent = ik.markerDiameter + 'px';
        } catch (error) { report(error.message); }
    });
    bodyField('mode').addEventListener('change', async () => {
        try { busy = true; const mode = bodyField('mode').value; sync(); await human().setInteractiveIKMode(mode); report('已切换人体控制模式'); }
        catch (error) { report(error.message); }
        finally { busy = false; sync(); }
    });
    for (const key of ['strength', 'damping', 'gravity', 'freePelvis']) bodyField(key).addEventListener('input', () => {
        try {
            human().setInteractiveBodySettings({ [key]: ['gravity', 'freePelvis'].includes(key) ? bodyField(key).checked : Number(bodyField(key).value) });
        } catch (error) { report(error.message); }
    });
    for (const field of bodyPanel.querySelectorAll('[data-damping-part]')) field.addEventListener('input', () => {
        try {
            const key = field.dataset.dampingPart;
            human().setInteractiveBodySettings({ dampingMultipliers: { [key]: Number(field.value) } });
            bodyPanel.querySelector('[data-damping-output="' + key + '"]').textContent = Number(field.value).toFixed(2) + '×';
        } catch (error) { report(error.message); }
    });
    bodyField('reset-damping').addEventListener('click', () => {
        try { human().setInteractiveBodySettings({ dampingMultipliers: normalizeDampingMultipliers() }); sync(); }
        catch (error) { report(error.message); }
    });
    for (const key of ['target', 'positionState', 'rotationState']) bodyField(key).addEventListener('change', () => {
        try {
            const api = human(), target = bodyField('target').value;
            const current = api.getInteractiveIKState().controls.find(item => item.key === target);
            api.setInteractiveTargetState(target, key === 'target' ? current.positionState : bodyField('positionState').value,
                key === 'target' ? current.rotationState : bodyField('rotationState').value); sync();
        } catch (error) { report(error.message); }
    });
    for (const axis of ['X', 'Y', 'Z']) bodyField('rotation' + axis).addEventListener('change', () => {
        try {
            const angles = ['X', 'Y', 'Z'].map(key => Number(bodyField('rotation' + key).value) * Math.PI / 180);
            human().setInteractiveTarget(bodyField('target').value, null, new Quaternion().setFromEuler(new Euler(...angles)).toArray());
        } catch (error) { report(error.message); }
    });
    window.addEventListener('pagehide', event => {
        if (!event.persisted) { closed = true; if (timer !== null) clearInterval(timer); timer = null; }
    });
    sync();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initIKPanel, { once: true });
else initIKPanel();

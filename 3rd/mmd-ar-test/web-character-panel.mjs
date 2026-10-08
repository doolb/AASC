// 服务器角色按清单加载；保留本地模型入口，静态角色不开放骨骼/物理操作。
function initCharacterPanel() {
    const button = document.getElementById('mmdArCharacterToggle'), panel = document.getElementById('mmdArCharacterPanel');
    if (!button || !panel) return;
    const list = document.getElementById('mmdArCharacterList'), status = document.getElementById('mmdArCharacterStatus');
    let roles = [], busy = false;
    const setOpen = open => {
        if (open) {
            window.DisplayMmdLighting?.close?.(); window.DisplayMmdAr?.closePanel?.();
            if (document.getElementById('mmdArMotionPanel')?.hidden === false) document.getElementById('mmdArMotionToggle')?.click();
        }
        panel.hidden = !open; button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', event => { event.stopPropagation(); setOpen(panel.hidden); });
    document.getElementById('mmdArCharacterClose').addEventListener('click', () => setOpen(false));
    panel.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', event => { if (!panel.contains(event.target) && !button.contains(event.target)) setOpen(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
    for (const id of ['displayMmdLightingToggle', 'mmdArMotionToggle', 'displayArTargetToggle']) {
        document.getElementById(id)?.addEventListener('click', () => setOpen(false));
    }
    const sync = () => {
        const profile = window.DisplayMmd?.getModelProfile?.();
        for (const item of list.querySelectorAll('button[data-role]')) {
            item.disabled = busy;
            item.setAttribute('aria-pressed', String(profile?.resourceId === item.dataset.role));
            item.style.borderColor = profile?.resourceId === item.dataset.role ? '#a8bbff' : '#758bff66';
        }
        const motionButton = document.getElementById('mmdArMotionToggle');
        if (motionButton) motionButton.title = profile?.modelType === 'glb' ? '当前角色没有骨骼动作或物理' : '';
        const motionPanel = document.getElementById('mmdArMotionPanel');
        if (motionPanel) {
            // inert保持原控件值，其他脚本更新disabled也不会重新放行静态角色物理。
            motionPanel.inert = busy || profile?.modelType === 'glb';
            motionPanel.style.opacity = profile?.modelType === 'glb' ? '0.5' : '';
        }
        for (const id of ['mmdArLocalVmdButton', 'mmdArLocalDefaultMotion']) {
            const control = document.getElementById(id);
            if (control) control.disabled = busy || profile?.modelType === 'glb';
        }
    };
    const report = detail => {
        status.textContent = detail.error || detail.phase + (Number.isFinite(detail.percent) ? ` ${detail.percent}%` : '');
        document.dispatchEvent(new CustomEvent('mmd-ar-load-progress', { detail }));
    };
    const updateCharacterUrl = resourceId => {
        const names = { 'miya-default': 'miya', 'xishi-default': 'xishi' };
        if (!Object.hasOwn(names, resourceId)) return;
        try {
            const url = new URL(location.href);
            url.searchParams.set('character', names[resourceId]);
            if (url.href !== location.href) history.replaceState(history.state, '', url.href);
        } catch (error) { /* 嵌入环境禁止修改地址时，角色切换仍然成功。 */ }
    };
    async function select(role) {
        if (busy) return;
        busy = true; sync();
        try {
            const loaded = await window.DisplayMmd.loadModel(role, report);
            if (!loaded) throw new Error('切换未完成，请等待当前加载结束后重试');
            updateCharacterUrl(role.resourceId);
            document.dispatchEvent(new CustomEvent('mmd-ar-server-character-selected', { detail: role }));
            status.textContent = `${role.name}已加载${role.modelType === 'glb' ? '（静态角色）' : ''}`;
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; sync(); }
    }
    document.addEventListener('mmd-ar-character-loaded', event => {
        const profile = event.detail;
        if (['miya-default', 'xishi-default'].includes(profile.resourceId)) {
            try { localStorage.setItem('aasc.mmdArTest.character.v1', profile.resourceId); } catch (error) { /* 当前切换仍有效。 */ }
            if (new URLSearchParams(location.search).has('character')) updateCharacterUrl(profile.resourceId);
        }
        sync();
    });
    async function readRoles() {
        try {
            const response = await fetch('./mmd-resources.json', { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok || data.status !== 'success' || !Array.isArray(data.resources)) throw new Error('角色列表读取失败');
            roles = data.resources.filter(role => ['pmx', 'glb'].includes(role.modelType));
            const fragment = document.createDocumentFragment();
            for (const role of roles) {
                const item = document.createElement('button');
                item.type = 'button'; item.dataset.role = role.resourceId;
                item.textContent = `${role.name || role.resourceId}${role.modelType === 'glb' ? ' · 静态' : ''}`;
                item.style.cssText = 'min-height:48px;border:1px solid #758bff66;border-radius:8px;background:#26344a80;color:#fff;text-align:left;padding:10px;cursor:pointer';
                item.addEventListener('click', () => select(role)); fragment.append(item);
            }
            list.replaceChildren(fragment); status.textContent = '选择角色后按需加载'; sync();
        } catch (error) {
            status.textContent = error.message;
            const retry = document.createElement('button'); retry.textContent = '重试'; retry.type = 'button';
            retry.addEventListener('click', readRoles); list.replaceChildren(retry);
        }
    }
    void readRoles();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCharacterPanel, { once: true });
else initCharacterPanel();

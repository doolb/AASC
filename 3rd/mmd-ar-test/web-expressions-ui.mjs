const GROUPS = new Map([[1, '眉毛'], [2, '眼睛'], [3, '嘴型'], [0, '其他'], [4, '其他']]);

function initExpressions() {
    const panel = document.getElementById('mmdArExpressionPanel');
    if (!panel) return;
    const list = panel.querySelector('[data-expression-list]');
    const message = panel.querySelector('[role="status"]');
    const clear = panel.querySelector('[data-expression-clear]');
    const motionPanel = document.getElementById('mmdArMotionPanel');
    const rows = new Map();
    let token = null, timer = null;

    function build(state) {
        const fragment = document.createDocumentFragment();
        const groups = new Map();
        rows.clear();
        for (const item of state.items) {
            const title = GROUPS.get(item.panel) || '其他';
            if (!groups.has(title)) {
                const section = document.createElement('section');
                const heading = document.createElement('h4');
                heading.textContent = title;
                heading.style.margin = '10px 0 6px';
                section.append(heading);
                groups.set(title, section);
            }
            const row = document.createElement('div');
            row.className = 'mmd-ar-expression-row';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'display-mmd-ar-action';
            button.textContent = item.englishName && item.englishName !== item.name
                ? `${item.name} / ${item.englishName}` : item.name || `表情 ${item.index + 1}`;
            button.setAttribute('aria-pressed', 'false');
            button.disabled = !item.supported;
            button.title = item.supported ? '点击启用，再点取消；可同时选择多项'
                : `当前播放器不支持此Morph（类型 ${item.type} 或无有效顶点）`;
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1';
            slider.step = '0.01';
            slider.value = '1';
            slider.disabled = !item.supported;
            slider.setAttribute('aria-label', `${item.name || '表情'}强度`);
            const output = document.createElement('output');
            output.textContent = item.supported ? '100%' : '未支持';
            row.append(button, slider, output);
            groups.get(title).append(row);
            rows.set(item.index, { button, slider, output });
            const set = weight => {
                try {
                    if (window.DisplayMmd?.getManualExpressions?.().token !== state.token) {
                        throw new Error('模型已切换，表情列表已更新，请重新选择');
                    }
                    if (!window.DisplayMmd?.setManualExpression?.(item.index, weight)) throw new Error('模型尚未就绪，请稍后重试');
                    sync();
                } catch (error) {
                    sync();
                    message.textContent = error?.message || String(error);
                }
            };
            button.addEventListener('click', () => set(button.getAttribute('aria-pressed') === 'true' ? null : Number(slider.value)));
            slider.addEventListener('input', () => set(Number(slider.value)));
        }
        // 面板顺序来自PMX的panel值；不根据米娅名称猜测分类或重写名称。
        for (const title of ['眉毛', '眼睛', '嘴型', '其他']) {
            if (groups.has(title)) fragment.append(groups.get(title));
        }
        list.replaceChildren(fragment);
    }

    function sync() {
        const state = window.DisplayMmd?.getManualExpressions?.() || { token: '', ready: false, items: [] };
        if (state.token !== token) {
            token = state.token;
            build(state);
        }
        let active = 0;
        for (const item of state.items) {
            const row = rows.get(item.index);
            if (!row) continue;
            row.button.setAttribute('aria-pressed', String(item.selected));
            row.button.disabled = row.slider.disabled = !state.ready || !item.supported;
            if (item.selected) {
                active++;
                row.slider.value = String(item.weight);
            }
            row.output.textContent = item.supported ? `${Math.round(Number(row.slider.value) * 100)}%` : '未支持';
        }
        clear.disabled = active === 0;
        if (!state.ready) {
            message.textContent = window.DisplayMmd?.getState?.().modelReady
                ? '当前角色不是 PMX，无法读取表情。' : '模型加载后自动读取表情。';
            return;
        }
        if (!state.items.length) {
            message.textContent = '当前 PMX 没有表情。';
            return;
        }
        const supported = state.items.filter(item => item.supported).length;
        message.textContent = `模型表情 ${state.items.length} 项，可用 ${supported} 项；手动启用 ${active} 项。`
            + (supported < state.items.length ? ' 未支持项已禁用。' : '');
    }

    clear.addEventListener('click', () => {
        try { window.DisplayMmd?.clearManualExpressions?.(); sync(); }
        catch (error) { message.textContent = error?.message || String(error); }
    });
    function watch() {
        clearInterval(timer);
        timer = null;
        if (motionPanel.hidden || document.hidden) return;
        sync();
        timer = setInterval(sync, 500);
    }
    const observer = new MutationObserver(watch);
    observer.observe(motionPanel, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', watch);
    window.addEventListener('pageshow', watch);
    window.addEventListener('pagehide', event => {
        clearInterval(timer);
        if (!event.persisted) {
            observer.disconnect();
            document.removeEventListener('visibilitychange', watch);
            window.removeEventListener('pageshow', watch);
        }
    });
    const style = document.createElement('style');
    style.textContent = `
      .mmd-ar-expression-list { max-height:330px; overflow:auto; }
      .mmd-ar-expression-row { display:grid; grid-template-columns:minmax(90px,1fr) minmax(60px,1fr) 42px; gap:7px; align-items:center; margin:5px 0; }
      .mmd-ar-expression-row button { min-width:0; overflow-wrap:anywhere; white-space:pre-wrap; font:inherit; }
      .mmd-ar-expression-row button[aria-pressed="true"] { background:#245783; border-color:#78b8ff; }
      .mmd-ar-expression-row input { min-width:0; width:100%; }
      .mmd-ar-expression-row output { font-size:11px; text-align:right; }
    `;
    document.head.append(style);
    watch();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initExpressions, { once: true });
else initExpressions();

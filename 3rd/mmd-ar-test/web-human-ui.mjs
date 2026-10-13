function initHuman() {
    const panel = document.getElementById('mmdArHumanPanel');
    if (!panel) return;
    const field = key => panel.querySelector('[data-human-field="' + key + '"]');
    const value = key => field(key).value.trim(), numeric = key => Number(value(key));
    const message = panel.querySelector('[role="status"]'), capabilities = panel.querySelector('[data-human-capabilities]');
    const mappings = panel.querySelector('[data-human-mappings]'), runtime = panel.querySelector('[data-human-runtime]');
    const human = () => {
        const api = window.DisplayMmd?.getHumanInterface?.();
        if (!api) throw new Error('请先加载PMX模型');
        return api;
    };
    let painted = '', busy = false, closed = false;
    const report = text => { message.textContent = text; };
    const mask = () => value('mask') ? [value('mask')] : [];
    const patch = () => ({ source: field('source').value, mode: value('mode'), mask: mask(),
        start: numeric('start'), duration: value('duration') ? numeric('duration') : null, strength: numeric('strength') });
    function options(select, choices) {
        const previous = select.value, fragment = document.createDocumentFragment();
        for (const [value, label] of choices) {
            const option = document.createElement('option'); option.value = value; option.textContent = label; fragment.append(option);
        }
        select.replaceChildren(fragment);
        if (choices.some(([value]) => value === previous)) select.value = previous;
    }
    function versions(state) {
        const action = state.actions.find(action => action.actionId === value('action'));
        options(field('version'), (action?.versions || []).map((version, index) =>
            [version.id, (index + 1) + ' · ' + version.createdAt + (version.id === action.active ? '（默认）' : '')]));
        if (action) field('version').value = action.active;
    }
    function sync() {
        if (closed) return;
        let api, state;
        try { api = human(); state = api.getState(); }
        catch { runtime.textContent = '等待PMX模型'; return; }
        runtime.textContent = (state.ready ? '动作库就绪' : '正在读取动作库') + ' · 活动层：' + state.layers.length
            + ' · 准备中：' + state.pending + (state.warning ? '\n' + state.warning : '');
        runtime.textContent += '\n注视：' + (state.gazeStatus.target === 'pointer' ? '点击位置（剩余' + state.gazeStatus.remaining.toFixed(1) + '秒）' : '相机')
            + ' · 头部：' + (state.gazeStatus.head || '不可用') + ' · 眼球：' + (state.gazeStatus.eyes.join('、') || '不可用')
            + (state.gazeStatus.issues.length ? '\n' + state.gazeStatus.issues.join('；') : '');
        for (const button of panel.querySelectorAll('[data-human]')) button.disabled = busy || !state.ready;
        const ikState = state.interactiveIK;
        const ikToggle = panel.querySelector('[data-human="ik-toggle"]'), ikReset = panel.querySelector('[data-human="ik-reset"]');
        ikToggle.textContent = ikState.enabled ? '关闭全身 IK' : '启用全身 IK';
        ikReset.disabled = busy || !state.ready || !ikState.enabled || !ikState.activeTargets;
        panel.querySelector('[data-human-ik-status]').textContent = ikState.enabled
            ? '控制点：' + ikState.targets + ' · 固定目标：' + ikState.activeTargets + (ikState.reason ? '\n' + ikState.reason : '')
            : '全身 IK 已关闭' + (ikState.reason && ikState.reason !== '已关闭' ? '\n' + ikState.reason : '');
        const key = state.token + ':' + state.revision;
        if (painted === key) return;
        painted = key;
        field('breathing').checked = state.physiology.breathing;
        field('blinking').checked = state.physiology.blinking;
        field('physiologyStrength').value = state.physiology.strength;
        field('gazeHead').checked = state.gaze.head;
        field('gazeEyes').checked = state.gaze.eyes;
        field('gazeManual').checked = state.gaze.manual;
        for (const key of ['manualYaw', 'manualPitch']) {
            const input = field('gazeManual' + (key === 'manualYaw' ? 'Yaw' : 'Pitch'));
            input.value = state.gaze[key];
            panel.querySelector('[data-human-output="gazeManual' + (key === 'manualYaw' ? 'Yaw' : 'Pitch') + '"]').textContent = state.gaze[key] + '°';
        }
        for (const key of ['strength', 'headYaw', 'headPitch', 'eyeYaw', 'eyePitch', 'headMs', 'eyeMs', 'holdSeconds', 'forward']) {
            field('gaze' + key[0].toUpperCase() + key.slice(1)).value = state.gaze[key];
        }
        const cap = api.capabilities();
        capabilities.textContent = '骨骼：' + cap.bones.length + ' · 可用表情：' + cap.morphs.length
            + '\n缺失 / 歧义：' + (cap.missing.join('、') || '无');
        const fragment = document.createDocumentFragment();
        for (const [key, bound] of Object.entries(cap.bindings)) {
            const [kind, semantic] = key.split(':'), label = document.createElement('label');
            // 五元音的人工映射沿用口型分类，避免同一设置出现两个编辑入口。
            if (kind === 'morphs' && ['a', 'i', 'u', 'e', 'o'].includes(semantic)) continue;
            label.className = 'mind-basic-field'; label.textContent = key + ' · ' + (bound || '无绑定');
            const select = document.createElement('select'); select.dataset.mapping = key;
            options(select, [['', '自动匹配'], ...cap[kind].map(item => [item.name, item.name])]);
            select.value = state.mappings[kind]?.[semantic] || ''; label.append(select); fragment.append(label);
        }
        mappings.replaceChildren(fragment);
        options(field('action'), state.actions.map(action => [action.actionId, action.actionId])); versions(state);
        panel.querySelector('[data-human-rules]').textContent = state.rules.map(rule =>
            rule.id + ': ' + rule.event + ' → ' + (rule.action || rule.expression)).join('\n') || '无规则';
    }
    const handlers = {
        physiology: api => api.physiology.set({ breathing: field('breathing').checked, blinking: field('blinking').checked,
            strength: numeric('physiologyStrength') }),
        gaze: api => api.gaze.set({ head: field('gazeHead').checked, eyes: field('gazeEyes').checked,
            strength: numeric('gazeStrength'), manual: field('gazeManual').checked,
            manualYaw: numeric('gazeManualYaw'), manualPitch: numeric('gazeManualPitch'),
            headYaw: numeric('gazeHeadYaw'), headPitch: numeric('gazeHeadPitch'),
            eyeYaw: numeric('gazeEyeYaw'), eyePitch: numeric('gazeEyePitch'), headMs: numeric('gazeHeadMs'),
            eyeMs: numeric('gazeEyeMs'), holdSeconds: numeric('gazeHoldSeconds'), forward: value('gazeForward') }),
        'gaze-reset': api => api.gaze.reset(),
        'gaze-auto': api => api.gaze.set({ manual: false }),
        'ik-toggle': api => api.setInteractiveIKEnabled(!api.getInteractiveIKState().enabled),
        'ik-reset': api => api.resetInteractiveIK(),
        register: api => api.learn.register({ actionId: value('actionId'), vmd: field('vmd').files[0], mask: mask(), expression: value('expression') }),
        'register-mpl': api => api.learn.register({ actionId: value('actionId'), source: field('source').value, mask: mask(), expression: value('expression') }),
        perform: api => api.perform({ action: value('action'), version: value('version'), owner: 'human:panel' }),
        version: api => api.learn.selectVersion(value('action'), value('version')),
        stop: api => { api.stop('human:panel'); api.stop('human:patch'); },
        'copy-mpl': () => { field('source').value = document.getElementById('mmdArMplSource')?.value || ''; },
        preview: api => api.mpl.play(field('source').value, { ...patch(), owner: 'human:patch' }),
        revise: api => api.learn.revise(value('action'), patch()),
        preset: api => api.learn.expression(value('preset'), JSON.parse(field('weights').value)),
        face: api => api.perform({ expression: value('preset'), duration: 2, owner: 'human:panel' }),
        reflex: api => api.learn.reflex({ id: value('ruleId'), event: value('event'), action: value('reflexAction'),
            expression: value('reflexExpression'), threshold: numeric('threshold'), cooldown: numeric('cooldown'),
            duration: numeric('reflexDuration'), strength: numeric('strength') }),
        'remove-reflex': api => api.learn.removeReflex(value('ruleId')),
        emit: api => api.reflex.emit({ type: value('event'), strength: 1 }),
        mappings: api => {
            const result = { bones: {}, morphs: {} };
            for (const select of mappings.querySelectorAll('[data-mapping]')) {
                const [kind, semantic] = select.dataset.mapping.split(':'); result[kind][semantic] = select.value;
            }
            return api.learn.mappings(result);
        },
        export: api => {
            const url = URL.createObjectURL(api.learn.export()), link = document.createElement('a');
            link.href = url; link.download = 'mmd-human-' + api.getState().signature + '.json'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        import: () => { field('libraryFile').click(); }
    };
    for (const key of ['gazeManual', 'gazeManualYaw', 'gazeManualPitch']) {
        field(key).addEventListener('input', () => {
            try {
                const api = human();
                const manual = field('gazeManual').checked;
                const yaw = numeric('gazeManualYaw'), pitch = numeric('gazeManualPitch');
                api.gaze.set({ manual, manualYaw: yaw, manualPitch: pitch });
                panel.querySelector('[data-human-output="gazeManualYaw"]').textContent = yaw + '°';
                panel.querySelector('[data-human-output="gazeManualPitch"]').textContent = pitch + '°';
                painted = '';
            } catch (error) { report(error.message); }
        });
    }
    for (const button of panel.querySelectorAll('[data-human]')) button.addEventListener('click', async () => {
        const key = button.dataset.human;
        try {
            busy = true; sync(); report('正在处理…');
            const result = await handlers[key](human());
            report('已完成：' + button.textContent + (result?.warnings?.length ? '\n' + result.warnings.join('\n') : ''));
        } catch (error) { report(error.message); }
        finally { busy = false; painted = ''; sync(); }
    });
    field('action').addEventListener('change', () => versions(human().getState()));
    field('libraryFile').addEventListener('change', async () => {
        const file = field('libraryFile').files[0];
        if (!file) return;
        try { busy = true; sync(); await human().learn.import(file); report('动作库已导入并保存'); }
        catch (error) { report(error.message); }
        finally { busy = false; field('libraryFile').value = ''; painted = ''; sync(); }
    });
    // 唯一公共入口动态取当前模型实例，避免外部保存已经销毁的runtime引用。
    window.MmdArHumanInterface = Object.freeze({ get current() { return human(); },
        capabilities: () => human().capabilities(), getState: () => human().getState(),
        perform: intent => human().perform(intent), stop: owner => human().stop(owner),
        physiology: { get: () => human().physiology.get(), set: options => human().physiology.set(options) },
        gaze: { get: () => human().gaze.get(), set: options => human().gaze.set(options),
            point: (x, y) => human().gaze.point(x, y), reset: () => human().gaze.reset() },
        reflex: { emit: event => human().reflex.emit(event) },
        mpl: { play: (source, options) => human().mpl.play(source, options) },
        mouth: { play: text => human().mouth.play(text), getState: () => human().mouth.getState(),
            stop: sequence => human().mouth.stop(sequence) },
        learn: Object.fromEntries(['list', 'register', 'revise', 'selectVersion', 'expression', 'reflex', 'removeReflex', 'mappings', 'export', 'import']
            .map(key => [key, (...args) => human().learn[key](...args)])) });
    const timer = setInterval(() => { if (!document.hidden) sync(); }, 500);
    window.addEventListener('pagehide', event => { if (!event.persisted) { closed = true; clearInterval(timer); } });
    sync();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuman, { once: true });
else initHuman();

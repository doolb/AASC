function initHuman() {
    const panel = document.getElementById('mmdArHumanPanel');
    if (!panel) return;
    const candidatePanel = document.createElement('details');
    candidatePanel.innerHTML = '<summary>SubAI候选动作</summary><p>生成动作完整播放后自动保存；采用才切换默认版本。</p>'
        + '<select data-human-field="candidate" aria-label="候选动作"></select>'
        + '<button type="button" data-human="candidate-preview">预览候选</button>'
        + '<button type="button" data-human="candidate-source">查看MPL</button>'
        + '<button type="button" data-human="candidate-adopt">采用为默认版本</button>'
        + '<button type="button" data-human="candidate-remove">删除候选</button>'
        + '<button type="button" data-human="candidate-save">重试保存动作库</button>'
        + '<button type="button" data-human="stop-subai">停止自动动作</button><p data-motion-status role="status"></p>';
    panel.append(candidatePanel);
    const field = key => panel.querySelector('[data-human-field="' + key + '"]');
    const value = key => field(key).value.trim(), numeric = key => Number(value(key));
    const message = panel.querySelector('[role="status"]'), capabilities = panel.querySelector('[data-human-capabilities]');
    const mappings = panel.querySelector('[data-human-mappings]'), runtime = panel.querySelector('[data-human-runtime]');
    const human = () => {
        const api = window.DisplayMmd?.getHumanInterface?.();
        if (!api) throw new Error('请先加载PMX模型');
        return api;
    };
    const avoidance = document.getElementById('mmdArHandAvoidance');
    avoidance?.addEventListener('change', () => {
        try { human().setArmAvoidanceEnabled(avoidance.checked); sync(); }
        catch (error) { message.textContent = error.message; }
    });
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
        // 共用原Human面板的状态刷新，不创建第二个避让轮询器。
        const current = window.DisplayMmd?.getHumanInterface?.();
        if (avoidance) {
            avoidance.disabled = !current;
            const status = current?.getArmAvoidanceState();
            if (status) avoidance.checked = status.enabled;
            document.getElementById('mmdArHandAvoidanceStatus').textContent = !status ? '等待PMX模型' : status.reason || (status.enabled ? '手部防穿模已开启' : '手部防穿模已关闭');
        }
        let api, state;
        try { api = human(); state = api.getState(); }
        catch { runtime.textContent = '等待PMX模型'; return; }
        runtime.textContent = (state.ready ? '动作库就绪' : '正在读取动作库') + ' · 活动层：' + state.layers.length
            + ' · 准备中：' + state.pending + (state.warning ? '\n' + state.warning : '');
        runtime.textContent += '\n注视：' + (state.gazeStatus.target === 'pointer' ? '点击位置（剩余' + state.gazeStatus.remaining.toFixed(1) + '秒）' : '相机')
            + ' · 头部：' + (state.gazeStatus.head || '不可用') + ' · 眼球：' + (state.gazeStatus.eyes.join('、') || '不可用')
            + (state.gazeStatus.issues.length ? '\n' + state.gazeStatus.issues.join('；') : '');
        for (const button of panel.querySelectorAll('[data-human]')) button.disabled = busy || !state.ready;
        const key = state.token + ':' + state.revision;
        if (painted === key) return;
        painted = key;
        field('breathing').checked = state.physiology.breathing;
        field('blinking').checked = state.physiology.blinking;
        field('physiologyStrength').value = state.physiology.strength;
        field('gazeHead').checked = state.gaze.head;
        field('gazeEyes').checked = state.gaze.eyes;
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
        options(field('candidate'), (state.candidates || []).map(item => [item.id, item.description + ' · ' + item.model]));
        options(field('action'), state.actions.map(action => [action.actionId, action.actionId])); versions(state);
        panel.querySelector('[data-human-rules]').textContent = state.rules.map(rule =>
            rule.id + ': ' + rule.event + ' → ' + (rule.action || rule.expression)).join('\n') || '无规则';
    }
    const selectedCandidate = api => {
        const result = api.candidates.list().find(item => item.id === value('candidate'));
        if (!result) throw new Error('请先选择候选动作');
        return result;
    };
    const handlers = {
        'candidate-preview': async api => api.startPrepared(await api.prepareMpl(selectedCandidate(api).source,
            { owner: 'candidate:preview' }), { owner: 'candidate:preview', priority: 100 }),
        'candidate-source': api => { field('source').value = selectedCandidate(api).source; },
        'candidate-adopt': api => api.candidates.adopt(selectedCandidate(api).id,
            value('actionId') || selectedCandidate(api).description.slice(0, 80)),
        'candidate-remove': api => api.candidates.remove(selectedCandidate(api).id),
        'candidate-save': api => api.candidates.retrySave(),
        'stop-subai': api => { window.DisplayMmdChatActions?.stop(); api.stop('candidate:preview'); },
        physiology: api => api.physiology.set({ breathing: field('breathing').checked, blinking: field('blinking').checked,
            strength: numeric('physiologyStrength') }),
        gaze: api => api.gaze.set({ head: field('gazeHead').checked, eyes: field('gazeEyes').checked,
            strength: numeric('gazeStrength'), headYaw: numeric('gazeHeadYaw'), headPitch: numeric('gazeHeadPitch'),
            eyeYaw: numeric('gazeEyeYaw'), eyePitch: numeric('gazeEyePitch'), headMs: numeric('gazeHeadMs'),
            eyeMs: numeric('gazeEyeMs'), holdSeconds: numeric('gazeHoldSeconds'), forward: value('gazeForward') }),
        'gaze-reset': api => api.gaze.reset(),
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
    window.DisplayMmdHumanInterface = Object.freeze({ get current() { return human(); },
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

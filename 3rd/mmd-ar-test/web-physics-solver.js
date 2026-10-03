'use strict';
const CLOTH = require('./web-vertex-cloth-inject');

// 只适配独立网页/APK副本；源锚点改变时停止构建，不静默漏掉某个模型/VMD路径。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`物理解算器缺少唯一锚点：${anchor.slice(0, 100)}`);
    return source.replace(anchor, replacement);
}

// THREE刚体后端已移除；旧偏好迁移自写XPBD，TMP14顶点模式使用独立选项。
function normalizePhysicsSolver(value) {
    if (['vertex-cloth', 'xpbd-webgl'].includes(value)) return value;
    return ['xpbd', 'three-xpbd'].includes(value) ? 'xpbd' : 'ammo';
}

function addSolverHelper(source) {
    let output = once(source, '    physics,\n    physicsFps\n}) => {', '    physics,\n    physicsFps,\n    physicsSolver\n}) => {');
    output = once(output, '    const options = { physics };', '    const options = { physics, physicsSolver };');
    output = once(output, '    physicsFps = DEFAULT_PMX_PHYSICS_FPS\n}) {', "    physicsFps = DEFAULT_PMX_PHYSICS_FPS,\n    physicsSolver = 'ammo'\n}) {");
    output = once(output, '        physicsFps\n    };', '        physicsFps,\n        physicsSolver\n    };');
    output = once(output, '        await ensurePhysics();', "        if (physicsSolver !== 'xpbd') await ensurePhysics();");
    // XPBD失败必须让切换回滚，不能选项写着XPBD而实际停用物理。
    output = once(output, '    } catch (error) {\n        return {', "    } catch (error) {\n        if (physicsSolver !== 'ammo') throw error;\n        return {");
    return once(output, '    physics.reset();', "    physics.reset();\n    if (physics.engine === 'xpbd' || physics.engine === 'vertex-cloth') { physics.resetMotion(); return; }");
}

function addSolverAnimationHelper(source, moduleUrl, clothUrl) {
    return once(`import { XpbdPmxPhysics } from '${moduleUrl}';\nimport { VertexClothPmxPhysics } from '${clothUrl}';\n${source}`, '\t_createMMDPhysics( mesh, params ) {', `\t_createMMDPhysics( mesh, params ) {
        if (params.physicsSolver === 'xpbd') return new XpbdPmxPhysics(mesh,
            mesh.geometry.userData.MMD.rigidBodies, mesh.geometry.userData.MMD.constraints, params);
        if (params.physicsSolver === 'vertex-cloth') return new VertexClothPmxPhysics(mesh, params,
            (target, bodies, joints, options) => new MMDPhysics(target, bodies, joints, options));`);
}

function addSolverRuntime(source) {
    let output = once(source, '    let physicsEnabled = true;', `    let physicsEnabled = true;
    let physicsSolver = 'ammo';
    ${normalizePhysicsSolver.toString()}
    const timedPhysics = new WeakSet();
    const timePhysics = (physics) => {
        if (!physics || timedPhysics.has(physics)) return;
        const update = physics.update;
        physics.update = function(delta) {
            const begin = performance.now();
            try { return update.call(this, delta); }
            finally { this.frameMs = performance.now() - begin; }
        };
        timedPhysics.add(physics);
    };
    const setPhysicsSolver = (value) => { physicsSolver = normalizePhysicsSolver(value); return physicsSolver; };
    const getPhysicsSolverState = () => {
        const physics = helper.current?.objects?.get(currentMesh)?.physics;
        if (!physics) return { solver: physicsSolver, active: false, bodyCount: 0, frameMs: 0 };
        return { solver: physics.engine || 'ammo', active: physicsEnabled,
            bodyCount: physics.bodies.length, jointCount: physics.constraints.length,
            frameMs: physics.frameMs || 0, ...physics.getState?.() };
    };`);
    output = once(output, '            physicsEnabled: usePhysics,', '            physicsEnabled: usePhysics,\n            physicsSolver,');
    output = once(output, '                ensurePhysics: ensureAmmoPhysics, physicsEnabled,',
        "                ensurePhysics: physicsSolver === 'xpbd' ? async () => {} : ensureAmmoPhysics, physicsEnabled, physicsSolver,");
    output = once(output, '        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);',
        '        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);\n        timePhysics(frameHelper?.objects?.get(currentMesh)?.physics);');
    return once(output, '        setMotionPlaybackEnabled,', `        setVertexClothGroup: (id, enabled) => {
            const result = helper.current?.objects?.get(currentMesh)?.physics?.setGroupEnabled?.(id, enabled) === true;
            startRendering(); return result;
        },
        setVertexClothPreview: (value) => helper.current?.objects?.get(currentMesh)?.physics?.setPreview?.(value) || false,
        setPhysicsSolver,
        getPhysicsSolverState,
        setMotionPlaybackEnabled,`);
}

function addSolverDisplay(source) {
    let output = once(source, '    async function setPhysicsEnabled(enabled) {', `    let physicsSolver = 'ammo';
    ${normalizePhysicsSolver.toString()}
    // 初始偏好在首次加载前读取，面板恢复无需异步重载，避免和“启用物理”恢复互相抢锁。
    try {
        const key = 'aasc.mmdArTest.physicsSolver.v1', saved = localStorage.getItem(key);
        physicsSolver = normalizePhysicsSolver(saved);
        if (saved === 'three-xpbd') localStorage.setItem(key, physicsSolver);
    } catch (error) { /* 保留已读取的选择；无法读取时默认Ammo。 */ }
    let physicsConfigurationBusy = false;
    async function setPhysicsSolver(value) {
        const next = normalizePhysicsSolver(value);
        if (physicsConfigurationBusy) return false;
        if (next === physicsSolver) return true;
        const previous = physicsSolver;
        physicsSolver = next;
        state.runtime?.setPhysicsSolver?.(next);
        if (state.runtimeType !== 'pmx' || !state.modelProfile) return true;
        physicsConfigurationBusy = true;
        try {
            if (await loadModel(state.modelProfile)) return true;
            physicsSolver = previous; state.runtime?.setPhysicsSolver?.(previous);
            return false;
        } catch (error) {
            physicsSolver = previous; state.runtime?.setPhysicsSolver?.(previous);
            throw error;
        } finally { physicsConfigurationBusy = false; }
    }
    async function setPhysicsEnabled(enabled) {
        if (physicsConfigurationBusy) return false;
        physicsConfigurationBusy = true;
        try { return await setPhysicsEnabledBase(enabled); }
        finally { physicsConfigurationBusy = false; }
    }
    async function setPhysicsEnabledBase(enabled) {`);
    output = once(output, '                state.runtime.setPhysicsEnabled?.(state.physicsEnabled);',
        '                state.runtime.setPhysicsSolver?.(physicsSolver);\n                state.runtime.setPhysicsEnabled?.(state.physicsEnabled);');
    return once(output, '        setMotionPlaybackEnabled,', `        setPhysicsSolver,
        setVertexClothGroup: (id, enabled) => !physicsConfigurationBusy && (state.runtime?.setVertexClothGroup?.(id, enabled) || false),
        setVertexClothPreview: (value) => state.runtime?.setVertexClothPreview?.(value) || false,
        getPhysicsSolver: () => physicsSolver,
        getPhysicsSolverState: () => state.runtime?.getPhysicsSolverState?.() || { solver: physicsSolver, active: false, bodyCount: 0, frameMs: 0 },
        setMotionPlaybackEnabled,`);
}

const SOLVER_CONTROL_IDS = Object.freeze(['mmdArPhysicsSolver', 'mmdArPhysicsSolverStatus', ...CLOTH.CLOTH_CONTROL_IDS]);
const SOLVER_PANEL_HTML = `<label class="mind-basic-field"><span>布料计算</span>
    <select id="mmdArPhysicsSolver" aria-label="布料计算求解器"><option value="ammo" selected>Ammo（原方式）</option>
    <option value="xpbd">XPBD（CPU）</option><option value="xpbd-webgl">XPBD（WebGL2）</option><option value="vertex-cloth">顶点布料（TMP14）</option></select></label>
    <p id="mmdArPhysicsSolverStatus" class="mind-basic-note" role="status">Ammo · 等待模型</p>${CLOTH.CLOTH_PANEL_HTML}`;
const SOLVER_PANEL_JS = `
    ${CLOTH.CLOTH_PANEL_JS}
    (() => {
        ${normalizePhysicsSolver.toString()}
        const select = document.getElementById('mmdArPhysicsSolver');
        const label = document.getElementById('mmdArPhysicsSolverStatus');
        const toggle = document.getElementById('mmdArPhysicsEnabled');
        const correction = document.getElementById('mmdArPhysicsStabilityReference');
        const correctionValue = document.getElementById('mmdArPhysicsStabilityReferenceValue');
        const correctionTitle = correctionValue?.parentElement?.firstChild;
        const physicsFps = document.getElementById('displayMmdPhysicsFps');
        const hint = document.getElementById('mmdArPhysicsStabilityReferenceHint');
        const panel = document.getElementById('mmdArMotionPanel');
        if (!select || !label) return;
        const key = 'aasc.mmdArTest.physicsSolver.v1';
        let timer = null;
        let requested = 'ammo';
        try { requested = normalizePhysicsSolver(localStorage.getItem(key)); }
        catch (error) { /* 存储受限按原方式启动。 */ }
        const update = () => {
            const solver = window.DisplayMmd?.getPhysicsSolver?.() || 'ammo';
            const xpbd = solver !== 'ammo';
            select.value = solver;
            if (correction) {
                correction.disabled = false;
                correction.setAttribute('aria-label', xpbd ? '每帧子步数' : '关节纠错基准频率');
            }
            // 同一保存值在Ammo与XPBD中含义不同，显示实际单位，避免把子步数误读为Hz。
            if (correctionTitle?.nodeType === 3) correctionTitle.nodeValue = xpbd ? '每帧子步数 ' : '纠错基准 Hz ';
            if (correctionValue && correction) correctionValue.textContent = correction.value + (xpbd ? ' 子步' : ' Hz');
            if (physicsFps) {
                physicsFps.disabled = xpbd;
                if (xpbd) physicsFps.title = '顶点/XPBD按每帧子步数计算；顶点模式其余Ammo保留已有频率。';
                else physicsFps.removeAttribute('title');
            }
            const roundsHint = ['xpbd', 'xpbd-webgl'].includes(solver) ? '每子步1轮并补旋转锁轴纠正' : '每子步1轮';
            if (hint) hint.textContent = xpbd ? '复用基准值作为每帧子步数：3表示3个子步；' + roundsHint + '，步长为本帧时间÷子步数。' + (solver === 'vertex-cloth' ? '非布料Ammo保留已有物理Hz，顶点求解不用它。' : '物理Hz暂不使用。')
                : '按该频率的关节纠错率换算到当前物理频率；只改纠错强度，不动弹簧/质量/阻尼。';
            const state = window.DisplayMmd?.getPhysicsSolverState?.();
            const name = { ammo: 'Ammo', xpbd: 'XPBD（CPU）', 'xpbd-webgl': 'XPBD（WebGL2）', 'vertex-cloth': 'TMP14顶点布料' }[solver] || 'Ammo';
            const particleInfo = solver === 'vertex-cloth' ? ' · ' + state?.particleCount + ' 粒子 / ' + state?.constraintCount + ' 约束' : '';
            label.textContent = !state?.active ? name + ' · 物理未运行'
                : name + ' · ' + state.bodyCount + ' 个刚体'
                    + (xpbd ? ' · 当前子步数 ' + state.substeps + ' · 每子步1轮' : '')
                    + (state.rotationLockProjections > 0 ? ' + 旋转锁轴纠正' : '')
                    + particleInfo + ' · 帧物理耗时 ' + Number(state.frameMs || 0).toFixed(2) + ' ms'
                    + (state.computeBackend === 'webgl2' ? ' · 读回 ' + Number(state.readbackMs || 0).toFixed(2) + ' ms · ' + state.passCount + ' passes · GPU ' + (state.gpuMs == null ? '计时不可用' : Number(state.gpuMs).toFixed(2) + ' ms') : '')
                    + (state.fallbackReason ? ' · CPU回退：' + state.fallbackReason : '');
        };
        const apply = async (value, persist) => {
            select.disabled = true; if (toggle) toggle.disabled = true;
            label.textContent = '正在重新建立物理…';
            try {
                if (await window.DisplayMmd?.setPhysicsSolver?.(value) !== true) {
                    update(); label.textContent += ' · 切换失败，已保留原方式'; return;
                }
                if (persist) {
                    try { localStorage.setItem(key, value); } catch (error) { /* 本次选择仍有效。 */ }
                }
                update();
            } catch (error) {
                update(); label.textContent += ' · ' + (error.message || '切换失败');
                console.warn('[MmdArTest] 切换布料计算失败:', error);
            } finally { select.disabled = false; if (toggle) toggle.disabled = false; }
        };
        select.addEventListener('change', () => apply(normalizePhysicsSolver(select.value), true));
        // 基准保存模块在本段之后绑定事件，微任务等待其更新当前实例及输出，再同步状态行。
        correction?.addEventListener('input', () => queueMicrotask(update));
        correction?.addEventListener('change', () => queueMicrotask(update));
        const sync = () => {
            if (timer !== null) clearInterval(timer);
            timer = null;
            if (panel && !panel.hidden) {
                if (!select.disabled) update();
                timer = setInterval(() => { if (!select.disabled) update(); }, 500);
            }
        };
        if (panel) new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
        window.addEventListener('pagehide', () => { if (timer !== null) clearInterval(timer); }, { once: true });
        apply(requested, false).then(sync);
    })();
`;

module.exports = { addSolverHelper, addSolverAnimationHelper, addSolverRuntime, addSolverDisplay,
    SOLVER_CONTROL_IDS, SOLVER_PANEL_HTML, SOLVER_PANEL_JS };

// 正式源码已包含此功能时复用共享实现，仅更新构建指纹。
module.exports = require('./web-production-shared').reuseAdapters(module.exports);

// WebGL后端适配放在共享复用之后，保证正式源码与旧注入来源都能正确接入。
const { applyWebglSolver } = require('./web-xpbd-webgl-inject');
for (const operation of ['addSolverHelper', 'addSolverAnimationHelper', 'addSolverRuntime', 'addSolverDisplay']) {
    const original = module.exports[operation];
    module.exports[operation] = (source, ...args) => applyWebglSolver(original(source, ...args), operation,
        operation === 'addSolverAnimationHelper' ? args[2] : args[0]);
}

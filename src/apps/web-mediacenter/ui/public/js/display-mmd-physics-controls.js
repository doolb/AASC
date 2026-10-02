/* 正式物理选项：沿用显示端 API 与持久化偏好，不创建额外配置服务。 */
(function exposeMmdPhysicsControls(root) {
    'use strict';
    function initialize() {
        const select = document.getElementById('mmdArPhysicsSolver');
        const status = document.getElementById('mmdArPhysicsSolverStatus');
        const toggle = document.getElementById('displayMmdPhysicsEnabled');
        const baseline = document.getElementById('mmdArPhysicsStabilityReference');
        const baselineOutput = document.getElementById('mmdArPhysicsStabilityReferenceValue');
        const fps = document.getElementById('displayMmdPhysicsFps');
        const hint = document.getElementById('mmdArPhysicsStabilityReferenceHint');
        if (!select || !toggle || !status) return;
        const key = 'aasc.display.mmd.physicsSolver.v1';
        let switching = false;
        const refresh = () => {
            const solver = root.DisplayMmd?.getPhysicsSolver?.() || 'ammo';
            const xpbd = solver === 'xpbd';
            select.value = solver;
            if (fps) fps.disabled = xpbd;
            if (baseline) {
                baseline.setAttribute('aria-label', xpbd ? '每帧子步数' : '关节纠错基准频率');
                const heading = baselineOutput?.parentElement?.firstChild;
                if (heading?.nodeType === 3) heading.nodeValue = xpbd ? '每帧子步数 ' : '纠错基准 Hz ';
                if (baselineOutput) baselineOutput.textContent = baseline.value + (xpbd ? ' 子步' : ' Hz');
            }
            if (hint) hint.textContent = xpbd
                ? '基准数值作为每帧子步数，每子步 1 轮；物理 Hz 不参与 XPBD。'
                : '按基准频率换算关节纠错强度；弹簧、质量、阻尼沿用 PMX。';
            status.textContent = xpbd ? 'XPBD · 每帧 ' + baseline.value + ' 子步' : 'Ammo';
        };
        select.addEventListener('change', async () => {
            if (switching) return;
            switching = true;
            const enabled = toggle.disabled;
            const localControls = [...document.querySelectorAll('#mmdArLocalAssets button, #mmdArLocalAssets input, #mmdArLocalAssets select')];
            const previousDisabled = localControls.map(control => control.disabled);
            localControls.forEach(control => { control.disabled = true; });
            select.disabled = true; toggle.disabled = true;
            status.textContent = '正在重建物理…';
            try {
                const next = select.value === 'xpbd' ? 'xpbd' : 'ammo';
                if (await root.DisplayMmd?.setPhysicsSolver?.(next) !== true) throw new Error('切换失败，已保留原方式');
                try { root.localStorage.setItem(key, next); }
                catch (error) { /* 本次选择仍可使用。 */ }
                refresh();
            } catch (error) {
                refresh();
                status.textContent += ' · ' + (error.message || '切换失败');
            } finally {
                localControls.forEach((control, index) => { control.disabled = previousDisabled[index]; });
                select.disabled = false; toggle.disabled = enabled; switching = false;
            }
        });
        baseline?.addEventListener('input', () => queueMicrotask(refresh));
        baseline?.addEventListener('change', () => queueMicrotask(refresh));
        refresh();

        // 与正式启动流程使用同一个显示端状态；先恢复偏好再启动异步模型加载。
        for (const [id, setting, apply] of [
            ['displayMmdMotionPlayback', 'motionPlayback', value => root.DisplayMmd?.setMotionPlaybackEnabled?.(value)],
            ['displayMmdPhysicsEnabled', 'physicsEnabled', value => root.DisplayMmd?.setPhysicsEnabled?.(value)]
        ]) {
            const input = document.getElementById(id);
            if (!input) continue;
            const storageKey = 'aasc.display.mmd.' + setting + '.v1';
            try { input.checked = root.localStorage.getItem(storageKey) !== 'false'; }
            catch (error) { input.checked = true; }
            void apply(input.checked);
            let current = input.checked;
            input.addEventListener('change', async () => {
                const next = input.checked;
                const controls = [input, select, ...document.querySelectorAll('#mmdArLocalAssets button, #mmdArLocalAssets input, #mmdArLocalAssets select')];
                const disabled = controls.map(control => control.disabled);
                controls.forEach(control => { control.disabled = true; });
                try {
                    if (await apply(next) !== true) throw new Error('切换失败');
                    current = next;
                    try { root.localStorage.setItem(storageKey, String(current)); }
                    catch (error) { /* 存储受限仅影响下次恢复。 */ }
                } catch (error) {
                    input.checked = current;
                    status.textContent = error.message || '切换失败，已恢复原设置';
                } finally {
                    controls.forEach((control, index) => { control.disabled = disabled[index]; });
                }
            });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})(window);

/* 正式显示端的灯光、动作和定位分类；只移动原控件节点，不复制状态或事件。 */
(function exposeDisplayMmdPanelGroups(root) {
    const GROUPS = Object.freeze({
        displayMmdLightingPanel: [
            ['基础光照', ['displayMmdLightingPreset', 'displayMmdPmxToonEnabled', 'displayMmdAmbientColor', 'displayMmdAmbientIntensity']],
            ['高光', ['displayMmdSpecularEnabled', 'displayMmdSpecularColor', 'displayMmdSpecularIntensity', 'displayMmdSpecularShininess']],
            ['AO', ['displayMmdPmxAoEnabled', 'displayMmdPmxAoEdgeCorrection', 'displayMmdPmxAoColor', 'displayMmdPmxAoIntensity', 'displayMmdPmxAoRadiusPercent', 'displayMmdPmxAoResolution', 'displayMmdPmxAoSampleCount', 'displayMmdPmxAoBlurPassCount', 'displayMmdPmxAoBlurRadius1', 'displayMmdPmxAoBlurRadius2', 'displayMmdPmxAoBlurRadius3']],
            ['主光', ['displayMmdKeyShadowEnabled', 'displayMmdKeyColor', 'displayMmdKeyIntensity', 'displayMmdKeyDirectionLongitude']],
            ['补光', ['displayMmdFillEnabled', 'displayMmdShadowSource', 'displayMmdFillColor', 'displayMmdFillIntensity', 'displayMmdFillDirectionLongitude']],
            ['边缘光 1', ['displayMmdRim1Enabled', 'displayMmdRim1Color', 'displayMmdRim1Intensity', 'displayMmdRim1DirectionLongitude']],
            ['边缘光 2', ['displayMmdRim2Enabled', 'displayMmdRim2Color', 'displayMmdRim2Intensity', 'displayMmdRim2DirectionLongitude']]
        ],
        displayMmdMotionPanel: [
            ['动作', ['displayMmdMotionPlayback', 'displayMmdMotionProgress']],
            ['物理', ['displayMmdPhysicsEnabled', 'displayMmdPhysicsFps', 'displayMmdRotationPhysicsLimit']]
        ],
        displayArTargetPanel: [
            ['定位图与校准', ['displayArTargetSelect', 'displayArTargetName', 'displayArPhysicalWidth', 'displayArCalibrationButton', 'displayArDeleteButton']],
            ['跟踪操作', ['displayArTrackerEngine', 'displayArStartButton', 'displayArStopButton', 'displayArTargetMessage']],
            ['体感环绕', ['displayArMotionEnabled', 'displayArMotionSensitivity', 'displayArMotionRecenter', 'displayArMotionMessage']],
            ['相机跟随', ['displayArTargetPlane', 'displayArTranslationDeadZone', 'displayArRotationDeadZone', 'displayArSmoothing', 'displayArCameraDistance']]
        ]
    });

    const PANELS = Object.freeze([
        ['displayMmdLightingToggle', 'displayMmdLightingPanel'],
        ['displayMmdMotionToggle', 'displayMmdMotionPanel'],
        ['displayArTargetToggle', 'displayArTargetPanel']
    ]);
    const GROUP_SWITCHES = Object.freeze({
        高光: 'displayMmdSpecularEnabled',
        AO: 'displayMmdPmxAoEnabled',
        主光: 'displayMmdKeyShadowEnabled',
        补光: 'displayMmdFillEnabled',
        '边缘光 1': 'displayMmdRim1Enabled',
        '边缘光 2': 'displayMmdRim2Enabled',
        体感环绕: 'displayArMotionEnabled'
    });
    const PANEL_OPACITY_STORAGE_KEY = 'aasc.display.mmdPanelOpacity.v1';
    const DEFAULT_PANEL_OPACITY = 96;
    let progressTimer = null;

    function directChild(panel, element) {
        if (element.parentElement?.classList.contains('display-mmd-ar-actions')
            && element.parentElement.parentElement === panel) return element;
        let node = element;
        while (node?.parentElement && node.parentElement !== panel) node = node.parentElement;
        return node?.parentElement === panel ? node : null;
    }

    function groupPanel(panel, definitions) {
        const covered = new Set();
        for (const [index, [title, ids]] of definitions.entries()) {
            const group = document.createElement('section');
            group.className = 'display-mmd-panel-group';
            if (title === '高光') group.classList.add('mmd-ar-specular');
            const header = document.createElement('div');
            header.className = 'display-mmd-panel-group-header';
            const switchElement = document.getElementById(GROUP_SWITCHES[title]);
            const switchLabel = switchElement && directChild(panel, switchElement);
            if (switchLabel) {
                switchElement.setAttribute('aria-label', title);
                switchLabel.querySelector('span')?.remove();
                switchLabel.classList.add('display-mmd-panel-group-switch');
                covered.add(switchLabel);
                header.appendChild(switchLabel);
            }
            const button = document.createElement('button');
            button.className = 'display-mmd-panel-group-toggle';
            button.type = 'button';
            button.textContent = title;
            const body = document.createElement('div');
            body.className = 'display-mmd-panel-group-body';
            body.id = `${panel.id}Group${index + 1}`;
            body.hidden = index !== 0;
            button.setAttribute('aria-controls', body.id);
            button.setAttribute('aria-expanded', String(index === 0));
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                body.hidden = !body.hidden;
                button.setAttribute('aria-expanded', String(!body.hidden));
            });
            header.appendChild(button);
            for (const id of ids) {
                const element = document.getElementById(id);
                const node = element && directChild(panel, element);
                if (!node || covered.has(node)) continue;
                covered.add(node);
                body.appendChild(node);
            }
            group.append(header, body);
            panel.appendChild(group);
        }
        // 现有定位提示与恢复按钮等没有单独 ID；保持其原事件并归到对应操作组。
        const fallback = panel.querySelector('.display-mmd-panel-group-body');
        for (const node of Array.from(panel.children)) {
            if (node.classList.contains('display-mmd-panel-group') || /-header$/u.test(node.className)) continue;
            fallback?.appendChild(node);
        }
    }

    function formatTime(seconds) {
        const value = Math.max(0, Math.floor(seconds));
        return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    }

    function updateProgress() {
        const progress = document.getElementById('displayMmdMotionProgress');
        const time = document.getElementById('displayMmdMotionTime');
        const motion = root.DisplayMmd?.getMotionProgress?.();
        const duration = Number(motion?.durationSeconds);
        const current = Number(motion?.timeSeconds);
        const valid = motion && Number.isFinite(duration) && duration > 0 && Number.isFinite(current);
        progress.max = valid ? duration : 1;
        progress.value = valid ? Math.max(0, Math.min(duration, current)) : 0;
        time.textContent = valid ? `${formatTime(progress.value)} / ${formatTime(duration)}` : '--:-- / --:--';
    }

    function setMotionOpen(open) {
        const panel = document.getElementById('displayMmdMotionPanel');
        const button = document.getElementById('displayMmdMotionToggle');
        panel.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        if (progressTimer !== null) root.clearInterval(progressTimer);
        progressTimer = open ? root.setInterval(updateProgress, 250) : null;
        if (open) updateProgress();
    }

    function initializeSharedPanelOpacity() {
        const stage = document.getElementById('displayStageLayers');
        const panels = PANELS.map(([, panelId]) => document.getElementById(panelId)).filter(Boolean);
        if (!stage || panels.length === 0) return;

        let opacity = DEFAULT_PANEL_OPACITY;
        try {
            const storedValue = root.localStorage.getItem(PANEL_OPACITY_STORAGE_KEY);
            const parsedValue = storedValue === null || storedValue.trim() === '' ? NaN : Number(storedValue);
            if (Number.isFinite(parsedValue)) opacity = Math.max(0, Math.min(100, Math.round(parsedValue)));
        } catch (error) {
            // 存储不可用时仍使用默认值，并允许本页面即时调节。
        }

        const inputs = [];
        const outputs = [];
        for (const panel of panels) {
            const label = document.createElement('label');
            label.className = 'display-mmd-panel-opacity-control';
            const heading = document.createElement('span');
            heading.append(document.createTextNode('面板不透明度'));
            const output = document.createElement('output');
            output.textContent = `${opacity}%`;
            heading.appendChild(output);
            const input = document.createElement('input');
            input.type = 'range';
            input.min = '0';
            input.max = '100';
            input.step = '1';
            input.value = String(opacity);
            input.setAttribute('aria-label', '面板不透明度');
            input.dataset.displayMmdPanelOpacity = 'true';
            label.append(heading, input);
            panel.prepend(label);
            inputs.push(input);
            outputs.push(output);
        }

        const applyOpacity = (value, persist = false) => {
            opacity = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
            stage.style.setProperty('--display-mmd-panel-opacity', `${opacity}%`);
            for (const input of inputs) input.value = String(opacity);
            for (const output of outputs) output.textContent = `${opacity}%`;
            if (!persist) return;
            try {
                root.localStorage.setItem(PANEL_OPACITY_STORAGE_KEY, String(opacity));
            } catch (error) {
                // 写入失败只影响刷新后的恢复，不影响当前页面的共用滑条。
            }
        };

        for (const input of inputs) {
            input.addEventListener('input', () => applyOpacity(input.value));
            input.addEventListener('change', () => applyOpacity(input.value, true));
        }
        applyOpacity(opacity);
    }

    function initialize() {
        for (const [id, definitions] of Object.entries(GROUPS)) {
            const panel = document.getElementById(id);
            if (panel) groupPanel(panel, definitions);
        }
        initializeSharedPanelOpacity();
        const edge = document.getElementById('displayMmdPmxAoEdgeCorrection');
        if (edge) {
            const key = 'aasc.display.mmdAoEdgeCorrection.v1';
            try { edge.checked = root.localStorage.getItem(key) !== 'false'; }
            catch (error) { edge.checked = true; }
            const syncEdge = () => {
                root.DisplayMmdAoEdgeCorrection = edge.checked;
                try { root.localStorage.setItem(key, String(edge.checked)); }
                catch (error) { /* 无存储权限时本次页面仍可切换。 */ }
            };
            edge.addEventListener('change', syncEdge);
            syncEdge();
        }
        const motionButton = document.getElementById('displayMmdMotionToggle');
        const motionPanel = document.getElementById('displayMmdMotionPanel');
        if (!motionButton || !motionPanel) return;
        motionButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const open = motionPanel.hidden;
            if (open) {
                root.DisplayMmdLighting?.close?.();
                root.DisplayMmdAr?.closePanel?.();
            }
            setMotionOpen(open);
        });
        motionPanel.addEventListener('click', (event) => event.stopPropagation());
        for (const [buttonId] of PANELS.filter(([id]) => id !== 'displayMmdMotionToggle')) {
            document.getElementById(buttonId)?.addEventListener('click', () => setMotionOpen(false));
        }
        document.addEventListener('click', () => setMotionOpen(false));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setMotionOpen(false);
        });
        root.addEventListener('pagehide', () => {
            if (progressTimer !== null) root.clearInterval(progressTimer);
            progressTimer = null;
        }, { once: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
}(window));

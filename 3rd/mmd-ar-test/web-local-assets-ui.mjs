import { createLocalModelSelection, createLocalMotionSelection, listLocalModels, localFilePath, normalizeLocalPath } from './web-local-assets.mjs';

// 系统目录树只提供本次授权文件的随机令牌；转换为标准File后继续复用网页加载器。
export function createNativeDirectoryPicker({ bridge, events, fetchFile = fetch, makeFile = (...args) => new File(...args) }) {
    // 使用时间起点避免刷新页面后重用操作号，旧页面回调不能命中新页面选择。
    let nextOperation = Date.now();
    let pending = null;
    let disposed = false;
    const receive = async ({ detail }) => {
        if (!detail?.operation) return;
        if (!pending || pending.operation !== detail.operation) {
            bridge.releaseDirectory(detail.operation);
            return;
        }
        const selected = pending;
        if (selected.received) return;
        selected.received = true;
        try {
            if (detail.status === 'cancelled') { selected.resolve(null); return; }
            if (detail.status !== 'selected') throw new Error(detail.message || '目录选择失败');
            if (!Array.isArray(detail.files) || detail.files.length > 4096) throw new Error('目录文件清单无效');
            const files = [];
            for (const entry of detail.files) {
                if (disposed) throw new Error('目录选择已结束');
                if (!/^\/picked-files\/[0-9a-f-]{36}$/u.test(entry.url)) throw new Error('目录文件地址无效');
                const path = normalizeLocalPath(entry.path);
                if (!path) throw new Error('目录文件路径无效');
                const response = await fetchFile(entry.url);
                if (!response.ok) throw new Error(`目录文件读取失败：${path}`);
                const blob = await response.blob();
                const file = makeFile([blob], path.split('/').at(-1), { type: blob.type });
                Object.defineProperty(file, 'webkitRelativePath', { value: path });
                files.push(file);
            }
            if (!disposed) selected.resolve(files);
        } catch (error) { selected.reject(error); }
        finally {
            bridge.releaseDirectory(detail.operation);
            if (pending === selected) pending = null;
        }
    };
    events.addEventListener('mmd-ar-directory-picked', receive);
    return {
        pick() {
            if (disposed || pending) return Promise.reject(new Error('目录选择暂不可用'));
            return new Promise((resolve, reject) => {
                const operation = String(++nextOperation);
                pending = { operation, resolve, reject };
                try { bridge.chooseDirectory(operation); }
                catch (error) { pending = null; reject(error); }
            });
        },
        dispose() {
            disposed = true;
            events.removeEventListener('mmd-ar-directory-picked', receive);
            if (pending) {
                bridge.releaseDirectory(pending.operation);
                pending.reject(new Error('目录选择已结束'));
                pending = null;
            }
        }
    };
}

// 一个视图对应当前操作；旧回调和旧收起定时器均不能覆盖下一次加载。
export function createLoadProgressView({ progress, text, fill, schedule = setTimeout, cancel = clearTimeout }) {
    let operation = 0;
    let hideTimer = null;
    let lastPercent = 0;
    let settled = false;
    const clearTimer = () => {
        if (hideTimer !== null) cancel(hideTimer);
        hideTimer = null;
    };
    const update = (token, { phase, percent, indeterminate = false, error } = {}) => {
        if (token !== operation || settled) return false;
        progress.hidden = false;
        progress.dataset.state = error ? 'error' : 'loading';
        progress.dataset.indeterminate = String(indeterminate && !error);
        progress.setAttribute('aria-label', '模型与动作加载进度');
        if (error || indeterminate) {
            progress.removeAttribute('aria-valuenow');
            text.textContent = error ? `加载失败：${error}` : phase;
            fill.style.width = error ? '0%' : '30%';
        } else {
            // 读取比例可能因纹理总数变化回退；显示值始终单调，100%只由提交成功设置。
            lastPercent = Math.max(lastPercent, Math.min(99, Math.max(0, Math.round(Number(percent) || 0))));
            progress.setAttribute('aria-valuenow', String(lastPercent));
            text.textContent = `${phase} ${lastPercent}%`;
            fill.style.width = `${lastPercent}%`;
        }
        if (error) { settled = true; clearTimer(); }
        return true;
    };
    const finish = (token, phase, waiting = false) => {
        if (token !== operation || settled) return false;
        progress.dataset.state = waiting ? 'waiting' : 'complete';
        progress.dataset.indeterminate = 'false';
        text.textContent = waiting ? phase : `${phase} 100%`;
        if (waiting) progress.removeAttribute('aria-valuenow');
        else progress.setAttribute('aria-valuenow', '100');
        fill.style.width = waiting ? '0%' : '100%';
        settled = true;
        clearTimer();
        hideTimer = schedule(() => {
            if (token === operation) { progress.hidden = true; hideTimer = null; }
        }, 1500);
        return true;
    };
    return {
        begin(phase) {
            clearTimer();
            operation += 1;
            settled = false;
            lastPercent = 0;
            update(operation, { phase, indeterminate: true });
            return operation;
        },
        update, finish
    };
}

function initLocalAssets() {
    const panel = document.getElementById('mmdArLocalAssets');
    if (!panel) return;
    const message = document.getElementById('mmdArLocalMessage');
    const modelName = document.getElementById('mmdArLocalModelName');
    const motionName = document.getElementById('mmdArLocalMotionName');
    const modelSelect = document.getElementById('mmdArLocalPmx');
    const directory = document.getElementById('mmdArLocalDirectory');
    const filesInput = document.getElementById('mmdArLocalFiles');
    const motionInput = document.getElementById('mmdArLocalVmd');
    const cameraVmdInput = document.getElementById('mmdArLocalCameraVmd');
    const cameraMotionName = document.getElementById('mmdArLocalCameraMotionName');
    const nativeDirectory = window.MmdArNativeFiles?.chooseDirectory
        ? createNativeDirectoryPicker({ bridge: window.MmdArNativeFiles, events: window }) : null;
    let selectedFiles = [];
    let currentModel = null;
    let currentMotion = null;
    let currentCameraMotion = null;
    let busy = false;
    const view = createLoadProgressView({
        progress: document.getElementById('mmdArLoadingProgress'),
        text: document.getElementById('mmdArLoadingText'),
        fill: document.getElementById('mmdArLoadingFill')
    });
    let defaultOperation = null;
    document.addEventListener('mmd-ar-load-progress', ({ detail }) => {
        if (busy) return;
        if (defaultOperation === null) defaultOperation = view.begin(detail.phase);
        view.update(defaultOperation, detail);
        if (detail.error || detail.percent === 100) {
            if (!detail.error) view.finish(defaultOperation, detail.phase);
            defaultOperation = null;
        }
    });
    // 所有替换入口串行；同时保护会重新加载 profile 的物理开关。
    const run = async (label, action) => {
        if (busy) return;
        if (document.getElementById('mmdArPhysicsEnabled')?.disabled) {
            message.textContent = '物理正在重新加载模型，请完成后再选择本地资源。';
            return;
        }
        busy = true;
        const controls = [...panel.querySelectorAll('button, input, select'),
            document.getElementById('mmdArPhysicsEnabled')].filter(Boolean);
        const disabled = controls.map((control) => control.disabled);
        controls.forEach((control) => { control.disabled = true; });
        message.textContent = label;
        message.dataset.error = 'false';
        defaultOperation = null;
        const operation = view.begin(label);
        const report = (detail) => {
            if (view.update(operation, detail)) {
                message.textContent = document.getElementById('mmdArLoadingText').textContent;
            }
        };
        try {
            // 文件读取、PMX解析和Ammo初始化可能阻塞主线程，先完成一次可见绘制。
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const result = await action(report);
            message.textContent = result?.message || result || '加载完成；本地文件仅在当前页面使用。';
            view.finish(operation, result?.waiting ? result.message : '加载完成', result?.waiting === true);
        } catch (error) {
            message.textContent = error.message || '本地资源加载失败';
            message.dataset.error = 'true';
            view.update(operation, { error: message.textContent });
        } finally {
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
            modelSelect.disabled = selectedFiles.length === 0;
            busy = false;
        }
    };
    const releaseMotion = () => {
        currentMotion?.release();
        currentMotion = null;
    };
    const releaseCameraMotion = () => {
        currentCameraMotion?.release();
        currentCameraMotion = null;
    };
    const applyModel = async (file, report) => {
        const next = createLocalModelSelection(selectedFiles, file);
        const previous = window.DisplayMmd.getModelProfile();
        const inheritMotion = window.DisplayMmd.getState().motionPlaybackEnabled === true
            && Boolean(previous?.motionUrl && previous?.motionResourceId);
        if (inheritMotion) {
            // 用新模型重新解析当前 VMD，不能复用绑定在旧骨骼上的 clip。
            Object.assign(next.profile, { motionUrl: previous.motionUrl,
                motionResourceId: previous.motionResourceId, playMode: previous.playMode || 'loop' });
        }
        try {
            const loaded = await window.DisplayMmd.loadModel(next.profile, report);
            if (!loaded) throw new Error(document.getElementById('displayMmdStatus')?.textContent || '模型加载失败');
        } catch (error) {
            next.release();
            throw error;
        }
        currentModel?.release();
        // 本地动作仍被新 profile 使用时保留其独立上下文，供后续换模型及物理重载读取。
        if (!inheritMotion) releaseMotion();
        currentModel = next;
        modelName.textContent = localFilePath(file);
        if (!inheritMotion) motionName.textContent = '无 VMD 动作（可单独选择）';
    };
    const acceptSelection = async (nextFiles, report) => {
            const models = listLocalModels(nextFiles);
            if (!models.length) throw new Error('所选文件中没有 PMX；请一起选择 PMX 和配套贴图');
            selectedFiles = nextFiles;
            const options = models.map((file) => {
                const option = document.createElement('option');
                option.value = localFilePath(file);
                option.textContent = localFilePath(file);
                return option;
            });
            if (models.length > 1) {
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = '请选择要加载的 PMX';
                options.unshift(placeholder);
            }
            modelSelect.replaceChildren(...options);
            if (models.length > 1) return { waiting: true, message: `找到 ${models.length} 个 PMX，请在下拉框中选择目标模型。` };
            await applyModel(models[0], report);
    };
    const acceptFiles = (input) => {
        if (!input.files.length || busy) return;
        void run('检查本地模型和贴图…', (report) => acceptSelection(Array.from(input.files), report));
    };
    for (const [buttonId, input] of [
        ['mmdArLocalDirectoryButton', directory], ['mmdArLocalFilesButton', filesInput],
        ['mmdArLocalVmdButton', motionInput], ['mmdArLocalCameraVmdButton', cameraVmdInput]
    ]) {
        document.getElementById(buttonId).addEventListener('click', () => {
            if (input === directory && nativeDirectory) {
                void run('选择本地模型目录…', async (report) => {
                    const files = await nativeDirectory.pick();
                    if (!files) return { waiting: true, message: '已取消目录选择，保留当前模型与动作。' };
                    return acceptSelection(files, report);
                });
                return;
            }
            // 清空 input 允许重选同一批文件；当前已加载模型另有会话引用，不依赖 input。
            input.value = '';
            input.click();
        });
    }
    if (!nativeDirectory && !('webkitdirectory' in directory)) document.getElementById('mmdArLocalDirectoryButton').hidden = true;
    directory.addEventListener('change', () => acceptFiles(directory));
    filesInput.addEventListener('change', () => acceptFiles(filesInput));
    modelSelect.addEventListener('change', () => {
        const file = listLocalModels(selectedFiles).find((entry) => localFilePath(entry) === modelSelect.value);
        if (file) void run('加载所选 PMX…', (report) => applyModel(file, report));
    });
    motionInput.addEventListener('change', () => {
        const file = motionInput.files[0];
        if (!file) return;
        void run('加载本地 VMD…', async (report) => {
            const next = createLocalMotionSelection(file);
            try {
                if (!await window.DisplayMmd.loadSelectedMotion(next, report)) throw new Error('动作加载已取消，请重新选择');
            } catch (error) {
                next.release();
                throw error;
            }
            releaseMotion();
            currentMotion = next;
            motionName.textContent = file.name;
        });
    });
    cameraVmdInput.addEventListener('change', () => {
        const file = cameraVmdInput.files[0];
        if (!file) return;
        void run('加载相机 VMD…', async (report) => {
            const next = createLocalMotionSelection(file);
            try {
                if (!await window.DisplayMmd.loadSelectedCameraMotion(next, report)) throw new Error('相机动作加载已取消，请重新选择');
            } catch (error) {
                next.release();
                throw error;
            }
            releaseCameraMotion();
            currentCameraMotion = next;
            cameraMotionName.textContent = file.name;
        });
    });
    document.getElementById('mmdArLocalDefaultMotion').addEventListener('click', () => {
        void run('恢复默认动作…', async (report) => {
            if (!await window.DisplayMmd.restoreDefaultMotion(report)) throw new Error('默认动作加载已取消');
            releaseMotion();
            motionName.textContent = '内置默认动作';
        });
    });
    document.getElementById('mmdArLocalDefaultModel').addEventListener('click', () => {
        void run('恢复默认模型和动作…', async (report) => {
            if (!await window.DisplayMmd.restoreDefaultModel(report)) throw new Error('默认模型加载失败');
            currentModel?.release();
            currentModel = null;
            releaseMotion();
            // 相机动作不属于默认模型/动作，恢复默认时一并清除并回到无相机动作状态。
            window.DisplayMmd.clearCameraMotion?.();
            releaseCameraMotion();
            modelName.textContent = '内置默认模型';
            motionName.textContent = '内置默认动作';
            cameraMotionName.textContent = '无相机动作';
        });
    });
    window.addEventListener('pagehide', (event) => {
        // BFCache 恢复会继续使用相同 File/URL，只有真正离开才释放。
        if (event.persisted) return;
        nativeDirectory?.dispose();
        currentModel?.release();
        releaseMotion();
        releaseCameraMotion();
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLocalAssets, { once: true });
    else initLocalAssets();
}

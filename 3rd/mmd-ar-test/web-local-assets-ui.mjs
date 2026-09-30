import { createLocalModelSelection, createLocalMotionSelection, listLocalModels, localFilePath } from './web-local-assets.mjs';

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
    let selectedFiles = [];
    let currentModel = null;
    let currentMotion = null;
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
    const applyModel = async (file, report) => {
        const next = createLocalModelSelection(selectedFiles, file);
        try {
            const loaded = await window.DisplayMmd.loadModel(next.profile, report);
            if (!loaded) throw new Error(document.getElementById('displayMmdStatus')?.textContent || '模型加载失败');
        } catch (error) {
            next.release();
            throw error;
        }
        currentModel?.release();
        releaseMotion();
        currentModel = next;
        modelName.textContent = localFilePath(file);
        motionName.textContent = '无 VMD 动作（可单独选择）';
    };
    const acceptFiles = (input) => {
        if (!input.files.length || busy) return;
        const nextFiles = Array.from(input.files);
        void run('检查本地模型和贴图…', async (report) => {
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
        });
    };
    for (const [buttonId, input] of [
        ['mmdArLocalDirectoryButton', directory], ['mmdArLocalFilesButton', filesInput],
        ['mmdArLocalVmdButton', motionInput]
    ]) {
        document.getElementById(buttonId).addEventListener('click', () => {
            // 清空 input 允许重选同一批文件；当前已加载模型另有会话引用，不依赖 input。
            input.value = '';
            input.click();
        });
    }
    if (!('webkitdirectory' in directory)) document.getElementById('mmdArLocalDirectoryButton').hidden = true;
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
            modelName.textContent = '内置默认模型';
            motionName.textContent = '内置默认动作';
        });
    });
    window.addEventListener('pagehide', (event) => {
        // BFCache 恢复会继续使用相同 File/URL，只有真正离开才释放。
        if (event.persisted) return;
        currentModel?.release();
        releaseMotion();
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLocalAssets, { once: true });
    else initLocalAssets();
}

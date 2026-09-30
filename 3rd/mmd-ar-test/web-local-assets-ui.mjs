import { createLocalModelSelection, createLocalMotionSelection, listLocalModels, localFilePath } from './web-local-assets.mjs';

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
        try {
            const result = await action();
            message.textContent = result || '加载完成；本地文件仅在当前页面使用。';
        } catch (error) {
            message.textContent = error.message || '本地资源加载失败';
            message.dataset.error = 'true';
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
    const applyModel = async (file) => {
        const next = createLocalModelSelection(selectedFiles, file);
        try {
            const loaded = await window.DisplayMmd.loadModel(next.profile);
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
        void run('检查本地模型和贴图…', async () => {
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
            if (models.length > 1) return `找到 ${models.length} 个 PMX，请在下拉框中选择目标模型。`;
            await applyModel(models[0]);
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
        if (file) void run('加载所选 PMX…', () => applyModel(file));
    });
    motionInput.addEventListener('change', () => {
        const file = motionInput.files[0];
        if (!file) return;
        void run('加载本地 VMD…', async () => {
            const next = createLocalMotionSelection(file);
            try {
                if (!await window.DisplayMmd.loadSelectedMotion(next)) throw new Error('动作加载已取消，请重新选择');
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
        void run('恢复默认动作…', async () => {
            if (!await window.DisplayMmd.restoreDefaultMotion()) throw new Error('默认动作加载已取消');
            releaseMotion();
            motionName.textContent = '内置默认动作';
        });
    });
    document.getElementById('mmdArLocalDefaultModel').addEventListener('click', () => {
        void run('恢复默认模型和动作…', async () => {
            if (!await window.DisplayMmd.restoreDefaultModel()) throw new Error('默认模型加载失败');
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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLocalAssets, { once: true });
else initLocalAssets();

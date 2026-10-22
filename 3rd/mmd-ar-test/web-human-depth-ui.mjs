import { createDepthClient } from './web-human-depth-client.mjs';
import { buildDepthHints, depthHeatmap, DEPTH_DEGENERATE_RANGE } from './web-human-depth-core.mjs';
import { POSE_BODY_KEYS, getPosePoint, filterImageDepthHints, isHmrPose } from './web-human-pose-semantic.mjs';

// 深度是独立任务，失败不删除骨骼结果；浮点值与图片对象绑定，不允许跨图片复用。
export function installImageDepth(root, { getImage, canCompute, onChanged = () => {}, cancelPose = () => {}, client = createDepthClient() }) {
    const panel = document.createElement('div'); panel.dataset.poseDepthPanel = '';
    panel.innerHTML = `<h4>Depth Anything V2 Small · 整图相对深度</h4>
        <label><input type="checkbox" data-depth="with-recognition">识别时同时计算整图深度（约27.3MB模型，浏览器本地）</label>
        <div class="display-mmd-ar-actions"><button type="button" class="display-mmd-ar-action" data-depth="compute">计算整图相对深度</button>
        <button type="button" class="display-mmd-ar-action" data-depth="cancel">取消深度计算</button></div>
        <label><input type="checkbox" data-depth="assist">相对深度辅助骨骼拟合（实验，默认关闭）</label>
        <canvas data-depth="preview" aria-label="当前原图的整图相对深度" style="max-width:100%;height:auto" hidden></canvas>
        <p>相对深度：黄色较近、蓝色较远；只比较当前图片的可见表面。衣物、背景、遮挡物也有深度；不是米制关节深度，不能可靠恢复隐藏腿或脚掌方向。</p>
        <p data-depth="status" role="status">点击后按需加载模型；深度只在当前浏览器计算。</p>`;
    root.querySelector('[data-pose="preview"]').insertAdjacentElement('afterend', panel);
    const field = key => panel.querySelector('[data-depth="' + key + '"]');
    let depth = null, image = null, epoch = 0, busy = false, disposed = false;
    const status = text => { field('status').textContent = text; };
    function buttons() {
        field('compute').disabled = disposed || busy || !getImage() || !canCompute();
        field('cancel').disabled = !busy;
    }
    function cancel() {
        epoch++;
        if (busy) client.cancel();
        busy = false; buttons();
    }
    function reset() {
        cancel(); depth = null; image = null;
        field('preview').hidden = true; field('preview').width = field('preview').height = 0;
        status('当前图片尚未计算相对深度。');
    }
    async function compute({ automatic = false } = {}) {
        const sourceImage = getImage();
        if (disposed || !sourceImage || busy || (!automatic && !canCompute())) return;
        const id = ++epoch; busy = true; depth = null; image = null;
        field('preview').hidden = true; buttons(); onChanged(); status('正在准备整图深度模型…');
        try {
            const result = await client.infer(sourceImage, message => { if (id === epoch) status(message); });
            if (disposed || id !== epoch || sourceImage !== getImage()) return;
            depth = result; image = sourceImage;
            const canvas = field('preview'), scratch = document.createElement('canvas');
            scratch.width = depth.width; scratch.height = depth.height;
            scratch.getContext('2d').putImageData(new ImageData(depthHeatmap(depth), depth.width, depth.height), 0, 0);
            canvas.width = Math.min(400, image.width); canvas.height = Math.max(1, Math.round(image.height * canvas.width / image.width));
            canvas.getContext('2d').drawImage(scratch, 0, 0, canvas.width, canvas.height);
            scratch.width = scratch.height = 0; canvas.hidden = false;
            status(`整图相对深度完成 · ${Number(depth.inferenceMs).toFixed(0)}ms · `
                + (depth.high - depth.low <= DEPTH_DEGENERATE_RANGE ? '深度范围退化，显示灰图，不提供前后排序。' : '黄色较近、蓝色较远。')
                + '仅当前图片可见表面。');
        } catch (error) {
            if (id === epoch && error.name !== 'AbortError') status('深度推理失败：' + error.message + '；已有骨骼结果保持。');
        } finally {
            if (id === epoch) { busy = false; buttons(); onChanged(); }
        }
    }
    function getOptions(pose) {
        if (!field('assist').checked) return { depthEnabled: false };
        if (!depth || image !== getImage() || busy) throw new Error('已开启深度辅助，请先完成当前图片的整图深度计算，或关闭辅助');
        const points = POSE_BODY_KEYS.map(key => ({ key, ...getPosePoint(pose, key) }));
        const { hints: proposed, rejected } = buildDepthHints(depth, points);
        const { hints, rejected: nativeRejected } = filterImageDepthHints(pose, proposed);
        return { depthRequested: true, depthEnabled: hints.length > 0, depthHints: hints, depthSampleRejected: [...rejected, ...nativeRejected] };
    }
    field('compute').addEventListener('click', () => { cancelPose(); void compute(); });
    field('cancel').addEventListener('click', () => { cancel(); status('深度计算已取消，当前骨骼保持原姿态。'); onChanged(); });
    for (const name of ['assist', 'with-recognition']) field(name).addEventListener('change', () => { cancelPose(); onChanged(); });
    buttons();
    return { cancel, reset, compute, getOptions, busy: () => busy,
        readyToApply: () => !field('assist').checked || (!busy && !!depth && image === getImage()),
        withRecognition: () => field('with-recognition').checked,
        setMode(source) { field('with-recognition').checked = isHmrPose({ source }); },
        sync() { buttons(); },
        dispose() { disposed = true; cancel(); client.dispose(); depth = image = null; field('preview').width = field('preview').height = 0; }
    };
}

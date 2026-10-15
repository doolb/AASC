import { createImagePoseClient } from './web-human-pose-client.mjs';
import { landmarkQuality, BODY_LANDMARKS } from './web-human-pose-core.mjs';

const EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 7], [0, 8]];
const BODY_NAMES = ['左肩', '右肩', '左肘', '右肘', '左腕', '右腕', '左髋', '右髋', '左膝', '右膝', '左踝', '右踝'];
export function installImagePose(panel, { human, ensurePhysics }) {
    const root = document.createElement('details'); root.dataset.posePanel = '';
    root.innerHTML = `<summary>图片姿态</summary>
        <p>在本机识别单人全身图片，预览后应用到身体物理。图片不会上传，深度为估计，应用后可继续拖点微调。</p>
        <label>选择图片 <input data-pose="file" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <div class="display-mmd-ar-actions"><button type="button" class="display-mmd-ar-action" data-pose="recognize">识别姿态</button>
        <button type="button" class="display-mmd-ar-action" data-pose="apply">应用姿态</button>
        <button type="button" class="display-mmd-ar-action" data-pose="cancel">取消识别</button></div>
        <label data-pose="candidate-row" hidden>人物候选 <select data-pose="candidate" aria-label="切换人物候选"></select></label>
        <canvas data-pose="preview" aria-label="图片与识别关键点预览" style="max-width:100%;height:auto" hidden></canvas>
        <p data-pose="status" role="status">首次识别按需加载模型；请先加载PMX模型。</p>`;
    panel.querySelector('[data-ik-message]').insertAdjacentElement('beforebegin', root);
    const field = key => root.querySelector('[data-pose="' + key + '"]');
    const client = createImagePoseClient(), preview = field('preview'), context = preview.getContext('2d');
    let image = null, result = null, candidates = [], inferenceMs = 0, busy = false, ready = false, serial = 0, token = null, disposed = false;
    const status = text => { field('status').textContent = text; };
    function buttons() {
        field('recognize').disabled = !ready || !image || busy;
        field('apply').disabled = !ready || !result?.quality.torsoReady || busy;
        field('cancel').disabled = !busy;
        field('candidate').disabled = busy || !ready;
        field('candidate-row').hidden = candidates.length < 2;
    }
    function clearResult() {
        result = null; candidates = []; field('candidate').replaceChildren();
    }
    function showCandidate(index) {
        result = candidates[index];
        draw(); buttons();
        if (!result) return;
        const count = result.landmarks.filter(point => landmarkQuality(point) >= 0.5).length;
        const low = result.quality.lowConfidence.map(i => BODY_NAMES[BODY_LANDMARKS.indexOf(i)]).join('、');
        const advice = result.quality.torsoReady ? '确认预览后点击“应用姿态”。' : '躯干关键点不完整，暂不能应用，请切换候选或图片。';
        status(`识别完成：候选${index + 1} · ${count}/33个可信关键点 · 身体${result.quality.visible}/12 · ${inferenceMs.toFixed(0)}ms。`
            + (low ? `低可信：${low}（红色空心点，可能遮挡或出画）。` : '') + '可信度不代表坐标准确。' + advice);
    }
    function cancel() {
        if (!busy) return;
        serial++; busy = false; client.cancel(); buttons(); status('识别已取消，当前骨骼保持原姿态');
    }
    function draw() {
        if (!image) return;
        const scratch = document.createElement('canvas'); scratch.width = image.width; scratch.height = image.height;
        scratch.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        preview.width = Math.min(400, image.width); preview.height = Math.round(image.height * preview.width / image.width);
        context.drawImage(scratch, 0, 0, preview.width, preview.height); preview.hidden = false;
        scratch.width = scratch.height = 0;
        if (!result) return;
        const valid = index => landmarkQuality(result.landmarks[index]) >= 0.5;
        const at = index => [result.landmarks[index].x * preview.width, result.landmarks[index].y * preview.height];
        context.strokeStyle = '#35efbd'; context.fillStyle = '#ffcf52'; context.lineWidth = 2;
        for (const [a, b] of EDGES) if (valid(a) && valid(b)) { context.beginPath(); context.moveTo(...at(a)); context.lineTo(...at(b)); context.stroke(); }
        result.landmarks.forEach((_, index) => { if (valid(index)) { context.beginPath(); context.arc(...at(index), 2.5, 0, Math.PI * 2); context.fill(); } });
        context.strokeStyle = '#ef5252';
        for (const index of result.quality.lowConfidence) {
            const [x, y] = at(index);
            if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= preview.width && y >= 0 && y <= preview.height) {
                context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.stroke();
            }
        }
    }
    field('file').addEventListener('change', async () => {
        cancel(); const id = ++serial; clearResult(); image = null; preview.hidden = true; buttons();
        const file = field('file').files?.[0];
        if (!file) return;
        let bitmap;
        try {
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('请选择20MiB以内的JPG、PNG或WebP图片');
            bitmap = await createImageBitmap(file);
            if (disposed || id !== serial) return;
            if (bitmap.width * bitmap.height > 4096 * 4096) throw new Error('图片超过1600万像素，请先缩小');
            const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
            const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            image = ctx.getImageData(0, 0, canvas.width, canvas.height); canvas.width = canvas.height = 0;
            draw(); status('图片已准备，点击“识别姿态”');
        } catch (error) { if (id === serial) status(error.message); }
        finally { bitmap?.close(); buttons(); }
    });
    field('recognize').addEventListener('click', async () => {
        if (!image || busy) return;
        const id = ++serial;
        try {
            token = human().getState().token; clearResult(); busy = true; buttons(); draw();
            status('准备浏览器本地推理…');
            const inferred = await client.infer(image, message => { if (id === serial) status(message); });
            if (id !== serial || disposed) return;
            if (human().getState().token !== token) throw new Error('模型已切换，识别结果已丢弃');
            candidates = inferred.candidates; inferenceMs = inferred.inferenceMs;
            field('candidate').replaceChildren(...candidates.map((candidate, index) => {
                const option = document.createElement('option'); option.value = String(index);
                option.textContent = `候选${index + 1} · 身体${candidate.quality.visible}/12`;
                return option;
            }));
            field('candidate').value = '0'; showCandidate(0);
        } catch (error) { if (id === serial && error.name !== 'AbortError') status(error.message); }
        finally { if (id === serial) { busy = false; buttons(); } }
    });
    field('apply').addEventListener('click', async () => {
        if (!result?.quality.torsoReady || busy) return;
        const id = ++serial, pose = result, expectedToken = token;
        try {
            busy = true; buttons(); await ensurePhysics({ isCurrent: () => id === serial && !disposed });
            if (id !== serial || disposed) return;
            const state = human().applyInteractiveImagePose(pose, expectedToken);
            status(`已应用${state.activeTargets}个控制点，可继续拖动微调；重置控制点可恢复原动作。`);
        } catch (error) { if (id === serial) status(error.message); }
        finally { if (id === serial) { busy = false; buttons(); } }
    });
    field('cancel').addEventListener('click', cancel);
    field('candidate').addEventListener('change', () => { if (!busy) showCandidate(Number(field('candidate').value)); });
    buttons();
    return {
        cancel,
        sync(isReady) {
            ready = isReady;
            if (token && (!ready || human().getState().token !== token)) { cancel(); token = null; clearResult(); status('模型已切换，请重新识别图片'); draw(); }
            buttons();
        },
        dispose() { disposed = true; serial++; client.dispose(); clearResult(); image = null; preview.width = preview.height = 0; }
    };
}

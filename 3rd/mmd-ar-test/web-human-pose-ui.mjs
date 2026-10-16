import { createImagePoseClient } from './web-human-pose-client.mjs';
import { landmarkQuality, BODY_LANDMARKS, poseLandmarkThreshold } from './web-human-pose-core.mjs';
import { installPoseOverlay } from './web-human-pose-overlay.mjs';

const EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 7], [0, 8]];
const BODY_NAMES = ['左肩', '右肩', '左肘', '右肘', '左腕', '右腕', '左髋', '右髋', '左膝', '右膝', '左踝', '右踝'];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export function installImagePose(panel, { human, ensurePhysics }) {
    const root = document.createElement('details'); root.dataset.posePanel = '';
    root.innerHTML = `<summary>图片姿态</summary>
        <p>RTMPose-m 在本机识别单人全身图片（17点，首次加载约52.3MiB模型）。图片不会上传；三维深度按当前姿态估计，应用后可在3D场景拖点微调。</p>
        <label>选择图片 <input data-pose="file" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <button type="button" class="display-mmd-ar-action" data-pose="paste">粘贴图片</button>
        <p>展开此区域后可按 Ctrl+V（Mac 用 ⌘V）粘贴截图或复制的图片，再点击识别姿态。</p>
        <div class="display-mmd-ar-actions"><button type="button" class="display-mmd-ar-action" data-pose="recognize">识别姿态</button>
        <button type="button" class="display-mmd-ar-action" data-pose="apply">应用姿态</button>
        <button type="button" class="display-mmd-ar-action" data-pose="cancel">取消识别</button></div>
        <label data-pose="candidate-row" hidden>人物候选 <select data-pose="candidate" aria-label="切换人物候选"></select></label>
        <canvas data-pose="preview" aria-label="图片与识别关键点预览" style="max-width:100%;height:auto" hidden></canvas>
        <p data-pose="status" role="status">首次识别按需加载模型；请先加载PMX模型。</p>`;
    panel.querySelector('[data-ik-message]').insertAdjacentElement('beforebegin', root);
    const field = key => root.querySelector('[data-pose="' + key + '"]');
    const client = createImagePoseClient(), preview = field('preview'), context = preview.getContext('2d');
    const overlay = installPoseOverlay(panel, root, { preview, human, redraw: () => draw() });
    let image = null, result = null, candidates = [], inferenceMs = 0, busy = false, ready = false, serial = 0, token = null, disposed = false;
    let readSerial = 0, reading = false, importing = false;
    const status = text => { field('status').textContent = text; };
    const acceptsPaste = () => !disposed && !panel.hidden && root.open;
    function buttons() {
        const pending = busy || reading || importing;
        field('recognize').disabled = !ready || !image || pending;
        field('apply').disabled = !ready || !result?.quality.torsoReady || pending;
        field('cancel').disabled = !pending;
        field('paste').disabled = reading || disposed;
        field('candidate').disabled = pending || !ready;
        field('candidate-row').hidden = candidates.length < 2;
    }
    function clearResult() {
        result = null; candidates = []; field('candidate').replaceChildren();
    }
    function showCandidate(index) {
        result = candidates[index];
        draw(); buttons();
        if (!result) return;
        const count = result.landmarks.filter(point => landmarkQuality(point) >= poseLandmarkThreshold(result)).length;
        const low = result.quality.lowConfidence.map(i => BODY_NAMES[BODY_LANDMARKS.indexOf(i)]).join('、');
        const advice = result.quality.torsoReady ? '确认预览后点击“应用姿态”。' : '躯干关键点不完整，暂不能应用，请切换候选或图片。';
        status(`识别完成：${result.source === 'rtmpose-m' ? 'RTMPose-m · 单人全图' : '候选' + (index + 1)} · ${count}/${result.landmarks.filter(Boolean).length}个可信关键点 · 身体${result.quality.visible}/12 · ${inferenceMs.toFixed(0)}ms。`
            + (low ? `低可信：${low}（红色空心点，可能遮挡或出画）。` : '') + '可信度不代表坐标准确。' + advice);
    }
    function cancel() {
        overlay.cancel();
        const pending = busy || reading || importing;
        // 即使没有运行ONNX，也使尚未返回的剪贴板读取/图片解码失效；空闲时保留已加载Worker。
        serial++; readSerial++;
        if (busy) client.cancel();
        busy = reading = importing = false; buttons();
        if (pending) status('操作已取消，当前骨骼保持原姿态');
    }
    function draw() {
        if (!image) return;
        const scratch = document.createElement('canvas'); scratch.width = image.width; scratch.height = image.height;
        scratch.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        preview.width = Math.min(400, image.width); preview.height = Math.round(image.height * preview.width / image.width);
        context.drawImage(scratch, 0, 0, preview.width, preview.height); preview.hidden = false;
        scratch.width = scratch.height = 0;
        if (!result || !overlay.showReference()) { overlay.setReference(image, result); return; }
        const valid = index => landmarkQuality(result.landmarks[index]) >= poseLandmarkThreshold(result);
        const at = index => [result.landmarks[index].x * preview.width, result.landmarks[index].y * preview.height];
        context.strokeStyle = '#35efbd'; context.fillStyle = '#ffcf52'; context.lineWidth = 2;
        for (const [a, b] of EDGES) if (valid(a) && valid(b)) { context.beginPath(); context.moveTo(...at(a)); context.lineTo(...at(b)); context.stroke(); }
        result.landmarks.forEach((_, index) => { if (valid(index)) { context.beginPath(); context.arc(...at(index), 2.5, 0, Math.PI * 2); context.fill(); } });
        context.strokeStyle = '#ef5252';
        for (const index of result.quality.lowConfidence) {
            if (!result.landmarks[index]) continue;
            const [x, y] = at(index);
            if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= preview.width && y >= 0 && y <= preview.height) {
                context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.stroke();
            }
        }
        overlay.setReference(image, result);
    }
    async function importImage(file, fromPaste = false) {
        if (!file || disposed) return;
        cancel(); const id = ++serial; clearResult(); importing = true; buttons(); draw();
        status('正在准备图片…');
        let bitmap;
        try {
            if (!IMAGE_TYPES.includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('请选择20MiB以内的JPG、PNG或WebP图片');
            bitmap = await createImageBitmap(file);
            if (disposed || id !== serial || (fromPaste && !acceptsPaste())) return;
            if (bitmap.width * bitmap.height > 4096 * 4096) throw new Error('图片超过1600万像素，请先缩小');
            const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
            const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            image = ctx.getImageData(0, 0, canvas.width, canvas.height); canvas.width = canvas.height = 0;
            // 清除旧文件名，保证粘贴后再次选择同一文件也会触发change。
            if (fromPaste) field('file').value = '';
            draw(); status('图片已准备，点击“识别姿态”');
        } catch (error) { if (id === serial) status(error.message); }
        finally { bitmap?.close(); if (id === serial && !disposed) { importing = false; buttons(); } }
    }
    function onPaste(event) {
        if (!acceptsPaste() || event.defaultPrevented || event.target?.isContentEditable
            || event.target?.closest?.('input, textarea, select')) return;
        const files = Array.from(event.clipboardData?.files || []);
        const file = files.find(value => IMAGE_TYPES.includes(value.type));
        if (!file) return;
        event.preventDefault(); void importImage(file, true);
    }
    async function readClipboardImage() {
        if (!acceptsPaste() || reading) return;
        cancel(); const id = ++readSerial;
        const isCurrent = () => id === readSerial && acceptsPaste();
        reading = true; buttons(); status('正在读取剪贴板图片…');
        try {
            if (typeof navigator.clipboard?.read !== 'function') throw new Error('当前浏览器无法读取剪贴板，请按 Ctrl+V 或选择图片文件');
            const items = await navigator.clipboard.read();
            if (!isCurrent()) return;
            for (const item of items) {
                const type = IMAGE_TYPES.find(value => item.types.includes(value));
                if (!type) continue;
                const file = await item.getType(type);
                if (!isCurrent()) return;
                reading = false; await importImage(file, true); return;
            }
            throw new Error('剪贴板中没有支持的图片，请复制截图/图片后重试，或选择图片文件');
        } catch (error) {
            if (isCurrent()) status(error.name === 'NotAllowedError'
                ? '浏览器未允许读取剪贴板，请按 Ctrl+V 或选择图片文件'
                : (error.message || '剪贴板读取失败，请按 Ctrl+V 或选择图片文件'));
        } finally { if (id === readSerial && !disposed) { reading = false; buttons(); } }
    }
    const onToggle = () => { if (!root.open) cancel(); };
    document.addEventListener('paste', onPaste);
    root.addEventListener('toggle', onToggle);
    field('paste').addEventListener('click', readClipboardImage);
    field('file').addEventListener('change', () => {
        void importImage(field('file').files?.[0]);
    });
    field('recognize').addEventListener('click', async () => {
        if (!image || busy || reading || importing || disposed) return;
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
        if (!result?.quality.torsoReady || busy || reading || importing || disposed) return;
        const id = ++serial, pose = result, expectedToken = token;
        try {
            busy = true; buttons(); await ensurePhysics({ isCurrent: () => id === serial && !disposed });
            if (id !== serial || disposed) return;
            status('正在按实际骨骼和关节范围拟合姿态…');
            const state = await human().applyInteractiveImagePose(pose, expectedToken, { isCurrent: () => id === serial && !disposed });
            if (id !== serial || disposed) return;
            status(`已应用${state.activeTargets}个控制点，${pose.dimensions === 2 ? '已按关节范围拟合，深度为估计；等待物理稳定并检查实际骨架，' : ''}可继续在3D场景拖动微调；重置控制点可恢复原动作。`);
        } catch (error) { if (id === serial) status(error.message); }
        finally { if (id === serial) { busy = false; buttons(); } }
    });
    field('cancel').addEventListener('click', cancel);
    field('candidate').addEventListener('change', () => { if (!busy && !reading && !importing && !disposed) showCandidate(Number(field('candidate').value)); });
    buttons();
    return {
        cancel,
        sync(isReady) {
            ready = isReady;
            if (token && (!ready || human().getState().token !== token)) { cancel(); token = null; clearResult(); status('模型已切换，请重新识别图片'); draw(); }
            buttons();
            overlay.sync(ready);
        },
        dispose() {
            disposed = true; serial++; readSerial++;
            overlay.dispose();
            document.removeEventListener('paste', onPaste); root.removeEventListener('toggle', onToggle);
            client.dispose(); clearResult(); image = null; preview.width = preview.height = 0;
        }
    };
}

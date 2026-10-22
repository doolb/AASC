import { createImagePoseClient } from './web-human-pose-client.mjs';
import { createHmr2PoseClient, normalizeHmr2BaseUrl } from './web-human-hmr2-client.mjs';
import { createHmrWebClient } from './web-human-hmr2-web-client.mjs';
import { POSE_BODY_KEYS, getPoseQuality, getPoseReference, isHmrPose } from './web-human-pose-semantic.mjs';
import { installImageDepth } from './web-human-depth-ui.mjs';
import { installPoseOverlay } from './web-human-pose-overlay.mjs';

const BODY_NAMES = ['左肩', '右肩', '左肘', '右肘', '左腕', '右腕', '左髋', '右髋', '左膝', '右膝', '左踝', '右踝'];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export function installImagePose(panel, { human, ensurePhysics, poseClient = createImagePoseClient(), hmrClient = createHmr2PoseClient(), hmrWebClient = createHmrWebClient(), depthClient } = {}) {
    const root = document.createElement('details'); root.dataset.posePanel = '';
    root.innerHTML = `<summary>图片姿态</summary>
        <label>骨骼计算方式 <select data-pose="source"><option value="mediapipe-pose">MediaPipe Pose · 本地</option><option value="hmr2-api">HMR2.0b · GPU API</option><option value="hmr2-web" disabled>HMR2.0b · 纯网页 WebGPU</option></select></label>
        <p data-pose="web-status" role="status">正在检查可选HMR网页模型…</p>
        <button type="button" class="display-mmd-ar-action" data-pose="web-refresh">重新检查网页模型</button>
        <p data-pose="privacy">MediaPipe Pose 在本机识别全身图片（33点，首次加载约16.7MiB检测与姿态模型）。图片不会上传；三维坐标为模型估计，应用后可在3D场景拖点微调。</p>
        <div data-pose="api-controls" hidden>
        <label>API 服务根地址 <input data-pose="api-url" type="url" placeholder="http://127.0.0.1:8768" style="width:100%;box-sizing:border-box"></label>
        <label>Bearer Token（只在本次会话使用）<input data-pose="api-token" type="password" autocomplete="off" style="width:100%;box-sizing:border-box"></label>
        <button type="button" class="display-mmd-ar-action" data-pose="test-api">测试连接（不上传图片）</button>
        <p>电脑服务供手机调用时填电脑局域网地址；服务必须允许当前网页 Origin。HTTPS 页面不能绕过远端 HTTP 限制，请使用合适的 HTTPS 部署。</p>
        </div><div data-pose="bbox-controls" hidden>
        <label><input data-pose="bbox-enabled" type="checkbox">指定人物框（已缩放/定向图片的像素 xyxy）</label>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
        <label>左 x1 <input data-pose="bbox-x1" type="number" min="0" step="any" style="width:100%;box-sizing:border-box"></label>
        <label>上 y1 <input data-pose="bbox-y1" type="number" min="0" step="any" style="width:100%;box-sizing:border-box"></label>
        <label>右 x2 <input data-pose="bbox-x2" type="number" min="0" step="any" style="width:100%;box-sizing:border-box"></label>
        <label>下 y2 <input data-pose="bbox-y2" type="number" min="0" step="any" style="width:100%;box-sizing:border-box"></label></div>
        <p data-pose="image-size">不指定框时使用整图单人假设，不是自动人物检测。HMR 原始结果仍可能存在左右腿/脚掌误判。</p></div>
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
    const client = poseClient, preview = field('preview'), context = preview.getContext('2d');
    const overlay = installPoseOverlay(panel, root, { preview, human, redraw: () => draw() });
    let image = null, result = null, candidates = [], inferenceMs = 0, busy = false, ready = false, serial = 0, token = null, disposed = false;
    let readSerial = 0, reading = false, importing = false, depth = null, observedToken = null;
    depth = installImageDepth(root, { getImage: () => image,
        canCompute: () => ready && !busy && !reading && !importing && !disposed && !panel.hidden && root.open,
        onChanged: () => buttons(), cancelPose: () => cancel(), ...(depthClient ? { client: depthClient } : {}) });
    const engines = { 'mediapipe-pose': (picture, progress) => client.infer(picture, progress),
        'hmr2-api': (picture, progress) => hmrClient.infer(picture, apiConfig(), progress),
        'hmr2-web': (picture, progress) => hmrWebClient.infer(picture, { bbox: selectedBox() }, progress) };
    let webAvailable = false, probeController = null;
    const preferencesKey = 'mmdAr.hmr2ApiBaseUrl';
    try { field('api-url').value = localStorage.getItem(preferencesKey) || 'http://127.0.0.1:8768'; }
    catch (error) { field('api-url').value = 'http://127.0.0.1:8768'; }
    function apiConfig() {
        const baseUrl = normalizeHmr2BaseUrl(field('api-url').value);
        try { localStorage.setItem(preferencesKey, baseUrl); } catch (error) { /* 私密模式不影响本次使用，密钥从不持久化。 */ }
        return { baseUrl, token: field('api-token').value, bbox: selectedBox() };
    }
    function selectedBox() {
        return field('bbox-enabled').checked ? ['x1', 'y1', 'x2', 'y2'].map(key => {
            const value = field('bbox-' + key).value.trim(); return value ? Number(value) : NaN;
        }) : undefined;
    }
    const status = text => { field('status').textContent = text; };
    const acceptsPaste = () => !disposed && !panel.hidden && root.open;
    function buttons() {
        const pending = busy || reading || importing || depth?.busy();
        field('recognize').disabled = !ready || !image || pending || (field('source').value === 'hmr2-web' && !webAvailable);
        field('web-refresh').disabled = pending || disposed;
        field('apply').disabled = !ready || !getPoseQuality(result).torsoReady || pending || !depth?.readyToApply();
        field('cancel').disabled = !pending;
        field('paste').disabled = reading || disposed;
        field('candidate').disabled = pending || !ready;
        field('candidate-row').hidden = candidates.length < 2;
        field('test-api').disabled = pending || disposed || field('source').value !== 'hmr2-api';
        depth?.sync();
    }
    function clearResult() {
        result = null; candidates = []; field('candidate').replaceChildren();
    }
    function showCandidate(index) {
        result = candidates[index];
        draw(); buttons();
        if (!result) return;
        const reference = getPoseReference(result), quality = getPoseQuality(result);
        const count = reference.points.filter(point => point.usable).length;
        const low = quality.lowConfidence.map(key => BODY_NAMES[POSE_BODY_KEYS.indexOf(key)] || key).join('、');
        const advice = quality.torsoReady ? '确认预览后点击“应用姿态”。' : '躯干关键点不完整，暂不能应用，请切换候选或图片。';
        const hmr = isHmrPose(result);
        const hmrLabel = result.source === 'hmr2-web' ? 'HMR2.0b · 网页 WebGPU · BODY25' : 'HMR2.0b · GPU API FP32 · BODY25';
        const label = hmr ? hmrLabel : result.source === 'rtmpose-m' ? 'RTMPose-m · 单人全图' : 'MediaPipe Pose · 候选' + (index + 1);
        status(`识别完成：${label} · ${count}/${reference.points.length}个${hmr ? '几何可用' : '可信'}关键点 · 身体${quality.visible}/12 · ${inferenceMs.toFixed(0)}ms。`
            + (low ? `${hmr ? '不可用' : '低可信'}：${low}（可能遮挡、出画或退化）。` : '')
            + (hmr ? 'HMR不提供逐点置信度，几何可用不代表识别正确。' : '可信度不代表坐标准确。') + advice);
    }
    function cancel() {
        overlay.cancel();
        const pending = busy || reading || importing || depth?.busy();
        // 即使没有运行ONNX，也使尚未返回的剪贴板读取/图片解码失效；空闲时保留已加载Worker。
        serial++; readSerial++;
        if (busy) { client.cancel(); hmrClient.cancel(); }
        // HMR大模型在关闭/切图/切模式时即使空闲也释放，避免长期占用显存。
        hmrWebClient.cancel();
        depth?.cancel();
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
        const reference = getPoseReference(result), points = reference.points;
        const valid = index => points[index]?.usable === true;
        const at = index => [points[index].x * preview.width, points[index].y * preview.height];
        context.strokeStyle = '#35efbd'; context.fillStyle = '#ffcf52'; context.lineWidth = 2;
        for (const [a, b] of reference.edges) if (valid(a) && valid(b)) { context.beginPath(); context.moveTo(...at(a)); context.lineTo(...at(b)); context.stroke(); }
        points.forEach((_, index) => { if (valid(index)) { context.beginPath(); context.arc(...at(index), 2.5, 0, Math.PI * 2); context.fill(); } });
        context.strokeStyle = '#ef5252';
        for (const key of getPoseQuality(result).lowConfidence) {
            const index = points.findIndex(point => point.key === key); if (index < 0) continue;
            const [x, y] = at(index);
            if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= preview.width && y >= 0 && y <= preview.height) {
                context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.stroke();
            }
        }
        overlay.setReference(image, result);
    }
    async function importImage(file, fromPaste = false) {
        if (!file || disposed) return;
        cancel(); const id = ++serial; clearResult(); depth.reset(); importing = true; buttons(); draw();
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
            ['x1', 'y1', 'x2', 'y2'].forEach((key, index) => { field('bbox-' + key).value = String([0, 0, image.width, image.height][index]); });
            field('image-size').textContent = `当前处理图片：${image.width}×${image.height}；人物框以此像素尺寸为准。不指定框是整图单人假设，不是人物检测。`;
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
    function invalidateReference() {
        cancel(); clearResult(); draw(); buttons(); status('计算方式、API 或人物框已变化，请重新识别图片。');
    }
    field('source').addEventListener('change', () => {
        invalidateReference(); depth.reset(); depth.setMode(field('source').value);
        const hmr = field('source').value === 'hmr2-api'; field('api-controls').hidden = !hmr;
        field('bbox-controls').hidden = !isHmrPose({ source: field('source').value });
        const privacy = {
            'hmr2-api': 'HMR2 将当前处理图片上传到填写的 API 地址，由 CUDA FP32 计算 BODY25。深度仍在浏览器本地计算。请确认服务和图片隐私；算法不会自动修复左右腿或脚掌。',
            'hmr2-web': 'HMR2在当前浏览器WebGPU计算，图片不会上传。首次识别加载约2.7GB模型并校验，适合桌面设备；初始化与计算可能需要等待。HMR仍可能误判左右腿或脚掌。',
            'mediapipe-pose': 'MediaPipe Pose 在本机识别全身图片（33点，首次加载约16.7MiB模型）。图片不会上传；三维坐标是估计，可在3D场景微调。'
        };
        field('privacy').textContent = privacy[field('source').value] || '请选择可用的骨骼计算方式';
        buttons();
    });
    for (const name of ['api-url', 'api-token', 'bbox-x1', 'bbox-y1', 'bbox-x2', 'bbox-y2']) field(name).addEventListener('input', invalidateReference);
    field('bbox-enabled').addEventListener('change', invalidateReference);
    field('test-api').addEventListener('click', async () => {
        if (busy || disposed || field('source').value !== 'hmr2-api') return;
        const id = ++serial; busy = true; buttons(); status('正在测试 HMR2 连接（不上传图片）…');
        try {
            const health = await hmrClient.testConnection(apiConfig());
            if (id !== serial || disposed) return;
            status(`HMR2 服务连接成功 · ${health.device} · ${health.precision} · ${health.ready ? '模型已就绪' : '模型未就绪'}${health.busy ? '；GPU忙，请稍后识别' : ''}。`);
        } catch (error) { if (id === serial && error.name !== 'AbortError') status('HMR2 连接失败：' + error.message); }
        finally { if (id === serial) { busy = false; buttons(); } }
    });
    const onToggle = () => { if (!root.open) cancel(); else buttons(); };
    document.addEventListener('paste', onPaste);
    root.addEventListener('toggle', onToggle);
    field('paste').addEventListener('click', readClipboardImage);
    field('file').addEventListener('change', () => {
        void importImage(field('file').files?.[0]);
    });
    field('recognize').addEventListener('click', async () => {
        if (!image || busy || reading || importing || disposed) return;
        if (!engines[field('source').value] || (field('source').value === 'hmr2-web' && !webAvailable)) { status('当前计算方式不可用，请先准备网页模型'); return; }
        const id = ++serial;
        try {
            token = human().getState().token; clearResult(); busy = true; buttons(); draw();
            status(field('source').value === 'hmr2-api' ? '准备上传图片到填写的 HMR2 服务…' : '准备浏览器本地推理…');
            const depthTask = depth.withRecognition() ? depth.compute({ automatic: true }) : null;
            const inferred = await engines[field('source').value](image, message => { if (id === serial) status(message); });
            if (depthTask) await depthTask;
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
        if (!getPoseQuality(result).torsoReady || busy || reading || importing || depth.busy() || !depth.readyToApply() || disposed) return;
        const id = ++serial, pose = result, expectedToken = token;
        try {
            const fitOptions = depth.getOptions(pose);
            busy = true; buttons(); await ensurePhysics({ isCurrent: () => id === serial && !disposed });
            if (id !== serial || disposed) return;
            status('正在按实际骨骼和关节范围拟合姿态…');
            const state = await human().applyInteractiveImagePose(pose, expectedToken, { ...fitOptions, isCurrent: () => id === serial && !disposed });
            if (id !== serial || disposed) return;
            const fit = state.imagePoseFit;
            const detail = fit && Number.isFinite(fit.error) ? `FK二维误差 ${(fit.error * 100).toFixed(2)}%（图片高度）；${fit.depthSource}。` : '';
            const depthDetail = fitOptions.depthRequested ? `深度线索：采用${fit?.depthAccepted || 0}条，拒绝${(fitOptions.depthSampleRejected?.length || 0) + (fit?.depthRejected?.length || 0)}条${fit?.depthFallback ? '，退化时已回退主解' : ''}${!fitOptions.depthEnabled ? '，无可用线索，保留原来源主路径' : ''}；表面归属未验证。` : '';
            status(`已应用${state.activeTargets}个控制点，${detail}${depthDetail}等待物理稳定并检查实际骨架，可继续在3D场景拖动微调；重置控制点可恢复原动作。`);
        } catch (error) { if (id === serial) status(error.message); }
        finally { if (id === serial) { busy = false; buttons(); } }
    });
    field('cancel').addEventListener('click', cancel);
    field('candidate').addEventListener('change', () => { if (!busy && !reading && !importing && !disposed) showCandidate(Number(field('candidate').value)); });
    async function refreshWeb() {
        probeController?.abort(); const controller = new AbortController(); probeController = controller;
        webAvailable = false; root.querySelector('option[value="hmr2-web"]').disabled = true;
        field('web-status').textContent = '正在检查可选HMR网页模型…'; buttons();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const state = await hmrWebClient.probe({ signal: controller.signal });
            if (disposed || probeController !== controller) return;
            webAvailable = state.available === true; root.querySelector('option[value="hmr2-web"]').disabled = !webAvailable;
            field('web-status').textContent = webAvailable ? 'HMR网页模型已准备，点击识别时按需加载。' : state.reason;
        } catch (error) {
            if (!disposed && probeController === controller) field('web-status').textContent = 'HMR网页模型检查失败或超时，请重新检查';
        } finally { clearTimeout(timer); if (!disposed) buttons(); }
    }
    field('web-refresh').addEventListener('click', () => { if (!busy && !disposed) void refreshWeb(); });
    void refreshWeb();
    buttons();
    return {
        cancel,
        sync(isReady) {
            ready = isReady;
            const currentToken = ready ? human().getState().token : null;
            if ((observedToken && observedToken !== currentToken) || (token && token !== currentToken)) {
                cancel(); depth.reset(); token = null; clearResult(); status('模型已切换，请重新识别图片'); draw();
            }
            observedToken = currentToken;
            buttons();
            overlay.sync(ready);
        },
        dispose() {
            disposed = true; serial++; readSerial++;
            overlay.dispose();
            document.removeEventListener('paste', onPaste); root.removeEventListener('toggle', onToggle);
            probeController?.abort(); client.dispose(); hmrClient.dispose(); hmrWebClient.dispose(); depth.dispose(); field('api-token').value = '';
            clearResult(); image = null; preview.width = preview.height = 0;
        }
    };
}

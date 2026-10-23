(function (root) {
    'use strict';
    const limits = { text: 1024 * 1024, image: 20 * 1024 * 1024, video: 100 * 1024 * 1024 };
    const text = /\.(txt|md|log|csv|json)$/i;
    const kindOf = file => text.test(file.name) ? 'text' : file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name) ? 'video' : null;
    function create({ host, getPolicy = () => ({}), getScope = () => '', onError = () => {}, fetchImpl = root.fetch.bind(root) }) {
        if (!document.getElementById('chatAttachmentStyles')) {
            const style = document.createElement('link'); style.id = 'chatAttachmentStyles'; style.rel = 'stylesheet'; style.href = '/css/chat-attachments.css'; document.head.append(style);
        }
        let items = []; let uploading = 0; let epoch = 0; let draftScope = getScope(); const controllers = new Set();
        const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
        input.accept = '.txt,.md,.log,.csv,.json,image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime'; input.hidden = true;
        host.append(input); const previews = document.createElement('div'); previews.className = 'chat-attachments'; host.append(previews);
        function paint() {
            previews.replaceChildren();
            for (const item of items) {
                const row = document.createElement('div'); row.className = 'chat-attachment';
                if (item.kind === 'image') { const image = document.createElement('img'); image.src = item.url; image.alt = item.name; row.append(image); }
                const label = document.createElement('span'); label.textContent = `${item.kind === 'video' ? '🎞️' : item.kind === 'text' ? '📄' : '🖼️'} ${item.name} (${(item.size / 1024).toFixed(0)}KB)`;
                const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = '移除附件';
                remove.addEventListener('click', () => { items = items.filter(value => value.id !== item.id); void release(item); paint(); });
                row.append(label, remove); previews.append(row);
            }
            if (uploading) { const label = document.createElement('span'); label.textContent = `正在上传 ${uploading} 个附件…`; previews.append(label); }
        }
        async function release(item) { try { await fetchImpl(`/api/chat/attachments/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); } catch { /* 断网后由服务端草稿租约过期回收。 */ } }
        async function add(file) {
            ensureScope();
            const kind = kindOf(file); const policy = getPolicy();
            if (policy.disabled) throw new Error('当前Agent入口尚不支持附件，请切换普通LLM聊天');
            if (!kind) throw new Error('不支持此附件格式');
            if (kind === 'image' && policy.images === false) throw new Error('当前LLM配置不支持上传图片');
            if (kind === 'video' && policy.videos !== true) throw new Error('请先在LLM配置中开启“支持上传视频”');
            if (!file.size || file.size > limits[kind]) throw new Error(`附件为空或超过${limits[kind] / 1024 / 1024}MiB限制`);
            if (items.length + uploading >= 4) throw new Error('每条消息最多4个附件');
            const revision = epoch; const scope = getScope(); const controller = new AbortController(); controllers.add(controller); uploading++; paint();
            try {
                const form = new FormData(); form.append('file', file);
                const response = await fetchImpl('/api/chat/attachments', { method: 'POST', body: form, signal: controller.signal });
                const result = await response.json();
                if (!response.ok || !result.attachment) throw new Error(result.error || '附件上传失败');
                if (revision !== epoch || scope !== getScope()) { void release(result.attachment); return; }
                items.push(result.attachment);
            } finally { controllers.delete(controller); if (revision === epoch) uploading--; paint(); }
        }
        input.addEventListener('change', async () => {
            const files = [...input.files]; const scope = getScope(); input.value = '';
            for (const file of files) { if (scope !== getScope()) break; try { await add(file); } catch (error) { if (error.name !== 'AbortError') onError(error.message); } }
        });
        const reset = () => { epoch++; for (const controller of controllers) controller.abort(); controllers.clear(); uploading = 0; const old = items; items = []; draftScope = getScope(); for (const item of old) void release(item); paint(); };
        function ensureScope() { if (draftScope !== getScope()) reset(); }
        return { choose: () => { ensureScope(); input.click(); }, add, ids: () => { ensureScope(); return items.map(item => item.id); }, items: () => { ensureScope(); return [...items]; }, busy: () => { ensureScope(); return uploading > 0; },
            sent() { items = []; paint(); },
            reset
        };
    }
    root.ChatAttachments = { create, kindOf };
})(window);

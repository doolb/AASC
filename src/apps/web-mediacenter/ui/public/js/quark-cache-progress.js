/* 逐行读取缓存事件；旧版服务端的单个 JSON 响应也可正常解析。 */
(function (root) {
    async function prepare(url, onProgress = () => {}) {
        const target = new URL(url, root.location.href);
        target.searchParams.set('prepare', '1');
        target.searchParams.set('progress', '1');
        const response = await fetch(target.href, { cache: 'no-store' });
        if (!response.ok) {
            let error = {};
            try { error = await response.json(); } catch {}
            throw new Error(error.message || `缓存请求失败 (${response.status})`);
        }
        let finalResult = null;
        const consume = line => {
            if (!line.trim()) return;
            const message = JSON.parse(line);
            if (message.type === 'progress') onProgress(message);
            else if (message.status) finalResult = message;
        };
        if (response.body?.getReader) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { value, done } = await reader.read();
                buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
                let newline;
                while ((newline = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
                if (done) break;
            }
            consume(buffer);
        } else {
            consume(await response.text());
        }
        if (!finalResult || finalResult.status !== 'success') throw new Error(finalResult?.message || '视频缓存失败');
        return finalResult;
    }
    root.QuarkCacheProgress = { prepare };
})(window);

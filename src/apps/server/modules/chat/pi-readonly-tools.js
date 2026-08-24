'use strict';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_REDIRECTS = 3;

function validateReadOnlyUrl(value) {
    let url;
    try {
        url = new URL(String(value));
    } catch (error) {
        throw new Error(`URL 不合法: ${error.message}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('URL 只允许 HTTP/HTTPS');
    }
    if (url.username || url.password) {
        throw new Error('URL 不允许携带认证信息');
    }
    return url;
}

async function readOnlyFetch(value, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET') {
        throw new Error('网络工具只允许 GET');
    }

    const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    let currentUrl = validateReadOnlyUrl(value);

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(currentUrl, {
                method: 'GET',
                redirect: 'manual',
                signal: controller.signal,
                headers: {
                    Accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.1'
                }
            });
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (!location || redirectCount >= maxRedirects) {
                    throw new Error('网络重定向次数超限');
                }
                currentUrl = validateReadOnlyUrl(new URL(location, currentUrl).toString());
                continue;
            }

            const declaredLength = Number(response.headers.get('content-length'));
            if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
                throw new Error('网络响应超过大小限制');
            }
            const text = await readResponseText(response, maxBytes);
            return {
                status: response.status,
                contentType: response.headers.get('content-type') || '',
                text
            };
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('网络请求超时');
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    throw new Error('网络重定向次数超限');
}

async function readResponseText(response, maxBytes) {
    if (!response.body) {
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > maxBytes) {
            throw new Error('网络响应超过大小限制');
        }
        return text;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw new Error('网络响应超过大小限制');
            }
            chunks.push(Buffer.from(value));
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
}

function parseSearchResults(html, limit = 5) {
    const source = String(html || '');
    const results = [];
    const linkPattern = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
    for (const match of source.matchAll(linkPattern)) {
        if (results.length >= limit) break;
        const start = match.index + match[0].length;
        const tail = source.slice(start, start + 1200);
        const snippetMatch = tail.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\//iu);
        results.push({
            title: stripHtml(match[2]),
            url: decodeHtmlEntities(match[1]),
            snippet: snippetMatch ? stripHtml(snippetMatch[1]) : ''
        });
    }
    return results;
}

function stripHtml(value) {
    return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/gu, '')).replace(/\s+/gu, ' ').trim();
}

function decodeHtmlEntities(value) {
    return String(value || '')
        .replace(/&amp;/gu, '&')
        .replace(/&quot;/gu, '"')
        .replace(/&#39;|&apos;/gu, "'")
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>');
}

module.exports = {
    validateReadOnlyUrl,
    readOnlyFetch,
    parseSearchResults
};

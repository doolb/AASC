'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { videoError } = require('./chat2api-video-jobs');
const { normalizeOutputVideos } = require('../../../../core/utils/chat-output-videos');
const PAGE = 'https://create.qianwen.com/r/ai-studio-pc/main/gen?tab=video';
const API = 'https://ai-studio-create.qianwen.com';
const AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

/** 官网MD5认证只绑定当次页面下发的资料和请求标识；业务正文不复用旧任务参数。 */
function studioAuth({ nonceId, signKey }, { browserId = randomUUID().replaceAll('-', ''), chid = randomUUID().replaceAll('-', ''), timestamp = Date.now() } = {}) {
    if (![nonceId, signKey].every(value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/u.test(value))) {
        throw videoError('qwen_video_auth', '千问创作页面未下发有效认证资料', 401);
    }
    const token = createHash('md5').update(`${browserId}_${nonceId}_${signKey}_${timestamp}_${chid}`).digest('hex');
    return { chid, product: 'ai_studio', token, browserId, timestamp, nonceId, signKey, platform: 'pc' };
}

function studioCookie(account) {
    const credentials = account.credentials || {};
    const raw = credentials.cookie || credentials.cookies || '';
    let cookie = typeof raw === 'string' ? raw : Object.entries(raw).map(([key, value]) => `${key}=${value}`).join('; ');
    const ticket = credentials.ticket || credentials.tongyi_sso_ticket;
    if (!/(?:^|;\s*)tongyi_sso_ticket=/.test(cookie) && ticket) cookie = [cookie, `tongyi_sso_ticket=${ticket}`].filter(Boolean).join('; ');
    if (!cookie || cookie.length > 32768 || /[\x00-\x1f\x7f]/u.test(cookie)) throw videoError('qwen_video_auth', '千问创作缺少有效登录票据', 401);
    return cookie;
}

function studioResponse(response) {
    if ([401, 403].includes(response.status)) throw videoError('qwen_video_auth', '千问创作认证失败，请在官网处理后重试', response.status);
    if (response.status === 429) throw videoError('qwen_video_rate_limit', '千问视频请求频率超限，请稍后重试', 429);
    if (response.status < 200 || response.status >= 300) throw videoError('qwen_video_http', `千问创作上游 HTTP ${response.status}`, 502);
    const result = response.data;
    if ([15004, 15005].includes(result?.code)) throw videoError('video_quota_insufficient', '千问创作积分不足，请在官网处理后重试', 402);
    if (result?.code === 15003) throw videoError('qwen_video_membership', '当前千问视频模型需要会员权限', 403);
    if ([-2, 1002, 1013, 1014].includes(result?.code)) throw videoError('qwen_video_auth', '千问创作认证已失效，请重新登录后重试', 401);
    if ([429, 1003, 10030].includes(result?.code)) throw videoError('qwen_video_rate_limit', '千问视频请求频率超限，请稍后重试', 429);
    if (result?.code === 1018) throw videoError('qwen_video_rejected', '千问视频内容未通过平台审核', 403);
    if (result?.code !== 0 || !result.data || typeof result.data !== 'object') throw videoError('qwen_video_protocol', '千问创作未返回有效任务数据', 502);
    return result.data;
}

/** 新创作页作品字段与旧聊天卡片不同；只在完成态提取实际视频，封面不充当作品。 */
function studioVideos(result) {
    if (['fail', 'failed', 'error', 'cancelled'].includes(result.status)) return { error: '千问视频生成失败或已被官网取消' };
    if (!['finish', 'finished', 'completed', 'success'].includes(result.status)) return { videos: [], done: false };
    const videos = normalizeOutputVideos((Array.isArray(result.resultVideos) ? result.resultVideos : []).filter(video => video && typeof video === 'object').map(video => ({
        url: video.downloadUrl || video.cdnUrl || video.url,
        posterUrl: video.coverCdnUrl, duration: video.duration, width: video.width, height: video.height
    })));
    if (!videos.length) return { error: '千问视频任务已结束但未返回作品' };
    return { videos, done: true };
}

/** 用保存的Qwen票据直接访问官网；创建不重试，认证字段不进入任务文件或错误文本。 */
function createQwenVideoStudio({ http }) {
    async function request(pathname, data, { account, signal }) {
        signal?.throwIfAborted();
        const headers = { Cookie: studioCookie(account), Origin: 'https://create.qianwen.com', Referer: PAGE, 'User-Agent': AGENT };
        try {
            const page = await http.request({ method: 'GET', url: PAGE, headers, signal, timeout: 30000, maxRedirects: 0,
                responseType: 'text', maxContentLength: 1024 * 1024, validateStatus: () => true });
            if (page.status !== 200 || typeof page.data !== 'string') throw videoError('qwen_video_auth', '千问创作认证页面不可用', 401);
            const match = page.data.match(/window\.__sm_req_token__\s*=\s*(\{[^<;]+?\})\s*[;<]/);
            let bootstrap;
            try { bootstrap = match ? JSON.parse(match[1]) : null; } catch { /* 网页异常不执行脚本，也不把HTML附到错误中。 */ }
            const auth = studioAuth(bootstrap || {});
            signal?.throwIfAborted();
            const response = await http.request({ method: 'POST', url: API + pathname,
                params: { biz_id: 'ai_image', pr: 'kkpcweb', fr: 'win', ai_ts: String(auth.timestamp), req_id: randomUUID() },
                headers: { ...headers, 'Content-Type': 'application/json', 'Cache-control': 'no-cache' },
                data: { ...data, ...auth }, signal, timeout: 60000, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024, validateStatus: () => true });
            return studioResponse(response);
        } catch (cause) {
            signal?.throwIfAborted();
            if (cause.code?.startsWith('qwen_video_') || cause.code === 'video_quota_insufficient') throw cause;
            // Axios错误可能包含Cookie和认证正文；只传递安全错误码及固定文本。
            throw videoError(cause.code || 'qwen_video_network', '千问创作请求失败，未自动重复创建视频', 502);
        }
    }
    return { request, query: async (upstream, options) => {
        const result = await request('/api/web/ai/video/record/query', { recordId: upstream.recordId, scene: upstream.scene }, options);
        if (result.recordId && String(result.recordId) !== String(upstream.recordId)) throw videoError('qwen_video_protocol', '千问返回了不匹配的视频任务', 502);
        return studioVideos(result);
    } };
}
module.exports = { createQwenVideoStudio, studioAuth, studioCookie, studioVideos };

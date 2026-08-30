'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const SEARCH_URL = 'https://cn.bing.com/search';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SEARCH_LIMITS = Object.freeze({
    fetchLimit: 10,
    displayLimit: 5,
    ttsLimit: 3
});
const BING_MONTHS = new Map([
    ['jan', 0], ['january', 0], ['feb', 1], ['february', 1],
    ['mar', 2], ['march', 2], ['apr', 3], ['april', 3],
    ['may', 4], ['jun', 5], ['june', 5], ['jul', 6], ['july', 6],
    ['aug', 7], ['august', 7], ['sep', 8], ['sept', 8], ['september', 8],
    ['oct', 9], ['october', 9], ['nov', 10], ['november', 10],
    ['dec', 11], ['december', 11]
]);
const BING_RELATIVE_UNITS = new Map([
    ['分钟', 60 * 1000], ['minute', 60 * 1000], ['minutes', 60 * 1000],
    ['小时', 60 * 60 * 1000], ['hour', 60 * 60 * 1000], ['hours', 60 * 60 * 1000],
    ['天', DAY_MS], ['day', DAY_MS], ['days', DAY_MS],
    ['周', 7 * DAY_MS], ['week', 7 * DAY_MS], ['weeks', 7 * DAY_MS],
    ['个月', 30 * DAY_MS], ['month', 30 * DAY_MS], ['months', 30 * DAY_MS],
    ['年', 365 * DAY_MS], ['year', 365 * DAY_MS], ['years', 365 * DAY_MS]
]);

function normalizeSearchLimit(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
}

function resolveSearchLimits(params = {}, globalConfig = {}) {
    const fetchLimit = normalizeSearchLimit(
        globalConfig.fetchLimit ?? params.fetchLimit,
        DEFAULT_SEARCH_LIMITS.fetchLimit,
        1,
        50
    );
    const displayLimit = normalizeSearchLimit(
        globalConfig.displayLimit ?? params.displayLimit,
        DEFAULT_SEARCH_LIMITS.displayLimit,
        1,
        fetchLimit
    );
    const ttsLimit = normalizeSearchLimit(
        globalConfig.ttsLimit ?? params.ttsLimit,
        DEFAULT_SEARCH_LIMITS.ttsLimit,
        0,
        displayLimit
    );
    return { fetchLimit, displayLimit, ttsLimit };
}

function parseBingResultDate(text, now = Date.now()) {
    const value = String(text || '').trim();
    if (!value || !Number.isFinite(now)) return null;

    const chineseDate = value.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/u);
    if (chineseDate) {
        return Date.UTC(
            Number(chineseDate[1]),
            Number(chineseDate[2]) - 1,
            Number(chineseDate[3])
        );
    }

    const numericDate = value.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/u);
    if (numericDate) {
        return Date.UTC(
            Number(numericDate[1]),
            Number(numericDate[2]) - 1,
            Number(numericDate[3])
        );
    }

    const englishDate = value.match(
        /\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(\d{4})\b/u
    );
    if (englishDate) {
        const month = BING_MONTHS.get(englishDate[1].toLowerCase());
        if (month !== undefined) {
            return Date.UTC(Number(englishDate[3]), month, Number(englishDate[2]));
        }
    }

    if (/刚刚|今天|just now|today/iu.test(value)) return now;
    if (/昨天|yesterday/iu.test(value)) return now - DAY_MS;

    const relativeDate = value.match(
        /(\d+(?:\.\d+)?)\s*(分钟|小时|天|周|个月|年|minutes?|hours?|days?|weeks?|months?|years?)\s*(?:前|ago)/iu
    );
    if (!relativeDate) return null;

    const unit = BING_RELATIVE_UNITS.get(relativeDate[2].toLowerCase());
    return unit ? now - Number(relativeDate[1]) * unit : null;
}

function selectLatestSearchResult(results, now = Date.now()) {
    return sortSearchResults(results, now)[0] || null;
}

function sortSearchResults(results, now = Date.now()) {
    const candidates = (Array.isArray(results) ? results : [])
        .map((result, index) => ({
            result,
            index,
            publishedAt: parseBingResultDate(
                `${result?.title || ''} ${result?.snippet || ''}`,
                now
            )
        }));

    candidates.sort((left, right) => {
        if (left.publishedAt === null && right.publishedAt === null) {
            return left.index - right.index;
        }
        if (left.publishedAt === null) return 1;
        if (right.publishedAt === null) return -1;
        return right.publishedAt - left.publishedAt || left.index - right.index;
    });

    return candidates.map(({ result }) => result);
}

async function requestBingHtml(query) {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('form', 'QBLH');
    url.searchParams.set('sp', '-1');
    url.searchParams.set('lq', '0');
    url.searchParams.set('qs', 'n');
    url.searchParams.set('sk', '');
    url.searchParams.set('sc', '8-1');

    const response = await axios.get(url.toString(), {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://cn.bing.com/'
        },
        timeout: 15000
    });
    return response.data;
}

function toFirstResult(result) {
    return {
        type: 'first_result',
        title: result.title || '未获取到标题',
        link: result.link || '',
        snippet: result.snippet || '未获取到摘要'
    };
}

module.exports = {
    id: 'search.web',
    name: '网页搜索',
    description: '使用 Bing 搜索并返回时间最新的网页结果（单次任务）',
    target: 'server',
    mode: 'one-shot',
    params: [
        { name: 'query', type: 'string', required: true, default: '', label: '搜索关键词', globalOnly: false },
        { name: 'fetchLimit', type: 'number', required: false, default: 10, min: 1, max: 50, label: '搜索结果数', globalOnly: true },
        { name: 'displayLimit', type: 'number', required: false, default: 5, min: 1, max: 50, label: '展示结果数', globalOnly: true },
        { name: 'ttsLimit', type: 'number', required: false, default: 3, min: 0, max: 50, label: 'TTS 播报数', globalOnly: true }
    ],

    async run(context = {}) {
        const params = context.params || {};
        const globalConfig = context.taskIO && context.taskName
            ? await context.taskIO.getTaskConfig(context.taskName).catch(() => ({}))
            : {};
        const limits = resolveSearchLimits(params, globalConfig);
        const query = String(params.query || '').trim();
        if (!query) {
            return { success: true, data: { result: [], ttsLimit: limits.ttsLimit } };
        }

        const fetchHtml = context.fetchHtml || requestBingHtml;
        const html = await fetchHtml(query);
        const $ = cheerio.load(html);
        const candidates = $('#b_results > li.b_algo')
            .toArray()
            .slice(0, limits.fetchLimit)
            .map((node) => ({
                title: $(node).find('h2 a').first().text().trim(),
                link: $(node).find('h2 a').first().attr('href') || '',
                snippet: $(node).find('.b_caption p').first().text().trim()
            }))
            .filter((result) => result.title);
        const sortedResults = sortSearchResults(candidates, context.now || Date.now())
            .slice(0, limits.displayLimit)
            .map(toFirstResult);
        if (sortedResults.length > 0) {
            return { success: true, data: { result: sortedResults, ttsLimit: limits.ttsLimit } };
        }

        const poleContent = $('#b_pole').text().trim();
        if (poleContent) {
            return {
                success: true,
                data: { result: [{ type: 'ai_answer', content: poleContent.substring(0, 500) }], ttsLimit: limits.ttsLimit }
            };
        }
        return { success: true, data: { result: [], ttsLimit: limits.ttsLimit } };
    }
};

module.exports.parseBingResultDate = parseBingResultDate;
module.exports.sortSearchResults = sortSearchResults;
module.exports.selectLatestSearchResult = selectLatestSearchResult;

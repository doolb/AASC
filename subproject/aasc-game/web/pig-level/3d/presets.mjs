// 季节 × 天气环境预设（纯数据，不依赖 three.js，可在 Node 中直接测试）。
// 所有颜色使用 sRGB 十六进制字符串，由环境模块转换为线性空间后插值。

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const WEATHERS = ['sunny', 'cloudy', 'rain'];

export const SEASON_LABELS = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
export const WEATHER_LABELS = { sunny: '晴', cloudy: '阴', rain: '雨' };

// 季节基础参数：参考 Painted Valley 的柔和奶油水粉色彩（高明度低荧光感，草叶根部与草坪自然融合）。
export const SEASON_BASE = {
    spring: {
        grassRoot: '#74bf54', grassTip: '#b4e36e', lawn: '#96d462', ground: '#78c252',
        foliage: ['#f9bac9', '#f5a8bc', '#f8c6d4', '#fbe2e8'], treeType: 'blossom',
        flowers: ['#fffbe8', '#ffe347', '#ffd6e6', '#ffffff', '#ffb8d0'], flowerDensity: 1,
        ambientLife: 'butterfly', seasonParticle: 'petal', props: ['flowerbed'],
        sunElevation: 36, hillColor: '#88c96b', mountainTint: '#a6c4b2'
    },
    summer: {
        grassRoot: '#3ea824', grassTip: '#8ee632', lawn: '#62cb34', ground: '#48ac26',
        foliage: ['#4ea836', '#64c244', '#40942e', '#76d452'], treeType: 'broadleaf',
        flowers: ['#ffe33d', '#fffbe8', '#ff9a3d', '#ffffff', '#ffe066'], flowerDensity: 0.95,
        ambientLife: 'firefly', seasonParticle: 'pollen', props: ['sunflower'],
        sunElevation: 38, hillColor: '#52b832', mountainTint: '#7eb4e0'
    },
    autumn: {
        grassRoot: '#c8a85a', grassTip: '#f0cf72', lawn: '#dfc274', ground: '#c6a65c',
        foliage: ['#f08834', '#e35c32', '#f7c242', '#d96e32'], treeType: 'maple',
        flowers: ['#ffe047', '#ff8c42', '#fffbe8', '#d45c3c'], flowerDensity: 0.55,
        ambientLife: 'none', seasonParticle: 'leaf', props: ['haystack', 'pumpkin'],
        sunElevation: 32, hillColor: '#cca862', mountainTint: '#b4a8d8'
    },
    winter: {
        grassRoot: '#9cb5aa', grassTip: '#f6fafc', lawn: '#5e9690', ground: '#dce7f5',
        foliage: ['#3c6c78', '#467d88', '#335d68', '#4f8892'], treeType: 'pine',
        flowers: ['#ffffff', '#dcecff'], flowerDensity: 0.14,
        ambientLife: 'none', seasonParticle: 'sparkle', props: ['snowman'],
        sunElevation: 28, hillColor: '#e4ecf6', mountainTint: '#b4bad8'
    }
};

// 天气修正参数：Painted Valley 清澈天蓝、纯白积云、高亮度高对比晴天主光与柔和暗部。
export const WEATHER_BASE = {
    sunny: {
        skyZenith: '#4b9fe3', skyHorizon: '#b5dff7', cloudTop: '#ffffff', cloudBottom: '#b4c8e6',
        cloudCover: 0.34, sunIntensity: 2.55, hemiIntensity: 0.58, fogDensity: 0.0052,
        wind: 0.55, precip: 'none', precipCount: 0, wetness: 0, snowCover: 0, lightning: false, shadowSoft: 0.25
    },
    cloudy: {
        skyZenith: '#8eaac7', skyHorizon: '#e4ecf4', cloudTop: '#ffffff', cloudBottom: '#b2c2d6',
        cloudCover: 0.85, sunIntensity: 1.4, hemiIntensity: 1.06, fogDensity: 0.011,
        wind: 1.0, precip: 'none', precipCount: 0, wetness: 0.1, snowCover: 0, lightning: false, shadowSoft: 0.7
    },
    rain: {
        skyZenith: '#6d88a8', skyHorizon: '#bdccdc', cloudTop: '#dde6f0', cloudBottom: '#889ab0',
        cloudCover: 1, sunIntensity: 1.08, hemiIntensity: 1.02, fogDensity: 0.016,
        wind: 1.45, precip: 'rain', precipCount: 3200, wetness: 1, snowCover: 0, lightning: true, shadowSoft: 0.9
    }
};

// 冬季降水天气专属修正（冬雨自动呈现为飘雪，柔粉紫暮蓝童话雪夜天空）
const WINTER_SNOW_WEATHER = {
    skyZenith: '#8c8ec4', skyHorizon: '#cdb9dc', cloudTop: '#f8f5fc', cloudBottom: '#b4aed4',
    cloudCover: 0.72, sunIntensity: 1.48, hemiIntensity: 1.06, fogDensity: 0.013,
    wind: 0.45, precip: 'snow', precipCount: 3000, wetness: 0, snowCover: 0.75, lightning: false, shadowSoft: 0.75
};

// 季节对天气天空的微调（春柔晨雾、冬粉紫雪暮、秋暖），按天气基础色做混合。
const SEASON_SKY_SHIFT = {
    spring: { horizon: '#f2f0de', amount: 0.28 },
    summer: { horizon: '#d6efff', amount: 0.1 },
    autumn: { horizon: '#f2dcc0', amount: 0.32 },
    winter: { horizon: '#c9bddc', amount: 0.42 }
};

// 原游戏蓝底铁笼关卡：叠加月夜蓝紫色调与紫色云团，保持明亮月光照明。
export const CAGE_DUSK = {
    skyZenith: '#4c5eb5', skyHorizon: '#b9a3df', cloudTop: '#cfc0f4', cloudBottom: '#7868bd',
    sunColor: '#ffe0ba', mountainTint: '#847cc4', amount: 0.72
};

// 天气随机权重：冬偏阴雪、夏偏晴/雨、秋偏阴、春均衡。
export const WEATHER_WEIGHTS = {
    spring: { sunny: 0.48, cloudy: 0.27, rain: 0.25 },
    summer: { sunny: 0.58, cloudy: 0.17, rain: 0.25 },
    autumn: { sunny: 0.34, cloudy: 0.42, rain: 0.24 },
    winter: { sunny: 0.30, cloudy: 0.30, rain: 0.40 }
};

// 关卡号映射季节：2～30 春、31～60 夏、61～90 秋、91+ 冬。
export function seasonForLevel(id) {
    const n = Number(id) || 0;
    if (n <= 30) return 'spring';
    if (n <= 60) return 'summer';
    if (n <= 90) return 'autumn';
    return 'winter';
}

// 以关卡号为种子的稳定伪随机（mulberry32）。
export function seededRandom(seed) {
    let a = (Number(seed) * 2654435761) >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 同一关卡号总是得到同一种天气，便于复现与测试。
export function randomWeather(season, levelId) {
    const weights = WEATHER_WEIGHTS[season] || WEATHER_WEIGHTS.spring;
    const roll = seededRandom(Number(levelId) * 7 + 13)();
    let acc = 0;
    for (const weather of WEATHERS) {
        acc += weights[weather];
        if (roll < acc) return weather;
    }
    return 'sunny';
}

// 十六进制颜色线性混合（sRGB 空间，仅用于预设合成）。
export function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = shift => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
    return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

// 合成最终环境参数：季节基础 + 天气修正 + 季节天空微调 + 可选铁笼黄昏。
export function buildPreset(season, weather, options = {}) {
    const s = SEASON_BASE[season] || SEASON_BASE.spring;
    const isWinterSnow = season === 'winter' && weather === 'rain';
    const w = isWinterSnow ? WINTER_SNOW_WEATHER : (WEATHER_BASE[weather] || WEATHER_BASE.sunny);
    const shift = SEASON_SKY_SHIFT[season] || SEASON_SKY_SHIFT.spring;
    // 冬季天然积雪，冬+雨触发飘雪加厚积雪。
    const snowCover = season === 'winter' ? Math.max(0.78, w.snowCover + 0.4) : w.snowCover;
    const wet = w.wetness;
    const preset = {
        season, weather,
        grassRoot: wet ? mixHex(s.grassRoot, '#468838', 0.15 * wet) : s.grassRoot,
        grassTip: snowCover > 0.5 ? s.grassTip : mixHex(s.grassTip, '#f4f8fb', snowCover * 0.8),
        lawn: mixHex(s.lawn, '#eef4f7', snowCover * 0.18),
        ground: mixHex(s.ground, '#eef5fc', snowCover * 0.92),
        foliage: s.foliage, treeType: s.treeType, flowers: s.flowers,
        flowerDensity: s.flowerDensity * (1 - snowCover * 0.7),
        hillColor: mixHex(s.hillColor, '#eef4f7', snowCover * 0.8),
        mountainTint: s.mountainTint,
        skyZenith: w.skyZenith,
        skyHorizon: mixHex(w.skyHorizon, shift.horizon, shift.amount),
        cloudTop: w.cloudTop, cloudBottom: w.cloudBottom, cloudCover: w.cloudCover,
        sunColor: season === 'autumn' ? '#ffe2b0' : season === 'winter' ? '#f2f6ff' : '#fff1d6',
        sunIntensity: w.sunIntensity, hemiIntensity: w.hemiIntensity,
        sunElevation: s.sunElevation, fogDensity: w.fogDensity,
        wind: w.wind, precip: w.precip, precipCount: w.precipCount,
        wetness: wet, snowCover, lightning: w.lightning, shadowSoft: w.shadowSoft,
        seasonParticle: weather === 'sunny' || weather === 'cloudy' ? s.seasonParticle : 'none',
        ambientLife: weather === 'sunny' ? s.ambientLife : (s.ambientLife === 'firefly' && weather === 'cloudy' ? 'firefly' : 'none'),
        props: s.props, dusk: 0
    };
    if (options.cage) {
        // 铁笼关卡固定叠加黄昏，呼应原作蓝紫背景。
        const k = CAGE_DUSK.amount;
        preset.skyZenith = mixHex(preset.skyZenith, CAGE_DUSK.skyZenith, k);
        preset.skyHorizon = mixHex(preset.skyHorizon, CAGE_DUSK.skyHorizon, k);
        preset.cloudTop = mixHex(preset.cloudTop, CAGE_DUSK.cloudTop, k);
        preset.cloudBottom = mixHex(preset.cloudBottom, CAGE_DUSK.cloudBottom, k);
        preset.sunColor = mixHex(preset.sunColor, CAGE_DUSK.sunColor, k);
        preset.mountainTint = mixHex(preset.mountainTint, CAGE_DUSK.mountainTint, k);
        preset.sunElevation = 14;
        preset.dusk = 1;
    }
    return preset;
}

// 预设中必须存在的字段，测试用。
export const PRESET_KEYS = ['grassRoot', 'grassTip', 'lawn', 'ground', 'foliage', 'treeType', 'flowers', 'flowerDensity', 'hillColor',
    'mountainTint', 'skyZenith', 'skyHorizon', 'cloudTop', 'cloudBottom', 'cloudCover', 'sunColor', 'sunIntensity', 'hemiIntensity',
    'sunElevation', 'fogDensity', 'wind', 'precip', 'precipCount', 'wetness', 'snowCover', 'lightning', 'shadowSoft', 'seasonParticle',
    'ambientLife', 'props', 'dusk'];

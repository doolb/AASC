// 无声文本预览按拼音估算节奏，时间线独立于VMD/MPL，不替换角色动作。
export const VOWELS = Object.freeze(['a', 'i', 'u', 'e', 'o']);
const zero = () => Object.fromEntries(VOWELS.map(key => [key, 0]));
const HAN = /^\p{Script=Han}+$/u;
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function validateText(value) {
    const text = String(value || '').trim();
    if (!text) throw new Error('请输入要播放口型的文字');
    if (Array.from(text).length > 400 || new TextEncoder().encode(text).length > 4096) {
        throw new Error('口型预览最多400字符、4KiB');
    }
    return text;
}

function vowelShape(vowel) {
    const shape = zero();
    if (vowel === 'v' || vowel === 'ü') { shape.u = 0.55; shape.i = 0.3; }
    else shape[vowel] = 0.8;
    return shape;
}

function syllableVowels(text) {
    let syllable = text.toLowerCase().replace(/\d/gu, '');
    // 普通话j/q/x及yu后的u通常表示ü；将其近似为圆唇与展唇组合。
    syllable = syllable.replace(/^([jqx])u/u, '$1v').replace(/^yu/u, 'v');
    syllable = syllable.replace(/iu$/u, 'iou').replace(/ui$/u, 'uei');
    return syllable.match(/[aiueovü]/gu) || ['a'];
}

export async function createTextTimeline(value) {
    const text = validateText(value);
    // 仅点击播放后加载本地字典，不访问TTS/LLM，也不创建音频或录音对象。
    const { pinyin } = await import('__LIPSYNC_PINYIN_URL__');
    const units = [];
    let unknown = 0, latin = 0;
    const syllables = word => pinyin(word, { type: 'array', toneType: 'none', nonZh: 'spaced' });
    for (const token of text.match(/\p{Script=Han}+|[a-zA-ZüÜ]+|\d+|\s+|[^\s]/gu) || []) {
        if (HAN.test(token)) {
            const chars = Array.from(token), sounds = syllables(token);
            for (let index = 0; index < chars.length; index++) {
                const sound = sounds[index] || '';
                if (!/^[a-zü]+$/iu.test(sound)) unknown++;
                units.push({ label: chars[index], sound: /^[a-zü]+$/iu.test(sound) ? sound : 'a', duration: 0.26 });
            }
            continue;
        }
        if (/^\d+$/u.test(token)) {
            for (const digit of token) units.push({ label: digit, sound: syllables(DIGITS[Number(digit)])[0], duration: 0.26 });
            continue;
        }
        if (/^[a-zü]+$/iu.test(token)) {
            latin++;
            const count = Math.min(6, syllableVowels(token).length);
            units.push({ label: token, sound: token, duration: Math.max(0.26, count * 0.16) });
            continue;
        }
        const duration = /[。！？.!?\n]/u.test(token) ? 0.4 : /[，、；：,;:]/u.test(token) ? 0.2 : 0.08;
        units.push({ label: token, sound: '', duration });
    }
    if (!units.some(unit => unit.sound)) throw new Error('没有可播放的文字，请输入中文、数字或拉丁字母');
    const frames = [{ time: 0, weights: zero() }];
    let time = 0;
    function frame(at, weights) {
        if (frames.at(-1).time === at) frames.at(-1).weights = weights;
        else frames.push({ time: at, weights });
    }
    for (const unit of units) {
        unit.start = time;
        const end = time + unit.duration;
        frame(time, zero());
        if (unit.sound) {
            const vowels = syllableVowels(unit.sound);
            const startRatio = /^[bpm]/iu.test(unit.sound) ? 0.25 : 0.08;
            frame(time + unit.duration * startRatio, zero());
            for (let index = 0; index < vowels.length; index++) {
                const ratio = startRatio + (0.76 - startRatio) * (index + 0.5) / vowels.length;
                frame(time + unit.duration * ratio, vowelShape(vowels[index]));
            }
        }
        frame(end, zero());
        time = end;
        unit.end = time;
    }
    frame(time + 0.12, zero());
    if (time > 150) throw new Error('口型预览不能超过150秒，请缩短文本');
    return { frames, units, duration: time + 0.12, unknown, latin };
}

export function sampleTimeline(timeline, time) {
    const frames = timeline.frames;
    let low = 0, high = frames.length - 1;
    while (low + 1 < high) {
        const middle = (low + high) >> 1;
        if (frames[middle].time <= time) low = middle;
        else high = middle;
    }
    const first = frames[low], next = frames[high];
    const ratio = Math.max(0, Math.min(1, (time - first.time) / (next.time - first.time || 1)));
    const alpha = ratio * ratio * (3 - 2 * ratio);
    return Object.fromEntries(VOWELS.map(key => [key, first.weights[key] + (next.weights[key] - first.weights[key]) * alpha]));
}

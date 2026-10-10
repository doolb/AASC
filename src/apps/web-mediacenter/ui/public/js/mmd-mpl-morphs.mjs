import { CharsetEncoder } from './vendor/three/libs/mmdparser.module.js';

const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const MORPH = new RegExp(`^morph\\s+("(?:[^"\\\\]|\\\\.)*")\\s+(${NUMBER})\\s*;$`, 'u');
const KEYFRAME = new RegExp(`^(${NUMBER})\\s*:\\s*(.+);$`, 'u');
const NAME = /^[^\s{};:&]+$/u;
const charset = new CharsetEncoder();
let encoding = null;

export function decodeVmdName(bytes) {
    const end = bytes.indexOf(0);
    return charset.s2u(end < 0 ? bytes : bytes.subarray(0, end));
}

export function encodeMorphName(name) {
    if (!name || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('表情名称为空或含控制字符');
    // Three现有表情轨道按普通对象分组，这些名称会与对象原型成员冲突。
    if (Object.hasOwn(Object.prototype, name)) throw new Error(`现有 VMD 播放器不支持保留名称 ${JSON.stringify(name)}`);
    if (!encoding) {
        encoding = new Map();
        // 与实际MMDParser读取VMD使用同一张表，避免浏览器另一种SJIS映射改变名称。
        for (const [key, value] of Object.entries(charset.s2uTable)) {
            const character = String.fromCharCode(value);
            if (!encoding.has(character)) encoding.set(character, Number(key));
        }
    }
    const result = [];
    for (const character of name) {
        const code = encoding.get(character);
        if (code === undefined) throw new Error(`表情 ${JSON.stringify(name)} 无法无损编码为 VMD Shift-JIS`);
        if (code > 255) result.push(code >> 8, code & 255);
        else result.push(code);
    }
    if (result.length > 15) throw new Error(`表情 ${JSON.stringify(name)} 超过 VMD 名称15字节限制`);
    const bytes = new Uint8Array(result);
    if (decodeVmdName(bytes) !== name) throw new Error(`表情 ${JSON.stringify(name)} 的 VMD 名称不能精确往返`);
    return bytes;
}

export function prepareMpl(source, morphs = []) {
    const lines = source.split(/\r?\n/u);
    const stripped = [...lines];
    const poses = new Map(), animations = new Map(), declared = new Set();
    const whitelist = new Map();
    for (const item of morphs) {
        if (typeof item?.name !== 'string') continue;
        const entries = whitelist.get(item.name) || [];
        entries.push(item);
        whitelist.set(item.name, entries);
    }
    let block = null, main = null;
    const fail = (line, message) => { throw new Error(`第${line}行：${message}`); };
    const validateReference = (name, line, collection, kind) => {
        if (!NAME.test(name) || !collection.has(name)) fail(line, `未知${kind} ${JSON.stringify(name)}；请先定义再引用`);
    };

    function parsePose(text, line) {
        if (!/^morph\b/u.test(text)) {
            if (!text.endsWith(';') || /[{}]/u.test(text)) fail(line, '骨骼语句须单独一行并以分号结束');
            return; // 骨骼语义仍由固定WASM编译器检查。
        }
        const match = text.match(MORPH);
        if (!match) fail(line, '表情格式应为 morph "PMX原始名称" 0.8;');
        let name;
        try { name = JSON.parse(match[1]); }
        catch { fail(line, '表情名称须使用有效的双引号字符串'); }
        const weight = Number(match[2]);
        if (!Number.isFinite(weight) || weight < 0 || weight > 1) fail(line, '表情权重必须在0–1之间');
        const entries = whitelist.get(name);
        if (!entries?.length) fail(line, `当前 PMX 没有表情 ${JSON.stringify(name)}`);
        if (entries.length !== 1) fail(line, `当前 PMX 中表情 ${JSON.stringify(name)} 重名，无法按名称播放`);
        if (entries[0].supported !== true) fail(line, `当前播放器不支持表情 ${JSON.stringify(name)} 的类型或轨道`);
        if (block.weights.has(name)) fail(line, `同一姿势重复定义表情 ${JSON.stringify(name)}`);
        let bytes;
        try { bytes = encodeMorphName(name); }
        catch (error) { fail(line, error.message); }
        block.weights.set(name, { name, weight, bytes });
        stripped[line - 1] = ''; // 保留原行号，避免骨骼编译错误指向错误位置。
    }

    function parseAnimation(text, line) {
        const match = text.match(KEYFRAME);
        if (!match) fail(line, '动画格式应为 秒数: pose 或 pose1 & pose2;');
        const time = Number(match[1]);
        if (!Number.isFinite(time) || time < 0 || time > 3600) fail(line, '动画时间必须是0–3600秒的有效数字');
        const references = match[2].split('&').map(name => name.trim());
        for (const name of references) validateReference(name, line, poses, '姿势');
        // Rust编译器使用f32秒数和f32乘法；表情与骨骼必须落在同一帧。
        const frame = Math.floor(Math.fround(Math.fround(time) * 30));
        block.entries.push({ frame, references, line });
    }

    function parseMain(text, line) {
        if (!text.endsWith(';')) fail(line, 'main引用须以分号结束');
        const name = text.slice(0, -1).trim();
        if (!NAME.test(name) || (!poses.has(name) && !animations.has(name))) fail(line, `main引用未知姿势或动画 ${JSON.stringify(name)}`);
        block.entries.push({ name, line });
    }
    const parsers = new Map([['@pose', parsePose], ['@animation', parseAnimation], ['main', parseMain]]);
    const finishers = new Map([
        ['@pose', () => poses.set(block.name, block.weights)],
        ['@animation', () => {
            if (!block.entries.length) fail(block.line, '动画至少需要一个关键帧');
            animations.set(block.name, block.entries);
        }],
        ['main', () => {
            if (!block.entries.length) fail(block.line, 'main至少需要一个姿势或动画引用');
            main = block.entries;
        }],
    ]);

    for (let index = 0; index < lines.length; index++) {
        const text = lines[index].trim(), line = index + 1;
        if (!text) continue;
        if (!block) {
            const match = text.match(/^(@pose|@animation)\s+([^\s{};:&]+)\s*(\{)?$/u)
                || text.match(/^(main)\s*(\{)?$/u);
            if (!match) fail(line, '声明须为 @pose 名称、@animation 名称或 main，并独占一行');
            const type = match[1], name = type === 'main' ? null : match[2];
            if (type === 'main' && main) fail(line, '只能定义一个main');
            if (name && declared.has(name)) fail(line, `姿势/动画名称 ${JSON.stringify(name)} 重复`);
            if (name) declared.add(name);
            block = { type, name, line, open: Boolean(type === 'main' ? match[2] : match[3]), weights: new Map(), entries: [] };
            continue;
        }
        if (!block.open) {
            if (text !== '{') fail(line, '声明后需要单独一行的开大括号');
            // 原编译器按行累计括号，将分行开括号规范化后仍保持总行号。
            stripped[block.line - 1] += ' {';
            stripped[index] = '';
            block.open = true;
            continue;
        }
        if (text === '}') {
            finishers.get(block.type)();
            block = null;
            continue;
        }
        parsers.get(block.type)(text, line);
    }
    if (block) fail(block.line, '声明缺少结束大括号');
    if (!main) throw new Error('MPL 需要非空main');

    // 所有main动画沿用绝对时间，同一量化帧合并而不是顺序拼接。
    const timeline = new Map(), controlled = new Map();
    for (const entry of main) {
        const keyframes = animations.get(entry.name) || [{ frame: 0, references: [entry.name], line: entry.line }];
        for (const keyframe of keyframes) {
            const changes = timeline.get(keyframe.frame) || new Map();
            for (const reference of keyframe.references) {
                for (const item of poses.get(reference).values()) {
                    if (changes.has(item.name) && changes.get(item.name) !== item.weight) {
                        fail(keyframe.line, `第${keyframe.frame}帧的表情 ${JSON.stringify(item.name)} 存在冲突权重`);
                    }
                    changes.set(item.name, item.weight);
                    controlled.set(item.name, item.bytes);
                }
            }
            timeline.set(keyframe.frame, changes);
        }
    }
    if (!controlled.size) return { boneSource: stripped.join('\n'), frames: [] };
    if (!timeline.has(0)) timeline.set(0, new Map());
    if (timeline.size * controlled.size > 70000) throw new Error('MPL 表情帧不能超过70,000条；请减少关键帧或表情数量');
    const weights = new Map([...controlled.keys()].map(name => [name, 0]));
    const frames = [];
    for (const [frame, changes] of [...timeline].sort((a, b) => a[0] - b[0])) {
        for (const [name, weight] of changes) weights.set(name, weight);
        // 在每个时间点补齐受控表情，缺省项沿用上一帧，确保时间线末尾保持正确。
        for (const [name, weight] of weights) frames.push({ name, frame, weight, bytes: controlled.get(name) });
    }
    return { boneSource: stripped.join('\n'), frames };
}

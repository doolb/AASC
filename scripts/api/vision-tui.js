#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 48;
const MAX_WIDTH = 120;

function parseArgs(argv) {
    const options = { kind: 'auto', width: DEFAULT_WIDTH, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--kind') {
            const kind = argv[index + 1];
            if (!kind || !['auto', 'ocr', 'yolo'].includes(kind)) {
                throw new Error('--kind 必须是 auto、ocr 或 yolo');
            }
            options.kind = kind;
            index += 1;
        } else if (arg === '--width') {
            const width = Number(argv[index + 1]);
            if (!Number.isInteger(width) || width < MIN_WIDTH || width > MAX_WIDTH) {
                throw new Error(`--width 必须是 ${MIN_WIDTH}..${MAX_WIDTH} 的整数`);
            }
            options.width = width;
            index += 1;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`未知参数: ${arg}`);
        }
    }
    return options;
}

function printHelp() {
    process.stdout.write(`用法：vision-tui.js [选项] < result.json

将 OCR 或 YOLO API 返回的 JSON 渲染成终端可读面板。

选项:
  --kind auto|ocr|yolo  指定结果类型，默认自动识别
  --width N             面板宽度，范围 ${MIN_WIDTH}..${MAX_WIDTH}
  --help                显示帮助

示例:
  scripts/api/vision-ocr.js --image ./screen.png --tui
  scripts/api/vision-yolo.js --image ./screen.png --tui
  curl ... | node scripts/api/vision-tui.js --kind ocr
`);
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value, digits = 3) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return number.toFixed(digits).replace(/\.?(0+)$/u, '');
}

function formatCoordinate(value) {
    const number = finiteNumber(value);
    return Number.isInteger(number) ? String(number) : formatNumber(number, 1);
}

function charWidth(character) {
    return /[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3040-\u33bf\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(character)
        ? 2
        : 1;
}

function displayWidth(value) {
    return [...String(value)].reduce((total, character) => total + charWidth(character), 0);
}

function truncate(value, maxWidth) {
    const text = String(value ?? '');
    if (displayWidth(text) <= maxWidth) return text;
    let result = '';
    let width = 0;
    for (const character of text) {
        const nextWidth = charWidth(character);
        if (width + nextWidth + 1 > maxWidth) break;
        result += character;
        width += nextWidth;
    }
    return `${result}…`;
}

function padRight(value, maxWidth) {
    const text = truncate(value, maxWidth);
    return text + ' '.repeat(Math.max(0, maxWidth - displayWidth(text)));
}

function wrapText(value, maxWidth) {
    const text = String(value ?? '');
    if (!text) return ['（无）'];
    const lines = [];
    let line = '';
    let width = 0;
    for (const character of text) {
        if (character === '\n') {
            lines.push(line || ' ');
            line = '';
            width = 0;
            continue;
        }
        const nextWidth = charWidth(character);
        if (line && width + nextWidth > maxWidth) {
            lines.push(line);
            line = '';
            width = 0;
        }
        line += character;
        width += nextWidth;
    }
    if (line || lines.length === 0) lines.push(line || ' ');
    return lines;
}

function panel(title, content, width) {
    const innerWidth = width - 4;
    const titleText = ` ${truncate(title, innerWidth - 2)} `;
    const top = `┌${titleText}${'─'.repeat(Math.max(0, width - 2 - displayWidth(titleText)))}┐`;
    const body = content.flatMap((line) => wrapText(line, innerWidth))
        .map((line) => `│ ${padRight(line, innerWidth)} │`);
    const bottom = `└${'─'.repeat(width - 2)}┘`;
    return [top, ...body, bottom];
}

function parsePoint(point) {
    if (Array.isArray(point)) {
        return { x: finiteNumber(point[0]), y: finiteNumber(point[1]) };
    }
    return { x: finiteNumber(point?.x), y: finiteNumber(point?.y) };
}

function boundsFromPoints(points) {
    const parsed = (Array.isArray(points) ? points : []).map(parsePoint);
    if (parsed.length === 0) return null;
    return {
        left: Math.min(...parsed.map((point) => point.x)),
        top: Math.min(...parsed.map((point) => point.y)),
        right: Math.max(...parsed.map((point) => point.x)),
        bottom: Math.max(...parsed.map((point) => point.y))
    };
}

function ocrItems(payload) {
    return (Array.isArray(payload.boxes) ? payload.boxes : [])
        .map((box) => ({
            label: String(box?.text || '（空文字）'),
            score: box?.score,
            bounds: boundsFromPoints(box?.points)
        }))
        .filter((item) => item.bounds);
}

function yoloItems(payload) {
    return (Array.isArray(payload.detections) ? payload.detections : [])
        .map((detection) => {
            const classId = Number.isInteger(Number(detection?.classId)) ? Number(detection.classId) : '?';
            const className = String(detection?.className || '').trim();
            return {
                label: className ? `${className} (class#${classId})` : `class#${classId}`,
                score: detection?.confidence,
                bounds: {
                    left: finiteNumber(detection?.left),
                    top: finiteNumber(detection?.top),
                    right: finiteNumber(detection?.right),
                    bottom: finiteNumber(detection?.bottom)
                }
            };
        })
        .filter((item) => item.bounds.right > item.bounds.left && item.bounds.bottom > item.bounds.top);
}

function drawPositionMap(items, sourceWidth, sourceHeight, width) {
    const mapWidth = Math.min(52, Math.max(24, width - 10));
    const mapHeight = 10;
    if (items.length === 0) return ['（没有可绘制的框）'];

    const grid = Array.from({ length: mapHeight }, () => Array(mapWidth).fill(' '));
    const xScale = Math.max(1, finiteNumber(sourceWidth, 1));
    const yScale = Math.max(1, finiteNumber(sourceHeight, 1));
    const clampX = (value) => Math.max(0, Math.min(mapWidth - 1, Math.round(value)));
    const clampY = (value) => Math.max(0, Math.min(mapHeight - 1, Math.round(value)));

    items.forEach((item, index) => {
        const box = item.bounds;
        const left = clampX((box.left / xScale) * (mapWidth - 1));
        const right = clampX((box.right / xScale) * (mapWidth - 1));
        const top = clampY((box.top / yScale) * (mapHeight - 1));
        const bottom = clampY((box.bottom / yScale) * (mapHeight - 1));
        const marker = String((index + 1) % 10);
        for (let x = left; x <= right; x += 1) {
            grid[top][x] = '-';
            grid[bottom][x] = '-';
        }
        for (let y = top; y <= bottom; y += 1) {
            grid[y][left] = '|';
            grid[y][right] = '|';
        }
        grid[top][left] = '+';
        grid[top][right] = '+';
        grid[bottom][left] = '+';
        grid[bottom][right] = '+';
        grid[Math.round((top + bottom) / 2)][Math.round((left + right) / 2)] = marker;
    });

    return [
        `坐标范围：${formatCoordinate(sourceWidth)} × ${formatCoordinate(sourceHeight)}`,
        `+${'-'.repeat(mapWidth)}+`,
        ...grid.map((row) => `|${row.join('')}|`),
        `+${'-'.repeat(mapWidth)}+`,
        '图中数字对应下方列表的序号'
    ];
}

function commonMeta(payload, extra = []) {
    const meta = [
        `状态：${payload.status || (payload.success === false ? 'error' : 'success')}`,
        `显示端：${payload.displayId || '未知'}    请求：${payload.requestId || '未知'}`,
        `耗时：${formatCoordinate(payload.elapsedMs)} ms`
    ];
    if (payload.affinityStatus) meta.push(`CPU：${payload.affinityStatus}`);
    return [...meta, ...extra];
}

function renderOcr(payload, width) {
    const items = ocrItems(payload);
    const imageWidth = finiteNumber(payload.imageWidth, Math.max(1, ...items.map((item) => item.bounds.right)));
    const imageHeight = finiteNumber(payload.imageHeight, Math.max(1, ...items.map((item) => item.bounds.bottom)));
    const lines = [
        ...panel('OCR 识别结果', commonMeta(payload, [`图片：${formatCoordinate(imageWidth)} × ${formatCoordinate(imageHeight)}`]), width),
        ...panel('识别文本', wrapText(payload.text || '（无文字）', width - 4), width),
        ...panel(`文字框（${items.length}）`, items.length > 0
            ? items.map((item, index) => `${index + 1}. ${truncate(item.label, 18)}  score=${formatNumber(item.score)}  (${formatCoordinate(item.bounds.left)},${formatCoordinate(item.bounds.top)})-(${formatCoordinate(item.bounds.right)},${formatCoordinate(item.bounds.bottom)})`)
            : ['（没有文字框）'], width),
        ...panel('位置图', drawPositionMap(items, imageWidth, imageHeight, width), width)
    ];
    return lines.join('\n');
}

function renderYolo(payload, width) {
    const items = yoloItems(payload);
    const sourceWidth = Math.max(1, ...items.map((item) => item.bounds.right));
    const sourceHeight = Math.max(1, ...items.map((item) => item.bounds.bottom));
    const timing = [
        `加载模型：${formatCoordinate(payload.loadModelMs)} ms`,
        `预处理：${formatCoordinate(payload.preprocessMs)} ms    推理：${formatCoordinate(payload.inferenceMs)} ms    后处理：${formatCoordinate(payload.postprocessMs)} ms`
    ];
    const lines = [
        ...panel('YOLO 检测结果', commonMeta(payload, [`模型：${payload.model || 'yolo11n'}`, ...timing]), width),
        ...panel(`检测框（${items.length}）`, items.length > 0
            ? items.map((item, index) => `${index + 1}. ${item.label}  conf=${formatNumber(item.score)}  (${formatCoordinate(item.bounds.left)},${formatCoordinate(item.bounds.top)})-(${formatCoordinate(item.bounds.right)},${formatCoordinate(item.bounds.bottom)})`)
            : ['（没有检测框）'], width),
        ...panel('位置图', [
            ...drawPositionMap(items, sourceWidth, sourceHeight, width),
            'YOLO 返回未携带原图尺寸，位置图按检测框最大坐标估算'
        ], width)
    ];
    return lines.join('\n');
}

function renderError(payload, width) {
    return panel('视觉请求失败', [
        `状态：${payload.status || 'error'}`,
        `错误：${payload.message || payload.error || '未知错误'}`,
        payload.requestId ? `请求：${payload.requestId}` : ''
    ].filter(Boolean), width).join('\n');
}

function resolveKind(payload, requestedKind) {
    if (requestedKind !== 'auto') return requestedKind;
    if (payload.kind === 'ocr' || Array.isArray(payload.boxes)) return 'ocr';
    return 'yolo';
}

function formatVisionResult(payload, requestedKind = 'auto', width = DEFAULT_WIDTH) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('视觉 API 返回必须是 JSON 对象');
    }
    const safeWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(width) || DEFAULT_WIDTH));
    if (payload.status === 'error' || payload.success === false) {
        return renderError(payload, safeWidth);
    }
    return resolveKind(payload, requestedKind) === 'ocr'
        ? renderOcr(payload, safeWidth)
        : renderYolo(payload, safeWidth);
}

function main(argv = process.argv.slice(2)) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        process.stderr.write(`参数错误：${error.message}\n`);
        process.exitCode = 2;
        return;
    }
    if (options.help) {
        printHelp();
        return;
    }

    let input;
    try {
        input = fs.readFileSync(0, 'utf8');
        const payload = JSON.parse(input);
        process.stdout.write(`${formatVisionResult(payload, options.kind, options.width)}\n`);
        if (payload.status === 'error' || payload.success === false) process.exitCode = 1;
    } catch (error) {
        process.stderr.write(`视觉结果解析失败：${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    formatVisionResult,
    parseArgs,
    renderOcr,
    renderYolo,
    renderError
};

if (require.main === module) main();

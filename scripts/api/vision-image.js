#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { ocrItems, yoloItems } = require('./vision-tui');

const DEFAULT_FONT_SIZE = 24;
const DEFAULT_STROKE_WIDTH = 3;
const BOX_COLOR = '#00ff66';
const TEXT_COLOR = '#ffffff';
const TEXT_BACKGROUND = '#000000b3';

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function numberText(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return String(Number(number.toFixed(2)));
}

function scoreText(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return number.toFixed(3).replace(/\.?(0+)$/u, '');
}

function escapeImageMagickText(value) {
    return String(value ?? '')
        .replace(/[\\]/gu, '\\\\')
        .replace(/%/gu, '%%')
        .replace(/"/gu, '\\"')
        .replace(/[\r\n]+/gu, ' ');
}

function labelFor(item) {
    return `${item.label} (${scoreText(item.score)})`;
}

function pointsFor(item) {
    return Array.isArray(item.points) ? item.points : [];
}

function geometryFor(item, kind) {
    const box = item.bounds;
    const points = pointsFor(item);
    if (kind === 'ocr' && points.length >= 3) {
        return `polygon ${points.map((point) => `${numberText(point.x)},${numberText(point.y)}`).join(' ')}`;
    }
    return `rectangle ${numberText(box.left)},${numberText(box.top)} ${numberText(box.right)},${numberText(box.bottom)}`;
}

function fontSizeFor(item, kind, defaultSize) {
    if (kind !== 'ocr') return defaultSize;
    const boxHeight = Math.max(1, finiteNumber(item.bounds.bottom) - finiteNumber(item.bounds.top));
    return Math.max(8, Math.min(96, Math.round(boxHeight * 0.85)));
}

function labelPosition(item, kind, fontSize) {
    const top = finiteNumber(item.bounds.top);
    const bottom = finiteNumber(item.bounds.bottom);
    const left = Math.max(0, finiteNumber(item.bounds.left));
    const y = kind === 'ocr'
        ? top + Math.max(0, ((bottom - top) - fontSize) / 2)
        : top >= fontSize + 6 ? top - fontSize - 6 : bottom + 4;
    return { x: left, y: Math.max(0, y) };
}

function buildAnnotationArgs(payload, kind, options = {}) {
    const items = kind === 'ocr' ? ocrItems(payload) : yoloItems(payload);
    const fontSize = Math.max(8, Math.min(96, Math.round(finiteNumber(options.fontSize, DEFAULT_FONT_SIZE))));
    const strokeWidth = Math.max(1, Math.min(24, Math.round(finiteNumber(options.strokeWidth, DEFAULT_STROKE_WIDTH))));
    const args = [
        '-stroke', BOX_COLOR,
        '-strokewidth', String(strokeWidth),
        '-fill', 'none'
    ];

    for (const item of items) args.push('-draw', geometryFor(item, kind));

    const fontPath = options.fontPath || process.env.AASC_VISION_FONT || findChineseFont();
    if (fontPath) args.push('-font', fontPath);
    args.push(
        '-gravity', 'NorthWest',
        '-pointsize', String(fontSize),
        '-stroke', 'none',
        '-fill', TEXT_COLOR,
        '-undercolor', TEXT_BACKGROUND
    );
    for (const item of items) {
        const itemFontSize = fontSizeFor(item, kind, fontSize);
        const position = labelPosition(item, kind, itemFontSize);
        args.push(
            '-pointsize', String(itemFontSize),
            '-annotate', `+${numberText(position.x)}+${numberText(position.y)}`,
            escapeImageMagickText(labelFor(item))
        );
    }
    return args;
}

function findChineseFont() {
    const candidates = process.platform === 'win32'
        ? [
            'C:\\Windows\\Fonts\\msyh.ttc',
            'C:\\Windows\\Fonts\\simhei.ttf',
            'C:\\Windows\\Fonts\\simsun.ttc'
        ]
        : process.platform === 'darwin'
            ? [
                '/System/Library/Fonts/PingFang.ttc',
                '/System/Library/Fonts/STHeiti Light.ttc',
                '/Library/Fonts/Arial Unicode.ttf'
            ]
            : [
                '/usr/share/fonts/wenquanyi/wqy-microhei/wqy-microhei.ttc',
                '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
                '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
            ];
    const existing = candidates.find((candidate) => fs.existsSync(candidate));
    if (existing) return existing;

    if (process.platform !== 'win32') {
        const result = spawnSync('fc-match', ['-f', '%{file}', 'sans:lang=zh'], {
            encoding: 'utf8',
            windowsHide: true
        });
        const fontPath = String(result.stdout || '').trim();
        if (result.status === 0 && fs.existsSync(fontPath)) return fontPath;
    }
    return null;
}

function runImageMagick(args) {
    let notFound = true;
    for (const command of ['magick', 'convert']) {
        const result = spawnSync(command, args, {
            encoding: 'utf8',
            windowsHide: true
        });
        if (result.error?.code === 'ENOENT') continue;
        notFound = false;
        if (result.status === 0) return;
        const details = String(result.stderr || result.stdout || '').trim();
        throw new Error(`ImageMagick 处理图片失败${details ? `：${details}` : ''}`);
    }
    if (notFound) throw new Error('未找到 ImageMagick，请安装 magick/convert 后重试');
    throw new Error('ImageMagick 处理图片失败');
}

function renderVisionImage(imagePath, payload, kind, outputDirectory) {
    if (!outputDirectory) throw new Error('生成标注图片必须指定临时目录');
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, `vision-annotated-${Date.now()}-${process.pid}.png`);
    runImageMagick([
        imagePath,
        ...buildAnnotationArgs(payload, kind),
        outputPath
    ]);
    return outputPath;
}

function showWithChafa(imagePath, options = {}) {
    const args = [];
    if (options.width !== undefined) {
        const width = Number(options.width);
        if (!Number.isInteger(width) || width < 20 || width > 300) {
            throw new Error('--chafa-width 必须是 20..300 的整数');
        }
        args.push('--size', `${width}x`);
    }
    args.push(imagePath);
    const result = spawnSync('chafa', args, {
        stdio: 'inherit',
        windowsHide: true
    });
    if (result.error?.code === 'ENOENT') throw new Error('未找到 chafa，请安装 chafa 后重试');
    if (result.status !== 0) throw new Error(`chafa 输出失败（退出码 ${result.status ?? '未知'}）`);
}

function renderAndShowVisionImage(imagePath, payload, kind, options = {}) {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-vision-'));
    try {
        const outputPath = renderVisionImage(imagePath, payload, kind, tempDirectory);
        showWithChafa(outputPath, options);
    } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
}

module.exports = {
    buildAnnotationArgs,
    findChineseFont,
    renderAndShowVisionImage,
    renderVisionImage,
    showWithChafa
};

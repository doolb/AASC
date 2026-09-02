'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const { buildAnnotationArgs, renderVisionImage } = require(path.join(root, 'scripts', 'api', 'vision-image'));

const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

function withTempDir(callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-vision-test-'));
    try {
        return callback(directory);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('OCR 标注使用 ImageMagick 绘制为像素图参数，不生成 SVG', () => {
    const args = buildAnnotationArgs({
        imageWidth: 800,
        imageHeight: 600,
        boxes: [{
            text: '你好',
            score: 0.987,
            points: [[10, 20], [110, 20], [110, 60], [10, 60]]
        }]
    }, 'ocr');

    assert.match(args.join('\n'), /-draw/);
    assert.match(args.join('\n'), /polygon 10,20 110,20 110,60 10,60/);
    assert.match(args.join('\n'), /你好 \(0\.987\)/);
    assert.equal(args.some((arg) => String(arg).endsWith('.svg')), false);
});

test('YOLO 标注可以实际合成为 PNG 位图', () => {
    withTempDir((directory) => {
        const inputPath = path.join(directory, 'input.png');
        fs.writeFileSync(inputPath, ONE_PIXEL_PNG);
        const outputPath = renderVisionImage(inputPath, {
            detections: [{
                classId: 32,
                className: 'sports ball',
                confidence: 0.876,
                left: 0,
                top: 0,
                right: 1,
                bottom: 1
            }]
        }, 'yolo', directory);

        assert.match(outputPath, /\.png$/u);
        assert.equal(fs.readFileSync(outputPath).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    });
});

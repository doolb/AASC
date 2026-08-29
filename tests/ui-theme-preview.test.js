'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const publicRoot = path.join(__dirname, '../src/apps/web-mediacenter/ui/public');
const uploadHtml = fs.readFileSync(path.join(publicRoot, 'upload.html'), 'utf8');
const themeScript = fs.readFileSync(path.join(publicRoot, 'js/ui-theme.js'), 'utf8');
const themeCss = fs.readFileSync(path.join(publicRoot, 'css/theme.css'), 'utf8');

test('主题选择器旁应提供主题预览按钮', () => {
    assert.match(uploadHtml, /id="themeSelect"[\s\S]*?id="themePreviewBtn"/u);
    assert.match(uploadHtml, /id="themePreviewBtn"[^>]*type="button"/u);
    assert.match(uploadHtml, /id="themePreviewBtn"[^>]*onclick="UiTheme\.showPreview\(\)"/u);
});

test('主题预览应临时切换根主题并支持关闭恢复', () => {
    assert.match(themeScript, /showPreview\s*\(/u);
    assert.match(themeScript, /closePreview\s*\(/u);
    assert.match(themeScript, /theme-preview-modal/u);
    assert.match(themeScript, /dataset\.themeMode/u);
    assert.match(themeScript, /恢复原主题|previewOriginalTheme/u);
    assert.match(themeScript, /hasPreviewState[\s\S]*if \(!hasPreviewState\) return/u);

    const previewBlock = themeScript.match(/showPreview\s*\([\s\S]*?\n\s*\},\n\n\s*\/\/ 预览关闭/u)?.[0] || '';
    assert.notEqual(previewBlock, '', '主题预览方法应存在完整实现');
    assert.doesNotMatch(previewBlock, /persistServerTheme|localStorage\.setItem|fetch\(/u);
});

test('主题预览器应覆盖常用控件和信息样式', () => {
    const requiredSamples = [
        'theme-preview-section', 'theme-preview-small-card', 'theme-preview-button',
        'theme-preview-switch', 'theme-preview-slider', 'theme-preview-input',
        'theme-preview-select', 'theme-preview-tip', 'theme-preview-status',
        'theme-preview-chat', 'theme-preview-log', 'theme-preview-popup'
    ];

    requiredSamples.forEach((sampleClass) => {
        assert.match(themeScript, new RegExp(sampleClass, 'u'), `预览器缺少 ${sampleClass}`);
    });
});

test('主题预览器应有独立弹窗布局并适配窄屏', () => {
    assert.match(themeCss, /\.theme-preview-modal\s*\{/u);
    assert.match(themeCss, /\.theme-preview-dialog\s*\{/u);
    assert.match(themeCss, /\.theme-preview-grid\s*\{/u);
    assert.match(themeCss, /@media\s*\([^)]*max-width[^)]*\)[\s\S]*\.theme-preview-dialog/u);
});

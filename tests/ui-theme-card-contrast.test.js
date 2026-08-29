const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const themeCss = fs.readFileSync(
    path.join(__dirname, '../src/apps/web-mediacenter/ui/public/css/theme.css'),
    'utf8'
);

function getRuleBody(selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rules = [...themeCss.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'gu'))];
    return rules.find((match) => /background:\s*var\(/u.test(match[1]))?.[1] || rules[0]?.[1] || '';
}

test('浅色主题大卡片与小卡片应使用不同背景层级', () => {
    const sectionRule = getRuleBody(':root[data-theme-mode="light"] .section');
    const controlItemRule = getRuleBody(':root[data-theme-mode="light"] .control-item');

    assert.match(sectionRule, /background:\s*var\(--bg-surface\)/u);
    assert.match(controlItemRule, /background:\s*var\(--card-background\)/u);
});

test('浅色主题卡片层级变量应保持不同颜色来源', () => {
    const lightTheme = themeCss.match(/:root\[data-theme="light"\]\s*\{([^}]*)\}/u)?.[1] || '';

    assert.match(lightTheme, /--bg-surface:\s*rgba\(255,\s*255,\s*255,\s*0\.78\)/u);
    assert.match(lightTheme, /--card-background:\s*#eaf4ff/u);
});

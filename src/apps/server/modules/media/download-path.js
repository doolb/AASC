'use strict';

// 分类名只作为单层目录名：替换路径分隔符与控制字符，避免穿越或空目录。
function sanitizeCategoryName(value) {
    let text = String(value ?? '').trim();
    text = text.replace(/[\/\\\u0000-\u001f\u007f]/g, '_');
    text = text.replace(/\s+/g, ' ');
    if (!text || text === '.' || text === '..') return '未分类';
    return text.slice(0, 50);
}

module.exports = { sanitizeCategoryName };

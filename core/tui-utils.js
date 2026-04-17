// TUI 文本辅助工具
//
// 说明：blessed 的日志组件在遇到超长单行文本时，可能会在右侧越界显示，导致 UI 视觉上“超出列表”。
// 这里提供基于“终端显示宽度（cell width）”的截断能力，尽量让每条日志保持单行、可滚动、且不破坏边框布局。

function isFullWidthCodePoint(code) {
    // 近似实现：覆盖常见 CJK / 全角区间，用于终端等宽字体的显示宽度估算。
    // 目标不是 100% 精确，而是避免中文/全角字符导致的截断偏差过大。
    return (
        code >= 0x1100 && (
            code <= 0x115f ||
            code === 0x2329 ||
            code === 0x232a ||
            (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
            (code >= 0xac00 && code <= 0xd7a3) ||
            (code >= 0xf900 && code <= 0xfaff) ||
            (code >= 0xfe10 && code <= 0xfe19) ||
            (code >= 0xfe30 && code <= 0xfe6f) ||
            (code >= 0xff00 && code <= 0xff60) ||
            (code >= 0xffe0 && code <= 0xffe6) ||
            (code >= 0x20000 && code <= 0x3fffd)
        )
    );
}

function getStringDisplayWidth(input) {
    const str = String(input == null ? '' : input);
    let width = 0;
    for (const ch of str) {
        const code = ch.codePointAt(0);
        // 控制字符不计宽度（避免污染计算）
        if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
        width += isFullWidthCodePoint(code) ? 2 : 1;
    }
    return width;
}

function normalizeToSingleLine(input) {
    // blessed.log 会按换行拆分；为了避免一条“事件”占多行导致列表滚动体验变差，这里统一压成单行。
    // 注意：保留信息，通过字面量 "\\n" 标记原始换行。
    return String(input == null ? '' : input)
        .replace(/\r\n|\r|\n/g, ' \\n ')
        .replace(/\t/g, '    ');
}

function stripAnsiSequences(input) {
    // 去除终端转义序列（ANSI/VT100）。
    // 目的：避免日志里混入控制序列后，blessed 渲染发生错位，出现“跑到上面面板里/边界溢出”。
    // 覆盖：
    // - CSI:  \x1b[ ... cmd
    // - OSC:  \x1b] ... (BEL or ST)
    // - DCS/PM/APC: \x1bP / \x1b^ / \x1b_ ... ST
    // - 单字符 ESC 序列: \x1bX
    let str = String(input == null ? '' : input);
    // OSC: ESC ] ... BEL  或  ESC ] ... ESC \
    str = str.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
    // DCS/PM/APC: ESC P/^/_ ... ESC \
    str = str.replace(/\x1b[\x50\x5e\x5f][\s\S]*?\x1b\\/g, '');
    // CSI: ESC [ ... final
    str = str.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    // Single ESC: ESC followed by 0x40-0x5F
    str = str.replace(/\x1b[@-Z\\-_]/g, '');
    // 兜底：残留 ESC 直接移除
    str = str.replace(/\x1b/g, '');
    return str;
}

function stripControlChars(input) {
    // 去除不可见控制字符（换行/tab 已在 normalizeToSingleLine 中处理），避免布局计算/渲染异常。
    return String(input == null ? '' : input).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}

function escapeBlessedTags(input) {
    // logBox 开启 tags:true 时，消息里的 { } 会被当成 blessed 标签解析。
    // 这会导致内容被吞掉或渲染错位（包括边框上/下溢出）。这里把所有花括号转义为字面量。
    const OPEN_PLACEHOLDER = '__BLESSED_OPEN__';
    const CLOSE_PLACEHOLDER = '__BLESSED_CLOSE__';
    let str = String(input == null ? '' : input);
    str = str.replace(/\\\{/g, OPEN_PLACEHOLDER).replace(/\\\}/g, CLOSE_PLACEHOLDER);
    str = str.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    str = str.replace(new RegExp(OPEN_PLACEHOLDER, 'g'), '\\{');
    str = str.replace(new RegExp(CLOSE_PLACEHOLDER, 'g'), '\\}');
    return str;
}

function truncateToDisplayWidth(input, maxWidth) {
    const str = String(input == null ? '' : input);
    const limit = Math.max(0, Number(maxWidth) || 0);
    if (limit === 0) return '';
    if (getStringDisplayWidth(str) <= limit) return str;

    // 预留省略号宽度：使用 ASCII "..."，兼容所有终端。
    const ellipsis = '...';
    const ellipsisWidth = 3;
    const target = Math.max(0, limit - ellipsisWidth);

    let width = 0;
    let out = '';
    for (const ch of str) {
        const code = ch.codePointAt(0);
        if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
        const w = isFullWidthCodePoint(code) ? 2 : 1;
        if (width + w > target) break;
        out += ch;
        width += w;
    }

    // 极窄宽度（<3）时，不追加省略号，直接硬截断。
    if (limit < ellipsisWidth) {
        return out;
    }
    return out + ellipsis;
}

function _sliceStartByDisplayWidth(str, maxWidth) {
    const limit = Math.max(0, Number(maxWidth) || 0);
    if (limit === 0) return '';
    let width = 0;
    let out = '';
    for (const ch of String(str == null ? '' : str)) {
        const code = ch.codePointAt(0);
        if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
        const w = isFullWidthCodePoint(code) ? 2 : 1;
        if (width + w > limit) break;
        out += ch;
        width += w;
    }
    return out;
}

function _sliceEndByDisplayWidth(str, maxWidth) {
    const limit = Math.max(0, Number(maxWidth) || 0);
    if (limit === 0) return '';
    const chars = Array.from(String(str == null ? '' : str));
    let width = 0;
    let out = '';
    for (let i = chars.length - 1; i >= 0; i--) {
        const ch = chars[i];
        const code = ch.codePointAt(0);
        if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
        const w = isFullWidthCodePoint(code) ? 2 : 1;
        if (width + w > limit) break;
        out = ch + out;
        width += w;
    }
    return out;
}

function truncateMiddleToDisplayWidth(input, maxWidth) {
    const str = String(input == null ? '' : input);
    const limit = Math.max(0, Number(maxWidth) || 0);
    if (limit === 0) return '';
    if (getStringDisplayWidth(str) <= limit) return str;

    const ellipsis = '...';
    const ellipsisWidth = 3;
    if (limit <= ellipsisWidth) {
        return _sliceStartByDisplayWidth(str, limit);
    }

    // 经验分配：更多保留尾部信息（常见为 displayId/actor 名/URL 末尾）。
    const target = limit - ellipsisWidth;
    const leftBudget = Math.max(0, Math.floor(target * 0.45));
    const rightBudget = Math.max(0, target - leftBudget);

    const left = _sliceStartByDisplayWidth(str, leftBudget);
    const right = _sliceEndByDisplayWidth(str, rightBudget);
    return left + ellipsis + right;
}

module.exports = {
    getStringDisplayWidth,
    normalizeToSingleLine,
    truncateToDisplayWidth,
    truncateMiddleToDisplayWidth,
    stripAnsiSequences,
    stripControlChars,
    escapeBlessedTags
};

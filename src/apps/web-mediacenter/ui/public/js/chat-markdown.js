/*
 * 控制端聊天 Markdown 渲染器。
 *
 * 该文件不依赖外部 CDN 或前端构建工具，适合当前原生 HTML/JavaScript 页面。
 * 渲染器只会生成内部定义的标签，普通文本、代码和 HTML 属性均经过转义，
 * 原始 HTML 不会被当作浏览器标签执行；链接还会经过协议白名单校验。
 */
(function exposeChatMarkdown(root, factory) {
    const renderer = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = renderer;
        return;
    }

    root.ChatMarkdown = renderer;
}(typeof globalThis === 'object' ? globalThis : window, () => {
    const HTML_ESCAPE_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    const escapeHtml = (value) => String(value)
        .replace(/[&<>"']/gu, (character) => HTML_ESCAPE_MAP[character]);

    const escapeAttribute = (value) => escapeHtml(value).replace(/`/gu, '&#96;');

    const isSafeUrl = (value) => {
        const url = String(value).trim();
        if (!url) return false;
        if (/^(?:javascript|vbscript|data):/iu.test(url)) return false;
        return /^(?:https?:|mailto:|\/|#|\.\/|\.\.\/)/iu.test(url);
    };

    const splitTableCells = (line) => {
        const value = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
        return value.split('|').map((cell) => cell.trim());
    };

    const renderInline = (value) => {
        const source = String(value);
        let html = '';
        let index = 0;

        while (index < source.length) {
            const remaining = source.slice(index);
            const codeMatch = remaining.match(/^`([^`\n]+)`/u);
            if (codeMatch) {
                html += `<code>${escapeHtml(codeMatch[1])}</code>`;
                index += codeMatch[0].length;
                continue;
            }

            const linkMatch = remaining.match(/^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/u);
            if (linkMatch) {
                const [, label, url, title] = linkMatch;
                if (isSafeUrl(url)) {
                    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
                    html += `<a href="${escapeAttribute(url)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${renderInline(label)}</a>`;
                } else {
                    html += escapeHtml(linkMatch[0]);
                }
                index += linkMatch[0].length;
                continue;
            }

            const strongMatch = remaining.match(/^(\*\*|__)(.+?)\1/u);
            if (strongMatch) {
                html += `<strong>${renderInline(strongMatch[2])}</strong>`;
                index += strongMatch[0].length;
                continue;
            }

            const strikeMatch = remaining.match(/^~~(.+?)~~/u);
            if (strikeMatch) {
                html += `<del>${renderInline(strikeMatch[1])}</del>`;
                index += strikeMatch[0].length;
                continue;
            }

            const emphasisMatch = remaining.match(/^(\*|_)([^\n]+?)\1/u);
            if (emphasisMatch) {
                html += `<em>${renderInline(emphasisMatch[2])}</em>`;
                index += emphasisMatch[0].length;
                continue;
            }

            const newlineMatch = remaining.match(/^\n+/u);
            if (newlineMatch) {
                html += '<br>'.repeat(newlineMatch[0].length);
                index += newlineMatch[0].length;
                continue;
            }

            html += escapeHtml(source[index]);
            index += 1;
        }

        return html;
    };

    const renderList = (lines, startIndex, ordered) => {
        const itemPattern = ordered ? /^\s*\d+[.)]\s+(.+)$/u : /^\s*[-+*]\s+(.+)$/u;
        const tagName = ordered ? 'ol' : 'ul';
        const items = [];
        let index = startIndex;

        while (index < lines.length) {
            const match = lines[index].match(itemPattern);
            if (!match) break;
            items.push(`<li>${renderInline(match[1])}</li>`);
            index += 1;
        }

        return {
            html: `<${tagName}>${items.join('')}</${tagName}>`,
            nextIndex: index
        };
    };

    const renderTable = (lines, startIndex) => {
        const headers = splitTableCells(lines[startIndex]);
        const rows = [];
        let index = startIndex + 2;

        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
            rows.push(splitTableCells(lines[index]));
            index += 1;
        }

        const headerHtml = headers.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
        const rowHtml = rows.map((row) => {
            const cells = headers.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] || '')}</td>`).join('');
            return `<tr>${cells}</tr>`;
        }).join('');

        return {
            html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table>`,
            nextIndex: index
        };
    };

    const isTableSeparator = (line) => {
        const cells = splitTableCells(line);
        return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
    };

    const renderBlocks = (lines) => {
        const blocks = [];
        let index = 0;

        while (index < lines.length) {
            const line = lines[index];
            if (!line.trim()) {
                index += 1;
                continue;
            }

            const fenceMatch = line.match(/^\s*```([\w-]*)\s*$/u);
            if (fenceMatch) {
                const codeLines = [];
                index += 1;
                while (index < lines.length && !/^\s*```\s*$/u.test(lines[index])) {
                    codeLines.push(lines[index]);
                    index += 1;
                }
                if (index < lines.length) index += 1;
                const languageClass = fenceMatch[1] ? ` class="language-${escapeAttribute(fenceMatch[1])}"` : '';
                blocks.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
                continue;
            }

            const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
            if (headingMatch) {
                const level = headingMatch[1].length;
                blocks.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
                index += 1;
                continue;
            }

            if (/^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/u.test(line)) {
                blocks.push('<hr>');
                index += 1;
                continue;
            }

            if (/^\s*>\s?/u.test(line)) {
                const quoteLines = [];
                while (index < lines.length && /^\s*>\s?/u.test(lines[index])) {
                    quoteLines.push(lines[index].replace(/^\s*>\s?/u, ''));
                    index += 1;
                }
                blocks.push(`<blockquote>${renderBlocks(quoteLines)}</blockquote>`);
                continue;
            }

            if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
                const table = renderTable(lines, index);
                blocks.push(table.html);
                index = table.nextIndex;
                continue;
            }

            if (/^\s*[-+*]\s+.+$/u.test(line)) {
                const list = renderList(lines, index, false);
                blocks.push(list.html);
                index = list.nextIndex;
                continue;
            }

            if (/^\s*\d+[.)]\s+.+$/u.test(line)) {
                const list = renderList(lines, index, true);
                blocks.push(list.html);
                index = list.nextIndex;
                continue;
            }

            const paragraphLines = [line];
            index += 1;
            while (index < lines.length && lines[index].trim()) {
                const nextLine = lines[index];
                const startsBlock = /^\s*(?:#{1,6}\s|```|>|[-+*]\s+|\d+[.)]\s+)/u.test(nextLine);
                if (startsBlock) break;
                paragraphLines.push(nextLine);
                index += 1;
            }
            blocks.push(`<p>${renderInline(paragraphLines.join('\n'))}</p>`);
        }

        return blocks.join('');
    };

    const render = (markdown) => renderBlocks(String(markdown || '').replace(/\r\n?/gu, '\n').split('\n'));

    return Object.freeze({ render });
}));

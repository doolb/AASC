# Task 4 第二轮修复报告

## 修复范围

- 根因：上一轮 Markdown 分页按源码 `<pre>` 高度估算，未量测 `ChatMarkdown.render()` 的真实块布局；内容区还比外层少固定 40px，状态栏与块级边距未纳入分页上限。
- 修复：播放器先同步 `#mediaTextContent` 的真实页边距、状态栏占用和可用宽高；Markdown 在同宽、同字体、同行高、同块级样式的隐藏容器中量测渲染后的 HTML，再以实际高度贪心分页。超页段落、列表项、引用和代码行会继续拆分，逻辑原文仍完整保留给 TTS 与锚点恢复。
- 布局：内容区由真实的四边页边距与量测得到的状态栏预留空间定位；显示内容和量测容器共享块级边距、最后块间距及代码换行规则。

## 回归覆盖

- 新增 Puppeteer 真实 `display.html` 回归：连续段落、列表、blockquote、代码块均逐页断言 `scrollHeight <= clientHeight`，并确认多页和代码文本完整出现。
- 保留并通过恢复进度、暂停回包、旋转后重新分页与文本 TTS 服务回归。

## 验证

- `node --test tests/text-media-player.test.js tests/text-media-markdown-pagination-dom.test.js tests/display-playback-resume.test.js tests/display-sleep-mode.test.js tests/text-media-server-integration.test.js tests/text-media-tts-service.test.js`：23 passed。
- 提交前另执行 `node --check src/apps/web-mediacenter/ui/public/js/text-media-player.js`、`git diff --check` 与提交对象范围检查。

## 提交范围整理

- 修订 `df536e1` 时使用独立 Git 索引，从父提交重建 Task 4 所需文件；当前工作树和用户已有暂存内容保持不变。
- `changelog.md` 仅纳入文本媒体设计和 Task 4 修复记录，动态填充、Pi Agent、Claude 等用户记录继续保留在工作树，但不归属该 Task 4 提交。

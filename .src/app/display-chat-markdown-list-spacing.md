# 显示端聊天 Markdown 列表缩进

## 目标文件清单

- `src/apps/web-mediacenter/ui/public/css/display-chat.css` // 在显示端聊天气泡内恢复 Markdown 列表缩进
- `src/apps/web-mediacenter/ui/public/js/chat-markdown.js` // 复用现有有序与无序列表标签输出，不改变渲染规则
- `src/apps/web-mediacenter/ui/public/js/self-test.js` // 只读检查气泡列表缩进样式

## 范围约束

- `ChatMarkdown.render` 已将 Markdown 有序列表和无序列表分别输出为 `ol` 与 `ul`。
- `display.css` 的全局 `*` 样式把 `margin` 和 `padding` 重置为 0；显示端聊天气泡没有恢复 `ul/ol` 缩进。
- 样式只限定在 `.display-chat-message-body`，不改变控制端聊天、文本媒体列表或其他列表。
- 列表文字缩进 24 CSS px，让序号和圆点落在气泡背景内部；保留既有 Markdown 安全转义和结构。

## 已有声明

- `ChatMarkdown.render`：将 Markdown 文本转换为受控标签，列表通过 `renderList` 输出 `ol/li` 或 `ul/li`。
- `display.css`：全局通配选择器清空所有节点默认 margin 和 padding。
- `display-chat.css`：`.display-chat-message` 提供实色气泡背景和 11px 水平内边距；正文当前只有段落间距样式。
- `chat.css`：控制端 `.chat-message-content ul/ol` 已使用 24px 左侧缩进，作为显示端基准。
- `self-test.js`：只读自测可通过同源 fetch 检查服务端可访问的 CSS。

## 操作流程

显示端收到聊天消息
  使用既有 ChatMarkdown.render 输出段落、列表等受控 HTML
  在 `.display-chat-message-body` 内显示输出

显示端聊天应用气泡样式
  仅选中气泡正文下的 ul 与 ol
  将列表起始缩进设为 24 CSS px
  设置列表块间距，保持列表文字与标记落在气泡背景内
  不修改 Markdown 输出、控制端样式和其他显示模块

只读自测
  获取 `/css/display-chat.css`
  检查气泡正文 ul/ol 样式包含 24 CSS px 缩进
  返回样式配置有效或缺失

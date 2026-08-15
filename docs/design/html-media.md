# HTML 媒体类型设计文档

## 功能概述

新增 `html` 媒体类型，支持将 HTML 文件或粘贴的 HTML 代码作为媒体发送到显示端，以 iframe 全屏铺满方式纯展示（不可交互）。用于大屏动画、自定义页面、数据可视化等场景。

## 功能需求

### 1. 媒体类型识别
- 服务端媒体库识别 `.html/.htm` 文件为 `html` 类型（`detectMediaType`）
- 上传端临时文件识别 `.html/.htm` 为 `html` 类型
- 批量播放（playlist）支持扫描 `html` 类型文件

### 2. 发送入口（三种）
- **媒体库文件**：点击媒体库中的 `.html` 文件，弹「HTML 发送设置」对话框，确认后发送
- **粘贴 HTML 代码**：工具栏「发送 HTML」按钮，对话框内粘贴代码 + 选择去向：
  - 临时发送：base64 走 WebSocket，不落盘
  - 保存到媒体库：构造 File 走现有上传 API 存到当前目录，再按 URL 发送
- **裁剪框拖拽**：把 `.html` 文件拖入裁剪预览区（或文件选择器选择），识别为 html 后弹「HTML 发送设置」对话框，以临时模式 base64 发送

### 3. 滚动模式（发送时选择）
- **分页式（page）**：每屏停留 N 秒（3/5/8 秒可选）滚一屏，滚到底部停止
- **平滑（smooth）**：按速度（慢/中/快，约 60/120/240 px/s）匀速滚动，滚到底部停止
- **循环（loop）**：平滑滚动，滚到底部后回顶重新开始

### 4. 显示端渲染
- iframe 铺满整个屏幕，`pointer-events: none` 纯展示，不可交互
- 裁剪不适用于 html（HTML 无固有宽高比），发送时跳过裁剪

### 5. 播放行为
- 单文件发送：一直显示，直到手动切换
- 批量播放：像图片一样按间隔计时切换，html 项使用默认滚动参数（分页式 5 秒）

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           控制端 (upload.html)                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  MediaLibrary: 点击 .html 文件 → HTML发送设置对话框                │   │
│  │  Upload: 裁剪框拖入 .html → HTML发送设置对话框 → 临时发送           │   │
│  │  工具栏「发送 HTML」→ 粘贴代码 + 去向（临时/媒体库）                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │ mediaData + htmlScroll                   │
│                              ▼                                           │
│                    WebSocketManager.sendMedia                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │ WebSocket (mediaBatch)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          显示端 (display.html)                           │
│  showMedia(data):                                                        │
│    mediaType === 'html' → iframe#mediaHtml 显示                           │
│      - type=url:    iframe.src = url（同源文件）                           │
│      - type=base64: 解码 → iframe.srcdoc = html（粘贴代码）                │
│  HtmlScrollController:                                                   │
│    - rAF 时间步进，读取 contentWindow.scrollHeight 判断溢出                │
│    - page:   每 pageInterval 秒 scrollBy(0, 视口高)，到底停止              │
│    - smooth: 按速度匀速 scrollBy，到底停止                                 │
│    - loop:   平滑滚动，到底 scrollTo(0,0) 循环                            │
└─────────────────────────────────────────────────────────────────────────┘
```

## 数据模型

```
mediaData（WebSocket 消息 media 字段）:
{
  type: 'url' | 'base64',
  url: string,              // type=url 时：媒体库 html 文件 URL
  data: string,             // type=base64 时：html 代码 base64
  mediaType: 'html',
  mimeType: 'text/html',    // base64 时
  fileName: string,
  temp: bool,               // 临时模式
  htmlScroll: {
    mode: 'page' | 'smooth' | 'loop',
    pageInterval: number,   // page 模式：每屏停留秒数（3/5/8）
    speed: 'slow' | 'medium' | 'fast'  // smooth/loop 模式：滚动速度
  }
}
```

批量播放 playlist 项：`{ url, fileName, mediaType: 'html' }`，滚动参数使用默认值（page, 5s）。

## 模块设计

### 1. 媒体类型识别（服务端 + 上传端）

```
detectMediaType(name)  // 服务端 media-library-app-service.js 与上传端 upload.js 同步修改
    ext = name 的后缀
    if ext in ['gif']: return 'gif'
    if ext in ['mp4','webm','mov','avi','mkv']: return 'video'
    if ext in ['html','htm']: return 'html'      // 新增
    return 'image'
```

### 2. 批量播放过滤（服务端）

```
playlist-app-service.js:
    MEDIA_TYPES = ['image', 'video', 'gif', 'html']   // 新增 'html'
```

### 3. 上传端发送流程

```
MediaLibrary.playMedia(url, mediaType):
    if mediaType === 'html':
        弹「HTML 发送设置」对话框（滚动方式 + 参数）
        确认后:
            跳过 Crop.showPreview（html 不支持裁剪预览）
            WebSocketManager.sendMedia({type:'url', url, mediaType:'html', htmlScroll})
    else:
        原有流程（裁剪预览 + 发送）

Upload.sendTempFile(file) / uploadFile(file) 临时模式分支:
    mediaType = detectMediaType(file.name)
    if mediaType === 'html':
        跳过 getMediaDimensions（无固有尺寸）
        跳过 Crop.showPreview
        弹「HTML 发送设置」对话框
        确认后发送 {type:'base64', data, mediaType:'html', mimeType:'text/html', temp:true, htmlScroll}

工具栏「发送 HTML」对话框:
    textarea 粘贴代码
    滚动设置（方式 + 参数）
    去向: 临时发送 / 保存到媒体库（保存并发送）
    临时发送: base64 直接发送
    保存到媒体库: new File([code], '时间戳.html') → MediaLibrary.uploadFile → 按 url 发送

批量临时拖入（多文件）含 html 文件:
    不弹设置框，自动使用默认滚动参数（分页式 5 秒）
    prepareTempFiles 中 detectMediaType 识别 html → playlist 项带 mediaType='html'

WebSocketManager.getMediaRatio(mediaData):
    if mediaData.mediaType === 'html': return 1    // 不创建 img 探测
```

### 4. 显示端渲染（display.html）

```
新增元素:
    <iframe id="mediaHtml">  // position:absolute 铺满, pointer-events:none

showMedia(data):
    if data.mediaType === 'html':
        隐藏 mediaImage / mediaVideo，显示 mediaHtml
        if data.type === 'url':
            mediaHtml.srcdoc = ''; mediaHtml.src = data.url
        else (base64):
            html = base64 解码
            mediaHtml.src = ''; mediaHtml.srcdoc = html
        mediaHtml.onload = () => startHtmlScroll(mediaHtml, data.htmlScroll)
    else 原有 img/video 流程

HtmlScrollController:
    state: { iframe, mode, pageInterval, speed, timer, rafId, scrollTop, finished }
    start(iframe, htmlScroll):
        默认参数: mode='page', pageInterval=5, speed='medium'
        win = iframe.contentWindow
        如果 win 不存在或不可访问: 放弃滚动（仅静态展示）
        scrollHeight = win.document.documentElement.scrollHeight || win.document.body.scrollHeight
        clientHeight = win.innerHeight || iframe.clientHeight
        如果 scrollHeight <= clientHeight: 不滚动
        mode === 'page':   setInterval 每 pageInterval*1000ms 滚一屏
                           scrollBy(0, clientHeight)，到底停止
        mode === 'smooth': rAF 步进，按速度 px/s 匀速 scrollBy，到底停止
        mode === 'loop':   rAF 步进，滚到底 scrollTo(0,0) 继续循环
    stop():
        清除定时器/rAF

批量播放: html 项按图片逻辑计时切换（interval），渲染走 iframe + 默认滚动参数
```

### 5. 安全说明

iframe 不加 `sandbox` 属性：sandbox 会使 iframe 变为 opaque origin，显示端无法读取
`scrollHeight` 控制滚动。媒体库文件来自本服务器、粘贴代码来自用户本人，属于同源可信内容；
`pointer-events: none` 已保证不可交互。若后续需要隔离，可改为服务端代理页包装方案。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/apps/web-mediacenter/modules/media/media-library-app-service.js` | detectMediaType 加 html |
| `src/apps/web-mediacenter/modules/media/playlist-app-service.js` | MEDIA_TYPES 加 html |
| `src/apps/web-mediacenter/ui/public/js/upload.js` | detectMediaType；html 跳过尺寸探测和裁剪预览；弹滚动设置框 |
| `src/apps/web-mediacenter/ui/public/js/media-library.js` | playMedia html 分支；「发送 HTML」对话框（工具栏入口 + 媒体库保存） |
| `src/apps/web-mediacenter/ui/public/js/websocket.js` | getMediaRatio html 返回 1；透传 htmlScroll |
| `src/apps/web-mediacenter/ui/public/js/crop.js` | showPreview html 分支（隐藏裁剪框） |
| `src/apps/web-mediacenter/ui/public/display.html` | iframe#mediaHtml + showMedia html 分支 + HtmlScrollController + playlist html 处理 |
| `src/apps/web-mediacenter/ui/public/upload.html` | 「发送 HTML」按钮；文件输入 accept 加 .html,.htm |

## 风险与注意事项

1. **iframe 同源滚动控制**：srcdoc 与同源 URL 的 iframe 均可访问 contentWindow（无 sandbox 时）；跨域 URL 的 html 文件无法控制滚动，仅静态展示
2. **粘贴代码相对资源失效**：srcdoc 无 base URL，相对路径资源（图片等）不加载；用户约定代码自包含（data: 内联）
3. **大量粘贴代码消息体积**：base64 膨胀约 33%，受 WebSocket maxPayload 限制（500MB），常规代码无影响
4. **滚动越界**：内容不足一屏时不滚动；分页滚动到底后停止，不产生空滚动

# 纯文本分页 TTS 播放实现文档

## 1. 媒体类型识别

```text
detectMediaType(name):
    ext = 去除查询串后的扩展名并转小写
    如果 ext 属于 gif: 返回 gif
    如果 ext 属于 mp4/webm/mov/avi/mkv: 返回 video
    如果 ext 属于 wav/ogg/mp3: 返回 audio
    如果 ext 属于 html/htm/mhtml: 返回 html
    如果 ext 属于 txt/md:
        返回 text
    否则返回 image

detectTextFormat(name):
    如果扩展名为 md: 返回 markdown
    如果扩展名为 txt: 返回 plain
    否则返回 null
```

控制端上传、媒体库播放和临时批量文件都必须携带：

```text
{ mediaType: "text", format: "plain|markdown", fileName, ... }
```

## 2. 播放列表

```text
PlaylistManager.MEDIA_TYPES = image/video/gif/html/audio/text

buildFromLibrary(...):
    扫描文件夹并过滤 MEDIA_TYPES
    对每个 text 文件输出:
        { url, fileName, mediaType: "text", format: detectTextFormat(fileName) }

buildFromTemp(files):
    排序后保留:
        { data, fileName, mediaType, format, mimeType }
```

## 3. 显示端文本播放器

```text
TextMediaPlayer 状态:
    source                 // URL 或 base64 文本源
    format                 // plain 或 markdown
    rawText
    pages[]                // 每页包含 html、speakText、sentences[]
    pageIndex
    sentenceIndex
    playbackId
    state                  // idle|loading|playing|paused|stopped|finished
    playlistContext        // 可选的 listId/index/total

load(data):
    stopCurrentPlayback()
    生成新的 playbackId
    如果 data.type == url:
        fetch(data.url) 并读取 text
    如果 data.type == base64:
        atob + Uint8Array + TextDecoder 解码
    format == markdown:
        使用安全 Markdown 渲染器生成 HTML
    format == plain:
        使用 textContent/等宽文本渲染
    文本页样式:
        background = "#FFF4B8"
        color = "#333333"
        code/blockquote 使用同色系稍深背景
        link 使用深蓝色
    使用 #mediaText 已完成旋转布局后的可用宽高测量并生成 pages，不在播放器再次交换宽高
    pageIndex = loadOptions.pageIndex（缺省时为 0）
    显示第 0 页
    requestPageSentences()

requestPageSentences():
    currentPage = pages[pageIndex]
    sentences = splitIntoSentences(currentPage.speakText)
    sentenceIndex = 0
    如果 sentences 为空:
        finishPage()
        返回
    state = playing
    requestNextSentence()

requestNextSentence():
    如果 state != playing 或 playbackId 已失效: 返回
    如果 sentenceIndex >= sentences.length:
        finishPage()
        返回
    通过 displayWs 发送:
        {
            type: "textSentenceTts",
            playbackId, pageIndex, sentenceIndex,
            text: sentences[sentenceIndex]
        }

handleSentenceAudio(data):
    如果 playbackId/pageIndex/sentenceIndex 不是当前状态: 丢弃
    播放 data.audioUrl
    音频 ended/error 后:
        sentenceIndex += 1
        requestNextSentence()

finishPage():
    上报 textProgress(pageIndex, pageTotal, state=playing)
    如果 pageIndex + 1 < pages.length:
        pageIndex += 1
        显示下一页
        requestPageSentences()
    否则:
        state = finished
        如果处于 playlist:
            触发 playlistNext()
        否则上报 textProgress(state=finished)

control(action):
    play: 如果已有当前 ttsAudio 则继续；如果 pause 发生在 TTS 回包前，则使用新的 playbackId 重新请求当前句
    pause: state=paused，暂停当前 ttsAudio，不清除当前页；若当前句仍在等待回包，则使旧 playbackId 与 pending 请求失效
    prev: 取消当前 playbackId，页码减一并重新请求
    next: 取消当前 playbackId，页码加一并重新请求
    stop: 取消当前 playbackId，清空音频，state=stopped，保留当前页
```

## 4. 显示端分句规则

```text
splitIntoSentences(text):
    先清理 Markdown 标记、代码围栏和列表前缀
    按现有 chat.splitIntoSentences 的中英文句末标点、换行和长度规则切分
    删除空句
    返回有序句子数组
```

实现时将现有分句规则抽取为浏览器和服务端均可加载的纯函数定义，避免两端各写一套规则。

## 5. 单句 TTS WebSocket

### 显示端 → 服务端

```text
textSentenceTts:
    displayId 由当前显示端连接确定
    校验 text 非空、长度在服务器 WebSocket 文本限制内
    按 playbackId 建立当前请求上下文
    调用 tts.generateTTS(text)
```

### 服务端 → 显示端

```text
tts/playAudio:
    {
        type: "tts",
        action: "playAudio",
        audioUrl,
        text,
        textPlayback: true,
        playbackId,
        pageIndex,
        sentenceIndex
    }
```

服务端生成失败时发送：

```text
{
    type: "textSentenceTtsError",
    playbackId,
    pageIndex,
    sentenceIndex,
    message
}
```

显示端收到失败消息后跳过当前句，继续下一句。

## 6. 批量播放状态

```text
playlistState:
    listId
    playlist[]
    index
    state
    currentTextPage
    currentTextPageTotal
    currentTextSentence
```

文本项进入 `playCurrentItem()` 时：

```text
如果 item.mediaType == text:
    stopPreviousMedia()
    TextMediaPlayer.load(item)
    TextMediaPlayer.attachPlaylist({listId, index, total})
    文本播放器最后一页完成 → playlistNext()
否则沿用 image/video/gif/html/audio 分支
```

`playlistProgress` 在原有字段上增加：

```text
pageIndex, pageTotal, sentenceIndex, sentenceTotal, format
```

服务端持久化非临时列表时保存当前 `index/state/currentTextPage`；重连后恢复文本项和页码，语音从当前页第一句重新开始。

## 7. 控制端动作

```text
单文档 textPlayback:
    { type: "control", action: "textPlayback",
      value: { action: "play|pause|prev|next|stop" } }

服务端:
    记录必要的 text state
    原样转发到目标显示端

控制端收到 textProgress 或 playlistProgress:
    更新页码、句子状态、按钮文案
```

批量级 `playlistControl(prev/next/stop/toggle)` 继续使用原协议；若当前项为 text，显示端先清理文本播放器再执行列表动作。

## 8. 文本模式设置

控制端沿用 HTML 模式设置面板的交互方式：

```text
Controls.showTextModePanel():
    显示文本模式弹窗
    提供:
        fontSize = auto|small|medium|large
        lineHeight = compact|normal|loose
        pageMargin = small|normal|large
    主题固定默认:
        background = "#FFF4B8"
        color = "#333333"
    点击应用:
        sendControl("textStyle", {
            background, color, fontSize, lineHeight, pageMargin
        })

显示端 handleControl(textStyle):
    合并 textStyle 到 currentTextStyle
    应用背景、文字、字体、行距和页边距
    重新测量文本页并生成 pages[]
    保留当前页对应的内容位置
    上报新的 textProgress(pageIndex, pageTotal)
```

```text
Markdown 分页:
    先按可量测的源行或渲染子节点贪心组页
    单个长段、列表或代码行超过一页时按量测文本片段继续拆分
    页面尺寸变化或 rotate 完成布局后重新分页
    使用当前页首段文本作为锚点恢复 pageIndex
```

默认样式参数：

```text
currentTextStyle = {
    background: "#FFF4B8",
    color: "#333333",
    fontSize: "auto",
    lineHeight: "normal",
    pageMargin: "normal"
}
```

`textStyle` 保存到当前显示端状态，显示端重连恢复时先恢复样式再执行文本分页；页码优先从 `currentTextProgress` 恢复，旧状态缺少该字段时回退 `currentMediaProgress`。

## 9. 错误处理与资源清理

```text
stopCurrentPlayback():
    playbackId = 新值
    清空 textSentenceQueue
    暂停并重置 ttsAudio
    移除 ended/error 监听
    清理未完成的 fetch/请求标记

过期回包:
    playbackId/pageIndex/sentenceIndex 任一不匹配 → 直接丢弃

文本解析失败:
    显示错误提示页并上报 textProgress(state=failed)

TTS 单句失败:
    记录日志
    跳过当前句
    继续下一句
```

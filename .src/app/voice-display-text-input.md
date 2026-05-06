#skill: ai-code-translation

# voice-display-node 文本输入功能

## 已有声明

```
SubDisplayTUI._initScreen       // TUI 屏幕初始化
SubDisplayTUI.logBox             // 日志显示区域（占屏幕 65%-2，带边框）
SubDisplayTUI._bindScrollKeys    // 现有键盘绑定（上下翻页滚动日志）
VoiceDisplay.sendVoiceInput      // 发送 voiceInput 消息到服务端
```

## 新增定义

```
ChatInputBar {
  inputBox: blessed.textarea     // 屏幕底部输入行
  keyboardMode: 'browse'|'input' // 键盘模式：浏览/输入
  onSendText: function           // 发送文本的回调
}
```

## 操作流程

### 1. TUI 新增底部输入栏

```
initChatInputBar(onSendCallback):
  onSendText ← onSendCallback  // 保存发送回调
  inputBox ← new blessed.textarea({
    bottom: 0, left: 0, width: '100%', height: 1,
    placeholder: "输入文本后 Enter 发送 (Tab 切换焦点)",
    inputOnFocus: true,
    style: { bg: 'blue', fg: 'white', focus: { bg: 'green', fg: 'black' } }
  })
  screen.append(inputBox)
```

### 2. 布局微调

```
adjustLayout:
  logBox.height ← '65%-3'       // 原为 '65%-2'，为输入栏腾出 1 行空间
```

### 3. Tab 切换焦点模式

```
onTabPress:
  if keyboardMode == 'browse':
    keyboardMode ← 'input'
    inputBox.focus()
    screen.render()
  else:
    keyboardMode ← 'browse'
    logBox.focus()
    screen.render()
```

### 4. Enter 发送文本

```
onEnterPress:
  if keyboardMode == 'input':
    text ← inputBox.getValue().trim()
    if text.length > 0:
      onSendText(text)           // 调用 VoiceDisplay.sendVoiceInput
      log("语音输入", "键盘输入: " + text)
    inputBox.clearValue()
    screen.render()
```

### 5. Esc/Shift+Tab 回到浏览模式

```
onEscPress:
  if keyboardMode == 'input':
    keyboardMode ← 'browse'
    logBox.focus()
    screen.render()
```

### 6. 输入框聚焦时加前缀

```
onInputBoxFocus:
  inputBox.setContent("> ")
  inputBox.setValue("> ")        // 设置视觉前缀
```

### 7. 输入框失焦时清前缀

```
onInputBoxBlur:
  value ← inputBox.getValue()
  if value == "> ":
    inputBox.clearValue()
```

## 注意事项

- tui.js 中只新增方法，不修改现有方法签名
- main.js 创建 TUI 后调用 initChatInputBar，传入 sendVoiceInput 的 bind
- 输入框在未聚焦时显示 placeholder 占位符
- 保持现有 q/C-c 退出绑定不变
- q 键仅在 browse 模式下退出，input 模式下 q 不生效（防止误退出）

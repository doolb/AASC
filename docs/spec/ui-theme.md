# 控制端主题与 UI 控件分类实现文档

## 主题管理伪代码

```text
UiTheme:
    themes = [dark, light, warm, pink, lavender-yellow, red-blue, gold, mint, ocean, forest, slate, algae-salt, girl-pink, rose-gold, new-year-red]
    storageKey = controlTheme
    serverEndpoint = /api/config/controlTheme
    ready = Promise.resolve()

    init():
        theme = readTheme()
        apply(theme, persistServer = false)
        bindThemeSelector()
        classify(document)
        observeDynamicNodes()
        ready = loadServerTheme()
        return ready

    readTheme():
        try:
            saved = localStorage.getItem(storageKey)
            if saved 在 themes 中:
                return saved
        catch:
            记录警告
        return dark

    loadServerTheme():
        try:
            response = await fetch(serverEndpoint)
            payload = await response.json()
            if response.ok 且 payload.status == success 且 payload.theme 在 themes 中:
                apply(payload.theme, persistServer = false)
        catch:
            保留本地已应用主题，不阻断控制端初始化

    apply(theme, persistServer = true):
        normalized = theme 在 themes 中 ? theme : dark
        document.documentElement.dataset.theme = normalized
        document.documentElement.dataset.themeMode = normalized == dark ? dark : light
        themeSelector.value = normalized
        save localStorage as compatibility cache
        if persistServer:
            persistServerTheme(normalized)

    persistServerTheme(theme):
        if fetch 不可用:
            return
        asynchronously POST { theme } to serverEndpoint
        request failure only records warning, does not rollback visible theme

    bindThemeSelector():
        themeSelector.change -> apply(themeSelector.value, persistServer = true)
```

## 控件分类伪代码

```text
classify(root):
    button -> data-ui-type = button
    nav-item -> data-ui-type = navigation
    input[type=text] -> data-ui-type = text
    input[type=number] -> data-ui-type = number
    input[type=time] -> data-ui-type = time
    input[type=password] -> data-ui-type = password
    input[type=file] -> data-ui-type = file
    input[type=radio] -> data-ui-type = radio
    input[type=checkbox] -> crop-debug-toggle -> switch, otherwise checkbox
    input[type=range] -> data-ui-type = slider
    select -> data-ui-type = select
    textarea -> data-ui-type = textarea
    h1..h6 -> data-ui-type = title
    known hint/status/modal/toast classes -> corresponding semantic type

MutationObserver:
    new nodes -> classify(new node)
```

## 样式伪代码

```text
:root / [data-theme=dark] / [data-theme=light] / [data-theme=warm] / [data-theme=pink]
    / [data-theme=lavender-yellow] / [data-theme=red-blue] / [data-theme=gold]
    / [data-theme=mint] / [data-theme=ocean] / [data-theme=forest] / [data-theme=slate]
    / [data-theme=algae-salt] / [data-theme=girl-pink] / [data-theme=rose-gold]
    / [data-theme=new-year-red]:
    定义背景、卡片、文字、边框、强调色、成功色、危险色和阴影变量

[data-theme-mode=light]:
    所有非深色主题复用浅色控件、卡片、弹窗和内容区域的对比度规则
    按钮渐变使用 accent-secondary 到 accent-color 的主题变量

[data-ui-type]:
    使用语义变量绘制控件

动态弹窗、任务面板、媒体库、聊天和 Toast:
    使用继承的主题变量
    不改变既有交互回调和业务数据

显示端临时响应弹窗旋转:
    popupSelector = voice-response-popup, voice-confirm-popup, search-result-popup, play-choices-popup, reminder-popup
    getRotationPopupElements() -> querySelectorAll(popupSelector)
    applyRotationPopupLayout(layout):
        maxWidth = max(layout.layoutWidth - layout.margin * 2, 1)
        maxHeight = max(layout.layoutHeight - layout.margin * 2, 1)
        popup.maxWidth = maxWidth
        popup.maxHeight = maxHeight
        popup.transform = translate(-50%, -50%) rotate(currentRotation deg)
    applyRotation():
        applyRotationPopupLayout(getRotationLayout())
    show popup:
        append popup
        applyRotationPopupLayout(getRotationLayout())

浅色主题兼容旧文字:
    为任务确认标题、任务名称、媒体库/聊天弹窗标题等高优先级文字设置 text-primary
    为旧组件的辅助文字设置 text-secondary
    为下拉选项设置浅色背景和 text-primary
    匹配动态 HTML 内联的 #fff 和白色 rgba 文字，并排除按钮文字
    任务确认框使用浅色表面背景

卡片和弹窗背景:
    定义 card-background 语义变量
    深色主题的 card-background 和 bg-surface-strong 保持原有半透明效果
    浅色主题的 card-background 和 bg-surface-strong 均使用 #eaf4ff
    卡片、内容分组、任务面板和媒体库条目使用 card-background
    modal-content、playlist-settings-dialog、task-confirm-box 等弹窗使用 bg-surface-strong

内容区域对比度:
    定义 content-background 语义变量
    浅色主题将设备列表、聊天消息列表和日志内容区设置为 content-background
    显示设备名、助手消息、普通日志消息使用 text-primary
    辅助信息使用 text-secondary
    用户消息、错误/警告日志和按钮继续保留对应强调色

浅色主题开关与路由选中态:
    input[type=checkbox] 和 input[type=radio] 使用 accent-color
    crop-debug-toggle 关闭时使用 bg-secondary 轨道、border-color 边框和 text-muted 滑块
    crop-debug-toggle 选中时使用 accent-color 轨道和白色滑块，悬停时使用 accent-secondary
    Settings.updateUI(type, value) 为对应 LLM 按钮设置 active = value == llm
    Settings.updateUI(type, value) 为对应系统按钮设置 active = value == system
    浅色主题下 routing-grid 中未选中按钮使用 bg-secondary/text-secondary/border-color
    浅色主题下 routing-grid 中选中按钮使用 accent-secondary 到 accent-color 渐变、白字和强调色外框
    保留路由按钮的现有 ID、data-routing、data-value、点击事件和深色内联背景兼容

显示控制状态控件:
    panel-display 内 data-fit 非 active 按钮使用 bg-secondary/text-secondary/border-color
    panel-display 内 data-fit active 按钮使用 accent-secondary 到 accent-color 渐变和强调色外框
    panel-display 内 data-rotation 非 active 按钮使用浅色中性样式，active 按钮使用强调色样式
    panel-display 内 centerResizeBtn 根据 active 使用中性/强调色样式
    panel-display 内 playPauseBtn.playing 使用 success-color，playPauseBtn.paused 使用 danger-color
    floating-control-panel 内 data-fit 与播放按钮复用相同的浅色状态规则
    不修改 Controls、Crop、FloatingControl 的状态计算和 WebSocket 控制消息

其他状态按钮:
    AsrDevice.updateUI() 为 data-asr=server/display 按钮同步 active
    TtsDevice.updateUI() 为 data-tts=server/display 按钮同步 active
    Tts.toggleAutoTts() 为 autoTtsBtn 同步 active = autoTtsEnabled
    Controls.updateTextPlaybackStatus() 为主面板文本按钮同步 playing/paused
    FloatingControl.updateTextPlaybackStatus() 为浮动文本按钮同步 playing/paused
    MediaLibrary.updatePlaylistProgress() 为主面板和浮动批量播放按钮同步 playing/paused
    data-selection-mode、selection-mode-btn、log-filter-btn、task-btn-option、chat-tab 等现有 active 状态复用统一浅色状态表现
    已选中项使用 accent-color/accent gradient；未选中项使用 bg-secondary/text-secondary/border-color
    不为纯导航 active、弹窗 active、媒体条目 active 强行套用按钮状态，保留各自布局和语义样式
```

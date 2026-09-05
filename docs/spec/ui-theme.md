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

    applyRemoteTheme(theme):
        apply(theme, persistServer = false)
```

## 显示端主题同步伪代码

```text
DisplayTheme:
    reuse UiTheme from ui-theme.js
    init():
        UiTheme.init()

    onWebSocketMessage(data):
        if data.type == controlThemeChanged:
            UiTheme.applyRemoteTheme(data.theme)

主题预览器:
    主题选择框旁的 preview button -> UiTheme.showPreview(selector.value)
    保存当前 documentElement 的 data-theme/data-theme-mode
    documentElement 临时应用待预览主题，不调用 apply，不写 localStorage，不发送 POST
    创建 theme-preview-modal，展示 section/control-item/button/switch/slider/input/select/text/tip/status/chat/log/popup 样例
    点击关闭按钮、遮罩或按 Escape -> 删除 theme-preview-modal，恢复原 data-theme/data-theme-mode

Server controlTheme update:
    validate theme in CONTROL_THEMES
    persist ui.controlTheme
    broadcast { type: controlThemeChanged, theme } to display clients
    display connection -> send current { type: controlThemeChanged, theme }
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

显示端样式:
    html, body, mediaContainer 和 mediaSleepOverlay background -> 固定 #000，作为媒体画布底色，不随主题变化
    waitingMessage and fixed status text -> text-primary/text-secondary
    mediaText background -> card-background, text -> text-primary
    response/confirm/search/play/reminder popup background -> bg-secondary
    popup border/accent/shadow -> accent-color/success-color/shadow-color
    image, video, iframe and iframe internal content -> keep original content and styles

媒体画布与主题 UI 边界:
    媒体画布未被图片、视频或网页内容覆盖的区域保持黑色
    主题切换只更新显示端 UI 控件和文本媒体的主题变量
    不把 bg-primary 主题变量应用到 html/body/mediaContainer，避免浅色主题改变媒体底色

显示端时间文本:
    #timeDisplay 和 #fileNameDisplay 文字颜色 -> 固定旧版白色
    #timeDisplay 和 #fileNameDisplay text-shadow -> 固定旧版黑色阴影
    #timeDisplay 和 #fileNameDisplay 正下方 2px 无模糊文字投影 -> accent-color，优先使用 65% 透明度的 color-mix 并保留纯色回退
    主题切换只更新主题色投影，不改变文字、黑色阴影、旋转和定位行为

显示端不透明表面:
    connectionStatus、mediaText、voiceStatus、voiceTextDisplay、task-status 和各类临时弹窗背景 -> bg-secondary
    不直接使用深色主题中为控制端组件设计的半透明 bg-surface-strong/card-background
    iframe 网页和图片/视频节点保持原内容，不添加主题滤镜

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

基础主题色与控件继承:
    根节点变量作为页面颜色的唯一来源，body 设置 text-primary 作为默认文字色
    modal-content、feature-name、browser-detail 和 tree-node 默认继承父级文字颜色
    辅助文字使用 text-secondary 或 text-muted，禁止普通文字固定使用 #fff、#888 或白色 rgba
    device-tree、browser-detail、feature-item 和树状容器使用 content-background、bg-surface 或 bg-surface-strong
    tree-setting-select、tree-capability-select、tree-event-input 和滑条使用 input-background/text-primary/border-color
    在线、错误、支持/不支持、选中和危险操作保留 success-color/danger-color/accent-color 等语义例外
    新增控件优先继承父级文字和基础控件颜色，不新增单个主题的硬编码覆盖

网页主题规则:
    根节点主题变量提供网页颜色，组件只表达语义，不直接决定具体色值
    普通文字、标题、字段值 -> text-primary
    辅助文字、节点 ID、字段标签、提示 -> text-secondary 或 text-muted
    卡片和区块 -> card-background 或 bg-surface
    输入控件 -> input-background/text-primary/border-color
    边框和阴影 -> border-color/shadow-color
    在线、离线、错误、成功、危险、选中和按钮前景色 -> 允许 success-color/danger-color/accent-color 或按钮专用前景色
    普通网页文字禁止固定使用 #fff、#888、白色 rgba 或仅适用于深色主题的背景值
    主题切换只更新主题变量和组件外观，不改变业务数据、路由、事件处理和媒体内容

服务器节点列表主题:
    server-card background -> card-background
    server-card border -> border-color
    server-card-header h3 and server-card-details dd -> text-primary
    server-card-id、server-card-details dt、server-list-status、共享媒体库辅助摘要 -> text-secondary 或 text-muted
    server-current-label、server-unavailable-label -> text-secondary
    server-status-online -> success-color 语义色
    server-status-offline -> danger-color 语义色
    server-switch-toolbar input -> input-background/text-primary/border-color
    server-connect-btn -> 保留按钮自身前景色，不套用普通文字颜色
    禁止服务器节点列表普通文字使用固定 #fff 或白色 rgba

卡片和弹窗背景:
    定义 card-background 语义变量
    深色主题的 card-background 和 bg-surface-strong 保持原有半透明效果
    浅色主题的 card-background 使用主题浅蓝色，bg-surface-strong 保持弹窗表面语义
    浅色主题的 .section 大容器使用略微调深后的 bg-surface，避免大面积近白背景
    .control-item 小控件卡片、任务面板和媒体库条目使用 card-background
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

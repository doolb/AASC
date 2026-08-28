# 控制端主题与 UI 控件分类实现文档

## 主题管理伪代码

```text
UiTheme:
    themes = [dark, light, warm, pink, lavender-yellow, red-blue, gold, mint, ocean, forest, slate, algae-salt, girl-pink]
    storageKey = controlTheme

    init():
        theme = readTheme()
        apply(theme)
        bindThemeSelector()
        classify(document)
        observeDynamicNodes()

    readTheme():
        try:
            saved = localStorage.getItem(storageKey)
            if saved 在 themes 中:
                return saved
        catch:
            记录警告
        return dark

    apply(theme):
        normalized = theme 在 themes 中 ? theme : dark
        document.documentElement.dataset.theme = normalized
        document.documentElement.dataset.themeMode = normalized == dark ? dark : light
        themeSelector.value = normalized
        try:
            localStorage.setItem(storageKey, normalized)
        catch:
            记录警告但不阻断页面

    bindThemeSelector():
        themeSelector.change -> apply(themeSelector.value)
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
    / [data-theme=algae-salt] / [data-theme=girl-pink]:
    定义背景、卡片、文字、边框、强调色、成功色、危险色和阴影变量

[data-theme-mode=light]:
    所有非深色主题复用浅色控件、卡片、弹窗和内容区域的对比度规则
    按钮渐变使用 accent-secondary 到 accent-color 的主题变量

[data-ui-type]:
    使用语义变量绘制控件

动态弹窗、任务面板、媒体库、聊天和 Toast:
    使用继承的主题变量
    不改变既有交互回调和业务数据

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
```

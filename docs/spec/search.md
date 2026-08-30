# 搜索页签功能规格

## 概述

控制端新增搜索页签，用于显示和管理语音搜索历史记录，支持手动搜索、播放、删除、清空操作。

## 布局结构

```
┌─────────────────────────────────────────────────────────┐
│  搜索页签 (panel-search)                                 │
│  ┌─────────────────────────────────────────────────────┐│
│  │ 搜索输入区                                          ││
│  │ [输入搜索关键词...] [搜索]                           ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │ 搜索历史列表                                        ││
│  │ ┌─────────────────────────────────────────────────┐ ││
│  │ │ [时间] 关键词 - 前五条结果摘要      [播放][删除]  │ ││
│  │ └─────────────────────────────────────────────────┘ ││
│  │ ┌─────────────────────────────────────────────────┐ ││
│  │ │ [时间] 关键词 - 前五条结果摘要      [播放][删除]  │ ││
│  │ └─────────────────────────────────────────────────┘ ││
│  │                    [清空历史]                       ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

## HTML 结构

```html
<section class="panel" id="panel-search" style="display:none;">
    <h1 class="page-title">搜索</h1>
    
    <div class="section">
        <h2>手动搜索</h2>
        <div class="search-input-group">
            <input type="text" id="searchInput" placeholder="输入搜索关键词">
            <button onclick="Search.performSearch()">搜索</button>
        </div>
    </div>
    
    <div class="section">
        <div class="search-history-header">
            <h2>搜索历史</h2>
            <button class="clear-btn" onclick="Search.clearHistory()">清空历史</button>
        </div>
        <div class="search-history-list" id="searchHistoryList">
            <div class="empty-list">暂无搜索记录</div>
        </div>
    </div>
</section>
```

## JavaScript 模块

### Search 模块 (public/js/search.js)

```
const Search = {
    history: [],
    
    init():
        调用 loadHistory()
        调用 render()
        绑定回车键搜索事件
    
    loadHistory():
        如果 WebSocket 已连接:
            发送 { type: 'getSearchHistory' }
        否则:
            延迟 500ms 后重试
    
    setHistory(history):
        设置 this.history = history
        调用 render()
    
    async performSearch():
        获取搜索关键词
        如果关键词为空:
            显示提示 "请输入搜索关键词"
            返回
        
        发送搜索请求到服务端:
            发送 { type: 'voiceCommand', displayId: currentDisplayId || null, text: '搜索' + keyword }
        清空输入框
        显示加载提示
    
    playResult(id):
        如果没有选择显示端:
            显示提示 "请先选择显示端"
            返回
        查找对应的历史记录
        如果存在:
            将前 3 条结果分别交给通用 TTS 播放
    
    deleteItem(id):
        发送 { type: 'deleteSearchHistory', id }
    
    clearHistory():
        显示确认对话框
        如果确认:
            发送 { type: 'clearSearchHistory' }
    
    render():
        获取 searchHistoryList 容器
        如果 history 为空:
            显示 "暂无搜索记录"
        否则:
            遍历 history 生成列表项
            每项包含: 时间、关键词、前五条结果、播放按钮、删除按钮
    
    formatTime(timestamp):
        格式化时间戳为可读字符串
        返回 "MM-DD HH:mm"
}
```

### WebSocket 消息处理更新

在 `public/js/websocket.js` 中添加:

```
handleMessage(data):
    ...
    如果 data.type === 'searchHistory':
        如果 window.Search 存在:
            调用 window.Search.setHistory(data.history)
```

### main.js 初始化更新

```
App.init():
    ...
    如果 window.Search 存在:
        调用 window.Search.init()
```

## CSS 样式

```css
.search-input-group {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
}

.search-input-group input {
    flex: 1;
    padding: 10px 15px;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-size: 14px;
}

.search-input-group button {
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    background: linear-gradient(135deg, #00d2ff, #3a7bd5);
    color: #fff;
    cursor: pointer;
}

.search-history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
}

.search-history-header h2 {
    margin: 0;
}

.clear-btn {
    padding: 5px 15px;
    border: none;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    font-size: 12px;
}

.clear-btn:hover {
    background: rgba(255, 107, 107, 0.3);
}

.search-history-list {
    max-height: 500px;
    overflow-y: auto;
}

.search-history-item {
    display: flex;
    align-items: flex-start;
    padding: 12px;
    margin-bottom: 10px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    gap: 10px;
}

.search-history-item .time {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    min-width: 80px;
}

.search-history-item .content {
    flex: 1;
}

.search-history-item .keyword {
    font-weight: 500;
    color: #00d2ff;
    margin-bottom: 5px;
}

.search-history-item .result {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
}

.search-history-item .actions {
    display: flex;
    gap: 5px;
}

.search-history-item .action-btn {
    padding: 5px 10px;
    border: none;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    font-size: 12px;
}

.search-history-item .action-btn:hover {
    background: rgba(255, 255, 255, 0.2);
}

.search-history-item .action-btn.delete:hover {
    background: rgba(255, 107, 107, 0.3);
}
```

## 数据结构

### 搜索历史项

```javascript
{
    id: string,          // 唯一标识
    query: string,       // 搜索关键词
    results: [{          // 最多五条搜索结果
        type: string,    // 'first_result' | 'ai_answer' | 'error'
        title: string,   // 结果标题
        snippet: string, // 结果摘要
        link: string     // 结果链接
    }],
    timestamp: number    // 搜索时间戳
}
```

搜索数量配置:

```javascript
{
    fetchLimit: 10,    // Bing 解析数量
    displayLimit: 5,   // 频道、历史和弹窗展示数量
    ttsLimit: 3        // 语音播报数量
}
```

## 服务端接口

已有接口 (无需修改):

| 类型 | 方向 | 说明 |
|------|------|------|
| getSearchHistory | 控制端 -> 服务端 | 获取搜索历史 |
| clearSearchHistory | 控制端 -> 服务端 | 清空搜索历史 |
| deleteSearchHistory | 控制端 -> 服务端 | 删除单条记录 |
| searchHistory | 服务端 -> 控制端 | 返回搜索历史 |

## 侧边栏更新

在侧边栏导航中添加搜索页签入口:

```html
<button class="nav-item" data-target="search" title="搜索">
    <span class="nav-icon">🔍</span>
    <span class="nav-text">搜索</span>
</button>
```

## 交互流程

1. **查看历史**: 进入搜索页签自动加载搜索历史
2. **手动搜索**: 输入关键词点击搜索，发送到服务端执行
3. **播放结果**: 点击播放按钮，TTS 播放对应搜索记录的结果摘要
4. **删除记录**: 点击删除按钮，删除单条记录
5. **清空历史**: 点击清空按钮，清空所有记录

## 搜索频道与 Pi Agent 隔离

```text
handleSearchRequest(query, route, sourceDisplayId):
    requestId = 生成唯一请求号
    广播 searchChannel({ requestId, query, status: 'started', timestamp })
    先触发通用语音播报“正在搜索${query}”

    如果 route == 'system':
        调用 performSearch(query)
        保存到 search-history.json
        广播 searchHistory(最新历史)
        广播 searchChannel({ requestId, status: 'completed', result })
        显示端继续收到搜索结果弹窗和结果 TTS

    如果 route == 'llm' 且当前 profile 是 Pi Agent:
        创建唯一临时 Pi 会话
        只发送当前搜索内容和搜索系统提示词
        不调用普通 handleChatMessage
        不发送 chatInput/chatChunk/chatResponse
        将 Pi 流式内容映射为 searchChannel 更新
        完成、失败或超时后关闭临时 Pi 会话
        广播 searchChannel({ requestId, status: 'completed' | 'failed' })
```

### 搜索频道消息

```javascript
{
    type: 'searchChannel',
    requestId: string,
    query: string,
    status: 'started' | 'running' | 'completed' | 'failed',
    content: string,
    result: object | null,
    error: string | null,
    timestamp: number
}
```

### 历史刷新约束

```text
收到 searchHistory:
    Search.setHistory(data.history)
    Chat.searchHistory = data.history
    Chat.renderSearchHistory()

Search.render():
    使用实际存在的 searchHistoryList 容器
    容器不存在时只记录兼容性日志，不丢弃内存历史
```

### 一次性 Pi 会话

```text
PiRuntimeManager.chatStream(..., { ephemeral: true, conversationKey }):
    使用唯一 conversationKey 创建独立 Pi 进程
    不读取既有群聊/私聊 Pi 内存上下文
    请求完成或抛错后 finally:
        terminateSession(key)
        从 sessions 删除 key
```

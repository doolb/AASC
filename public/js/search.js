const Search = {
    history: [],
    
    init() {
        this.loadHistory();
        this.bindEvents();
    },
    
    bindEvents() {
        const input = document.getElementById('searchInput');
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }
    },
    
    loadHistory() {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getSearchHistory'
            }));
        } else {
            setTimeout(() => this.loadHistory(), 500);
        }
    },
    
    setHistory(history) {
        this.history = history || [];
        this.render();
    },
    
    performSearch() {
        const input = document.getElementById('searchInput');
        const keyword = input ? input.value.trim() : '';
        
        if (!keyword) {
            if (window.showToast) {
                window.showToast('请输入搜索关键词', 'warning');
            }
            return;
        }
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'voiceCommand',
                displayId: window.currentDisplayId || null,
                text: `搜索${keyword}`
            }));
            
            if (window.showToast) {
                window.showToast(`正在搜索: ${keyword}`, 'loading');
            }
            
            input.value = '';
        }
    },
    
    playResult(id) {
        const item = this.history.find(h => h.id === id);
        if (!item) return;
        
        if (!window.currentDisplayId) {
            if (window.showToast) {
                window.showToast('请先选择显示端', 'error');
            }
            return;
        }
        
        let text = '';
        if (item.results && item.results.snippet) {
            text = item.results.snippet;
        } else if (item.results && item.results.title) {
            text = item.results.title;
        } else {
            text = `搜索${item.query}，未找到相关结果`;
        }
        
        if (window.WebSocketManager && window.currentDisplayId) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'tts',
                displayId: window.currentDisplayId,
                action: 'play',
                text: text
            }));
            
            if (window.showToast) {
                window.showToast('正在播放搜索结果', 'success');
            }
        }
    },
    
    deleteItem(id) {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'deleteSearchHistory',
                id: id
            }));
            
            if (window.showToast) {
                window.showToast('已删除', 'success');
            }
        }
    },
    
    clearHistory() {
        if (this.history.length === 0) {
            if (window.showToast) {
                window.showToast('暂无搜索记录', 'info');
            }
            return;
        }
        
        if (!confirm('确定要清空所有搜索历史吗？')) {
            return;
        }
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'clearSearchHistory'
            }));
            
            if (window.showToast) {
                window.showToast('已清空搜索历史', 'success');
            }
        }
    },
    
    render() {
        const container = document.getElementById('searchHistoryList');
        if (!container) return;
        
        if (this.history.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无搜索记录</div>';
            return;
        }
        
        const html = this.history.map(item => {
            const time = this.formatTime(item.timestamp);
            const resultText = item.results && item.results.snippet 
                ? item.results.snippet 
                : (item.results && item.results.title ? item.results.title : '无结果');
            
            return `
                <div class="search-history-item">
                    <div class="time">${time}</div>
                    <div class="content">
                        <div class="keyword">${this.escapeHtml(item.query)}</div>
                        <div class="result">${this.escapeHtml(resultText)}</div>
                    </div>
                    <div class="actions">
                        <button class="action-btn" onclick="Search.playResult('${item.id}')" title="播放结果">播放</button>
                        <button class="action-btn delete" onclick="Search.deleteItem('${item.id}')" title="删除">删除</button>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = html;
    },
    
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${month}-${day} ${hours}:${minutes}`;
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

window.Search = Search;

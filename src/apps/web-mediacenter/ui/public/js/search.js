const Search = {
    history: [],
    channelEntries: [],
    
    init() {
        this.loadHistory();
        this.bindEvents();
        this.render();
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

    handleChannel(data) {
        if (!data || !data.requestId) return;
        const index = this.channelEntries.findIndex(item => item.requestId === data.requestId);
        const entry = {
            ...(index >= 0 ? this.channelEntries[index] : {}),
            ...data
        };
        if (index >= 0) {
            this.channelEntries[index] = entry;
        } else {
            this.channelEntries.unshift(entry);
        }
        this.channelEntries = this.channelEntries.slice(0, 20);
        this.renderChannel();
    },

    normalizeResults(results) {
        if (Array.isArray(results)) return results;
        return results ? [results] : [];
    },

    formatResultText(result) {
        if (!result) return '无结果';
        if (result.type === 'ai_answer') return result.content || '无结果';
        if (result.type === 'first_result') {
            return [result.title, result.snippet].filter(Boolean).join('：');
        }
        return result.message || '无结果';
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
        
        const results = this.normalizeResults(item.results);
        const text = results.length > 0
            ? results.slice(0, 3).map(result => this.formatResultText(result)).join('。')
            : `搜索${item.query}，未找到相关结果`;
        
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
        this.renderChannel();
        if (!container) return;
        
        if (this.history.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无搜索记录</div>';
            return;
        }
        
        const html = this.history.map(item => {
            const time = this.formatTime(item.timestamp);
            const resultList = this.normalizeResults(item.results);
            const resultHtml = resultList.map((result, index) =>
                `<div>${index + 1}. ${this.escapeHtml(this.formatResultText(result))}</div>`
            ).join('') || '<div>无结果</div>';
            
            return `
                <div class="search-history-item">
                    <div class="time">${time}</div>
                    <div class="content">
                        <div class="keyword">${this.escapeHtml(item.query)}</div>
                        <div class="result">${resultHtml}</div>
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

    renderChannel() {
        const container = document.getElementById('searchChannelList');
        if (!container) return;
        if (this.channelEntries.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无搜索任务</div>';
            return;
        }

        container.innerHTML = this.channelEntries.map(item => {
            const statusLabels = {
                started: '搜索中',
                running: '搜索中',
                completed: '已完成',
                failed: '失败'
            };
            const status = statusLabels[item.status] || item.status || '未知';
            const resultList = this.normalizeResults(item.result);
            const resultHtml = resultList.length > 0
                ? resultList.map((result, index) =>
                    `<div>${index + 1}. ${this.escapeHtml(this.formatResultText(result))}</div>`
                ).join('')
                : this.escapeHtml(item.content || item.error || '');
            return `
                <div class="search-channel-item status-${this.escapeHtml(item.status || 'unknown')}">
                    <div class="search-channel-header">
                        <span class="search-channel-status">${this.escapeHtml(status)}</span>
                        <span class="search-channel-time">${this.formatTime(item.timestamp)}</span>
                    </div>
                    <div class="search-channel-query">${this.escapeHtml(item.query || '')}</div>
                    <div class="search-channel-content">${resultHtml}</div>
                </div>
            `;
        }).join('');
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

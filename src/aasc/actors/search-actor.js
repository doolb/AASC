const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');
const path = require('path');
const fs = require('fs');

const SEARCH_HISTORY_FILE = path.join(__dirname, '../../config/search-history.json');

class SearchActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'search-handler',
      capabilities: [
        {
          id: 'web-search',
          name: '网络搜索',
          category: CapabilityCategory.PROFESSIONAL,
          level: CapabilityLevel.L3,
          securityLevel: 0,
          description: '网络搜索能力，支持搜索引擎查询'
        },
        {
          id: 'search-history',
          name: '搜索历史',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L1,
          securityLevel: 0,
          description: '搜索历史管理能力'
        }
      ],
      subscriptions: [MessageTopic.SYSTEM, 'search'],
      ...options
    });

    this.searchHistory = [];
    this.maxHistorySize = options.maxHistorySize || 50;
    this._loadHistory();
  }

  _loadHistory() {
    try {
      if (fs.existsSync(SEARCH_HISTORY_FILE)) {
        const data = fs.readFileSync(SEARCH_HISTORY_FILE, 'utf8');
        this.searchHistory = JSON.parse(data);
        console.log(`[SearchActor] 已加载 ${this.searchHistory.length} 条搜索记录`);
      }
    } catch (err) {
      console.error('[SearchActor] 加载搜索历史失败:', err.message);
      this.searchHistory = [];
    }
  }

  _saveHistory() {
    try {
      const dir = path.dirname(SEARCH_HISTORY_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(SEARCH_HISTORY_FILE, JSON.stringify(this.searchHistory, null, 2), 'utf8');
    } catch (err) {
      console.error('[SearchActor] 保存搜索历史失败:', err.message);
    }
  }

  async onInit() {
    this.registerHandler('search', this.handleSearch.bind(this));
    this.registerHandler('search.query', this.handleQuery.bind(this));
    this.registerHandler('search.history', this.handleHistory.bind(this));
    this.registerHandler('search.history.clear', this.handleClearHistory.bind(this));
    this.registerHandler('search.history.delete', this.handleDeleteHistoryItem.bind(this));
  }

  async handleSearch(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'query':
        return this.handleQuery(message);
      case 'history':
        return this.handleHistory(message);
      case 'history.clear':
        return this.handleClearHistory(message);
      case 'history.delete':
        return this.handleDeleteHistoryItem(message);
      default:
        return this.handleQuery(message);
    }
  }

  async handleQuery(message) {
    const { query } = message.payload.data || message.payload;
    
    if (!query) {
      return { success: false, error: 'Search query is required' };
    }

    try {
      const results = await this._performSearch(query);
      
      const historyItem = {
        id: Date.now().toString(),
        query: query,
        results: results,
        timestamp: Date.now()
      };
      
      this.searchHistory.unshift(historyItem);
      if (this.searchHistory.length > this.maxHistorySize) {
        this.searchHistory = this.searchHistory.slice(0, this.maxHistorySize);
      }
      this._saveHistory();
      
      return { 
        success: true, 
        data: {
          query: query,
          results: results,
          historyItem: historyItem
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleHistory(message) {
    const { limit, offset } = message.payload.data || message.payload;
    
    try {
      let history = [...this.searchHistory];
      
      if (offset && offset > 0) {
        history = history.slice(offset);
      }
      
      if (limit && limit > 0) {
        history = history.slice(0, limit);
      }
      
      return { 
        success: true, 
        data: {
          history: history,
          total: this.searchHistory.length
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleClearHistory(message) {
    try {
      this.searchHistory = [];
      this._saveHistory();
      
      return { success: true, data: { cleared: true } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleDeleteHistoryItem(message) {
    const { id } = message.payload.data || message.payload;
    
    if (!id) {
      return { success: false, error: 'History item ID is required' };
    }

    try {
      const index = this.searchHistory.findIndex(item => item.id === id);
      
      if (index === -1) {
        return { success: false, error: `History item not found: ${id}` };
      }
      
      this.searchHistory.splice(index, 1);
      this._saveHistory();
      
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _performSearch(query) {
    const axios = require('axios');
    const cheerio = require('cheerio');
    
    const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH&sp=-1&lq=0&qs=n&sk=&sc=8-1`;
    console.log(`[SearchActor] 正在搜索: ${query}`);
    
    try {
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'max-age=0',
          'Referer': 'https://cn.bing.com/',
          'sec-ch-ua': '"Microsoft Edge";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1'
        },
        timeout: 15000
      });
      
      const $ = cheerio.load(response.data);
      
      const poleContent = $('#b_pole').text().trim();
      if (poleContent) {
        console.log('[SearchActor] 结果类型: ai_answer');
        return {
          type: 'ai_answer',
          content: poleContent.substring(0, 500)
        };
      }
      
      const firstLi = $('#b_results li').first();
      if (firstLi.length > 0) {
        const title = firstLi.find('h2 a').text().trim();
        const link = firstLi.find('h2 a').attr('href') || '';
        const snippet = firstLi.find('.b_caption p').text().trim();
        
        console.log('[SearchActor] 结果类型: first_result');
        return {
          type: 'first_result',
          title: title || '未获取到标题',
          link: link,
          snippet: snippet || '未获取到摘要'
        };
      }
      
      console.log('[SearchActor] 未找到结果');
      return {
        type: 'error',
        message: '未找到搜索结果'
      };
      
    } catch (err) {
      console.error('[SearchActor] 搜索失败:', err.message);
      return {
        type: 'error',
        message: err.message
      };
    }
  }

  parseSearchCommand(text) {
    const trimmedText = text.trim();
    
    if (trimmedText.startsWith('搜索')) {
      const query = trimmedText.replace('搜索', '').trim();
      if (query) {
        return {
          type: 'query',
          query: query
        };
      }
    }
    
    return null;
  }
}

module.exports = SearchActor;

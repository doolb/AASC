(function() {
  'use strict';

  const Chat2APIControl = {
    baseUrl: 'http://127.0.0.1:8080',
    loginSession: null,

    escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    setProxyAddress(addressText) {
      if (typeof addressText !== 'string' || !addressText.includes(':')) return;
      const match = addressText.match(/^(\[[^\]]+\]|[^:]+):(\d+)$/);
      if (!match) return;
      const host = match[1].replace(/^\[|\]$/g, '');
      this.baseUrl = `http://${host}:${match[2]}`;
    },

    async request(path, options) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options && options.headers ? options.headers : {}) },
        ...(options || {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error && body.error.message ? body.error.message : `请求失败 (${response.status})`);
      return body;
    },

    async open(addressText) {
      this.setProxyAddress(addressText);
      this.ensureModal();
      document.getElementById('chat2apiModal').style.display = 'flex';
      await this.refresh();
    },

    close() {
      const modal = document.getElementById('chat2apiModal');
      if (modal) modal.style.display = 'none';
    },

    ensureModal() {
      if (document.getElementById('chat2apiModal')) return;
      const modal = document.createElement('div');
      modal.id = 'chat2apiModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.65);padding:20px;box-sizing:border-box';
      modal.innerHTML = '<div style="width:min(720px,100%);max-height:90vh;overflow:auto;background:#182033;color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:20px;box-sizing:border-box">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><strong style="font-size:18px">Chat2API 账户管理</strong><button class="task-card-btn" onclick="Chat2APIControl.close()">关闭</button></div>' +
        '<div id="chat2apiMessage" style="min-height:20px;color:#9bd1ff;font-size:13px;margin-bottom:10px"></div>' +
        '<div id="chat2apiContent"></div>' +
      '</div>';
      modal.addEventListener('click', (event) => { if (event.target === modal) this.close(); });
      document.body.appendChild(modal);
    },

    message(text, isError) {
      const element = document.getElementById('chat2apiMessage');
      if (element) { element.textContent = text || ''; element.style.color = isError ? '#ff9b9b' : '#9bd1ff'; }
    },

    async refresh() {
      try {
        const [config, providers, accounts, apiKeys, modelMappings] = await Promise.all([
          this.request('/api/chat2api/config'), this.request('/api/chat2api/providers'),
          this.request('/api/chat2api/accounts'), this.request('/api/chat2api/api-keys'), this.request('/api/chat2api/model-mappings'),
        ]);
        this.render({ config, providers, accounts, apiKeys, modelMappings });
        this.message('');
      } catch (error) {
        this.message(`无法连接 Chat2API 代理：${error.message}。请先启动 chat2api.proxy。`, true);
      }
    },

    render(data) {
      const providers = Array.isArray(data.providers) ? data.providers : [];
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      const apiKeys = Array.isArray(data.apiKeys) ? data.apiKeys : [];
      const mappings = Array.isArray(data.modelMappings) ? data.modelMappings : [];
      const content = document.getElementById('chat2apiContent');
      if (!content) return;
      const providerOptions = providers.map((provider) => `<option value="${this.escapeHtml(provider.id)}">${this.escapeHtml(provider.name || provider.id)}</option>`).join('');
      const accountRows = accounts.length ? accounts.map((account) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)"><span>${this.escapeHtml(account.label || account.accountId)} <small style="color:#9aa7bf">${this.escapeHtml(account.providerId)}</small></span><span style="display:flex;gap:5px;align-items:center"><span style="color:#8ee6a2">${account.enabled === false ? '已禁用' : '已登录'}</span><button class="task-card-btn" data-chat2api-account-toggle="${this.escapeHtml(account.accountId)}">${account.enabled === false ? '启用' : '禁用'}</button><button class="task-card-btn danger" data-chat2api-account-delete="${this.escapeHtml(account.accountId)}">删除</button></span></div>`).join('') : '<div style="color:#9aa7bf">暂无已登录账号</div>';
      const keyRows = apiKeys.length ? apiKeys.map((key) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08)"><span>${this.escapeHtml(key.label || key.id)}</span><span><code>${this.escapeHtml(key.maskedValue || '')}</code> <button class="task-card-btn" data-chat2api-key-disable="${this.escapeHtml(key.id)}">禁用</button><button class="task-card-btn danger" data-chat2api-key-delete="${this.escapeHtml(key.id)}">删除</button></span></div>`).join('') : '<div style="color:#9aa7bf">暂无 API Key</div>';
      const mappingRows = mappings.length ? mappings.map((mapping) => `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08)"><code>${this.escapeHtml(mapping.model)}</code> → <code>${this.escapeHtml(mapping.actualModel)}</code></div>`).join('') : '<div style="color:#9aa7bf">暂无模型映射</div>';
      const config = data.config || {};
      const configSection = `<section style="grid-column:1/-1;padding:12px;background:rgba(255,255,255,.04);border-radius:10px"><h4 style="margin:0 0 10px">代理配置</h4><div style="display:grid;grid-template-columns:1fr 100px 1fr;gap:8px"><label style="font-size:12px;color:#b5bfd1">监听地址<input id="chat2apiConfigHost" value="${this.escapeHtml(config.host || '127.0.0.1')}" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:7px;background:#202b42;color:#fff;border:1px solid #46516b;border-radius:6px"></label><label style="font-size:12px;color:#b5bfd1">端口<input id="chat2apiConfigPort" type="number" value="${this.escapeHtml(config.port || 8080)}" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:7px;background:#202b42;color:#fff;border:1px solid #46516b;border-radius:6px"></label><label style="font-size:12px;color:#b5bfd1">负载均衡<select id="chat2apiConfigStrategy" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:7px;background:#202b42;color:#fff;border:1px solid #46516b;border-radius:6px"><option value="round-robin" ${config.loadBalanceStrategy === 'round-robin' ? 'selected' : ''}>轮询</option><option value="fill-first" ${config.loadBalanceStrategy === 'fill-first' ? 'selected' : ''}>最低用量</option><option value="failover" ${config.loadBalanceStrategy === 'failover' ? 'selected' : ''}>故障转移</option></select></label></div><label style="display:block;margin-top:8px;font-size:13px"><input type="checkbox" id="chat2apiConfigApiKey" ${config.enableApiKey !== false ? 'checked' : ''}> 启用 API Key 鉴权</label><button class="task-card-btn primary" id="chat2apiSaveConfig" style="margin-top:8px">保存配置</button></section>`;
      content.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
        configSection +
        '<section style="padding:12px;background:rgba(255,255,255,.04);border-radius:10px"><h4 style="margin:0 0 10px">登录 Provider</h4>' +
          `<select id="chat2apiProvider" style="width:100%;padding:8px;background:#202b42;color:#fff;border:1px solid #46516b;border-radius:6px">${providerOptions}</select>` +
          '<div id="chat2apiCredentialFields" style="margin-top:10px"></div>' +
          '<div style="display:flex;gap:8px;margin-top:10px"><button class="task-card-btn" id="chat2apiOpenLogin">打开登录页</button><button class="task-card-btn primary" id="chat2apiCompleteLogin" style="display:none">完成登录</button></div>' +
        '</section>' +
        '<section style="padding:12px;background:rgba(255,255,255,.04);border-radius:10px"><h4 style="margin:0 0 10px">已登录账号</h4><div id="chat2apiAccounts">' + accountRows + '</div></section>' +
        '<section style="grid-column:1/-1;padding:12px;background:rgba(255,255,255,.04);border-radius:10px"><div style="display:flex;justify-content:space-between;align-items:center"><h4 style="margin:0 0 8px">代理 API Key</h4><button class="task-card-btn" id="chat2apiCreateKey">新建 Key</button></div><div>' + keyRows + '</div></section>' +
        '<section style="grid-column:1/-1;padding:12px;background:rgba(255,255,255,.04);border-radius:10px"><h4 style="margin:0 0 8px">模型映射</h4><div>' + mappingRows + '</div></section>' +
      '</div>';
      this.providers = providers;
      const select = document.getElementById('chat2apiProvider');
      const renderFields = () => this.renderCredentialFields(select && select.value);
      if (select) select.addEventListener('change', renderFields);
      const openButton = document.getElementById('chat2apiOpenLogin');
      if (openButton) openButton.addEventListener('click', () => this.startLogin(select.value));
      const completeButton = document.getElementById('chat2apiCompleteLogin');
      if (completeButton) completeButton.addEventListener('click', () => this.completeLogin());
      const keyButton = document.getElementById('chat2apiCreateKey');
      if (keyButton) keyButton.addEventListener('click', () => this.createKey());
      const saveConfigButton = document.getElementById('chat2apiSaveConfig');
      if (saveConfigButton) saveConfigButton.addEventListener('click', () => this.saveConfig());
      content.querySelectorAll('[data-chat2api-account-toggle]').forEach((button) => button.addEventListener('click', () => this.updateAccount(button.dataset.chat2apiAccountToggle, button.textContent === '启用')));
      content.querySelectorAll('[data-chat2api-account-delete]').forEach((button) => button.addEventListener('click', () => this.deleteAccount(button.dataset.chat2apiAccountDelete)));
      content.querySelectorAll('[data-chat2api-key-disable]').forEach((button) => button.addEventListener('click', () => this.disableKey(button.dataset.chat2apiKeyDisable)));
      content.querySelectorAll('[data-chat2api-key-delete]').forEach((button) => button.addEventListener('click', () => this.deleteKey(button.dataset.chat2apiKeyDelete)));
      renderFields();
    },

    renderCredentialFields(providerId) {
      const provider = (this.providers || []).find((item) => item.id === providerId);
      const fields = provider && provider.credentialFields && provider.credentialFields.length ? provider.credentialFields : [{ name: 'token', label: 'Token / Cookie', type: 'password', required: true }];
      const container = document.getElementById('chat2apiCredentialFields');
      if (!container) return;
      container.innerHTML = fields.map((field) => `<label style="display:block;margin-top:8px;font-size:12px;color:#b5bfd1">${this.escapeHtml(field.label || field.name)}<input data-chat2api-credential="${this.escapeHtml(field.name)}" type="${field.type === 'textarea' ? 'text' : (field.type || 'password')}" placeholder="${this.escapeHtml(field.placeholder || '')}" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px;background:#202b42;color:#fff;border:1px solid #46516b;border-radius:6px"></label>`).join('');
    },

    async startLogin(providerId) {
      try {
        this.loginSession = await this.request('/api/chat2api/oauth/start', { method: 'POST', body: JSON.stringify({ providerId }) });
        const completeButton = document.getElementById('chat2apiCompleteLogin');
        if (completeButton) completeButton.style.display = 'inline-block';
        const loginWindow = window.open(this.loginSession.loginUrl, '_blank', 'noopener');
        this.message(loginWindow ? '已打开官方登录页，登录后将 Token/Cookie 粘贴到下方。' : '浏览器阻止了弹窗，请手动打开登录地址：' + this.loginSession.loginUrl);
      } catch (error) { this.message(error.message, true); }
    },

    async completeLogin() {
      if (!this.loginSession) { this.message('请先点击“打开登录页”。', true); return; }
      const credentials = {};
      document.querySelectorAll('[data-chat2api-credential]').forEach((element) => { if (element.value) credentials[element.dataset.chat2apiCredential] = element.value; });
      try {
        await this.request('/api/chat2api/oauth/complete', { method: 'POST', body: JSON.stringify({ state: this.loginSession.state, providerId: this.loginSession.providerId, credentials }) });
        this.loginSession = null;
        this.message('登录成功，账号已保存。');
        await this.refresh();
      } catch (error) { this.message(error.message, true); }
    },

    async createKey() {
      const label = window.prompt('请输入 API Key 名称', '控制端');
      if (label === null) return;
      try {
        const result = await this.request('/api/chat2api/api-keys', { method: 'POST', body: JSON.stringify({ label }) });
        window.prompt('API Key 仅显示这一次，请复制保存：', result.value);
        await this.refresh();
      } catch (error) { this.message(error.message, true); }
    },

    async saveConfig() {
      try {
        await this.request('/api/chat2api/config', { method: 'PUT', body: JSON.stringify({ host: document.getElementById('chat2apiConfigHost').value.trim(), port: Number(document.getElementById('chat2apiConfigPort').value), loadBalanceStrategy: document.getElementById('chat2apiConfigStrategy').value, enableApiKey: document.getElementById('chat2apiConfigApiKey').checked }) });
        this.message('配置已保存；监听地址/端口变更需重启 chat2api.proxy。');
      } catch (error) { this.message(error.message, true); }
    },

    async updateAccount(accountId, enabled) {
      try { await this.request(`/api/chat2api/accounts/${encodeURIComponent(accountId)}`, { method: 'PUT', body: JSON.stringify({ enabled }) }); await this.refresh(); } catch (error) { this.message(error.message, true); }
    },

    async deleteAccount(accountId) {
      if (!window.confirm('确定删除这个账号吗？凭据将从本机删除。')) return;
      try { await this.request(`/api/chat2api/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }); await this.refresh(); } catch (error) { this.message(error.message, true); }
    },

    async disableKey(id) {
      try { await this.request(`/api/chat2api/api-keys/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ enabled: false }) }); await this.refresh(); } catch (error) { this.message(error.message, true); }
    },

    async deleteKey(id) {
      if (!window.confirm('确定删除这个 API Key 吗？')) return;
      try { await this.request(`/api/chat2api/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' }); await this.refresh(); } catch (error) { this.message(error.message, true); }
    },
  };

  window.Chat2APIControl = Chat2APIControl;
})();

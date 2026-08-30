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

    setProxyAddress(addressText, instanceId) {
      if (instanceId && typeof window !== 'undefined' && window.location && window.location.origin) {
        this.baseUrl = `${window.location.origin}/api/chat2api-gateway/${encodeURIComponent(instanceId)}`;
        return;
      }
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

    async open(addressText, instanceId) {
      this.setProxyAddress(addressText, instanceId);
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
      modal.className = 'chat2api-modal modal-mask';
      modal.innerHTML = '<div class="chat2api-dialog">' +
        '<div class="chat2api-header"><strong class="chat2api-title">Chat2API 账户管理</strong><span class="chat2api-header-actions"><button class="task-card-btn" id="chat2apiImportLegacy">导入原 Chat2API 数据</button><button class="task-card-btn" onclick="Chat2APIControl.close()">关闭</button></span></div>' +
        '<div id="chat2apiMessage" class="chat2api-message"></div>' +
        '<div id="chat2apiContent" class="chat2api-content"></div>' +
      '</div>';
      modal.addEventListener('click', (event) => { if (event.target === modal) this.close(); });
      document.body.appendChild(modal);
    },

    message(text, isError) {
      const element = document.getElementById('chat2apiMessage');
      if (element) {
        element.textContent = text || '';
        element.classList.toggle('is-error', Boolean(isError));
      }
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
      const mappingProviderOptions = ['<option value="">自动选择 Provider</option>', ...providers.map((provider) => `<option value="${this.escapeHtml(provider.id)}">${this.escapeHtml(provider.name || provider.id)}</option>`)].join('');
      const mappingAccountOptions = ['<option value="">自动选择账号</option>', ...accounts.map((account) => `<option value="${this.escapeHtml(account.accountId || account.id)}">${this.escapeHtml(account.label || account.name || account.accountId || account.id)}（${this.escapeHtml(account.providerId)}）</option>`)].join('');
      const accountRows = accounts.length ? accounts.map((account) => `<div class="chat2api-list-row"><span>${this.escapeHtml(account.label || account.accountId)} <small class="chat2api-secondary-text">${this.escapeHtml(account.providerId)}</small></span><span class="chat2api-row-actions"><span class="chat2api-success-text">${account.enabled === false ? '已禁用' : '已登录'}</span><button class="task-card-btn" data-chat2api-account-toggle="${this.escapeHtml(account.accountId)}">${account.enabled === false ? '启用' : '禁用'}</button><button class="task-card-btn danger" data-chat2api-account-delete="${this.escapeHtml(account.accountId)}">删除</button></span></div>`).join('') : '<div class="chat2api-empty">暂无已登录账号</div>';
      const keyRows = apiKeys.length ? apiKeys.map((key) => `<div class="chat2api-list-row"><span>${this.escapeHtml(key.label || key.id)}</span><span class="chat2api-row-actions"><code class="chat2api-code">${this.escapeHtml(key.maskedValue || '')}</code><button class="task-card-btn" data-chat2api-key-disable="${this.escapeHtml(key.id)}">禁用</button><button class="task-card-btn danger" data-chat2api-key-delete="${this.escapeHtml(key.id)}">删除</button></span></div>`).join('') : '<div class="chat2api-empty">暂无 API Key</div>';
      const mappingRows = mappings.length ? mappings.map((mapping) => `<div class="chat2api-mapping-row"><span class="chat2api-mapping-values"><code class="chat2api-code">${this.escapeHtml(mapping.model)}</code><span class="chat2api-secondary-text">→</span><code class="chat2api-code">${this.escapeHtml(mapping.actualModel)}</code><small class="chat2api-secondary-text">${this.escapeHtml(mapping.preferredProviderId || mapping.providerId || '自动 Provider')}</small></span><span class="chat2api-row-actions"><button class="task-card-btn" data-chat2api-mapping-edit="${this.escapeHtml(mapping.model)}">编辑</button><button class="task-card-btn danger" data-chat2api-mapping-delete="${this.escapeHtml(mapping.model)}">删除</button></span></div>`).join('') : '<div class="chat2api-empty">暂无模型映射</div>';
      const mappingEditor = `<div id="chat2apiMappingEditor" class="chat2api-mapping-editor" hidden><div class="chat2api-section-heading"><h5 id="chat2apiMappingEditorTitle" class="chat2api-editor-title">新增模型映射</h5><button class="task-card-btn" id="chat2apiMappingCancel" hidden>取消编辑</button></div><div class="chat2api-mapping-form"><label class="chat2api-field">请求模型<input id="chat2apiMappingModel" placeholder="例如 Qwen3.6-Flash"></label><label class="chat2api-field">实际模型<input id="chat2apiMappingActualModel" placeholder="例如 Qwen3.7"></label><label class="chat2api-field">优先 Provider<select id="chat2apiMappingProvider">${mappingProviderOptions}</select></label><label class="chat2api-field">优先账号<select id="chat2apiMappingAccount">${mappingAccountOptions}</select></label></div><button class="task-card-btn primary chat2api-save-button" id="chat2apiMappingSave">保存映射</button></div>`;
      const config = data.config || {};
      const configSection = `<section class="chat2api-section chat2api-section-wide"><h4 class="chat2api-section-title">代理配置</h4><div class="chat2api-config-grid"><label class="chat2api-field">监听地址<input id="chat2apiConfigHost" value="${this.escapeHtml(config.host || '127.0.0.1')}"></label><label class="chat2api-field">端口<input id="chat2apiConfigPort" type="number" value="${this.escapeHtml(config.port || 8080)}"></label><label class="chat2api-field">负载均衡<select id="chat2apiConfigStrategy"><option value="round-robin" ${config.loadBalanceStrategy === 'round-robin' ? 'selected' : ''}>轮询</option><option value="fill-first" ${config.loadBalanceStrategy === 'fill-first' ? 'selected' : ''}>最低用量</option><option value="failover" ${config.loadBalanceStrategy === 'failover' ? 'selected' : ''}>故障转移</option></select></label><label class="chat2api-field">原始日志最大字节数<input id="chat2apiConfigRawTrafficMaxBytes" type="number" min="1024" max="2097152" step="1" value="${this.escapeHtml(config.rawTrafficMaxBytes || 262144)}"></label></div><label class="chat2api-checkbox"><input type="checkbox" id="chat2apiConfigApiKey" ${config.enableApiKey !== false ? 'checked' : ''}> 启用 API Key 鉴权</label><label class="chat2api-checkbox"><input type="checkbox" id="chat2apiConfigDebugRawTraffic" ${config.debugRawTraffic === true ? 'checked' : ''}> 记录发给 AI 的原始请求和返回结果</label><div class="chat2api-secondary-text">调试日志默认关闭，开启后会把聊天内容写入服务日志，排障完成后请关闭。</div><button class="task-card-btn primary chat2api-save-button" id="chat2apiSaveConfig">保存配置</button></section>`;
      content.innerHTML = '<div class="chat2api-grid">' +
        configSection +
        '<section class="chat2api-section"><h4 class="chat2api-section-title">登录 Provider</h4>' +
          `<select id="chat2apiProvider" class="chat2api-select">${providerOptions}</select>` +
          '<div id="chat2apiCredentialFields" class="chat2api-credential-fields"></div>' +
          '<div class="chat2api-actions"><button class="task-card-btn" id="chat2apiOpenLogin">打开登录页</button><button class="task-card-btn primary" id="chat2apiCompleteLogin" hidden>完成登录</button></div>' +
        '</section>' +
        '<section class="chat2api-section"><h4 class="chat2api-section-title">已登录账号</h4><div id="chat2apiAccounts">' + accountRows + '</div></section>' +
        '<section class="chat2api-section chat2api-section-wide"><div class="chat2api-section-heading"><h4 class="chat2api-section-title">代理 API Key</h4><button class="task-card-btn" id="chat2apiCreateKey">新建 Key</button></div><div>' + keyRows + '</div></section>' +
        '<section class="chat2api-section chat2api-section-wide"><div class="chat2api-section-heading"><h4 class="chat2api-section-title">模型映射</h4><button class="task-card-btn primary" id="chat2apiMappingNew">新增映射</button></div><div>' + mappingRows + '</div>' + mappingEditor + '</section>' +
      '</div>';
      this.providers = providers;
      this.accounts = accounts;
      this.modelMappings = mappings;
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
      const importLegacyButton = document.getElementById('chat2apiImportLegacy');
      if (importLegacyButton) importLegacyButton.addEventListener('click', () => this.importLegacyData());
      const newMappingButton = document.getElementById('chat2apiMappingNew');
      if (newMappingButton) newMappingButton.addEventListener('click', () => this.openMappingEditor());
      const saveMappingButton = document.getElementById('chat2apiMappingSave');
      if (saveMappingButton) saveMappingButton.addEventListener('click', () => this.saveModelMapping());
      const cancelMappingButton = document.getElementById('chat2apiMappingCancel');
      if (cancelMappingButton) cancelMappingButton.addEventListener('click', () => this.resetMappingEditor());
      content.querySelectorAll('[data-chat2api-account-toggle]').forEach((button) => button.addEventListener('click', () => this.updateAccount(button.dataset.chat2apiAccountToggle, button.textContent === '启用')));
      content.querySelectorAll('[data-chat2api-account-delete]').forEach((button) => button.addEventListener('click', () => this.deleteAccount(button.dataset.chat2apiAccountDelete)));
      content.querySelectorAll('[data-chat2api-key-disable]').forEach((button) => button.addEventListener('click', () => this.disableKey(button.dataset.chat2apiKeyDisable)));
      content.querySelectorAll('[data-chat2api-key-delete]').forEach((button) => button.addEventListener('click', () => this.deleteKey(button.dataset.chat2apiKeyDelete)));
      content.querySelectorAll('[data-chat2api-mapping-edit]').forEach((button) => button.addEventListener('click', () => this.openMappingEditor((this.modelMappings || []).find((mapping) => mapping.model === button.dataset.chat2apiMappingEdit))));
      content.querySelectorAll('[data-chat2api-mapping-delete]').forEach((button) => button.addEventListener('click', () => this.deleteModelMapping(button.dataset.chat2apiMappingDelete)));
      renderFields();
    },

    openMappingEditor(mapping) {
      const editor = document.getElementById('chat2apiMappingEditor');
      const modelInput = document.getElementById('chat2apiMappingModel');
      const actualModelInput = document.getElementById('chat2apiMappingActualModel');
      const providerSelect = document.getElementById('chat2apiMappingProvider');
      const accountSelect = document.getElementById('chat2apiMappingAccount');
      const title = document.getElementById('chat2apiMappingEditorTitle');
      const cancelButton = document.getElementById('chat2apiMappingCancel');
      if (!editor || !modelInput || !actualModelInput || !providerSelect || !accountSelect) return;
      const current = mapping && typeof mapping === 'object' ? mapping : null;
      this.mappingEditingModel = current ? current.model : null;
      editor.hidden = false;
      modelInput.value = current ? current.model || '' : '';
      actualModelInput.value = current ? current.actualModel || '' : '';
      providerSelect.value = current ? current.preferredProviderId || current.providerId || '' : '';
      accountSelect.value = current ? current.preferredAccountId || current.accountId || '' : '';
      if (title) title.textContent = current ? '编辑模型映射' : '新增模型映射';
      if (cancelButton) cancelButton.hidden = !current;
      modelInput.focus();
    },

    resetMappingEditor() {
      const editor = document.getElementById('chat2apiMappingEditor');
      if (editor) editor.hidden = true;
      this.mappingEditingModel = null;
    },

    async saveModelMapping() {
      const modelInput = document.getElementById('chat2apiMappingModel');
      const actualModelInput = document.getElementById('chat2apiMappingActualModel');
      const providerSelect = document.getElementById('chat2apiMappingProvider');
      const accountSelect = document.getElementById('chat2apiMappingAccount');
      const model = modelInput && modelInput.value.trim();
      const actualModel = actualModelInput && actualModelInput.value.trim();
      if (!model || !actualModel) {
        this.message('请求模型和实际模型不能为空。', true);
        return;
      }
      const payload = { model, actualModel };
      if (providerSelect && providerSelect.value) payload.preferredProviderId = providerSelect.value;
      if (accountSelect && accountSelect.value) payload.preferredAccountId = accountSelect.value;
      try {
        await this.request('/api/chat2api/model-mappings', { method: 'POST', body: JSON.stringify(payload) });
        if (this.mappingEditingModel && this.mappingEditingModel !== model) {
          await this.request(`/api/chat2api/model-mappings/${encodeURIComponent(this.mappingEditingModel)}`, { method: 'DELETE' });
        }
        this.mappingEditingModel = null;
        await this.refresh();
        this.message('模型映射已保存。');
      } catch (error) { this.message(`模型映射保存失败：${error.message}`, true); }
    },

    async deleteModelMapping(model) {
      if (!window.confirm(`确定删除模型映射“${model}”吗？`)) return;
      try {
        await this.request(`/api/chat2api/model-mappings/${encodeURIComponent(model)}`, { method: 'DELETE' });
        await this.refresh();
        this.message('模型映射已删除。');
      } catch (error) { this.message(`模型映射删除失败：${error.message}`, true); }
    },

    renderCredentialFields(providerId) {
      const provider = (this.providers || []).find((item) => item.id === providerId);
      const fields = provider && provider.credentialFields && provider.credentialFields.length ? provider.credentialFields : [{ name: 'token', label: 'Token / Cookie', type: 'password', required: true }];
      const container = document.getElementById('chat2apiCredentialFields');
      if (!container) return;
      container.innerHTML = fields.map((field) => `<label class="chat2api-field">${this.escapeHtml(field.label || field.name)}<input data-chat2api-credential="${this.escapeHtml(field.name)}" type="${field.type === 'textarea' ? 'text' : (field.type || 'password')}" placeholder="${this.escapeHtml(field.placeholder || '')}"></label>`).join('');
    },

    async startLogin(providerId) {
      try {
        this.loginSession = await this.request('/api/chat2api/oauth/start', { method: 'POST', body: JSON.stringify({ providerId }) });
        const completeButton = document.getElementById('chat2apiCompleteLogin');
        if (completeButton) completeButton.hidden = false;
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
        await this.request('/api/chat2api/config', { method: 'PUT', body: JSON.stringify({
          host: document.getElementById('chat2apiConfigHost').value.trim(),
          port: Number(document.getElementById('chat2apiConfigPort').value),
          loadBalanceStrategy: document.getElementById('chat2apiConfigStrategy').value,
          enableApiKey: document.getElementById('chat2apiConfigApiKey').checked,
          debugRawTraffic: document.getElementById('chat2apiConfigDebugRawTraffic').checked,
          rawTrafficMaxBytes: Number(document.getElementById('chat2apiConfigRawTrafficMaxBytes').value),
        }) });
        this.message('配置已保存；监听地址/端口变更需重启 chat2api.proxy，原始日志开关对下一次请求生效。');
      } catch (error) { this.message(error.message, true); }
    },

    async importLegacyData() {
      try {
        const preview = await this.request('/api/chat2api/import/legacy/preview', { method: 'POST', body: '{}' });
        const counts = preview.counts || {};
        const config = preview.config || {};
        const summary = `将导入 Provider ${Number(counts.providers || 0)} 个、账号 ${Number(counts.accounts || 0)} 个、模型映射 ${Number(counts.modelMappings || 0)} 条`;
        const configSummary = Object.keys(config).length > 0 ? `，并更新代理配置${config.port ? `（端口 ${config.port}）` : ''}` : '';
        if (!window.confirm(`${summary}${configSummary}。不会删除现有数据，确认继续吗？`)) {
          this.message('已取消原 Chat2API 数据导入。');
          return;
        }
        const result = await this.request('/api/chat2api/import/legacy/merge', { method: 'POST', body: JSON.stringify({ confirmed: true }) });
        await this.refresh();
        this.message(`原 Chat2API 数据导入完成：账号 ${Number((result.counts || {}).accounts || 0)} 个。`);
      } catch (error) { this.message(`原 Chat2API 数据导入失败：${error.message}`, true); }
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

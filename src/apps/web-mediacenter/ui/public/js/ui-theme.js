'use strict';

// 控制端主题与 UI 语义管理器：主题由服务端全局保存，浏览器缓存用于离线和旧版本兼容。
(function createUiTheme(windowObject, documentObject) {
    const themes = [
        'dark', 'light', 'warm', 'pink', 'lavender-yellow', 'red-blue', 'gold',
        'mint', 'ocean', 'forest', 'slate', 'algae-salt', 'girl-pink',
        'rose-gold', 'new-year-red'
    ];
    const storageKey = 'controlTheme';
    const serverEndpoint = '/api/config/controlTheme';
    const classificationSelector = [
        'button', 'input', 'select', 'textarea', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        '.routing-hint', '.chat-config-hint', '.placeholder-hint', '.log-filter-hint',
        '.task-file-zone-hint', '.modal-overlay', '.chat-modal-overlay', '.modal-mask',
        '.library-modal', '.self-test-modal', '.task-confirm-overlay', '.toast',
        '.viewer-3d-status', '.playing-badge', '.feature-badge', '.task-card-status'
    ].join(',');

    const hasClass = (element, className) => Boolean(
        element && element.classList && element.classList.contains(className)
    );

    const getSemanticType = (element) => {
        const tagName = (element.tagName || '').toLowerCase();
        if (tagName === 'button') return hasClass(element, 'nav-item') ? 'navigation' : 'button';
        if (tagName === 'input') {
            const inputType = (element.type || 'text').toLowerCase();
            const inputTypes = {
                checkbox: (
                    hasClass(element, 'crop-debug-toggle') || hasClass(element, 'theme-preview-switch')
                ) ? 'switch' : 'checkbox',
                file: 'file', number: 'number', password: 'password', radio: 'radio',
                range: 'slider', text: 'text', time: 'time', hidden: 'hidden'
            };
            return inputTypes[inputType] || 'text';
        }
        if (tagName === 'select') return 'select';
        if (tagName === 'textarea') return 'textarea';
        if (/^h[1-6]$/.test(tagName)) return 'title';
        if (hasClass(element, 'toast')) return 'toast';
        if (
            hasClass(element, 'modal-overlay') || hasClass(element, 'chat-modal-overlay') ||
            hasClass(element, 'modal-mask') || hasClass(element, 'library-modal') ||
            hasClass(element, 'self-test-modal') || hasClass(element, 'task-confirm-overlay')
        ) return 'modal';
        if (
            hasClass(element, 'routing-hint') || hasClass(element, 'chat-config-hint') ||
            hasClass(element, 'placeholder-hint') || hasClass(element, 'log-filter-hint') ||
            hasClass(element, 'task-file-zone-hint')
        ) return 'tip';
        if (
            hasClass(element, 'viewer-3d-status') || hasClass(element, 'playing-badge') ||
            hasClass(element, 'feature-badge') || hasClass(element, 'task-card-status')
        ) return 'status';
        return null;
    };

    const UiTheme = {
        themes,
        storageKey,
        selector: null,
        observer: null,
        previewModal: null,
        previewOriginalTheme: undefined,
        previewOriginalThemeMode: undefined,
        previewEscapeHandler: null,
        ready: Promise.resolve(),

        init() {
            this.selector = documentObject.getElementById('themeSelect');
            this.apply(this.readTheme(), false);
            this.bindSelector();
            this.classify(documentObject);
            this.observeDynamicNodes();
            this.ready = this.loadServerTheme();
            return this.ready;
        },

        normalize(theme) {
            return themes.includes(theme) ? theme : 'dark';
        },

        readTheme() {
            try {
                return this.normalize(windowObject.localStorage.getItem(storageKey));
            } catch (error) {
                console.warn('读取控制端主题失败，使用深色主题:', error);
                return 'dark';
            }
        },

        async loadServerTheme() {
            if (typeof windowObject.fetch !== 'function') return;
            try {
                const response = await windowObject.fetch(serverEndpoint);
                if (!response || response.ok === false) return;
                const payload = await response.json();
                if (payload && payload.status === 'success' && themes.includes(payload.theme)) {
                    this.apply(payload.theme, false);
                }
            } catch (error) {
                console.warn('读取服务端控制端主题失败，保留本地主题:', error);
            }
        },

        apply(theme, persistServer = true) {
            const normalizedTheme = this.normalize(theme);
            documentObject.documentElement.dataset.theme = normalizedTheme;
            documentObject.documentElement.dataset.themeMode = normalizedTheme === 'dark' ? 'dark' : 'light';
            if (this.selector) this.selector.value = normalizedTheme;
            try {
                windowObject.localStorage.setItem(storageKey, normalizedTheme);
            } catch (error) {
                console.warn('保存控制端主题失败:', error);
            }
            if (persistServer) {
                void this.persistServerTheme(normalizedTheme);
            }
            return normalizedTheme;
        },

        getThemeLabel(theme) {
            if (!this.selector || !this.selector.options) return theme;
            const option = Array.from(this.selector.options).find((item) => item.value === theme);
            return option ? option.textContent : theme;
        },

        setRootTheme(theme) {
            const normalizedTheme = this.normalize(theme);
            documentObject.documentElement.dataset.theme = normalizedTheme;
            documentObject.documentElement.dataset.themeMode = normalizedTheme === 'dark' ? 'dark' : 'light';
            return normalizedTheme;
        },

        // 主题预览只改动根元素的 data 属性，关闭时恢复原值，不触发浏览器或服务端持久化。
        showPreview(theme = this.selector?.value || documentObject.documentElement.dataset.theme || 'dark') {
            this.closePreview();
            const root = documentObject.documentElement;
            const normalizedTheme = this.normalize(theme);
            const modal = documentObject.createElement('div');
            modal.id = 'themePreviewModal';
            modal.className = 'theme-preview-modal modal-mask';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'themePreviewTitle');
            modal.innerHTML = `
                <div class="theme-preview-dialog">
                    <div class="theme-preview-header">
                        <div>
                            <h2 id="themePreviewTitle" data-ui-type="title">主题预览 · ${this.getThemeLabel(normalizedTheme)}</h2>
                            <p class="theme-preview-subtitle" data-ui-type="tip">以下样式仅用于预览，关闭后恢复当前主题。</p>
                        </div>
                        <button class="theme-preview-close" type="button" data-preview-close aria-label="关闭主题预览">×</button>
                    </div>
                    <div class="theme-preview-grid">
                        <section class="theme-preview-section theme-preview-sample-wide" data-ui-type="section">
                            <h3 data-ui-type="title">卡片与文字</h3>
                            <p data-ui-type="text">标题、正文和辅助文字会从主题基础颜色继承。</p>
                            <div class="theme-preview-small-card">
                                <strong data-ui-type="text">小卡片</strong>
                                <span data-ui-type="tip">设备在线 · 主题色边框</span>
                            </div>
                        </section>

                        <section class="theme-preview-section" data-ui-type="section">
                            <h3 data-ui-type="title">按钮状态</h3>
                            <div class="theme-preview-button-row">
                                <button class="control-btn theme-preview-button" type="button" data-ui-type="button">普通</button>
                                <button class="control-btn active theme-preview-button" type="button" data-ui-type="button">选中</button>
                                <button class="control-btn playing theme-preview-button" type="button" data-ui-type="button">播放</button>
                                <button class="control-btn danger theme-preview-button" type="button" data-ui-type="button">危险</button>
                            </div>
                        </section>

                        <section class="theme-preview-section" data-ui-type="section">
                            <h3 data-ui-type="title">开关与滑条</h3>
                            <label class="theme-preview-switch-row">
                                <input class="theme-preview-switch" type="checkbox" checked data-ui-type="switch">
                                <span>启用功能</span>
                            </label>
                            <label class="theme-preview-field">
                                <span>音量</span>
                                <input class="theme-preview-slider" type="range" min="0" max="100" value="68" data-ui-type="slider">
                            </label>
                        </section>

                        <section class="theme-preview-section" data-ui-type="section">
                            <h3 data-ui-type="title">输入控件</h3>
                            <label class="theme-preview-field">
                                <span>文本输入</span>
                                <input class="theme-preview-input" type="text" value="主题预览文字" data-ui-type="text">
                            </label>
                            <label class="theme-preview-field">
                                <span>下拉选择</span>
                                <select class="theme-preview-select" data-ui-type="select">
                                    <option>选项一</option>
                                    <option selected>选项二</option>
                                </select>
                            </label>
                        </section>

                        <section class="theme-preview-section" data-ui-type="section">
                            <h3 data-ui-type="title">Tip 与状态</h3>
                            <p class="theme-preview-tip" data-ui-type="tip">这是一条提示信息，用于确认辅助文字在当前主题下清晰可读。</p>
                            <div class="theme-preview-status" data-ui-type="status">已连接 · 正常</div>
                        </section>

                        <section class="theme-preview-section" data-ui-type="section">
                            <h3 data-ui-type="title">聊天与日志</h3>
                            <div class="theme-preview-chat">
                                <div class="theme-preview-chat-message assistant">助手：主题预览已打开。</div>
                                <div class="theme-preview-chat-message user">我可以看到不同控件的颜色。</div>
                            </div>
                            <div class="theme-preview-log"><span>12:34:56</span> [系统] 主题已加载</div>
                        </section>

                        <section class="theme-preview-section theme-preview-sample-wide" data-ui-type="section">
                            <h3 data-ui-type="title">弹窗表面</h3>
                            <div class="theme-preview-popup modal-mask" data-ui-type="modal">
                                <div class="theme-preview-popup-content">
                                    <strong data-ui-type="title">弹窗标题</strong>
                                    <span data-ui-type="text">弹窗背景、边框和文字的层次。</span>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>`;

            this.previewOriginalTheme = root.dataset.theme;
            this.previewOriginalThemeMode = root.dataset.themeMode;
            this.setRootTheme(normalizedTheme);
            documentObject.body.appendChild(modal);
            this.previewModal = modal;
            this.classify(modal);

            modal.addEventListener('click', (event) => {
                const target = event.target;
                if (
                    target === modal ||
                    (target && typeof target.closest === 'function' && target.closest('[data-preview-close]'))
                ) {
                    this.closePreview();
                }
            });
            this.previewEscapeHandler = (event) => {
                if (event.key === 'Escape') this.closePreview();
            };
            documentObject.addEventListener('keydown', this.previewEscapeHandler);
            modal.querySelector('[data-preview-close]')?.focus();
            return modal;
        },

        // 预览关闭时恢复主题属性；没有原属性时删除属性，避免残留预览状态。
        closePreview() {
            const hasPreviewState = Boolean(
                this.previewModal ||
                this.previewOriginalTheme !== undefined ||
                this.previewOriginalThemeMode !== undefined
            );
            if (!hasPreviewState) return;
            const root = documentObject.documentElement;
            if (this.previewModal) this.previewModal.remove();
            if (this.previewEscapeHandler) {
                documentObject.removeEventListener('keydown', this.previewEscapeHandler);
            }
            if (this.previewOriginalTheme === undefined) {
                delete root.dataset.theme;
            } else {
                root.dataset.theme = this.previewOriginalTheme;
            }
            if (this.previewOriginalThemeMode === undefined) {
                delete root.dataset.themeMode;
            } else {
                root.dataset.themeMode = this.previewOriginalThemeMode;
            }
            this.previewModal = null;
            this.previewOriginalTheme = undefined;
            this.previewOriginalThemeMode = undefined;
            this.previewEscapeHandler = null;
        },

        // 显示端只接受服务端广播，不重复发起 POST，避免主题通知在显示端形成回环。
        applyRemoteTheme(theme) {
            return this.apply(theme, false);
        },

        async persistServerTheme(theme) {
            if (typeof windowObject.fetch !== 'function') return;
            try {
                const response = await windowObject.fetch(serverEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ theme })
                });
                if (!response || response.ok === false) {
                    console.warn('保存服务端控制端主题失败，保留当前页面主题');
                }
            } catch (error) {
                console.warn('保存服务端控制端主题失败，保留当前页面主题:', error);
            }
        },

        bindSelector() {
            if (!this.selector || this.selector.dataset.themeBound === 'true') return;
            this.selector.addEventListener('change', (event) => {
                this.closePreview();
                this.apply(event.target.value);
            });
            this.selector.dataset.themeBound = 'true';
        },

        classify(root) {
            if (!root || typeof root.querySelectorAll !== 'function') return;
            const elements = [];
            if (typeof root.matches === 'function' && root.matches(classificationSelector)) {
                elements.push(root);
            }
            elements.push(...root.querySelectorAll(classificationSelector));
            elements.forEach((element) => {
                const semanticType = getSemanticType(element);
                if (semanticType) element.dataset.uiType = semanticType;
            });
        },

        observeDynamicNodes() {
            const Observer = windowObject.MutationObserver;
            if (!Observer || !documentObject.body || this.observer) return;
            this.observer = new Observer((records) => {
                records.forEach((record) => record.addedNodes.forEach((node) => this.classify(node)));
            });
            this.observer.observe(documentObject.body, { childList: true, subtree: true });
        }
    };

    windowObject.UiTheme = UiTheme;
}(window, document));

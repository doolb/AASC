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
                checkbox: hasClass(element, 'crop-debug-toggle') ? 'switch' : 'checkbox',
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
            this.selector.addEventListener('change', (event) => this.apply(event.target.value));
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

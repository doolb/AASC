const Crop = {
    currentMedia: null,
    data: { x: 0, y: 0, width: 100, height: 100 },
    debug: false,
    rotation: 0,
    // 当前适配模式（与显示端 currentFit 同步；contain 默认）：
    // recalculateSize 据此决定切换角度时是否发送 crop——非 crop 模式误发会把显示端强制切成裁剪放大
    currentFit: 'contain',

    _log(...args) {
        if (this.debug) {
            console.log(...args);
        }
    },
    isDragging: false,
    isResizing: false,
    resizeHandle: null,
    _lastSendTime: 0,
    _sendThrottleMs: 10,
    dragStart: { x: 0, y: 0 },
    cropStart: { x: 0, y: 0, width: 0, height: 0 },
    centerResize: true,
    
    get box() {
        return document.getElementById('cropBox');
    },
    
    get container() {
        return document.getElementById('cropPreviewContainer');
    },
    
    get previewImg() {
        return document.getElementById('cropPreviewImg');
    },
    
    get previewVideo() {
        return document.getElementById('cropPreviewVideo');
    },

    get placeholder() {
        return document.getElementById('cropPreviewPlaceholder');
    },


    // 当前显示的预览媒体元素
    _currentMedia() {
        return this.previewImg.style.display !== 'none' ? this.previewImg : this.previewVideo;
    },

    convertToOriginal(visualCrop, rotation) {
        if (rotation === 0) {
            return { ...visualCrop };
        } else if (rotation === 90) {
            return {
                x: 100 - visualCrop.y - visualCrop.height,
                y: visualCrop.x,
                width: visualCrop.height,
                height: visualCrop.width
            };
        } else if (rotation === 180) {
            return {
                x: 100 - visualCrop.x - visualCrop.width,
                y: 100 - visualCrop.y - visualCrop.height,
                width: visualCrop.width,
                height: visualCrop.height
            };
        } else if (rotation === 270) {
            return {
                x: visualCrop.y,
                y: 100 - visualCrop.x - visualCrop.width,
                width: visualCrop.height,
                height: visualCrop.width
            };
        }
        return { ...visualCrop };
    },
    
    sendData() {
        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('crop', this.data);
        }
    },
    
    updateContainerSize() {
        const containerWidth = this.container.parentElement.clientWidth;
        if (containerWidth > 0) {
            this.container.style.height = containerWidth + 'px';
        }
    },
    
    updateBox() {
        if (!this.box || !this.container) {
            this._log('[Crop] updateBox: box 或 container 不存在');
            return;
        }
        
        const media = this._currentMedia();
        let mediaRect = media.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();

        this._log('[Crop] updateBox: mediaRect=', mediaRect.width, 'x', mediaRect.height, 'containerRect=', containerRect.width, 'x', containerRect.height);

        if (mediaRect.width === 0 || mediaRect.height === 0) {
            // 无媒体（临时模式占位提示等场景）：html 以占位框为媒体区域（适配旋转），
            // 其他情况以容器为媒体区域，裁剪框仍可拖动
            this._log('[Crop] updateBox: 媒体尺寸为0，以' + (this.placeholder && this.placeholder.style.display !== 'none' ? '占位框' : '容器') + '为媒体区域');
            if (this.placeholder && this.placeholder.style.display !== 'none') {
                mediaRect = this.placeholder.getBoundingClientRect();
            } else {
                mediaRect = {
                    left: containerRect.left,
                    top: containerRect.top,
                    width: containerRect.width,
                    height: containerRect.height
                };
            }
        }
        
        const offsetX = mediaRect.left - containerRect.left;
        const offsetY = mediaRect.top - containerRect.top;
        const mediaWidth = mediaRect.width;
        const mediaHeight = mediaRect.height;
        
        const boxLeft = (offsetX + (this.data.x / 100) * mediaWidth);
        const boxTop = (offsetY + (this.data.y / 100) * mediaHeight);
        const boxWidth = (this.data.width / 100) * mediaWidth;
        const boxHeight = (this.data.height / 100) * mediaHeight;
        
        this._log('[Crop] updateBox: box位置=', boxLeft, ',', boxTop, '尺寸=', boxWidth, 'x', boxHeight);
        
        if (boxWidth > 0 && boxHeight > 0) {
            this.box.style.display = 'block';
        }
        
        this.box.style.left = boxLeft + 'px';
        this.box.style.top = boxTop + 'px';
        this.box.style.width = boxWidth + 'px';
        this.box.style.height = boxHeight + 'px';
        
        this.updateInputFields();
    },
    

    setRotation(rotation) {
        this.rotation = rotation;
        document.querySelectorAll('[data-rotation]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.rotation) === rotation);
        });

        this._applyRotationClass(rotation);
    },

    // 旋转类统一应用于预览媒体与 html 占位框
    _applyRotationClass(rotation) {
        const els = [];
        // 控制模式：截图已是网页原方向（显示端已反旋转成原方向），
        // 不给截图预览加旋转 CSS，否则预览被二次旋转
        if (!this.controlModeOn) {
            els.push(this.previewImg, this.previewVideo);
        }
        if (this.placeholder) els.push(this.placeholder);
        els.forEach(el => {
            el.classList.remove('rotate-90', 'rotate-180', 'rotate-270');
            if (rotation === 90) el.classList.add('rotate-90');
            else if (rotation === 180) el.classList.add('rotate-180');
            else if (rotation === 270) el.classList.add('rotate-270');
        });
    },

    setData(data) {
        this.data = { ...data };
    },
    
    applyRotation(rotation) {
        this.rotation = rotation;

        document.querySelectorAll('[data-rotation]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.rotation) === rotation);
        });

        this._applyRotationClass(rotation);

        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('rotate', rotation);
        }

        setTimeout(() => {
            this.recalculateSize();
        }, 350);
    },
    
    recalculateSize(sendToDisplay = true) {
        const media = this._currentMedia();
        const mediaRect = media.getBoundingClientRect();
        
        this._log('[Crop] recalculateSize: mediaRect=', mediaRect.width, 'x', mediaRect.height, 'sendToDisplay=', sendToDisplay);
        
        if (mediaRect.width === 0 || mediaRect.height === 0) {
            this._log('[Crop] recalculateSize: 媒体尺寸为0，跳过');
            return;
        }
        
        const canvasSize = window.displayCanvasSize || { width: 1920, height: 1080 };
        const aspectRatio = canvasSize.width / canvasSize.height;
        const mediaAspect = mediaRect.width / mediaRect.height;
        
        let newW, newH;
        if (aspectRatio > mediaAspect) {
            newW = 100;
            newH = 100 * mediaAspect / aspectRatio;
        } else {
            newH = 100;
            newW = 100 * aspectRatio / mediaAspect;
        }
        
        this.data.width = newW;
        this.data.height = newH;
        this.data.x = (100 - newW) / 2;
        this.data.y = (100 - newH) / 2;
        
        // 非裁剪模式：只重算裁剪框 UI，不发 crop（显示端保持原适配模式，切换角度不误进裁剪放大）
        if (this.currentFit !== 'crop') {
            this.updateBox();
            return;
        }
        // 控制模式：不显示裁剪框也不发 crop（截图强制全屏，坐标按截图比例）
        if (this.controlModeOn) return;
        this.box.style.display = 'block';
        this.updateBox();
        if (sendToDisplay) {
            this.sendData();
        }
    },
    
    showPreview(url, mediaType, onReady) {
        if (mediaType === 'html') {
            // HTML 媒体：占位框表示 iframe 区域，初始化裁剪框（拖拽实时缩放显示端）
            this.currentMedia = url;
            this.previewImg.style.display = 'none';
            this.previewVideo.style.display = 'none';
            this.placeholder.style.display = 'block';
            this.data = { x: 0, y: 0, width: 100, height: 100 };
            this.box.style.display = 'block';
            this.updateBox();
            // 控制端刷新同步显示端裁剪范围：回调恢复保存的裁剪数据
            if (typeof onReady === 'function') {
                onReady();
            }
            return;
        }
        // 非 html 媒体：隐藏 html 占位框
        if (this.placeholder) {
            this.placeholder.style.display = 'none';
        }
        // 新预览开始时移除临时模式数据丢失占位提示（并重置占位 key）
        if (window.MediaLibrary && window.MediaLibrary.removeTempPreviewPlaceholder) {
            window.MediaLibrary.removeTempPreviewPlaceholder();
        } else {
            const placeholder = document.querySelector('.temp-preview-placeholder');
            if (placeholder) placeholder.remove();
        }

        this.currentMedia = url;
        this._onReadyCallback = onReady || null;
        this._callbackExecuted = false;
        this._loadComplete = false;
        this._log('[Crop] showPreview 开始, url:', url, 'mediaType:', mediaType, 'hasCallback:', !!onReady);

        const executeCallback = () => {
            if (this._callbackExecuted) return;
            this._callbackExecuted = true;
            this._loadComplete = true;
            if (this._onReadyCallback) {
                this._onReadyCallback();
                this._onReadyCallback = null;
            } else {
                this.recalculateSize(false);
            }
        };
        
        if (mediaType === 'video') {
            this.previewVideo.style.display = 'block';
            this.previewImg.style.display = 'none';
            this.previewVideo.onloadedmetadata = () => {
                this._log('[Crop] video onloadedmetadata 触发');
                executeCallback();
            };
            this.previewVideo.src = url;
            if (this.previewVideo.readyState >= 1) {
                this._log('[Crop] video readyState >= 1, 立即计算');
                executeCallback();
            } else {
                this._retryShowPreview(0);
            }
        } else {
            this.previewImg.style.display = 'block';
            this.previewVideo.style.display = 'none';
            this.previewImg.onload = () => {
                this._log('[Crop] img onload 触发');
                executeCallback();
            };
            this.previewImg.src = url;
            if (this.previewImg.complete && this.previewImg.naturalWidth > 0) {
                this._log('[Crop] img 已加载完成, 立即计算');
                executeCallback();
            } else {
                this._retryShowPreview(0);
            }
        }
    },

    _retryShowPreview(retryCount) {
        if (retryCount >= 5 || this._callbackExecuted) return;
        setTimeout(() => {
            const media = this._currentMedia();
            const mediaRect = media.getBoundingClientRect();
            if (mediaRect.width > 0 && mediaRect.height > 0 && !this._callbackExecuted) {
                this._callbackExecuted = true;
                this._loadComplete = true;
                if (this._onReadyCallback) {
                    this._onReadyCallback();
                    this._onReadyCallback = null;
                } else {
                    this.recalculateSize(false);
                }
            } else if (mediaRect.width === 0 || mediaRect.height === 0) {
                this._retryShowPreview(retryCount + 1);
            }
        }, 200 * (retryCount + 1));
    },
    
    reset() {
        const media = this._currentMedia();
        const mediaRect = media.getBoundingClientRect();
        
        if (mediaRect.width === 0 || mediaRect.height === 0) {
            this._log('[Crop] reset: 媒体尺寸为0，跳过');
            return;
        }
        
        const canvasSize = window.displayCanvasSize || { width: 1920, height: 1080 };
        const aspectRatio = canvasSize.width / canvasSize.height;
        let mediaAspect = mediaRect.width / mediaRect.height;

        let newW, newH;
        if (aspectRatio > mediaAspect) {
            newW = 100;
            newH = 100 * mediaAspect / aspectRatio;
        } else {
            newH = 100;
            newW = 100 * aspectRatio / mediaAspect;
        }
        
        this.data.x = (100 - newW) / 2;
        this.data.y = (100 - newH) / 2;
        this.data.width = newW;
        this.data.height = newH;
        
        this.updateBox();
        this.sendData();
    },
    
    onMouseDown(e) {
        if (e.target.classList.contains('crop-resize-handle')) {
            this.isResizing = true;
            this.resizeHandle = e.target.dataset.handle;
        } else {
            this.isDragging = true;
        }
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.cropStart = { ...this.data };
        e.preventDefault();
    },
    
    onMouseMove(e) {
        if (!this.isDragging && !this.isResizing) return;
        
        const media = this._currentMedia();
        let mediaRect = media.getBoundingClientRect();
        if (mediaRect.width === 0 || mediaRect.height === 0) {
            // 无媒体：html 以占位框为拖动区域（与 updateBox 基准一致），其他以容器
            if (this.placeholder && this.placeholder.style.display !== 'none') {
                mediaRect = this.placeholder.getBoundingClientRect();
            } else {
                mediaRect = this.container.getBoundingClientRect();
            }
        }

        let dx = ((e.clientX - this.dragStart.x) / mediaRect.width) * 100;
        let dy = ((e.clientY - this.dragStart.y) / mediaRect.height) * 100;

        if (this.isDragging) {
            // updateBox 始终用 data.x→横向位置、data.y→纵向位置, 所以拖拽直接用原始 dx/dy
            this.data.x = Math.max(0, Math.min(100 - this.data.width, this.cropStart.x + dx));
            this.data.y = Math.max(0, Math.min(100 - this.data.height, this.cropStart.y + dy));
        } else if (this.isResizing) {
            const canvasSize = window.displayCanvasSize || { width: 1920, height: 1080 };
            const aspectRatio = canvasSize.width / canvasSize.height;
            const mediaAspect = mediaRect.width / mediaRect.height;
            
            let delta;
            const handle = this.resizeHandle;

            // 手柄始终控制相同的视觉边缘(东=视觉横向width, 西=视觉横向width,
            // 南=视觉纵向height, 北=视觉纵向height), 不因旋转而变。
            // updateBox 始终用 data.x→视觉横向、data.y→视觉纵向,
            // 所以东/西用 dx, 南/北用 dy, 无需旋转变换。
            if (aspectRatio > mediaAspect) {
                delta = dx;
            } else {
                delta = dy;
            }
            
            let newW, newH, newX, newY;
            
            if (this.centerResize) {
                // 中心缩放: 对称扩展/收缩
                let outwardDelta;
                if (handle.includes('e') || handle.includes('w')) {
                    outwardDelta = handle.includes('e') ? delta : -delta;
                    newW = Math.max(10, Math.min(100, this.cropStart.width + 2 * outwardDelta));
                    newH = newW / aspectRatio * mediaAspect;
                    if (newH > 100) { newH = 100; newW = newH * aspectRatio / mediaAspect; }
                    newX = this.cropStart.x - outwardDelta;
                    newY = this.cropStart.y - (newH - this.cropStart.height) / 2;
                } else {
                    outwardDelta = handle.includes('s') ? delta : -delta;
                    newH = Math.max(10, Math.min(100, this.cropStart.height + 2 * outwardDelta));
                    newW = newH * aspectRatio / mediaAspect;
                    if (newW > 100) { newW = 100; newH = newW * mediaAspect / aspectRatio; }
                    newY = this.cropStart.y - outwardDelta;
                    newX = this.cropStart.x - (newW - this.cropStart.width) / 2;
                }
                // 边界修正: 如果超出, 减少另一侧
                if (newX < 0) { newX = 0; }
                if (newY < 0) { newY = 0; }
                if (newX + newW > 100) { newW = 100 - newX; newH = newW / aspectRatio * mediaAspect; }
                if (newY + newH > 100) { newH = 100 - newY; newW = newH * aspectRatio / mediaAspect; }
                if (newH > 100) { newH = 100; newW = newH * aspectRatio / mediaAspect; }
                if (newW > 100) { newW = 100; newH = newW * mediaAspect / aspectRatio; }
            } else {
                // 边缘缩放: 对边固定
                if (handle.includes('e')) {
                    newW = Math.max(10, Math.min(100 - this.cropStart.x, this.cropStart.width + delta));
                    newH = newW / aspectRatio * mediaAspect;
                    if (newH > 100) { newH = 100; newW = newH * aspectRatio / mediaAspect; }
                    newX = this.cropStart.x;
                    newY = this.cropStart.y;
                } else if (handle.includes('w')) {
                    newW = Math.max(10, this.cropStart.width - delta);
                    newH = newW / aspectRatio * mediaAspect;
                    if (newH > 100) { newH = 100; newW = newH * aspectRatio / mediaAspect; }
                    newX = Math.max(0, this.cropStart.x + this.cropStart.width - newW);
                    newY = this.cropStart.y;
                } else if (handle.includes('s')) {
                    newH = Math.max(10, Math.min(100 - this.cropStart.y, this.cropStart.height + delta));
                    newW = newH * aspectRatio / mediaAspect;
                    if (newW > 100) { newW = 100; newH = newW * mediaAspect / aspectRatio; }
                    newX = this.cropStart.x;
                    newY = this.cropStart.y;
                } else if (handle.includes('n')) {
                    newH = Math.max(10, this.cropStart.height - delta);
                    newW = newH * aspectRatio / mediaAspect;
                    if (newW > 100) { newW = 100; newH = newW * mediaAspect / aspectRatio; }
                    newX = this.cropStart.x;
                    newY = Math.max(0, this.cropStart.y + this.cropStart.height - newH);
                } else {
                    newX = this.cropStart.x;
                    newY = this.cropStart.y;
                    newW = this.cropStart.width;
                    newH = this.cropStart.height;
                }
            }
            
            if (newX + newW > 100) {
                newW = 100 - newX;
                newH = newW * mediaAspect / aspectRatio;
            }
            if (newY + newH > 100) {
                newH = 100 - newY;
                newW = newH * aspectRatio / mediaAspect;
            }
            
            this.data.x = newX;
            this.data.y = newY;
            this.data.width = newW;
            this.data.height = newH;
        }

        this.updateBox();

        const now = Date.now();
        if (now - this._lastSendTime >= this._sendThrottleMs) {
            this._lastSendTime = now;
            this.sendData();
        }
    },
    
    onMouseUp() {
        const wasActive = this.isDragging || this.isResizing;
        this.isDragging = false;
        this.isResizing = false;
        this.resizeHandle = null;
        this._lastSendTime = 0;
        // 只有真正拖拽/缩放过裁剪框才发送裁剪指令，防止空白处点击误发
        if (wasActive) {
            this.sendData();
        }
    },
    
    onTouchStart(e) {
        const touch = e.touches[0];
        this.onMouseDown({ 
            clientX: touch.clientX, 
            clientY: touch.clientY,
            target: e.target,
            preventDefault: () => e.preventDefault()
        });
    },
    
    onTouchMove(e) {
        const touch = e.touches[0];
        this.onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
    },
    
    onTouchEnd() {
        this.onMouseUp();
    },
    
    init() {
        if (!this.box) {
            console.error('[Crop] init: cropBox 元素不存在');
            return;
        }
        if (!this.container) {
            console.error('[Crop] init: cropPreviewContainer 元素不存在');
            return;
        }
        
        this._log('[Crop] init: 初始化成功');

        // 同步中心缩放按钮状态（默认激活）
        const btn = document.getElementById('centerResizeBtn');
        if (btn) btn.classList.toggle('active', this.centerResize);

        this.box.addEventListener('mousedown', (e) => this.onMouseDown(e));
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mouseup', () => this.onMouseUp());
        
        this.box.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        document.addEventListener('touchend', () => this.onTouchEnd());
        
        window.addEventListener('resize', () => {
            this.updateContainerSize();
            this.updateBox();
        });
    },
    
    updateInputFields() {
        const inputX = document.getElementById('cropInputX');
        const inputY = document.getElementById('cropInputY');
        const inputWidth = document.getElementById('cropInputWidth');
        const inputHeight = document.getElementById('cropInputHeight');
        
        if (inputX && this.data.x != null && !isNaN(this.data.x)) inputX.value = this.data.x.toFixed(1);
        if (inputY && this.data.y != null && !isNaN(this.data.y)) inputY.value = this.data.y.toFixed(1);
        if (inputWidth && this.data.width != null && !isNaN(this.data.width)) inputWidth.value = this.data.width.toFixed(1);
        if (inputHeight && this.data.height != null && !isNaN(this.data.height)) inputHeight.value = this.data.height.toFixed(1);
    },
    
    setCropManually() {
        const inputX = document.getElementById('cropInputX');
        const inputY = document.getElementById('cropInputY');
        const inputWidth = document.getElementById('cropInputWidth');
        const inputHeight = document.getElementById('cropInputHeight');
        
        if (!inputX || !inputY || !inputWidth || !inputHeight) return;
        
        let x = parseFloat(inputX.value) || 0;
        let y = parseFloat(inputY.value) || 0;
        let width = parseFloat(inputWidth.value) || 10;
        let height = parseFloat(inputHeight.value) || 10;
        
        x = Math.max(0, Math.min(100, x));
        y = Math.max(0, Math.min(100, y));
        width = Math.max(1, Math.min(100 - x, width));
        height = Math.max(1, Math.min(100 - y, height));
        
        this.data.x = x;
        this.data.y = y;
        this.data.width = width;
        this.data.height = height;
        
        this.updateBox();
    },
    
    applyManualCrop() {
        this.setCropManually();
        
        if (window.Controls) {
            window.Controls.sendFitMode('crop');
        } else {
            this.sendData();
        }
    },
    
    updateCustomPreview() {
    },
    
    applyCustomMode() {
        const customWidth = parseInt(document.getElementById('customWidth').value) || 1920;
        const customHeight = parseInt(document.getElementById('customHeight').value) || 1080;
        const customLeft = parseInt(document.getElementById('customLeft').value) || 0;
        const customTop = parseInt(document.getElementById('customTop').value) || 0;
        
        const customData = {
            mode: 'custom',
            width: customWidth,
            height: customHeight,
            left: customLeft,
            top: customTop
        };
        
        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('customCrop', customData);
        }
        
        document.querySelectorAll('[data-fit]').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const customBtn = document.querySelector('[data-fit="custom"]');
        if (customBtn) customBtn.classList.add('active');
    },

    // ===== 控制模式：转发输入到显示端 + 显示回传截图 =====
    controlModeOn: false,
    _controlWheelTime: 0,

    // 初始化控制模式 UI 与事件绑定（upload.js init 调用）
    initControlMode() {
        const toggle = document.getElementById('controlModeToggle');
        if (!toggle) return;
        toggle.addEventListener('change', () => {
            this.setControlMode(toggle.checked);
        });
        const sendBtn = document.getElementById('controlTextSendBtn');
        const textInput = document.getElementById('controlTextInput');
        if (sendBtn && textInput) {
            sendBtn.addEventListener('click', () => {
                this.sendTextToDisplay(textInput.value);
                textInput.value = '';
            });
            textInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.sendTextToDisplay(textInput.value);
                    textInput.value = '';
                }
                e.stopPropagation(); // 防止被控制模式全局键盘捕获转发
            });
        }
        const container = this.container;
        if (container) {
            container.addEventListener('mousedown', (e) => this.onContainerMouse(e, 'mousedown'));
            container.addEventListener('mouseup', (e) => this.onContainerMouse(e, 'mouseup'));
            container.addEventListener('click', (e) => this.onContainerMouse(e, 'click'));
            container.addEventListener('contextmenu', (e) => this.onContainerMouse(e, 'contextmenu'));
            container.addEventListener('wheel', (e) => this.onContainerWheel(e), { passive: false });
        }
        document.addEventListener('keydown', (e) => this.onDocKey(e, 'keydown'), true);
        document.addEventListener('keyup', (e) => this.onDocKey(e, 'keyup'), true);

        // 控制端主动刷新显示端（重新加载代码并恢复持久化状态）
        const refreshBtn = document.getElementById('refreshDisplayBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                if (window.WebSocketManager) {
                    window.WebSocketManager.sendControl('reload', Date.now());
                }
            });
        }
    },

    // 开启/关闭控制模式
    setControlMode(on) {
        this.controlModeOn = !!on;
        const toggle = document.getElementById('controlModeToggle');
        if (toggle) toggle.checked = this.controlModeOn;
        const textRow = document.getElementById('controlTextRow');
        if (textRow) textRow.style.display = this.controlModeOn ? '' : 'none';
        this._updateControlCapabilityHint();
        this._setControlModeDragGuard(on);
        if (this.controlModeOn) {
            // 开启：立即隐藏裁剪框，容器跟随显示端比例（不等截图回来）
            this._applyControlModeContainer();
        } else {
            // 关闭：隐藏截图底图，恢复 html 占位框与裁剪框、容器正方形
            this.previewImg.style.display = 'none';
            this.previewImg.removeAttribute('src');
            if (this.placeholder) {
                this.placeholder.style.display = 'block';
                const t = this.placeholder.querySelector('.crop-preview-placeholder-text');
                if (t) t.textContent = 'HTML 页面区域（iframe）';
            }
            this._restoreContainer();
        }
        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('controlMode', this.controlModeOn);
        }
    },

    // 控制模式禁用拖放：模拟拖动（操作网页）会触发原生 HTML5 drag → 预览容器 drop 误发临时文件
    _setControlModeDragGuard(on) {
        const container = document.getElementById('cropPreviewContainer');
        if (!container) return;
        const types = ['dragover', 'drop', 'dragenter', 'dragleave'];
        if (on && !this._controlDragGuard) {
            this._controlDragGuard = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
            types.forEach(t => container.addEventListener(t, this._controlDragGuard, true));
        } else if (!on && this._controlDragGuard) {
            types.forEach(t => container.removeEventListener(t, this._controlDragGuard, true));
            this._controlDragGuard = null;
        }
    },

    // 控制模式容器：隐藏裁剪框 + 跟随截图实际比例（不旋转）
    // 截图比例可能 ≠ canvasSize（WebView 可用高度被系统栏压缩），用截图尺寸确保无黑边铺满
    _applyControlModeContainer() {
        if (this.box) this.box.style.display = 'none';
        const shot = this._controlShotSize;
        const canvasSize = window.displayCanvasSize || { width: 1920, height: 1080 };
        const w = shot && shot.width > 0 ? shot.width : canvasSize.width;
        const h = shot && shot.height > 0 ? shot.height : canvasSize.height;
        if (w > 0 && h > 0) {
            this.container.style.aspectRatio = w + ' / ' + h;
        }
    },

    // 截图 actual content 区域：容器内 objectFit:contain 实际绘制区域（图片盒=容器全尺寸，需按比例算）
    _controlShotArea() {
        const c = this.container.getBoundingClientRect();
        if (c.width === 0 || c.height === 0) return null;
        const shot = this._controlShotSize;
        const ratio = shot && shot.width > 0 && shot.height > 0
            ? shot.width / shot.height
            : 16 / 9;   // 兜底
        const cRatio = c.width / c.height;
        const area = { left: c.left, top: c.top, width: c.width, height: c.height };
        if (ratio > cRatio) {
            // 截图更宽：左右铺满，上下留黑边
            area.height = c.width / ratio;
            area.top = c.top + (c.height - area.height) / 2;
        } else {
            // 截图更高：上下铺满，左右留黑边
            area.width = c.height * ratio;
            area.left = c.left + (c.width - area.width) / 2;
        }
        return area;
    },

    // 容器内鼠标事件 → 截图区域百分比 → 转发
    // 控制模式：以截图实际显示区域（去 letterbox）为坐标系，避免容器黑边被误算进坐标
    onContainerMouse(e, evtName) {
        if (!this.controlModeOn) return;
        // 坐标基准 = 截图实际显示区域（objectFit contain 去 letterbox 黑边），
        // 容器比例可能 ≠ 截图比例（canvasSize 1920x1080 vs 截图 1280x623），按容器算会垂直偏移
        const area = this._controlShotArea();
        if (!area) return;
        // 区域内相对百分比
        const px = ((e.clientX - area.left) / area.width) * 100;
        const py = ((e.clientY - area.top) / area.height) * 100;
        if (evtName === 'contextmenu') {
            e.preventDefault();
        }
        this.sendControlInput({
            event: evtName,
            x: px,
            y: py,
            button: e.button
        });
    },

    onContainerWheel(e) {
        if (!this.controlModeOn) return;
        // 阻止滚轮冒泡，外层页面不跟随滚动
        if (e.cancelable) e.preventDefault();
        // 50ms 节流，避免高频刷屏
        const now = Date.now();
        if (now - this._controlWheelTime < 50) return;
        this._controlWheelTime = now;
        this.sendControlInput({
            event: 'wheel',
            deltaX: e.deltaX || 0,
            deltaY: e.deltaY || 0
        });
    },

    // 文档级键盘捕获（捕获阶段，阻止控制端页面自身响应）
    onDocKey(e, evtName) {
        if (!this.controlModeOn) return;
        // ESC：不转发网页，直接退出控制模式（用户想中断远程操作）
        if (e.key === 'Escape') {
            if (evtName === 'keydown') {
                e.preventDefault();
                e.stopPropagation();
                this.setControlMode(false);
            }
            return;
        }
        // 控制模式开启后其他按键全部转发（含 Tab/Enter/方向键）
        e.preventDefault();
        e.stopPropagation();
        const msg = {
            event: evtName,
            key: e.key,
            code: e.code,
            keyCode: e.keyCode || e.which || 0,
            altKey: e.altKey,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey
        };
        // 单字符（无 Ctrl/Alt/Meta）附带 char 供显示端 insertText
        if (evtName === 'keydown' && msg.key && msg.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            msg.char = msg.key;
        }
        this.sendControlInput(msg);
    },

    // 文本注入消息（中文粘贴等）
    sendTextToDisplay(text) {
        if (!text || !this.controlModeOn) return;
        this.sendControlInput({ event: 'text', text: text });
    },

    // 发送输入消息（静默，不走 sendControl 的 toast）
    sendControlInput(msg) {
        if (!window.WebSocketManager || !window.currentDisplayId) return;
        const ws = window.WebSocketManager.ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'control',
                displayId: window.currentDisplayId,
                action: 'controlInput',
                ...msg
            }));
        }
    },

    // 显示端回传截图：作为预览底图全量显示（跟随显示端比例、不旋转），隐藏裁剪框
    showControlScreenshot(data) {
        if (!this.controlModeOn) return;
        const img = this.previewImg;
        if (!img) return;
        if (!data.dataUrl || data.mode === 'none') {
            // 控制模式中：裁剪框保持隐藏（setControlMode 已处理），仅切换占位提示
            img.style.display = 'none';
            img.removeAttribute('src');
            if (this.placeholder) {
                this.placeholder.style.display = 'block';
                const t = this.placeholder.querySelector('.crop-preview-placeholder-text');
                if (t) {
                    const caps = this._currentDisplayCapabilities();
                    if (data.mode === 'none' && caps.crossOriginControl) {
                        t.textContent = '原生截图失败，无画面（操作仍生效）';
                    } else if (data.mode === 'none' && caps.crossOriginControlDegraded) {
                        t.textContent = '跨域控制降级：仅同源页面可操作';
                    } else if (data.mode === 'none') {
                        t.textContent = '此显示端不支持跨域控制，无画面（操作仍生效）';
                    } else {
                        t.textContent = 'HTML 页面区域（iframe）';
                    }
                }
            }
            return;
        }
        img.src = data.dataUrl;
        img.style.display = 'block';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        // 记录截图实际尺寸：坐标换算用（截图比例可能 ≠ canvasSize，容器需按截图比例无黑边铺满）
        this._controlShotSize = { width: data.width, height: data.height };
        this._applyControlModeContainer();
        if (this.placeholder) this.placeholder.style.display = 'none';
    },

    // 恢复默认容器：正方形 + 显示裁剪框
    _restoreContainer() {
        if (this.container) {
            this.container.style.aspectRatio = '1 / 1';
        }
        if (this.box) {
            this.box.style.display = 'block';
        }
    },

    // 当前选中显示端能力（displayList → capabilities）
    _currentDisplayCapabilities() {
        try {
            const list = window.DeviceList && window.DeviceList.getDisplays
                ? window.DeviceList.getDisplays() : [];
            const item = list.find(d => d.id === window.currentDisplayId) || {};
            return item.capabilities || {};
        } catch (e) {
            return {};
        }
    },

    // 控制开关旁的能力标识："跨域控制"可用 / 不可用 / 降级
    _updateControlCapabilityHint() {
        const hint = document.getElementById('controlCapabilityHint');
        if (!hint) return;
        const caps = this._currentDisplayCapabilities();
        if (caps.crossOriginControl) {
            hint.textContent = '跨域控制';
            hint.style.color = '#4caf50';
        } else if (caps.crossOriginControlDegraded) {
            hint.textContent = '跨域控制降级';
            hint.style.color = '#ff9800';
        } else {
            hint.textContent = '不支持跨域控制';
            hint.style.color = 'rgba(255,255,255,0.4)';
        }
    }
};

window.setCropRotation = Crop.applyRotation.bind(Crop);
window.resetCrop = Crop.reset.bind(Crop);
window.setCropManually = Crop.setCropManually.bind(Crop);
window.applyManualCrop = Crop.applyManualCrop.bind(Crop);
window.updateCustomPreview = Crop.updateCustomPreview.bind(Crop);
window.applyCustomMode = Crop.applyCustomMode.bind(Crop);
window.showControlScreenshot = Crop.showControlScreenshot.bind(Crop);

window.setCropRotation = Crop.applyRotation.bind(Crop);
window.resetCrop = Crop.reset.bind(Crop);
window.setCropManually = Crop.setCropManually.bind(Crop);
window.applyManualCrop = Crop.applyManualCrop.bind(Crop);
window.updateCustomPreview = Crop.updateCustomPreview.bind(Crop);
window.applyCustomMode = Crop.applyCustomMode.bind(Crop);
window.toggleCenterResize = () => {
    Crop.centerResize = !Crop.centerResize;
    const btn = document.getElementById('centerResizeBtn');
    if (btn) btn.classList.toggle('active', Crop.centerResize);
};
window.Crop = Crop;

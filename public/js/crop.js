const Crop = {
    currentMedia: null,
    data: { x: 0, y: 0, width: 100, height: 100 },
    rotation: 0,
    isDragging: false,
    isResizing: false,
    resizeHandle: null,
    dragStart: { x: 0, y: 0 },
    cropStart: { x: 0, y: 0, width: 0, height: 0 },
    
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
            console.log('[Crop] updateBox: box 或 container 不存在');
            return;
        }
        
        const media = this.previewImg.style.display !== 'none' ? this.previewImg : this.previewVideo;
        const mediaRect = media.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        
        console.log('[Crop] updateBox: mediaRect=', mediaRect.width, 'x', mediaRect.height, 'containerRect=', containerRect.width, 'x', containerRect.height);
        
        if (mediaRect.width === 0 || mediaRect.height === 0) {
            console.log('[Crop] updateBox: 媒体尺寸为0，跳过');
            return;
        }
        
        const offsetX = mediaRect.left - containerRect.left;
        const offsetY = mediaRect.top - containerRect.top;
        const mediaWidth = mediaRect.width;
        const mediaHeight = mediaRect.height;
        
        const boxLeft = (offsetX + (this.data.x / 100) * mediaWidth);
        const boxTop = (offsetY + (this.data.y / 100) * mediaHeight);
        const boxWidth = (this.data.width / 100) * mediaWidth;
        const boxHeight = (this.data.height / 100) * mediaHeight;
        
        console.log('[Crop] updateBox: box位置=', boxLeft, ',', boxTop, '尺寸=', boxWidth, 'x', boxHeight);
        
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
        
        this.previewImg.classList.remove('rotate-90', 'rotate-180', 'rotate-270');
        this.previewVideo.classList.remove('rotate-90', 'rotate-180', 'rotate-270');
        
        if (rotation === 90) {
            this.previewImg.classList.add('rotate-90');
            this.previewVideo.classList.add('rotate-90');
        } else if (rotation === 180) {
            this.previewImg.classList.add('rotate-180');
            this.previewVideo.classList.add('rotate-180');
        } else if (rotation === 270) {
            this.previewImg.classList.add('rotate-270');
            this.previewVideo.classList.add('rotate-270');
        }
    },
    
    setData(data) {
        this.data = { ...data };
    },
    
    applyRotation(rotation) {
        this.rotation = rotation;
        
        document.querySelectorAll('[data-rotation]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.rotation) === rotation);
        });
        
        this.previewImg.classList.remove('rotate-90', 'rotate-180', 'rotate-270');
        this.previewVideo.classList.remove('rotate-90', 'rotate-180', 'rotate-270');
        
        if (rotation === 90) {
            this.previewImg.classList.add('rotate-90');
            this.previewVideo.classList.add('rotate-90');
        } else if (rotation === 180) {
            this.previewImg.classList.add('rotate-180');
            this.previewVideo.classList.add('rotate-180');
        } else if (rotation === 270) {
            this.previewImg.classList.add('rotate-270');
            this.previewVideo.classList.add('rotate-270');
        }
        
        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('rotate', rotation);
        }
        
        setTimeout(() => {
            this.recalculateSize();
        }, 350);
    },
    
    recalculateSize(sendToDisplay = true) {
        const media = this.previewImg.style.display !== 'none' ? this.previewImg : this.previewVideo;
        const mediaRect = media.getBoundingClientRect();
        
        console.log('[Crop] recalculateSize: mediaRect=', mediaRect.width, 'x', mediaRect.height, 'sendToDisplay=', sendToDisplay);
        
        if (mediaRect.width === 0 || mediaRect.height === 0) {
            console.log('[Crop] recalculateSize: 媒体尺寸为0，跳过');
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
        
        this.box.style.display = 'block';
        this.updateBox();
        if (sendToDisplay) {
            this.sendData();
        }
    },
    
    showPreview(url, mediaType, onReady) {
        this.currentMedia = url;
        this._onReadyCallback = onReady || null;
        console.log('[Crop] showPreview 开始, url:', url, 'mediaType:', mediaType, 'hasCallback:', !!onReady);
        
        if (mediaType === 'video') {
            this.previewVideo.style.display = 'block';
            this.previewImg.style.display = 'none';
            this.previewVideo.onloadedmetadata = () => {
                console.log('[Crop] video onloadedmetadata 触发');
                requestAnimationFrame(() => {
                    if (this._onReadyCallback) {
                        this._onReadyCallback();
                        this._onReadyCallback = null;
                    } else {
                        this.recalculateSize(false);
                    }
                });
            };
            this.previewVideo.src = url;
            if (this.previewVideo.readyState >= 1) {
                console.log('[Crop] video readyState >= 1, 立即计算');
                requestAnimationFrame(() => {
                    if (this._onReadyCallback) {
                        this._onReadyCallback();
                        this._onReadyCallback = null;
                    } else {
                        this.recalculateSize(false);
                    }
                });
            } else {
                this._retryShowPreview(0);
            }
        } else {
            this.previewImg.style.display = 'block';
            this.previewVideo.style.display = 'none';
            this.previewImg.onload = () => {
                console.log('[Crop] img onload 触发');
                requestAnimationFrame(() => {
                    if (this._onReadyCallback) {
                        this._onReadyCallback();
                        this._onReadyCallback = null;
                    } else {
                        this.recalculateSize(false);
                    }
                });
            };
            this.previewImg.src = url;
            if (this.previewImg.complete && this.previewImg.naturalWidth > 0) {
                console.log('[Crop] img 已加载完成, 立即计算');
                requestAnimationFrame(() => {
                    if (this._onReadyCallback) {
                        this._onReadyCallback();
                        this._onReadyCallback = null;
                    } else {
                        this.recalculateSize(false);
                    }
                });
            } else {
                this._retryShowPreview(0);
            }
        }
    },
    
    _retryShowPreview(retryCount) {
        if (retryCount >= 5) return;
        setTimeout(() => {
            const media = this.previewImg.style.display !== 'none' ? this.previewImg : this.previewVideo;
            const mediaRect = media.getBoundingClientRect();
            if (mediaRect.width > 0 && mediaRect.height > 0) {
                if (this._onReadyCallback) {
                    this._onReadyCallback();
                    this._onReadyCallback = null;
                } else {
                    this.recalculateSize(false);
                }
            } else {
                this._retryShowPreview(retryCount + 1);
            }
        }, 200 * (retryCount + 1));
    },
    
    reset() {
        const media = this.previewImg.style.display !== 'none' ? this.previewImg : this.previewVideo;
        const mediaRect = media.getBoundingClientRect();
        
        if (mediaRect.width === 0 || mediaRect.height === 0) {
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
        
        const media = this.previewImg.style.display !== 'none' ? this.previewImg : this.previewVideo;
        const mediaRect = media.getBoundingClientRect();
        
        let dx = ((e.clientX - this.dragStart.x) / mediaRect.width) * 100;
        let dy = ((e.clientY - this.dragStart.y) / mediaRect.height) * 100;
        
        let adjustedDx = dx;
        let adjustedDy = dy;
        
        if (this.isDragging) {
            this.data.x = Math.max(0, Math.min(100 - this.data.width, this.cropStart.x + adjustedDx));
            this.data.y = Math.max(0, Math.min(100 - this.data.height, this.cropStart.y + adjustedDy));
        } else if (this.isResizing) {
            const canvasSize = window.displayCanvasSize || { width: 1920, height: 1080 };
            const aspectRatio = canvasSize.width / canvasSize.height;
            const mediaAspect = mediaRect.width / mediaRect.height;
            
            let delta;
            let handle = this.resizeHandle;
            
            if (this.rotation === 90) {
                if (handle === 'nw') handle = 'sw';
                else if (handle === 'ne') handle = 'nw';
                else if (handle === 'se') handle = 'ne';
                else if (handle === 'sw') handle = 'se';
            } else if (this.rotation === 180) {
                if (handle === 'nw') handle = 'se';
                else if (handle === 'ne') handle = 'sw';
                else if (handle === 'se') handle = 'nw';
                else if (handle === 'sw') handle = 'ne';
            } else if (this.rotation === 270) {
                if (handle === 'nw') handle = 'ne';
                else if (handle === 'ne') handle = 'se';
                else if (handle === 'se') handle = 'sw';
                else if (handle === 'sw') handle = 'nw';
            }
            
            if (aspectRatio > mediaAspect) {
                delta = dx;
            } else {
                delta = dy;
            }
            
            let newW, newH, newX, newY;
            
            if (handle.includes('e')) {
                newW = Math.max(10, Math.min(100 - this.cropStart.x, this.cropStart.width + delta));
                newH = newW / aspectRatio * mediaAspect;
                if (newH > 100) {
                    newH = 100;
                    newW = newH * aspectRatio / mediaAspect;
                }
                newX = this.cropStart.x;
                newY = this.cropStart.y;
            } else if (handle.includes('w')) {
                newW = Math.max(10, this.cropStart.width - delta);
                newH = newW / aspectRatio * mediaAspect;
                if (newH > 100) {
                    newH = 100;
                    newW = newH * aspectRatio / mediaAspect;
                }
                newX = Math.max(0, this.cropStart.x + this.cropStart.width - newW);
                newY = this.cropStart.y;
            } else if (handle.includes('s')) {
                newH = Math.max(10, Math.min(100 - this.cropStart.y, this.cropStart.height + delta));
                newW = newH * aspectRatio / mediaAspect;
                if (newW > 100) {
                    newW = 100;
                    newH = newW * mediaAspect / aspectRatio;
                }
                newX = this.cropStart.x;
                newY = this.cropStart.y;
            } else if (handle.includes('n')) {
                newH = Math.max(10, this.cropStart.height - delta);
                newW = newH * aspectRatio / mediaAspect;
                if (newW > 100) {
                    newW = 100;
                    newH = newW * mediaAspect / aspectRatio;
                }
                newX = this.cropStart.x;
                newY = Math.max(0, this.cropStart.y + this.cropStart.height - newH);
            } else {
                newX = this.cropStart.x;
                newY = this.cropStart.y;
                newW = this.cropStart.width;
                newH = this.cropStart.height;
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
        this.sendData();
    },
    
    onMouseUp() {
        this.isDragging = false;
        this.isResizing = false;
        this.resizeHandle = null;
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
        
        console.log('[Crop] init: 初始化成功');
        
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
    }
};

window.setCropRotation = Crop.applyRotation.bind(Crop);
window.resetCrop = Crop.reset.bind(Crop);
window.setCropManually = Crop.setCropManually.bind(Crop);
window.applyManualCrop = Crop.applyManualCrop.bind(Crop);
window.updateCustomPreview = Crop.updateCustomPreview.bind(Crop);
window.applyCustomMode = Crop.applyCustomMode.bind(Crop);
window.Crop = Crop;

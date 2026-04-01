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
        console.log('[控制端-裁剪] sendData:', {
            视觉裁剪数据: { ...this.data },
            旋转角度: this.rotation
        });
        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('crop', this.data);
        }
    },
    
    updateContainerSize() {
        const aspectRatio = window.displayCanvasSize.width / window.displayCanvasSize.height;
        const containerWidth = this.container.parentElement.clientWidth;
        const containerHeight = containerWidth / aspectRatio;
        this.container.style.height = containerHeight + 'px';
    },
    
    updateBox() {
        const media = this.previewImg.style.display !== 'none' ? this.previewImg : this.previewVideo;
        const mediaRect = media.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        
        const offsetX = mediaRect.left - containerRect.left;
        const offsetY = mediaRect.top - containerRect.top;
        const mediaWidth = mediaRect.width;
        const mediaHeight = mediaRect.height;
        
        const boxLeft = (offsetX + (this.data.x / 100) * mediaWidth);
        const boxTop = (offsetY + (this.data.y / 100) * mediaHeight);
        const boxWidth = (this.data.width / 100) * mediaWidth;
        const boxHeight = (this.data.height / 100) * mediaHeight;
        
        console.log('[控制端-裁剪] updateBox:', {
            媒体尺寸: { width: mediaWidth, height: mediaHeight },
            媒体偏移: { x: offsetX, y: offsetY },
            裁剪框像素位置: { left: boxLeft, top: boxTop, width: boxWidth, height: boxHeight },
            裁剪框百分比: { x: this.data.x, y: this.data.y, width: this.data.width, height: this.data.height }
        });
        
        this.box.style.left = boxLeft + 'px';
        this.box.style.top = boxTop + 'px';
        this.box.style.width = boxWidth + 'px';
        this.box.style.height = boxHeight + 'px';
    },
    
    setRotation(rotation) {
        this.rotation = rotation;
        document.querySelectorAll('[data-rotation]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.rotation) === rotation);
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
        
        const aspectRatio = window.displayCanvasSize.width / window.displayCanvasSize.height;
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
        
        console.log('[控制端-裁剪] recalculateSize:', {
            显示画布比例: aspectRatio,
            媒体比例: mediaAspect,
            计算后裁剪框: { x: this.data.x, y: this.data.y, width: newW, height: newH }
        });
        
        this.updateBox();
        if (sendToDisplay) {
            this.sendData();
        }
    },
    
    showPreview(url, mediaType) {
        this.currentMedia = url;
        
        if (mediaType === 'video') {
            this.previewVideo.src = url;
            this.previewVideo.style.display = 'block';
            this.previewImg.style.display = 'none';
            this.previewVideo.onloadedmetadata = () => {
                this.recalculateSize(false);
            };
        } else {
            this.previewImg.src = url;
            this.previewImg.style.display = 'block';
            this.previewVideo.style.display = 'none';
            this.previewImg.onload = () => {
                this.recalculateSize(false);
            };
        }
        
        this.box.style.display = 'block';
    },
    
    reset() {
        const media = this.previewImg.style.display !== 'none' ? this.previewImg : this.previewVideo;
        const mediaRect = media.getBoundingClientRect();
        
        const aspectRatio = window.displayCanvasSize.width / window.displayCanvasSize.height;
        const mediaAspect = mediaRect.width / mediaRect.height;
        
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
            const aspectRatio = window.displayCanvasSize.width / window.displayCanvasSize.height;
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
    }
};

window.setCropRotation = Crop.applyRotation.bind(Crop);
window.resetCrop = Crop.reset.bind(Crop);
window.Crop = Crop;

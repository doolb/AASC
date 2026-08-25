window.currentDisplayId = null;
window.displayCanvasSize = { width: 1920, height: 1080 };

const Sidebar = {
    init() {
        const navItems = document.querySelectorAll('.nav-item');
        const sidebarNav = document.querySelector('.sidebar-nav');
        
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.target;
                this.switchPanel(target);

                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                item.classList.add('active');

                this.saveLastPanel(target);
            });
        });

        if (sidebarNav) {
            this.initDragScroll(sidebarNav);
        }

        const content = document.querySelector('.content');
        if (content) {
            this.initContentDragScroll(content);
        }
        
        this.loadLastPanel();
    },

    initDragScroll(sidebarNav) {
        const dragThreshold = 6;
        let dragState = null;
        let suppressClickUntil = 0;

        sidebarNav.addEventListener('pointerdown', (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            if (event.isPrimary === false) return;

            dragState = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startScrollTop: sidebarNav.scrollTop,
                moved: false,
                captured: false
            };
        });

        sidebarNav.addEventListener('pointermove', (event) => {
            if (!dragState || dragState.pointerId !== event.pointerId) return;

            const deltaY = event.clientY - dragState.startY;
            if (!dragState.moved && Math.abs(deltaY) < dragThreshold) return;

            dragState.moved = true;
            if (!dragState.captured) {
                sidebarNav.setPointerCapture(event.pointerId);
                dragState.captured = true;
            }
            sidebarNav.classList.add('is-dragging');
            sidebarNav.scrollTop = dragState.startScrollTop - deltaY;
            event.preventDefault();
        });

        const endDrag = (event) => {
            if (!dragState || dragState.pointerId !== event.pointerId) return;

            if (dragState.moved) {
                suppressClickUntil = Date.now() + 200;
            }
            if (dragState.captured && sidebarNav.hasPointerCapture(event.pointerId)) {
                sidebarNav.releasePointerCapture(event.pointerId);
            }
            sidebarNav.classList.remove('is-dragging');
            dragState = null;
        };

        sidebarNav.addEventListener('pointerup', endDrag);
        sidebarNav.addEventListener('pointercancel', endDrag);
        sidebarNav.addEventListener('click', (event) => {
            if (Date.now() > suppressClickUntil) return;

            event.preventDefault();
            event.stopPropagation();
            suppressClickUntil = 0;
        }, true);
    },

    initContentDragScroll(content) {
        const dragThreshold = 6;
        let dragState = null;

        content.addEventListener('pointerdown', (event) => {
            if (event.target !== content) return;
            if (event.button !== undefined && event.button !== 0) return;
            if (event.isPrimary === false) return;

            dragState = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startScrollTop: window.scrollY,
                moved: false,
                captured: false
            };
        });

        content.addEventListener('pointermove', (event) => {
            if (!dragState || dragState.pointerId !== event.pointerId) return;

            const deltaY = event.clientY - dragState.startY;
            if (!dragState.moved && Math.abs(deltaY) < dragThreshold) return;

            dragState.moved = true;
            if (!dragState.captured) {
                content.setPointerCapture(event.pointerId);
                dragState.captured = true;
            }
            content.classList.add('is-dragging');
            window.scrollTo(0, Math.max(0, dragState.startScrollTop - deltaY));
            event.preventDefault();
        });

        const endDrag = (event) => {
            if (!dragState || dragState.pointerId !== event.pointerId) return;

            if (dragState.captured && content.hasPointerCapture(event.pointerId)) {
                content.releasePointerCapture(event.pointerId);
            }
            content.classList.remove('is-dragging');
            dragState = null;
        };

        content.addEventListener('pointerup', endDrag);
        content.addEventListener('pointercancel', endDrag);
    },
    
    switchPanel(targetId) {
        // 动态组面板委托给 SidebarRegistry
        if (targetId && targetId.startsWith('dynamic-')) {
            if (window.SidebarRegistry) {
                window.SidebarRegistry.navigate(targetId.replace('dynamic-', ''));
            }
            return;
        }

        // 切换到硬编码面板时隐藏所有动态面板
        document.querySelectorAll('.panel[id^="panel-dynamic-"]').forEach(function(p) { p.style.display = 'none'; });

        const panels = document.querySelectorAll('.panel');
        panels.forEach(panel => {
            panel.style.display = panel.id === `panel-${targetId}` ? 'block' : 'none';
        });

        if (targetId === 'map') {
            App.initMapPanel();
        }

        if (targetId === 'display' && window.Crop && window.Crop.currentMedia) {
            setTimeout(() => {
                window.Crop.updateContainerSize();
                window.Crop.recalculateSize(false);
            }, 100);
        }

    },
    
    saveLastPanel(panelId) {
        try {
            localStorage.setItem('lastPanel', panelId);
        } catch (e) {
            console.warn('Failed to save last panel:', e);
        }
    },
    
    loadLastPanel() {
        let lastPanel = 'media';
        try {
            lastPanel = localStorage.getItem('lastPanel') || 'media';
        } catch (e) {
            console.warn('Failed to load last panel:', e);
        }

        // 动态组面板恢复
        if (lastPanel && lastPanel.startsWith('dynamic-')) {
            const groupId = lastPanel.replace('dynamic-', '');
            const btn = document.querySelector(`[data-target="${lastPanel}"]`);
            if (btn) {
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                btn.classList.add('active');
            }
            if (window.SidebarRegistry && window.SidebarRegistry._groups.has(groupId)) {
                window.SidebarRegistry.navigate(groupId);
            }
            return;
        }

        // 兼容已移除页签（例如旧版本保存的 brain），避免刷新后没有任何可见面板。
        if (!document.getElementById(`panel-${lastPanel}`)) {
            lastPanel = 'media';
            this.saveLastPanel(lastPanel);
        }

        this.switchPanel(lastPanel);

        const activeItem = document.querySelector(`[data-target="${lastPanel}"]`);
        if (activeItem) {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            activeItem.classList.add('active');
        }
    }
};

const App = {
    mapPanel: null,
    
    init() {
        Sidebar.init();
        
        if (window.DeviceList) {
            window.DeviceList.init();
        }
        
        if (window.Upload) {
            window.Upload.init();
        }
        
        if (window.Controls) {
            window.Controls.init();
        }
        
        if (window.Crop) {
            window.Crop.init();
        }
        
        if (window.WebSocketManager) {
            window.WebSocketManager.connect();
        }
        
        if (window.Crop) {
            window.Crop.updateContainerSize();
        }
        
        if (window.LibraryManager) {
            window.LibraryManager.load();
        }
        
        if (window.MediaLibrary) {
            window.MediaLibrary.init();
        }
        
        if (window.Chat) {
            window.Chat.init();
        }
        
        if (window.Tts) {
            window.Tts.init();
        }

        if (window.AsrDevice) {
            window.AsrDevice.init();
        }

        if (window.TtsDevice) {
            window.TtsDevice.init();
        }
        
        if (window.Reminder) {
            window.Reminder.load();
        }
        
        if (window.Search) {
            window.Search.init();
        }
        
        if (window.FloatingControl) {
            window.FloatingControl.init();
        }
        
        if (window.LogViewer) {
            window.LogViewer.init();
        }

    },
    
    async initMapPanel() {
        if (this.mapPanel) return;
        
        if (window.MapPanel) {
            this.mapPanel = new window.MapPanel({
                container: document.getElementById('map-container')
            });
            await this.mapPanel.init();
        }
    }
};

window.openViewerFullscreen = () => {
    window.open('/viewer3d.html', '_blank');
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

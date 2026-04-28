window.currentDisplayId = null;
window.displayCanvasSize = { width: 1920, height: 1080 };

const Sidebar = {
    init() {
        const navItems = document.querySelectorAll('.nav-item');
        
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.target;
                this.switchPanel(target);
                
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                
                this.saveLastPanel(target);
            });
        });
        
        this.loadLastPanel();
    },
    
    switchPanel(targetId) {
        const panels = document.querySelectorAll('.panel');
        panels.forEach(panel => {
            panel.style.display = panel.id === `panel-${targetId}` ? 'block' : 'none';
        });

        if (window.LogBrainViewer) {
            window.LogBrainViewer.setActive(targetId === 'brain');
        }
        
        if (targetId === 'map') {
            App.initMapPanel();
        }

        if (targetId === 'brain' && window.LogBrainViewer) {
            window.LogBrainViewer.refreshSummary();
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

        if (window.LogBrainViewer) {
            window.LogBrainViewer.init();
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

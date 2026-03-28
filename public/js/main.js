window.currentDisplayId = null;
window.displayCanvasSize = { width: 1920, height: 1080 };

const App = {
    init() {
        if (window.DisplayList) {
            window.DisplayList.init();
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
        
        if (window.MediaList) {
            window.MediaList.load();
        }
        
        if (window.Chat) {
            window.Chat.init();
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

const fs = require('fs');
const path = require('path');
const os = require('os');

let mediaLibraries = [];
let PORT = 8081;
let defaultUploadsDir = null;

function init(config) {
    PORT = config.port || 8081;
    defaultUploadsDir = config.uploadsDir || path.join(process.cwd(), 'uploads');
    
    if (!fs.existsSync(defaultUploadsDir)) {
        fs.mkdirSync(defaultUploadsDir, { recursive: true });
    }
    
    mediaLibraries = [{
        id: 'default',
        name: '默认媒体库',
        path: defaultUploadsDir,
        type: 'local',
        isDefault: true
    }];
    
    const configPath = path.join(process.cwd(), 'media-libraries.json');
    if (fs.existsSync(configPath)) {
        try {
            const savedLibraries = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            savedLibraries.forEach(lib => {
                if (lib.id !== 'default' && lib.path && fs.existsSync(lib.path)) {
                    mediaLibraries.push(lib);
                }
            });
        } catch (e) {
            console.error('加载媒体库配置失败:', e);
        }
    }
}

function saveLibrariesConfig() {
    const configPath = path.join(process.cwd(), 'media-libraries.json');
    const librariesToSave = mediaLibraries.filter(lib => !lib.isDefault);
    fs.writeFileSync(configPath, JSON.stringify(librariesToSave, null, 2));
}

function detectMediaType(name) {
    const ext = name.toLowerCase().split('.').pop().split('?')[0];
    if (['gif'].includes(ext)) return 'gif';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
    return 'image';
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.startsWith('multipart/form-data')) {
            return reject(new Error('不是 multipart/form-data'));
        }
        
        const boundary = contentType.split('boundary=')[1];
        if (!boundary) {
            return reject(new Error('找不到 boundary'));
        }
        
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const boundaryBuffer = Buffer.from('--' + boundary);
            const result = { fields: {}, files: {} };
            
            let start = 0;
            while (start < buffer.length) {
                const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
                if (boundaryIndex === -1) break;
                
                const nextBoundary = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
                if (nextBoundary === -1) break;
                
                const part = buffer.slice(boundaryIndex + boundaryBuffer.length + 2, nextBoundary - 2);
                const headerEnd = part.indexOf('\r\n\r\n');
                
                if (headerEnd !== -1) {
                    const headers = part.slice(0, headerEnd).toString();
                    const body = part.slice(headerEnd + 4);
                    
                    const nameMatch = headers.match(/name="([^"]+)"/);
                    const filenameMatch = headers.match(/filename="([^"]+)"/);
                    
                    if (nameMatch) {
                        const name = nameMatch[1];
                        if (filenameMatch) {
                            const filename = filenameMatch[1];
                            result.files[name] = {
                                filename: filename,
                                data: body,
                                contentType: headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream'
                            };
                        } else {
                            result.fields[name] = body.toString().replace(/\r\n$/, '');
                        }
                    }
                }
                
                start = nextBoundary;
            }
            
            resolve(result);
        });
        req.on('error', reject);
    });
}

function getLibraryById(libraryId) {
    return mediaLibraries.find(lib => lib.id === libraryId) || mediaLibraries[0];
}

async function saveUploadedFile(file, displayId, connection, libraryId) {
    if (!file) {
        throw new Error('没有上传文件');
    }
    
    if (!displayId) {
        throw new Error('没有选择显示端');
    }
    
    const library = getLibraryById(libraryId);
    const uploadsDir = library.path;
    
    const detectedType = detectMediaType(file.filename);
    const uniqueName = `${Date.now()}_${file.filename}`;
    const filePath = path.join(uploadsDir, uniqueName);
    
    fs.writeFileSync(filePath, file.data);
    
    const localIP = getLocalIP();
    const fileUrl = `http://${localIP}:${PORT}/uploads/${encodeURIComponent(uniqueName)}`;
    
    const mediaData = {
        type: 'url',
        url: fileUrl,
        fileName: file.filename,
        mediaType: detectedType,
        timestamp: Date.now(),
        libraryId: library.id
    };
    
    const displayState = connection.getDisplayState(displayId);
    if (displayState) {
        connection.setDisplayState(displayId, { currentMedia: mediaData });
        connection.sendToDisplay(displayId, mediaData);
    }
    
    return mediaData;
}

function getMediaList(libraryId) {
    const library = getLibraryById(libraryId);
    const uploadsDir = library.path;
    
    if (!fs.existsSync(uploadsDir)) {
        return [];
    }
    
    const files = fs.readdirSync(uploadsDir);
    const localIP = getLocalIP();
    
    const mediaList = files
        .filter(f => !f.startsWith('.'))
        .map(f => {
            const stat = fs.statSync(path.join(uploadsDir, f));
            return {
                name: f,
                url: `http://${localIP}:${PORT}/uploads/${encodeURIComponent(f)}`,
                mediaType: detectMediaType(f),
                size: stat.size,
                time: stat.mtime,
                libraryId: library.id
            };
        })
        .sort((a, b) => b.time - a.time);
    
    return mediaList;
}

function deleteMedia(filename, libraryId) {
    const library = getLibraryById(libraryId);
    const filePath = path.join(library.path, filename);
    
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
    }
    return false;
}

function getUploadsDir() {
    return defaultUploadsDir;
}

function getLibraries() {
    return mediaLibraries.map(lib => ({
        id: lib.id,
        name: lib.name,
        type: lib.type,
        isDefault: lib.isDefault,
        path: lib.path,
        httpUrl: lib.type === 'http' ? lib.httpUrl : null
    }));
}

function addLibrary(config) {
    const id = 'lib_' + Date.now();
    const newLibrary = {
        id: id,
        name: config.name || '新媒体库',
        path: config.path,
        type: config.type || 'local',
        isDefault: false,
        httpUrl: config.httpUrl || null
    };
    
    if (newLibrary.type === 'local' && newLibrary.path) {
        if (!fs.existsSync(newLibrary.path)) {
            fs.mkdirSync(newLibrary.path, { recursive: true });
        }
    }
    
    mediaLibraries.push(newLibrary);
    saveLibrariesConfig();
    
    return newLibrary;
}

function updateLibrary(libraryId, config) {
    const index = mediaLibraries.findIndex(lib => lib.id === libraryId);
    if (index === -1) return null;
    
    const library = mediaLibraries[index];
    if (library.isDefault) return null;
    
    if (config.name) library.name = config.name;
    if (config.path) {
        library.path = config.path;
        if (!fs.existsSync(library.path)) {
            fs.mkdirSync(library.path, { recursive: true });
        }
    }
    if (config.type) library.type = config.type;
    if (config.httpUrl) library.httpUrl = config.httpUrl;
    
    saveLibrariesConfig();
    return library;
}

function deleteLibrary(libraryId) {
    const index = mediaLibraries.findIndex(lib => lib.id === libraryId);
    if (index === -1) return false;
    
    const library = mediaLibraries[index];
    if (library.isDefault) return false;
    
    mediaLibraries.splice(index, 1);
    saveLibrariesConfig();
    return true;
}

function getFolders(libraryId) {
    const library = getLibraryById(libraryId);
    const uploadsDir = library.path;
    
    if (!fs.existsSync(uploadsDir)) {
        return [];
    }
    
    const items = fs.readdirSync(uploadsDir);
    const folders = items
        .filter(item => {
            const itemPath = path.join(uploadsDir, item);
            return fs.statSync(itemPath).isDirectory() && !item.startsWith('.');
        })
        .map(folder => ({
            name: folder,
            path: path.join(uploadsDir, folder)
        }));
    
    return folders;
}

function createFolder(folderName, libraryId) {
    const library = getLibraryById(libraryId);
    const folderPath = path.join(library.path, folderName);
    
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        return true;
    }
    return false;
}

function deleteFolder(folderName, libraryId) {
    const library = getLibraryById(libraryId);
    const folderPath = path.join(library.path, folderName);
    
    if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
        return true;
    }
    return false;
}

function getMediaInFolder(folderName, libraryId) {
    const library = getLibraryById(libraryId);
    const folderPath = path.join(library.path, folderName);
    
    if (!fs.existsSync(folderPath)) {
        return [];
    }
    
    const files = fs.readdirSync(folderPath);
    const localIP = getLocalIP();
    
    const mediaList = files
        .filter(f => !f.startsWith('.'))
        .map(f => {
            const stat = fs.statSync(path.join(folderPath, f));
            return {
                name: f,
                url: `http://${localIP}:${PORT}/uploads/${encodeURIComponent(folderName + '/' + f)}`,
                mediaType: detectMediaType(f),
                size: stat.size,
                time: stat.mtime,
                folder: folderName,
                libraryId: library.id
            };
        })
        .sort((a, b) => b.time - a.time);
    
    return mediaList;
}

module.exports = {
    init,
    detectMediaType,
    getLocalIP,
    parseMultipart,
    saveUploadedFile,
    getMediaList,
    deleteMedia,
    getUploadsDir,
    getLibraries,
    addLibrary,
    updateLibrary,
    deleteLibrary,
    getFolders,
    createFolder,
    deleteFolder,
    getMediaInFolder,
    getLibraryById
};

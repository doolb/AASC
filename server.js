const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pipeline } = require('stream');
const config = require('./core/config');
const tts = require('./core/tts');
const timeAnnounce = require('./core/timeAnnounce');
const chat = require('./core/chat');
const reminder = require('./core/reminder');
const { MediaLibraryManager } = require('./core/media-library');

config.loadConfig();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = config.get('server.port', 8081);
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let displayClients = new Map();
let controlClients = new Set();
let serverStartTime = Date.now();

tts.init(config.getTtsConfig());
timeAnnounce.init(config.get('timeAnnounce', { enabled: true, interval: 30 }));
chat.init(config.get('chat', {}));
reminder.init();

const mediaLibraryManager = new MediaLibraryManager({
    configPath: path.join(__dirname, 'config/media-libraries.json'),
    getPort: () => PORT,
    getLocalIP: getLocalIP
});

mediaLibraryManager.init().then(() => {
    console.log('媒体库初始化完成');
    
    const localRoutes = mediaLibraryManager.getLocalLibraryRoutes();
    localRoutes.forEach(route => {
        app.use(route.routePrefix, express.static(route.basePath));
        console.log(`[媒体库] 静态路由: ${route.routePrefix} -> ${route.basePath}`);
    });
    
    startServer();
}).catch(err => {
    console.error('媒体库初始化失败:', err.message);
    startServer();
});

function startServer() {
    server.listen(PORT, '0.0.0.0', () => {
        const localIP = getLocalIP();
        console.log('='.repeat(50));
        console.log('媒体中心服务器已启动');
        console.log('='.repeat(50));
        console.log(`上传端地址: http://${localIP}:${PORT}/upload`);
        console.log(`显示端地址: http://${localIP}:${PORT}/display`);
        console.log('='.repeat(50));
        
        timeAnnounce.start(displayClients, sendToDisplay);
        reminder.start(displayClients, sendToDisplay);
    });
}

function generateId() {
    return Math.random().toString(36).substring(2, 10);
}

function createDisplayState() {
    return {
        currentMedia: null,
        rotation: 0,
        fit: 'contain',
        crop: { x: 0, y: 0, width: 100, height: 100 },
        volume: 100,
        isPlaying: false,
        canvasSize: { width: 1920, height: 1080 },
        browserInfo: null
    };
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json({ limit: '500mb' }));

app.get('/', (req, res) => {
    res.redirect('/upload');
});

app.get('/upload', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/display', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

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

app.post('/upload-file', async (req, res) => {
    try {
        const multipart = await parseMultipart(req);
        const file = multipart.files.file || multipart.files.media;
        const displayId = multipart.fields.displayId;
        
        if (!file) {
            return res.status(400).json({ status: 'error', message: '没有上传文件' });
        }
        
        if (!displayId) {
            return res.status(400).json({ status: 'error', message: '没有选择显示端' });
        }
        
        const detectedType = detectMediaType(file.filename);
        const uniqueName = `${Date.now()}_${file.filename}`;
        const filePath = path.join(UPLOADS_DIR, uniqueName);
        
        fs.writeFileSync(filePath, file.data);
        
        const localIP = getLocalIP();
        const fileUrl = `http://${localIP}:${PORT}/uploads/${encodeURIComponent(uniqueName)}`;
        
        const mediaData = {
            type: 'url',
            url: fileUrl,
            fileName: file.filename,
            mediaType: detectedType,
            timestamp: Date.now()
        };
        
        currentMedia = mediaData;
        const displayData = displayClients.get(displayId);
        if (displayData) {
            displayData.state.currentMedia = mediaData;
            sendToDisplay(displayId, mediaData);
        }
        res.json({ status: 'success', message: '媒体已发送到显示端' });
    } catch (err) {
        console.error('文件上传失败:', err);
        res.status(500).json({ status: 'error', message: '文件上传失败: ' + err.message });
    }
});

app.get('/media-list', (req, res) => {
    try {
        const files = fs.readdirSync(UPLOADS_DIR);
        const localIP = getLocalIP();
        
        const mediaList = files
            .filter(f => !f.startsWith('.'))
            .map(f => {
                const stat = fs.statSync(path.join(UPLOADS_DIR, f));
                return {
                    name: f,
                    url: `http://${localIP}:${PORT}/uploads/${encodeURIComponent(f)}`,
                    mediaType: detectMediaType(f),
                    size: stat.size,
                    time: stat.mtime
                };
            })
            .sort((a, b) => b.time - a.time);
        
        res.json({ status: 'success', list: mediaList });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '获取列表失败' });
    }
});

app.delete('/media/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = path.join(UPLOADS_DIR, filename);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            res.json({ status: 'success', message: '文件已删除' });
        } else {
            res.status(404).json({ status: 'error', message: '文件不存在' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: '删除失败' });
    }
});

app.post('/api/tts/generate', async (req, res) => {
    try {
        const { text, voice, speed } = req.body;
        
        if (!text) {
            return res.status(400).json({ status: 'error', message: 'text 不能为空' });
        }
        
        const audioPath = await tts.generateTTS(text, voice, speed);
        const fileName = path.basename(audioPath);
        res.json({ 
            status: 'success', 
            audioUrl: `/uploads/tts/${fileName}`,
            message: 'TTS生成成功'
        });
    } catch (err) {
        console.error('TTS生成失败:', err);
        res.status(500).json({ status: 'error', message: 'TTS生成失败: ' + err.message });
    }
});

app.get('/api/tts/config', (req, res) => {
    const ttsConfig = config.getTtsConfig();
    res.json({ 
        status: 'success', 
        serviceUrl: ttsConfig.serviceUrl,
        defaultVoice: ttsConfig.defaultVoice,
        defaultSpeed: ttsConfig.defaultSpeed
    });
});

app.post('/api/tts/config', (req, res) => {
    try {
        const { serviceUrl, defaultVoice, defaultSpeed } = req.body;
        
        const ttsConfig = {};
        if (serviceUrl !== undefined) ttsConfig.serviceUrl = serviceUrl;
        if (defaultVoice !== undefined) ttsConfig.defaultVoice = defaultVoice;
        if (defaultSpeed !== undefined) ttsConfig.defaultSpeed = defaultSpeed;
        
        config.setTtsConfig(ttsConfig);
        tts.init(config.getTtsConfig());
        
        res.json({ status: 'success', message: 'TTS配置已更新' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

app.get('/api/timeAnnounce/config', (req, res) => {
    res.json({ 
        status: 'success', 
        config: timeAnnounce.getConfig()
    });
});

app.post('/api/timeAnnounce/config', (req, res) => {
    try {
        const { enabled, interval, repeatCount, repeatDelay } = req.body;
        
        timeAnnounce.setConfig({ enabled, interval, repeatCount, repeatDelay });
        config.set('timeAnnounce', timeAnnounce.getConfig());
        
        res.json({ 
            status: 'success', 
            message: '整点报时配置已更新',
            config: timeAnnounce.getConfig()
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

app.post('/api/timeAnnounce/test', async (req, res) => {
    try {
        const result = await timeAnnounce.checkAndAnnounce(displayClients, sendToDisplay, true);
        if (result) {
            res.json({ status: 'success', message: '整点报时测试成功' });
        } else {
            res.json({ status: 'error', message: '整点报时测试失败' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: '整点报时测试失败: ' + err.message });
    }
});

app.get('/api/config', (req, res) => {
    res.json({ 
        status: 'success', 
        config: config.getConfig()
    });
});

app.get('/api/chat/config', (req, res) => {
    res.json({ 
        status: 'success', 
        config: chat.getConfig()
    });
});

app.post('/api/chat/config', (req, res) => {
    try {
        const newConfig = chat.setConfig(req.body);
        config.set('chat', newConfig);
        res.json({ 
            status: 'success', 
            message: '聊天配置已更新',
            config: newConfig
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

app.get('/api/chat/history', (req, res) => {
    res.json({ 
        status: 'success', 
        history: chat.getHistory()
    });
});

app.post('/api/chat/clear', (req, res) => {
    chat.clearHistory();
    res.json({ 
        status: 'success', 
        message: '聊天记录已清空'
    });
});

app.get('/api/chat/templates', (req, res) => {
    res.json({ 
        status: 'success', 
        templates: chat.getTemplates()
    });
});

app.post('/api/chat/templates', (req, res) => {
    try {
        const templates = chat.setTemplates(req.body.templates);
        res.json({ 
            status: 'success', 
            templates: templates
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '模板更新失败' });
    }
});

app.post('/api/chat/templates/add', (req, res) => {
    try {
        const templates = chat.addTemplate(req.body);
        res.json({ 
            status: 'success', 
            templates: templates
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '模板添加失败' });
    }
});

app.delete('/api/chat/templates/:id', (req, res) => {
    try {
        const templates = chat.removeTemplate(req.params.id);
        res.json({ 
            status: 'success', 
            templates: templates
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '模板删除失败' });
    }
});

app.get('/api/reminders', (req, res) => {
    res.json({ 
        status: 'success', 
        reminders: reminder.getAllReminders()
    });
});

app.post('/api/reminders', (req, res) => {
    try {
        const { content, time, type, methods, repeat } = req.body;
        
        if (!content || !time) {
            return res.status(400).json({ status: 'error', message: '内容和时间不能为空' });
        }
        
        const newReminder = reminder.addReminder({ content, time, type, methods, repeat });
        res.json({ 
            status: 'success', 
            message: '提醒已创建',
            reminder: newReminder
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '创建提醒失败: ' + err.message });
    }
});

app.put('/api/reminders/:id', (req, res) => {
    try {
        const updated = reminder.updateReminder(req.params.id, req.body);
        if (!updated) {
            return res.status(404).json({ status: 'error', message: '提醒不存在' });
        }
        res.json({ 
            status: 'success', 
            message: '提醒已更新',
            reminder: updated
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '更新提醒失败: ' + err.message });
    }
});

app.delete('/api/reminders/:id', (req, res) => {
    try {
        const deleted = reminder.deleteReminder(req.params.id);
        if (!deleted) {
            return res.status(404).json({ status: 'error', message: '提醒不存在' });
        }
        res.json({ 
            status: 'success', 
            message: '提醒已删除'
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '删除提醒失败: ' + err.message });
    }
});

app.post('/api/reminders/:id/toggle', (req, res) => {
    try {
        const { enabled } = req.body;
        const updated = reminder.toggleReminder(req.params.id, enabled);
        if (!updated) {
            return res.status(404).json({ status: 'error', message: '提醒不存在' });
        }
        res.json({ 
            status: 'success', 
            message: enabled ? '提醒已启用' : '提醒已禁用',
            reminder: updated
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '操作失败: ' + err.message });
    }
});

app.post('/api/reminders/test', async (req, res) => {
    try {
        await reminder.testReminder(req.body);
        res.json({ 
            status: 'success', 
            message: '测试提醒已发送'
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '测试提醒失败: ' + err.message });
    }
});

app.post('/api/reminders/:id/test', async (req, res) => {
    try {
        const reminderData = reminder.getReminder(req.params.id);
        if (!reminderData) {
            return res.status(404).json({ status: 'error', message: '提醒不存在' });
        }
        
        const { displayId } = req.body;
        
        if (displayId) {
            const displayData = displayClients.get(displayId);
            if (!displayData) {
                return res.status(404).json({ status: 'error', message: '显示端不存在' });
            }
            await reminder.testReminder(reminderData, displayId, sendToDisplay);
        } else {
            await reminder.testReminder(reminderData);
        }
        
        res.json({ 
            status: 'success', 
            message: '测试提醒已发送'
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '测试提醒失败: ' + err.message });
    }
});

app.get('/api/media-libraries', (req, res) => {
    res.json({
        status: 'success',
        libraries: mediaLibraryManager.listLibraries(),
        defaultLibraryId: mediaLibraryManager.getDefaultLibraryId()
    });
});

app.post('/api/media-libraries', async (req, res) => {
    try {
        const { name, type, path: libPath, url, share, domain, username, password, readonly } = req.body;
        
        if (!name) {
            return res.status(400).json({ status: 'error', message: '名称不能为空' });
        }
        
        const config = await mediaLibraryManager.addLibraryFromConfig({
            name,
            type: type || 'local',
            path: libPath,
            url,
            share,
            domain,
            username,
            password,
            readonly: readonly || false
        });
        
        res.json({ status: 'success', library: config });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.put('/api/media-libraries/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, readonly, isDefault } = req.body;
        
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (readonly !== undefined) updates.readonly = readonly;
        
        const config = mediaLibraryManager.updateLibraryConfig(id, updates);
        
        if (isDefault) {
            mediaLibraryManager.setDefault(id);
        }
        
        res.json({ status: 'success', library: config });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.delete('/api/media-libraries/:id', async (req, res) => {
    try {
        await mediaLibraryManager.removeLibrary(req.params.id);
        mediaLibraryManager.saveConfig();
        res.json({ status: 'success', message: '媒体库已删除' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/media-libraries/:id/list', async (req, res) => {
    try {
        const { path: dirPath = '/' } = req.query;
        const items = await mediaLibraryManager.list(req.params.id, dirPath);
        res.json({ status: 'success', items });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/media-libraries/:id/upload', async (req, res) => {
    try {
        const multipart = await parseMultipart(req);
        const file = multipart.files.file || multipart.files.files;
        const dirPath = multipart.fields.path || '/';
        
        if (!file) {
            return res.status(400).json({ status: 'error', message: '没有上传文件' });
        }
        
        const result = await mediaLibraryManager.upload(req.params.id, dirPath, file);
        res.json({ status: 'success', file: result });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.delete('/api/media-libraries/:id/file', async (req, res) => {
    try {
        const { path: filePath } = req.query;
        
        if (!filePath) {
            return res.status(400).json({ status: 'error', message: '路径不能为空' });
        }
        
        await mediaLibraryManager.delete(req.params.id, filePath);
        res.json({ status: 'success', message: '文件已删除' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/media-libraries/:id/folder', async (req, res) => {
    try {
        const { path: dirPath, name } = req.body;
        
        if (!name) {
            return res.status(400).json({ status: 'error', message: '文件夹名称不能为空' });
        }
        
        const result = await mediaLibraryManager.createFolder(req.params.id, dirPath || '/', name);
        res.json({ status: 'success', folder: result });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.delete('/api/media-libraries/:id/folder', async (req, res) => {
    try {
        const { path: folderPath } = req.query;
        
        if (!folderPath) {
            return res.status(400).json({ status: 'error', message: '路径不能为空' });
        }
        
        await mediaLibraryManager.deleteFolder(req.params.id, folderPath);
        res.json({ status: 'success', message: '文件夹已删除' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/media-libraries/:id/set-default', (req, res) => {
    try {
        mediaLibraryManager.setDefault(req.params.id);
        res.json({ status: 'success', message: '已设为默认媒体库' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/media-libraries/:id/proxy/*', async (req, res) => {
    try {
        const filePath = decodeURIComponent(req.params[0]);
        
        if (!filePath) {
            return res.status(400).json({ status: 'error', message: '文件路径不能为空' });
        }
        
        const stream = await mediaLibraryManager.getFileStream(req.params.id, filePath);
        
        const ext = filePath.toLowerCase().split('.').pop();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'mov': 'video/quicktime',
            'avi': 'video/x-msvideo',
            'mkv': 'video/x-matroska'
        };
        
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        
        stream.pipe(res);
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/restart', (req, res) => {
    res.json({ status: 'success', message: '服务器正在重启...' });
    
    console.log('收到重启请求，正在关闭服务器...');
    
    setTimeout(() => {
        wss.clients.forEach(client => {
            client.close();
        });
        
        server.close(() => {
            console.log('服务器已关闭，正在重启...');
            
            const { spawn } = require('child_process');
            const args = process.argv.slice(1);
            
            spawn(process.execPath, args, {
                detached: true,
                stdio: 'inherit',
                cwd: process.cwd()
            });
            
            process.exit(0);
        });
        
        setTimeout(() => {
            process.exit(0);
        }, 3000);
    }, 100);
});

function detectMediaType(name) {
    const ext = name.toLowerCase().split('.').pop().split('?')[0];
    if (['gif'].includes(ext)) return 'gif';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
    return 'image';
}

function getDisplayList() {
    const list = [];
    displayClients.forEach((data, id) => {
        list.push({
            id: id,
            ip: data.ip,
            canvasSize: data.state.canvasSize,
            browserInfo: data.state.browserInfo
        });
    });
    return list;
}

function broadcastToControls(data) {
    const message = JSON.stringify(data);
    controlClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function sendToDisplay(displayId, data) {
    const displayData = displayClients.get(displayId);
    if (displayData && displayData.ws.readyState === WebSocket.OPEN) {
        displayData.ws.send(JSON.stringify(data));
        return true;
    }
    return false;
}

function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
}

wss.on('connection', (ws, req) => {
    const url = req.url || '/';
    
    if (url === '/display' || url.startsWith('/display')) {
        const displayId = generateId();
        const clientIP = getClientIP(req);
        const savedState = config.getDisplayState(clientIP);
        displayClients.set(displayId, {
            ws: ws,
            ip: clientIP,
            state: {
                ...createDisplayState(),
                ...savedState
            }
        });
        console.log(`显示端 ${displayId} (${clientIP}) 已连接，当前连接数: ${displayClients.size}`);
        
        ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));
        ws.send(JSON.stringify({ type: 'displayId', id: displayId, ip: clientIP }));
        
        if (savedState && savedState.currentMedia) {
            ws.send(JSON.stringify({ 
                type: 'restoreState',
                state: savedState
            }));
        }
        
        broadcastToControls({ type: 'displayList', list: getDisplayList() });
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                const displayData = displayClients.get(displayId);
                
                if (data.type === 'canvasSize' && displayData) {
                    displayData.state.canvasSize = { width: data.width, height: data.height };
                    broadcastToControls({ type: 'displayList', list: getDisplayList() });
                } else if (data.type === 'browserInfo' && displayData) {
                    displayData.state.browserInfo = {
                        userAgent: data.userAgent,
                        browserName: data.browserName,
                        browserVersion: data.browserVersion,
                        os: data.os,
                        deviceType: data.deviceType,
                        screenWidth: data.screenWidth,
                        screenHeight: data.screenHeight,
                        devicePixelRatio: data.devicePixelRatio,
                        featureSupport: data.featureSupport
                    };
                    broadcastToControls({ type: 'displayList', list: getDisplayList() });
                }
            } catch (e) {
                console.error('解析显示端消息失败:', e);
            }
        });
        
        ws.on('close', () => {
            displayClients.delete(displayId);
            console.log(`显示端 ${displayId} 已断开，当前连接数: ${displayClients.size}`);
            broadcastToControls({ type: 'displayList', list: getDisplayList() });
        });
    } else if (url === '/control' || url.startsWith('/control')) {
        controlClients.add(ws);
        console.log(`控制端已连接，当前连接数: ${controlClients.size}`);
        
        ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));
        ws.send(JSON.stringify({ type: 'displayList', list: getDisplayList() }));
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                const displayId = data.displayId;
                const displayData = displayClients.get(displayId);
                
                if (!displayData) return;
                
                if (data.type === 'getState') {
                    const stateToSend = { ...displayData.state };
                    if (stateToSend.currentMedia) {
                        stateToSend.currentMediaUrl = stateToSend.currentMedia.url;
                        stateToSend.currentMediaType = stateToSend.currentMedia.mediaType;
                    }
                    ws.send(JSON.stringify({
                        type: 'displayState',
                        displayId: displayId,
                        state: stateToSend
                    }));
                } else if (data.type === 'media') {
                    displayData.state.currentMedia = data.media;
                    config.updateDisplayState(displayData.ip, { currentMedia: data.media });
                    sendToDisplay(displayId, data.media);
                } else if (data.type === 'control') {
                    if (data.action === 'rotate') {
                        displayData.state.rotation = data.value;
                        config.updateDisplayState(displayData.ip, { rotation: data.value });
                    } else if (data.action === 'fit') {
                        displayData.state.fit = data.value;
                        config.updateDisplayState(displayData.ip, { fit: data.value });
                    } else if (data.action === 'crop') {
                        displayData.state.crop = data.value;
                        config.updateDisplayState(displayData.ip, { crop: data.value });
                    } else if (data.action === 'volume') {
                        displayData.state.volume = data.value;
                        config.updateDisplayState(displayData.ip, { volume: data.value });
                    } else if (data.action === 'play') {
                        displayData.state.isPlaying = data.value;
                        config.updateDisplayState(displayData.ip, { isPlaying: data.value });
                    }
                    sendToDisplay(displayId, data);
                } else if (data.type === 'tts') {
                    if (data.action === 'testTimeAnnounce') {
                        (async () => {
                            try {
                                await timeAnnounce.checkAndAnnounce(displayClients, sendToDisplay, true);
                            } catch (err) {
                                console.error('[整点报时] 测试失败:', err.message);
                            }
                        })();
                    } else if (data.action === 'stop') {
                        displayClients.forEach((displayData, id) => {
                            sendToDisplay(id, data);
                        });
                    } else if (data.action === 'play' && data.text) {
                        (async () => {
                            try {
                                const sentences = chat.splitIntoSentences(data.text);
                                for (const sentence of sentences) {
                                    const audioPath = await tts.generateTTS(sentence);
                                    const fileName = path.basename(audioPath);
                                    sendToDisplay(displayId, {
                                        type: 'tts',
                                        action: 'playAudio',
                                        audioUrl: `/uploads/tts/${fileName}`,
                                        text: sentence
                                    });
                                }
                            } catch (err) {
                                console.error('[TTS] 播放失败:', err.message);
                            }
                        })();
                    } else {
                        sendToDisplay(displayId, data);
                    }
                } else if (data.type === 'chat') {
                    (async () => {
                        try {
                            await chat.chatStream(data.message, {
                                useTemplate: data.useTemplate,
                                displayId: displayId
                            }, {
                                onChunk: (chunk, fullMessage) => {
                                    ws.send(JSON.stringify({
                                        type: 'chatChunk',
                                        chunk: chunk,
                                        message: fullMessage
                                    }));
                                },
                                onSentence: async (sentence, fullMessage) => {
                                    try {
                                        const audioPath = await tts.generateTTS(sentence);
                                        const fileName = path.basename(audioPath);
                                        sendToDisplay(displayId, {
                                            type: 'tts',
                                            action: 'playAudio',
                                            audioUrl: `/uploads/tts/${fileName}`,
                                            text: sentence
                                        });
                                    } catch (ttsErr) {
                                        console.error('[Chat] TTS生成失败:', ttsErr.message);
                                    }
                                },
                                onComplete: (fullMessage, history) => {
                                    ws.send(JSON.stringify({
                                        type: 'chatResponse',
                                        success: true,
                                        message: fullMessage,
                                        history: history
                                    }));
                                },
                                onError: (error) => {
                                    ws.send(JSON.stringify({
                                        type: 'chatResponse',
                                        success: false,
                                        error: error
                                    }));
                                }
                            });
                        } catch (err) {
                            console.error('[Chat] 处理失败:', err.message);
                            ws.send(JSON.stringify({
                                type: 'chatResponse',
                                success: false,
                                error: err.message
                            }));
                        }
                    })();
                } else if (data.type === 'chatHistory') {
                    ws.send(JSON.stringify({
                        type: 'chatHistory',
                        history: chat.getHistory()
                    }));
                } else if (data.type === 'clearChatHistory') {
                    chat.clearHistory();
                    ws.send(JSON.stringify({
                        type: 'chatHistory',
                        history: []
                    }));
                }
            } catch (e) {
                console.error('解析控制端消息失败:', e);
            }
        });
        
        ws.on('close', () => {
            controlClients.delete(ws);
            console.log(`控制端已断开，当前连接数: ${controlClients.size}`);
        });
    }
    
    ws.on('error', (error) => {
        console.error('WebSocket错误:', error.message);
    });
});

function getLocalIP() {
    return '192.168.1.39';
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

setInterval(() => {
    tts.cleanupOldTtsFiles();
}, 5 * 60 * 1000);

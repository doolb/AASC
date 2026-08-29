let scene, camera, renderer, sphere, count, originalPositions;

const ttsEngineSelect = document.getElementById('tts-engine');
const llmEngineSelect = document.getElementById('llm-engine');
const refAudioSelect = document.getElementById('ref-audio');
let referenceAudios = [];

async function loadServerConfig() {
    try {
        const response = await fetch('/config');
        const config = await response.json();
        
        if (config.llmEngine) {
            llmEngineSelect.value = config.llmEngine;
        }
        if (config.ttsEngine) {
            ttsEngineSelect.value = config.ttsEngine;
            if (config.ttsEngine === 'gptsovits') {
                await loadReferenceAudios();
                refAudioSelect.style.display = 'inline-block';
            }
        }
    } catch (e) {
        console.error('Failed to load server config:', e);
    }
}

loadServerConfig();

async function loadReferenceAudios() {
    try {
        const response = await fetch('/reference-audios');
        const data = await response.json();
        referenceAudios = data.audios || [];
        
        if (referenceAudios.length > 0) {
            refAudioSelect.innerHTML = '';
            referenceAudios.forEach((audio, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = audio.name.replace('.wav', '');
                refAudioSelect.appendChild(option);
            });
        }
    } catch (e) {
        console.error('Failed to load reference audios:', e);
    }
}

ttsEngineSelect.addEventListener('change', async () => {
    const engine = ttsEngineSelect.value;
    
    if (engine === 'gptsovits') {
        await loadReferenceAudios();
        refAudioSelect.style.display = 'inline-block';
        
        if (referenceAudios.length > 0) {
            const selected = referenceAudios[0];
            await fetch('/set-reference', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audioPath: selected.path,
                    promptText: selected.promptText
                })
            });
        }
    } else {
        refAudioSelect.style.display = 'none';
    }
});

refAudioSelect.addEventListener('change', async () => {
    const index = parseInt(refAudioSelect.value);
    if (referenceAudios[index]) {
        const selected = referenceAudios[index];
        await fetch('/set-reference', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audioPath: selected.path,
                promptText: selected.promptText
            })
        });
    }
});

function init3D() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030303, 0.002);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 35;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    const geometry = new THREE.SphereGeometry(12, 128, 128);
    const material = new THREE.PointsMaterial({
        size: 0.15,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        vertexColors: true
    });

    count = geometry.attributes.position.count;
    const colors = [];
    const color1 = new THREE.Color(0x00f2ff);
    const color2 = new THREE.Color(0xbd00ff);
    originalPositions = geometry.attributes.position.array.slice();

    for (let i = 0; i < count; i++) {
        const mixed = color1.clone().lerp(color2, Math.random());
        colors.push(mixed.r, mixed.g, mixed.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    sphere = new THREE.Points(geometry, material);
    scene.add(sphere);
}

let audioContext, analyser, dataArray;
let micAnalyser, micDataArray, micTimeDomainData;
let isAudioInit = false;
let isAudioUnlocked = false;
let smoothedBass = 0;
let smoothedAvg = 0;

const audioUnlockOverlay = document.getElementById('audio-unlock-overlay');

function unlockAudio() {
    if (isAudioUnlocked) return;
    
    isAudioUnlocked = true;
    
    if (audioUnlockOverlay) {
        audioUnlockOverlay.classList.add('hidden');
        setTimeout(() => {
            audioUnlockOverlay.style.display = 'none';
        }, 500);
    }
    
    initAudioContext().then(() => {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
        const silentAudio = document.createElement('audio');
        silentAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        silentAudio.play().catch(() => {});
        
        if (audioQueue.length > 0 && !isPlaying) {
            playNextAudio();
        }
    });
}

if (audioUnlockOverlay) {
    audioUnlockOverlay.addEventListener('click', unlockAudio);
    audioUnlockOverlay.addEventListener('touchstart', unlockAudio, { passive: true });
}

document.addEventListener('click', function checkFirstInteraction(e) {
    if (e.target !== audioUnlockOverlay && !audioUnlockOverlay?.contains(e.target)) {
        unlockAudio();
    }
}, { once: false });

const monitorCanvas = document.getElementById('mini-monitor');
const monitorCtx = monitorCanvas.getContext('2d');

async function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        micAnalyser = audioContext.createAnalyser();
        micAnalyser.fftSize = 256;
        micAnalyser.smoothingTimeConstant = 0.8;
        micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
        micTimeDomainData = new Uint8Array(micAnalyser.fftSize);
        
        isAudioInit = true;
    }
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
}

const recordBtn = document.getElementById('record-btn');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const chatHistory = document.getElementById('chat-history');
const statusDisplay = document.getElementById('status-display');
const audioPlayer = document.getElementById('audio-player');
const clearHistoryBtn = document.getElementById('clear-history');
const noInterruptCheckbox = document.getElementById('no-interrupt');

let pcmCapture = null;
let recordingStream = null;
let isRecording = false;
let isAlwaysListening = false;
let silenceStartTime = null;
let hasSpeech = false;
let currentAbortController = null;
let isFirstAudioOfSession = false;
let activeSessionId = null;
let wasListeningBeforePlayback = false;
let isLLMGenerating = false;
let recordingStartTime = null;
let speechStartTime = null;

const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION = 1000;

const toastContainer = document.getElementById('toast-container');

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    switch (type) {
        case 'start': icon = 'fa-microphone'; break;
        case 'stop': icon = 'fa-stop'; break;
        case 'success': icon = 'fa-check-circle'; break;
        case 'error': icon = 'fa-exclamation-circle'; break;
        case 'warning': icon = 'fa-exclamation-triangle'; break;
        case 'info': icon = 'fa-info-circle'; break;
    }
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 1500);
}

async function startRecording() {
    if (isRecording) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                sampleRate: 16000
            } 
        });
        recordingStream = stream;
        pcmCapture = new PcmAudioCapture().start(stream);
        isRecording = true;
        recordBtn.classList.add('recording');
        setStatus('LISTENING...', 'busy');
        silenceStartTime = null;
        hasSpeech = false;
        recordingStartTime = Date.now();
        speechStartTime = null;
        
        showToast('开始监听', 'start');
        
        initAudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(micAnalyser); 
        
    } catch (e) {
        console.error('Mic error:', e);
        if (pcmCapture) {
            pcmCapture.stop();
            pcmCapture = null;
        }
        if (recordingStream) {
            recordingStream.getTracks().forEach(track => track.stop());
            recordingStream = null;
        }
        let msg = '无法访问麦克风';
        if (e.name === 'NotAllowedError') {
            msg = '麦克风权限被拒绝，请在浏览器设置中允许';
        } else if (e.name === 'NotFoundError') {
            msg = '未找到麦克风设备';
        } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            msg = '麦克风需要 HTTPS 或 localhost 访问';
        }
        alert(msg);
        isAlwaysListening = false;
        recordBtn.classList.remove('active');
    }
}

async function sendRecordedAudio(audioBlob) {
    if (!audioBlob) return;
    if (currentAbortController) {
        showToast('取消上一次请求', 'warning');
        currentAbortController.abort();
        currentAbortController = null;
    }
    setStatus('UPLOADING...', 'busy');

    const speechOffset = speechStartTime ? (speechStartTime - recordingStartTime) : 0;
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');
    formData.append('speechOffset', speechOffset.toString());
    currentAbortController = new AbortController();
    try {
        const response = await fetch('/audio', {
            method: 'POST',
            body: formData,
            signal: currentAbortController.signal
        });
        handleStream(response);
    } catch (e) {
        if (e.name === 'AbortError') {
            showToast('请求已取消', 'info');
        } else {
            console.error(e);
            showToast('请求错误', 'error');
            setStatus('ERROR', 'busy');
        }
    }
}

function stopRecording() {
    if (!isRecording) return;
    const audioBlob = pcmCapture ? pcmCapture.stopWav() : null;
    pcmCapture = null;
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
    isRecording = false;
    recordBtn.classList.remove('recording');
    silenceStartTime = null;
    hasSpeech = false;
    showToast('停止监听', 'stop');
    void sendRecordedAudio(audioBlob);
}

let audioQueue = [];
let isPlaying = false;
let currentAudioSource = null;

function setStatus(status, type = 'normal') {
    statusDisplay.textContent = status;
    const dot = document.querySelector('.status-dot');
    dot.className = 'status-dot ' + (type === 'busy' ? 'busy' : 'healthy');
}

function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    
    if (role === 'assistant' && document.querySelector('.message.assistant.typing')) {
        const typingMsg = document.querySelector('.message.assistant.typing');
        typingMsg.classList.remove('typing');
    }

    div.innerHTML = `
        <div class="role-label">${role === 'user' ? 'USER' : 'AI CORE'}</div>
        <div class="message-content">${content}</div>
    `;
    
    if (role === 'assistant' && !content) {
        div.classList.add('typing');
    }
    
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return div;
}

async function playNextAudio() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        setStatus('WAITING FOR INPUT...');

        if (noInterruptCheckbox.checked && wasListeningBeforePlayback && !isLLMGenerating) {
            showToast('恢复监听', 'start');
            wasListeningBeforePlayback = false;
            setTimeout(startRecording, 500);
        } else if (isAlwaysListening && !noInterruptCheckbox.checked) {
            showToast('恢复监听', 'start');
            setTimeout(startRecording, 500);
        } else if (isLLMGenerating) {
        }
        return;
    }

    if (noInterruptCheckbox.checked && isRecording) {
        wasListeningBeforePlayback = isAlwaysListening;
        stopRecording();
    }
    
    isPlaying = true;
    const audioData = audioQueue.shift();
    const url = audioData.url;
    
    try {
        await initAudioContext();
        
        audioPlayer.src = url;
        
        if (!currentAudioSource) {
            try {
                const source = audioContext.createMediaElementSource(audioPlayer);
                source.connect(analyser);
                analyser.connect(audioContext.destination);
                currentAudioSource = source; 
            } catch (e) {
            }
        }
        
        await audioPlayer.play();
        setStatus('SPEAKING...', 'busy');
    } catch (e) {
        console.error('播放错误:', e);
        
        if (e.name === 'NotAllowedError') {
            isAudioUnlocked = false;
            if (audioUnlockOverlay) {
                audioUnlockOverlay.style.display = 'flex';
                audioUnlockOverlay.classList.remove('hidden');
                showToast('请点击屏幕解锁音频', 'warning');
            }
            audioQueue.unshift(audioData);
            isPlaying = false;
            return;
        }
        
        isPlaying = false;
        playNextAudio();
        return;
    }

    audioPlayer.onended = () => {
        console.log(`🎵 播放完成，播放下一个`);
        playNextAudio();
    };
    
    audioPlayer.onerror = (e) => {
        console.error('Audio error:', e);
        isPlaying = false;
        playNextAudio();
    };
}

async function handleStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let assistantMsgEl = null;
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');
        
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.slice(6));
                    
                    if (data.type === 'start') {
                        setStatus('PROCESSING...', 'busy');
                        isFirstAudioOfSession = true;
                        activeSessionId = data.session_id;
                        isLLMGenerating = true;
                        assistantMsgEl = addMessage('assistant', '');
                        showToast('处理中...', 'info');
                        
                        if (noInterruptCheckbox.checked && isAlwaysListening && !isRecording) {
                            wasListeningBeforePlayback = true;
                        }
                    } else if (data.type === 'status') {
                        setStatus(data.message, 'busy');
                    } else if (data.type === 'text') {
                        if (data.session_id && data.session_id !== activeSessionId) {
                            continue;
                        }
                        if (!assistantMsgEl) continue;
                        const contentDiv = assistantMsgEl.querySelector('.message-content');
                        contentDiv.textContent += data.content;
                        chatHistory.scrollTop = chatHistory.scrollHeight;
                    } else if (data.type === 'audio') {
                        if (data.session_id && data.session_id !== activeSessionId) {
                            continue;
                        }
                        if (isFirstAudioOfSession) {
                            isFirstAudioOfSession = false;
                            audioPlayer.pause();
                            audioPlayer.currentTime = 0;
                            audioQueue = [];
                            isPlaying = false;
                        }
                        audioQueue.push(data);
                        if (!isPlaying) {
                            playNextAudio();
                        }
                    } else if (data.type === 'asr') {
                        addMessage('user', data.text);
                    } else if (data.type === 'ignored') {
                        showToast('无效输入', 'warning');
                        setStatus('NO VALID INPUT');
                        if (isAlwaysListening) {
                            setTimeout(startRecording, 500);
                        }
                    } else if (data.type === 'interrupted') {
                        showToast('会话中断', 'warning');
                        isLLMGenerating = false;
                        if (assistantMsgEl) assistantMsgEl.classList.remove('typing');
                    } else if (data.type === 'error') {
                        console.error('Error:', data.message);
                        showToast('错误: ' + data.message, 'error');
                        setStatus('ERROR', 'busy');
                        isLLMGenerating = false;
                        if (assistantMsgEl) {
                            assistantMsgEl.classList.remove('typing');
                            const contentDiv = assistantMsgEl.querySelector('.message-content');
                            contentDiv.textContent = `错误: ${data.message}`;
                        }
                    } else if (data.type === 'end') {
                        isLLMGenerating = false;
                        showToast('生成完成', 'success');
                        if (assistantMsgEl) assistantMsgEl.classList.remove('typing');
                        
                        if (noInterruptCheckbox.checked && wasListeningBeforePlayback && !isPlaying && !isRecording) {
                            showToast('恢复监听', 'start');
                            wasListeningBeforePlayback = false;
                            setTimeout(startRecording, 500);
                        }
                    }
                } catch (e) {
                    console.error('Parse error:', e);
                }
            }
        }
    }
}

async function sendText() {
    const text = textInput.value.trim();
    if (!text) return;
    
    if (currentAbortController) {
        showToast('取消上一次请求', 'warning');
        currentAbortController.abort();
        currentAbortController = null;
    }
    
    textInput.value = '';
    addMessage('user', text);
    setStatus('THINKING...', 'busy');
    
    const ttsEngine = ttsEngineSelect.value;
    const llmEngine = llmEngineSelect.value;
    
    currentAbortController = new AbortController();
    
    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, tts_engine: ttsEngine, llm_engine: llmEngine }),
            signal: currentAbortController.signal
        });
        
        handleStream(response);
    } catch (e) {
        if (e.name === 'AbortError') {
            showToast('请求已取消', 'info');
        } else {
            console.error(e);
            showToast('请求错误', 'error');
            setStatus('ERROR', 'busy');
        }
    }
}

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    recordBtn.addEventListener('click', () => {
        if (!isAlwaysListening) {
            isAlwaysListening = true;
            wasListeningBeforePlayback = true;
            recordBtn.classList.add('active');
            const label = recordBtn.querySelector('.btn-label');
            if (label) label.textContent = 'ALWAYS LISTENING';
            startRecording();
        } else {
            isAlwaysListening = false;
            wasListeningBeforePlayback = false;
            recordBtn.classList.remove('active');
            const label = recordBtn.querySelector('.btn-label');
            if (label) label.textContent = 'TAP TO SPEAK';
            stopRecording();
        }
    });
} else {
    console.warn('麦克风不可用: 需要 HTTPS 或 localhost');
    recordBtn.style.opacity = '0.5';
    recordBtn.title = '麦克风需要 HTTPS 或 localhost';
}

let time = 0;
let mouseX = 0, mouseY = 0;

document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX - window.innerWidth / 2) * 0.0005;
    mouseY = (e.clientY - window.innerHeight / 2) * 0.0005;
});

function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

function drawMonitor(data) {
    monitorCtx.clearRect(0, 0, monitorCanvas.width, monitorCanvas.height);
    monitorCtx.fillStyle = '#00f2ff';
    
    const barWidth = 3;
    const gap = 1;
    const step = Math.floor(data.length / (monitorCanvas.width / (barWidth + gap)));

    for (let i = 0; i < monitorCanvas.width; i += (barWidth + gap)) {
        const dataIndex = Math.floor(i / (barWidth + gap)) * step;
        const value = data[dataIndex] || 0;
        const percent = value / 255;
        const barHeight = percent * monitorCanvas.height;

        monitorCtx.globalAlpha = 0.5 + (percent * 0.5);
        monitorCtx.fillRect(i, monitorCanvas.height - barHeight, barWidth, barHeight);
    }
}

window.addEventListener('load', () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        setTimeout(() => {
            recordBtn.click();
        }, 500);
    }
});

function drawIdleMonitor(t) {
    monitorCtx.clearRect(0, 0, monitorCanvas.width, monitorCanvas.height);
    monitorCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    for (let i = 0; i < monitorCanvas.width; i += 4) {
        const h = 5 + Math.sin(i * 0.1 + t * 5) * 3;
        monitorCtx.fillRect(i, monitorCanvas.height - h, 3, h);
    }
}

function animate() {
    requestAnimationFrame(animate);
    time += 0.005;

    let bassTarget = 0;
    let avgTarget = 0;
    let currentData = null;

    if (isAudioInit) {
        if (isRecording) {
            micAnalyser.getByteFrequencyData(micDataArray);
            currentData = micDataArray;
        } else {
            analyser.getByteFrequencyData(dataArray);
            currentData = dataArray;
        }

        const overallSum = currentData.reduce((a, b) => a + b, 0);
        avgTarget = overallSum / currentData.length;
        
        if (isRecording) {
            micAnalyser.getByteTimeDomainData(micTimeDomainData);
            
            let sumSquares = 0;
            for (let i = 0; i < micTimeDomainData.length; i++) {
                const normalized = (micTimeDomainData[i] - 128) / 128;
                sumSquares += normalized * normalized;
            }
            const rms = Math.sqrt(sumSquares / micTimeDomainData.length);
            
            if (rms >= SILENCE_THRESHOLD) {
                if (!hasSpeech && !speechStartTime) {
                    speechStartTime = Date.now();
                }
                hasSpeech = true;
                silenceStartTime = null;
            } else if (hasSpeech) {
                if (!silenceStartTime) silenceStartTime = Date.now();
                if (Date.now() - silenceStartTime > SILENCE_DURATION) {
                    stopRecording();
                }
            }
        }

        bassTarget = currentData[5] / 255;
        drawMonitor(currentData);
    } else {
        drawIdleMonitor(time);
    }

    smoothedBass = lerp(smoothedBass, bassTarget, 0.08);
    smoothedAvg = lerp(smoothedAvg, avgTarget / 255, 0.1);

    if (sphere) {
        const scaleTarget = 1 + (smoothedBass * 0.3);
        sphere.scale.lerp(new THREE.Vector3(scaleTarget, scaleTarget, scaleTarget), 0.05);

        const positions = sphere.geometry.attributes.position.array;
        const audioForce = smoothedAvg * 5.0;

        for (let i = 0; i < count; i++) {
            const px = originalPositions[i * 3];
            const py = originalPositions[i * 3 + 1];
            const pz = originalPositions[i * 3 + 2];

            let noise = Math.sin(px * 0.4 + time * 2) * 
                        Math.cos(py * 0.3 + time * 1.5) * 
                        Math.sin(pz * 0.4 + time * 2.5);

            const displacement = 1 + (noise * 0.1) + (noise * audioForce * 0.25);

            positions[i * 3]     = px * displacement;
            positions[i * 3 + 1] = py * displacement;
            positions[i * 3 + 2] = pz * displacement;
        }
        sphere.geometry.attributes.position.needsUpdate = true;
        sphere.rotation.y += 0.001 + (smoothedAvg * 0.002);
        sphere.rotation.x += (mouseY - sphere.rotation.x) * 0.05;
        sphere.rotation.y += (mouseX - sphere.rotation.y) * 0.05;
    }

    renderer.render(scene, camera);
}

try {
    init3D();
    animate();
} catch (e) {
    console.error("3D Init Failed:", e);
}

if (sendBtn) {
    sendBtn.addEventListener('click', () => {
        sendText();
    });
} else {
    console.error("Send button not found!");
}

if (textInput) {
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendText();
        }
    });
}

if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', async () => {
        await fetch('/history', { method: 'DELETE' });
        chatHistory.innerHTML = '';
        setStatus('HISTORY CLEARED');
    });
}

window.addEventListener('resize', () => {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});

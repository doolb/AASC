package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type Config struct {
	ServerURL    string  `json:"serverUrl"`
	DisplayID    string  `json:"displayId"`
	VADThreshold float64 `json:"vadThreshold"`
}

type VoiceDisplay struct {
	config       *Config
	ws           *websocket.Conn
	wsMutex      sync.Mutex
	asr          *ServerASR
	audio        *AudioPlayer
	recorder     *AudioRecorder
	stopChan     chan struct{}
	connected    bool
	connMutex    sync.Mutex
	asrReadyChan chan struct{}
}

func NewVoiceDisplay(cfg *Config) *VoiceDisplay {
	return &VoiceDisplay{
		config:       cfg,
		stopChan:     make(chan struct{}),
		asrReadyChan: make(chan struct{}, 1),
	}
}

func (vd *VoiceDisplay) Connect() error {
	u, err := url.Parse(vd.config.ServerURL)
	if err != nil {
		return fmt.Errorf("解析服务器URL失败: %w", err)
	}

	wsURL := fmt.Sprintf("ws://%s/ws", u.Host)
	if u.Scheme == "https" {
		wsURL = fmt.Sprintf("wss://%s/ws", u.Host)
	}

	log.Printf("[连接] 正在连接到 %s", wsURL)

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("WebSocket连接失败: %w", err)
	}

	vd.ws = conn
	vd.setConnected(true)

	registerMsg := map[string]interface{}{
		"type":       "register",
		"clientType": "display",
		"displayId":  vd.config.DisplayID,
	}
	vd.sendJSON(registerMsg)

	log.Printf("[连接] 已连接，显示端ID: %s", vd.config.DisplayID)
	return nil
}

func (vd *VoiceDisplay) setConnected(connected bool) {
	vd.connMutex.Lock()
	defer vd.connMutex.Unlock()
	vd.connected = connected
}

func (vd *VoiceDisplay) isConnected() bool {
	vd.connMutex.Lock()
	defer vd.connMutex.Unlock()
	return vd.connected
}

func (vd *VoiceDisplay) sendJSON(data map[string]interface{}) error {
	vd.wsMutex.Lock()
	defer vd.wsMutex.Unlock()
	if vd.ws == nil {
		return fmt.Errorf("WebSocket未连接")
	}
	return vd.ws.WriteJSON(data)
}

func (vd *VoiceDisplay) handleMessage(msgType string, data map[string]interface{}) {
	switch msgType {
	case "tts":
		vd.handleTTS(data)
	case "voiceInput":
		log.Printf("[消息] 收到语音输入确认")
	case "control":
		log.Printf("[消息] 收到控制指令: %v", data)
	case "reminder":
		vd.handleReminder(data)
	case "voiceCommand":
		vd.handleVoiceCommand(data)
	default:
		log.Printf("[消息] 未知消息类型: %s", msgType)
	}
}

func (vd *VoiceDisplay) handleTTS(data map[string]interface{}) {
	action, _ := data["action"].(string)
	switch action {
	case "playAudio":
		audioUrl, _ := data["audioUrl"].(string)
		text, _ := data["text"].(string)
		if text != "" {
			log.Printf("[TTS] 播报: %s", text)
		}
		if audioUrl != "" {
			vd.playAudioFromURL(audioUrl)
		}
	case "play":
		text, _ := data["text"].(string)
		if text != "" {
			log.Printf("[TTS] 播报文本: %s", text)
		}
	case "stop":
		if vd.audio != nil {
			vd.audio.Stop()
			vd.audio.ClearQueue()
		}
		log.Printf("[TTS] 停止播报并清空队列")
	}
}

func (vd *VoiceDisplay) handleReminder(data map[string]interface{}) {
	action, _ := data["action"].(string)
	switch action {
	case "voice":
		audioUrl, _ := data["audioUrl"].(string)
		text, _ := data["text"].(string)
		if text != "" {
			log.Printf("[提醒] 播报: %s", text)
		}
		if audioUrl != "" {
			vd.playAudioFromURL(audioUrl)
		}
	case "popup":
		content, _ := data["content"].(string)
		log.Printf("[提醒] 弹窗: %s", content)
	default:
		log.Printf("[提醒] 未知动作: %s", action)
	}
}

func (vd *VoiceDisplay) handleVoiceCommand(data map[string]interface{}) {
	action, _ := data["action"].(string)
	audioUrl, _ := data["audioUrl"].(string)
	text, _ := data["text"].(string)

	switch action {
	case "confirm":
		if audioUrl != "" {
			log.Printf("[语音命令] 确认: %s", text)
			vd.playAudioFromURL(audioUrl)
		}
	case "response":
		if audioUrl != "" {
			log.Printf("[语音命令] 响应: %s", text)
			vd.playAudioFromURL(audioUrl)
		}
	case "searchResult":
		if audioUrl != "" {
			log.Printf("[语音命令] 搜索结果: %s", text)
			vd.playAudioFromURL(audioUrl)
		}
	case "weatherResult":
		if audioUrl != "" {
			log.Printf("[语音命令] 天气结果: %s", text)
			vd.playAudioFromURL(audioUrl)
		}
	case "playChoices":
		if audioUrl != "" {
			log.Printf("[语音命令] 播放选项: %s", text)
			vd.playAudioFromURL(audioUrl)
		}
	default:
		if audioUrl != "" {
			log.Printf("[语音命令] %s: %s", action, text)
			vd.playAudioFromURL(audioUrl)
		}
	}
}

func (vd *VoiceDisplay) playAudioFromURL(audioUrl string) {
	if vd.audio == nil {
		log.Printf("[TTS] 音频播放器未初始化")
		return
	}

	serverBase := vd.config.ServerURL
	fullURL := fmt.Sprintf("%s%s", serverBase, audioUrl)

	vd.audio.QueueURL(fullURL)
}

func (vd *VoiceDisplay) sendVoiceInput(text string) {
	if text == "" {
		return
	}

	msg := map[string]interface{}{
		"type":     "voiceInput",
		"text":     text,
		"isFinal":  true,
		"fullText": text,
	}

	if err := vd.sendJSON(msg); err != nil {
		log.Printf("[语音] 发送语音输入失败: %v", err)
	} else {
		log.Printf("[语音] 已发送: %s", text)
	}
}

func (vd *VoiceDisplay) startVoiceRecognition() error {
	if vd.asr == nil || !vd.asr.IsReady() {
		return fmt.Errorf("服务器端ASR不可用")
	}

	log.Printf("[语音] 开始语音识别（服务器端ASR）...")

	go func() {
		audioChan := make(chan []byte, 100)

		go vd.recorder.Start(audioChan, vd.stopChan)

		for wavData := range audioChan {
			text, err := vd.asr.Recognize(wavData)
			if err != nil {
				log.Printf("[语音] 服务器识别失败: %v", err)
				continue
			}
			if text != "" {
				log.Printf("[语音] 识别结果: %s", text)
				vd.sendVoiceInput(text)
			} else {
				log.Printf("[语音] 服务器忽略该段音频")
			}
		}
	}()

	return nil
}

func (vd *VoiceDisplay) waitForASRReady() {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-vd.stopChan:
				return
			case <-ticker.C:
				if vd.asr != nil && vd.asr.RefreshStatus() {
					log.Printf("[ASR] 服务器端ASR已就绪，启动语音识别")
					select {
					case vd.asrReadyChan <- struct{}{}:
					default:
					}
					if err := vd.startVoiceRecognition(); err != nil {
						log.Printf("[ASR] 启动语音识别失败: %v", err)
					}
					return
				}
			}
		}
	}()
}

func (vd *VoiceDisplay) setupPlaybackPause() {
	if vd.audio == nil || vd.recorder == nil {
		return
	}

	vd.audio.SetOnPlayStart(func() {
		log.Printf("[录音] 播放开始，暂停录音")
		vd.recorder.Pause()
	})

	vd.audio.SetOnPlayEnd(func() {
		log.Printf("[录音] 播放结束，恢复录音")
		vd.recorder.Resume()
	})
}

func (vd *VoiceDisplay) ListenMessages() {
	defer func() {
		vd.setConnected(false)
		log.Printf("[连接] 消息监听结束")
	}()

	for {
		select {
		case <-vd.stopChan:
			return
		default:
		}

		if vd.ws == nil {
			time.Sleep(time.Second)
			continue
		}

		_, message, err := vd.ws.ReadMessage()
		if err != nil {
			if !vd.isConnected() {
				return
			}
			log.Printf("[连接] 读取消息失败: %v", err)
			vd.reconnect()
			continue
		}

		var data map[string]interface{}
		if err := json.Unmarshal(message, &data); err != nil {
			continue
		}

		msgType, _ := data["type"].(string)
		vd.handleMessage(msgType, data)
	}
}

func (vd *VoiceDisplay) reconnect() {
	vd.setConnected(false)

	for i := 1; i <= 5; i++ {
		log.Printf("[重连] 第%d次尝试重连...", i)
		time.Sleep(time.Duration(i*2) * time.Second)

		if err := vd.Connect(); err != nil {
			log.Printf("[重连] 重连失败: %v", err)
			continue
		}
		log.Printf("[重连] 重连成功")
		return
	}

	log.Printf("[重连] 重连失败，退出")
	close(vd.stopChan)
}

func (vd *VoiceDisplay) Start() error {
	var err error

	vd.audio, err = NewAudioPlayer()
	if err != nil {
		return fmt.Errorf("初始化音频播放器失败: %w", err)
	}

	vd.asr = NewServerASR(vd.config.ServerURL)
	if !vd.asr.IsReady() {
		log.Printf("[警告] 服务器端ASR不可用，语音识别功能将不可用")
	}

	vd.recorder = NewAudioRecorder()

	vd.setupPlaybackPause()

	if err := vd.Connect(); err != nil {
		return fmt.Errorf("连接服务器失败: %w", err)
	}

	if vd.asr != nil && vd.asr.IsReady() {
		if err := vd.startVoiceRecognition(); err != nil {
			log.Printf("[警告] 语音识别启动失败: %v", err)
		}
	} else {
		log.Printf("[ASR] 等待ASR就绪...")
		vd.waitForASRReady()
	}

	go vd.ListenMessages()

	log.Printf("[启动] 语音显示端已启动")
	return nil
}

func (vd *VoiceDisplay) Stop() {
	close(vd.stopChan)

	if vd.recorder != nil {
		vd.recorder.Stop()
	}
	if vd.audio != nil {
		vd.audio.Stop()
	}
	if vd.asr != nil {
		vd.asr.Close()
	}
	if vd.ws != nil {
		vd.ws.Close()
	}

	log.Printf("[停止] 语音显示端已停止")
}

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	if cfg.ServerURL == "" {
		cfg.ServerURL = "http://localhost:3000"
	}
	if cfg.VADThreshold == 0 {
		cfg.VADThreshold = 0.5
	}

	return &cfg, nil
}

func main() {
	configPath := "config.json"
	if len(os.Args) > 1 {
		configPath = os.Args[1]
	}

	cfg, err := loadConfig(configPath)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	vd := NewVoiceDisplay(cfg)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	if err := vd.Start(); err != nil {
		log.Fatalf("启动失败: %v", err)
	}

	<-sigChan
	log.Printf("收到退出信号，正在关闭...")
	vd.Stop()
}

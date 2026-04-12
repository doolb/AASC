package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/hajimehoshi/oto/v2"
)

type queueItem struct {
	itemType string
	url      string
	data     []byte
}

type AudioPlayer struct {
	context      *oto.Context
	player       *oto.Player
	mu           sync.Mutex
	stopChan     chan struct{}
	playQueue    []queueItem
	queueMu      sync.Mutex
	processing   bool
	stopRequested bool
}

func NewAudioPlayer() (*AudioPlayer, error) {
	ctx, ready, err := oto.NewContext(&oto.NewContextOptions{
		SampleRate:   16000,
		ChannelCount: 1,
		BitDepthInBytes: 2,
	})
	if err != nil {
		return nil, fmt.Errorf("创建音频上下文失败: %w", err)
	}
	<-ready

	return &AudioPlayer{
		context:   ctx,
		stopChan:  make(chan struct{}),
		playQueue: make([]queueItem, 0),
	}, nil
}

func (ap *AudioPlayer) QueueURL(url string) {
	ap.queueMu.Lock()
	ap.stopRequested = false
	ap.playQueue = append(ap.playQueue, queueItem{itemType: "url", url: url})
	queueLen := len(ap.playQueue)
	ap.queueMu.Unlock()

	log.Printf("[音频队列] 加入队列，当前队列长度: %d", queueLen)
	go ap.processQueue()
}

func (ap *AudioPlayer) QueueData(data []byte) {
	ap.queueMu.Lock()
	ap.stopRequested = false
	ap.playQueue = append(ap.playQueue, queueItem{itemType: "data", data: data})
	queueLen := len(ap.playQueue)
	ap.queueMu.Unlock()

	log.Printf("[音频队列] 加入队列，当前队列长度: %d", queueLen)
	go ap.processQueue()
}

func (ap *AudioPlayer) processQueue() {
	ap.queueMu.Lock()
	if ap.processing {
		ap.queueMu.Unlock()
		return
	}
	ap.processing = true
	ap.queueMu.Unlock()

	defer func() {
		ap.queueMu.Lock()
		ap.processing = false
		ap.queueMu.Unlock()
	}()

	for {
		ap.queueMu.Lock()
		if ap.stopRequested || len(ap.playQueue) == 0 {
			ap.playQueue = ap.playQueue[:0]
			ap.queueMu.Unlock()
			break
		}
		item := ap.playQueue[0]
		ap.playQueue = ap.playQueue[1:]
		ap.queueMu.Unlock()

		switch item.itemType {
		case "url":
			if err := ap.PlayFromURL(item.url); err != nil {
				log.Printf("[音频队列] 播放URL失败: %v", err)
			}
		case "data":
			if err := ap.playData(item.data); err != nil {
				log.Printf("[音频队列] 播放数据失败: %v", err)
			}
		}
	}
}

func (ap *AudioPlayer) ClearQueue() {
	ap.queueMu.Lock()
	ap.playQueue = ap.playQueue[:0]
	ap.queueMu.Unlock()
	log.Printf("[音频队列] 已清空")
}

func (ap *AudioPlayer) PlayFromURL(url string) error {
	ap.mu.Lock()
	defer ap.mu.Unlock()

	if ap.stopRequested {
		log.Printf("[音频] 跳过播放（已停止）")
		return nil
	}

	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("下载音频失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载音频失败: HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("读取音频数据失败: %w", err)
	}

	return ap.playData(data)
}

func (ap *AudioPlayer) PlayFile(path string) error {
	ap.mu.Lock()
	defer ap.mu.Unlock()

	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("读取音频文件失败: %w", err)
	}

	return ap.playData(data)
}

func (ap *AudioPlayer) playData(data []byte) error {
	if ap.stopRequested {
		log.Printf("[音频] 跳过播放（已停止）")
		return nil
	}

	if ap.player != nil {
		ap.player.Close()
	}

	ap.player = ap.context.NewPlayer(func() []byte {
		return data
	})

	ap.player.Play()

	log.Printf("[音频] 开始播放 (%d bytes)", len(data))
	return nil
}

func (ap *AudioPlayer) Stop() {
	ap.mu.Lock()
	defer ap.mu.Unlock()

	ap.stopRequested = true
	ap.processing = false

	if ap.player != nil {
		ap.player.Close()
		ap.player = nil
	}
}

func (ap *AudioPlayer) PlayTTSResponse(audioUrl string) error {
	return ap.PlayFromURL(audioUrl)
}

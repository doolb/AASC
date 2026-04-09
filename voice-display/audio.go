package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/hajimehoshi/oto/v2"
)

type AudioPlayer struct {
	context  *oto.Context
	player   *oto.Player
	mu       sync.Mutex
	stopChan chan struct{}
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
		context:  ctx,
		stopChan: make(chan struct{}),
	}, nil
}

func (ap *AudioPlayer) PlayFromURL(url string) error {
	ap.mu.Lock()
	defer ap.mu.Unlock()

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

	if ap.player != nil {
		ap.player.Close()
		ap.player = nil
	}
}

func (ap *AudioPlayer) PlayTTSResponse(audioUrl string) error {
	return ap.PlayFromURL(audioUrl)
}

func LoadAudioConfig(path string) (map[string]interface{}, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	return config, nil
}

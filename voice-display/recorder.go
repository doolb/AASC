package main

import (
	"log"
	"sync"

	"github.com/hajimehoshi/oto/v2"
)

type AudioRecorder struct {
	context  *oto.Context
	recording bool
	mu       sync.Mutex
}

func NewAudioRecorder() *AudioRecorder {
	return &AudioRecorder{}
}

func (r *AudioRecorder) Start(audioChan chan<- []float32, stopChan <-chan struct{}) error {
	ctx, ready, err := oto.NewContext(&oto.NewContextOptions{
		SampleRate:   16000,
		ChannelCount: 1,
		BitDepthInBytes: 2,
	})
	if err != nil {
		return err
	}
	<-ready

	r.context = ctx
	r.mu.Lock()
	r.recording = true
	r.mu.Unlock()

	const bufferSize = 4096
	buf := make([]byte, bufferSize)
	samples := make([]float32, bufferSize/2)

	const silenceThreshold = 0.01
	const minSpeechDuration = 300
	var hasSpeech bool
	var speechFrameCount int

	for {
		select {
		case <-stopChan:
			r.mu.Lock()
			r.recording = false
			r.mu.Unlock()
			return nil
		default:
		}

		n, err := ctx.NewPlayer(func() []byte { return buf }).Read(buf[:bufferSize])
		if err != nil {
			log.Printf("[录音] 读取音频失败: %v", err)
			continue
		}

		if n == 0 {
			continue
		}

		for i := 0; i < n/2 && i < len(samples); i++ {
			sample := int16(buf[i*2]) | int16(buf[i*2+1])<<8
			samples[i] = float32(sample) / 32768.0
		}

		rms := computeRMS(samples[:n/2])

		if rms >= silenceThreshold {
			hasSpeech = true
			speechFrameCount++
		} else if hasSpeech && speechFrameCount >= minSpeechDuration/20 {
			chunk := make([]float32, speechFrameCount*bufferSize/2)
			copy(chunk, samples)
			select {
			case audioChan <- chunk:
			default:
			}
			hasSpeech = false
			speechFrameCount = 0
		}
	}
}

func (r *AudioRecorder) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.recording = false
	if r.context != nil {
		r.context.Close()
	}
}

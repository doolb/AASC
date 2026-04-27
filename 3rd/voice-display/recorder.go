package main

import (
	"encoding/binary"
	"math"
	"sync"

	"github.com/gen2brain/malgo"
)

type AudioRecorder struct {
	recording  bool
	paused     bool
	mu         sync.Mutex
	sampleRate int
}

func NewAudioRecorder() *AudioRecorder {
	return &AudioRecorder{
		sampleRate: 16000,
	}
}

func (r *AudioRecorder) Start(audioChan chan<- []byte, stopChan <-chan struct{}) error {
	ctx, err := malgo.InitContext(nil, malgo.ContextConfig{}, nil)
	if err != nil {
		return err
	}
	defer ctx.Free()

	deviceConfig := malgo.DefaultDeviceConfig(malgo.Capture)
	deviceConfig.Capture.Format = malgo.FormatS16
	deviceConfig.Capture.Channels = 1
	deviceConfig.Capture.SampleRate = r.sampleRate
	deviceConfig.Alsa.NoMMap = 1

	const silenceThreshold = 0.01
	const minSpeechDuration = 300
	const frameDurationMs = 20
	framesPerBuffer := r.sampleRate * frameDurationMs / 1000

	var hasSpeech bool
	var speechSamples []int16
	var silenceFrameCount int
	silenceFramesNeeded := minSpeechDuration / frameDurationMs

	onRecvFrames := func(pOutputSample, pInputSamples []byte, framecount uint32) {
		r.mu.Lock()
		isPaused := r.paused
		r.mu.Unlock()

		if isPaused {
			hasSpeech = false
			speechSamples = nil
			silenceFrameCount = 0
			return
		}

		samples := make([]int16, framecount)
		for i := uint32(0); i < framecount; i++ {
			samples[i] = int16(binary.LittleEndian.Uint16(pInputSamples[i*2 : i*2+2]))
		}

		rms := computeRMS(samples)

		if rms >= silenceThreshold {
			hasSpeech = true
			speechSamples = append(speechSamples, samples...)
			silenceFrameCount = 0
		} else if hasSpeech {
			speechSamples = append(speechSamples, samples...)
			silenceFrameCount++

			if silenceFrameCount >= silenceFramesNeeded {
				if len(speechSamples) >= framesPerBuffer {
					wavData := encodeWAV(speechSamples, r.sampleRate)
					select {
					case audioChan <- wavData:
					default:
					}
				}
				speechSamples = nil
				hasSpeech = false
				silenceFrameCount = 0
			}
		}
	}

	callback := malgo.DataProc(onRecvFrames)

	err = ctx.DeviceInit(malgo.Capture, &deviceConfig, callback)
	if err != nil {
		return err
	}

	r.mu.Lock()
	r.recording = true
	r.mu.Unlock()

	ctx.DeviceStart(malgo.Capture)

	<-stopChan

	ctx.DeviceStop(malgo.Capture)

	r.mu.Lock()
	r.recording = false
	r.mu.Unlock()

	if hasSpeech && len(speechSamples) >= framesPerBuffer {
		wavData := encodeWAV(speechSamples, r.sampleRate)
		select {
		case audioChan <- wavData:
		default:
		}
	}

	return nil
}

func (r *AudioRecorder) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.recording = false
}

func (r *AudioRecorder) IsRecording() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.recording
}

func (r *AudioRecorder) Pause() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.paused = true
	log.Printf("[录音] 已暂停")
}

func (r *AudioRecorder) Resume() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.paused = false
	log.Printf("[录音] 已恢复")
}

func (r *AudioRecorder) IsPaused() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.paused
}

func encodeWAV(samples []int16, sampleRate int) []byte {
	numChannels := 1
	bitsPerSample := 16
	byteRate := sampleRate * numChannels * bitsPerSample / 8
	blockAlign := numChannels * bitsPerSample / 8
	dataSize := len(samples) * 2

	buf := make([]byte, 44+dataSize)

	copy(buf[0:4], []byte("RIFF"))
	binary.LittleEndian.PutUint32(buf[4:8], uint32(36+dataSize))
	copy(buf[8:12], []byte("WAVE"))

	copy(buf[12:16], []byte("fmt "))
	binary.LittleEndian.PutUint32(buf[16:20], 16)
	binary.LittleEndian.PutUint16(buf[20:22], 1)
	binary.LittleEndian.PutUint16(buf[22:24], uint16(numChannels))
	binary.LittleEndian.PutUint32(buf[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(buf[28:32], uint32(byteRate))
	binary.LittleEndian.PutUint16(buf[32:34], uint16(blockAlign))
	binary.LittleEndian.PutUint16(buf[34:36], uint16(bitsPerSample))

	copy(buf[36:40], []byte("data"))
	binary.LittleEndian.PutUint32(buf[40:44], uint32(dataSize))

	for i, sample := range samples {
		binary.LittleEndian.PutUint16(buf[44+i*2:], uint16(sample))
	}

	return buf
}

func computeRMS(samples []int16) float64 {
	var sumSquares float64
	for _, s := range samples {
		v := float64(s) / 32768.0
		sumSquares += v * v
	}
	if len(samples) == 0 {
		return 0
	}
	return math.Sqrt(sumSquares / float64(len(samples)))
}

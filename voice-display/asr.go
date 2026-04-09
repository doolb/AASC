package main

import (
	"fmt"
	"log"
	"math"

	"github.com/maxhawkins/go-whisper"
)

type ASREngine struct {
	model    whisper.Model
	language string
}

func NewASREngine(modelPath string) (*ASREngine, error) {
	if modelPath == "" {
		return nil, fmt.Errorf("模型路径未指定")
	}

	model, err := whisper.New(modelPath)
	if err != nil {
		return nil, fmt.Errorf("加载ASR模型失败: %w", err)
	}

	log.Printf("[ASR] 模型加载完成: %s", modelPath)

	return &ASREngine{
		model:    model,
		language: "zh",
	}, nil
}

func (e *ASREngine) ProcessStream(audioChan <-chan []float32, callback func(text string, isFinal bool)) {
	context, err := e.model.NewContext()
	if err != nil {
		log.Printf("[ASR] 创建上下文失败: %v", err)
		return
	}

	context.SetLanguage(e.language)

	var buffer []float32
	const chunkSize = 16000 * 3

	for chunk := range audioChan {
		buffer = append(buffer, chunk...)

		if len(buffer) >= chunkSize {
			text, err := e.recognize(buffer)
			if err != nil {
				log.Printf("[ASR] 识别失败: %v", err)
			} else if text != "" {
				callback(text, true)
			}
			buffer = buffer[:0]
		}
	}

	if len(buffer) > 0 {
		text, err := e.recognize(buffer)
		if err != nil {
			log.Printf("[ASR] 最终识别失败: %v", err)
		} else if text != "" {
			callback(text, true)
		}
	}
}

func (e *ASREngine) recognize(audio []float32) (string, error) {
	context, err := e.model.NewContext()
	if err != nil {
		return "", err
	}

	context.SetLanguage(e.language)

	if err := context.Process(audio); err != nil {
		return "", err
	}

	var result string
	for {
		segment, err := context.NextSegment()
		if err != nil {
			break
		}
		result += segment.Text
	}

	return result, nil
}

func (e *ASREngine) Close() {
	if e.model != nil {
		e.model.Close()
	}
}

func computeRMS(samples []float32) float64 {
	var sumSquares float64
	for _, s := range samples {
		sumSquares += float64(s) * float64(s)
	}
	if len(samples) == 0 {
		return 0
	}
	return math.Sqrt(sumSquares / float64(len(samples)))
}

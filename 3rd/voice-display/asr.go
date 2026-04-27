package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"time"
)

type ServerASR struct {
	serverURL string
	client    *http.Client
	ready     bool
}

type asrStatusResponse struct {
	Status string `json:"status"`
	Ready  bool   `json:"ready"`
}

type asrRecognizeResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Text    string `json:"text"`
}

func NewServerASR(serverURL string) *ServerASR {
	asr := &ServerASR{
		serverURL: serverURL,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	asr.ready = asr.checkReady()
	if asr.ready {
		log.Printf("[ASR] 服务器端 ASR 可用")
	} else {
		log.Printf("[ASR] 服务器端 ASR 不可用")
	}

	return asr
}

func (a *ServerASR) checkReady() bool {
	url := fmt.Sprintf("%s/api/asr/status", a.serverURL)

	resp, err := a.client.Get(url)
	if err != nil {
		log.Printf("[ASR] 检查ASR状态失败: %v", err)
		return false
	}
	defer resp.Body.Close()

	var result asrStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[ASR] 解析ASR状态响应失败: %v", err)
		return false
	}

	return result.Ready
}

func (a *ServerASR) IsReady() bool {
	return a.ready
}

func (a *ServerASR) RefreshStatus() bool {
	a.ready = a.checkReady()
	return a.ready
}

func (a *ServerASR) Recognize(wavData []byte) (string, error) {
	url := fmt.Sprintf("%s/api/asr/recognize", a.serverURL)

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	part, err := writer.CreateFormFile("audio", "audio.wav")
	if err != nil {
		return "", fmt.Errorf("创建表单文件失败: %w", err)
	}

	if _, err := io.Copy(part, bytes.NewReader(wavData)); err != nil {
		return "", fmt.Errorf("写入音频数据失败: %w", err)
	}

	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("关闭表单写入器失败: %w", err)
	}

	req, err := http.NewRequest("POST", url, &buf)
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("发送识别请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("服务器返回错误 %d: %s", resp.StatusCode, string(body))
	}

	var result asrRecognizeResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("解析识别响应失败: %w", err)
	}

	switch result.Status {
	case "success":
		return result.Text, nil
	case "ignored":
		return "", nil
	default:
		return "", fmt.Errorf("识别失败: %s", result.Message)
	}
}

func (a *ServerASR) Close() {
}

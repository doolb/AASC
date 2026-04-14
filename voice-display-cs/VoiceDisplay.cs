using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace VoiceDisplayCs;

public class VoiceDisplay : IDisposable
{
    private readonly Config _config;
    private ClientWebSocket? _ws;
    private AsrClient? _asr;
    private AudioPlayer? _audio;
    private AudioRecorder? _recorder;
    private CancellationTokenSource? _stopCts;
    private bool _connected;
    private int _reconnectAttempts;
    private const int MaxReconnectAttempts = 5;
    private bool _disposed;

    public VoiceDisplay(Config config)
    {
        _config = config;
    }

    public async Task ConnectAsync()
    {
        var uri = new Uri(_config.ServerUrl);
        var wsProtocol = uri.Scheme == "https" ? "wss" : "ws";
        var wsUrl = $"{wsProtocol}://{uri.Authority}/display?subDisplay=true&displayId={Uri.EscapeDataString(_config.DisplayId)}";

        Console.WriteLine($"[连接] 正在连接到 {wsUrl}");

        _ws = new ClientWebSocket();
        _ws.Options.RemoteCertificateValidationCallback = (_, _, _, _) => true;

        await _ws.ConnectAsync(new Uri(wsUrl), _stopCts?.Token ?? CancellationToken.None);

        _connected = true;
        _reconnectAttempts = 0;

        Console.WriteLine($"[连接] 已连接，显示端ID: {_config.DisplayId}");

        await DeclareCapabilitiesAsync();
    }

    private async Task SendJsonAsync(Dictionary<string, object> data)
    {
        if (_ws?.State != WebSocketState.Open) return;

        var json = JsonSerializer.Serialize(data, AppJsonContext.Default.DictionaryStringObject);
        var bytes = Encoding.UTF8.GetBytes(json);
        await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true,
            _stopCts?.Token ?? CancellationToken.None);
    }

    private async Task DeclareCapabilitiesAsync()
    {
        await SendJsonAsync(new Dictionary<string, object>
        {
            ["type"] = "capabilities",
            ["capabilities"] = new Dictionary<string, bool>
            {
                ["mediaRendering"] = false,
                ["voicePlayback"] = true,
                ["voiceRecording"] = true,
                ["voiceRecognition"] = true,
                ["displayText"] = false
            }
        });
        Console.WriteLine("[能力] 已声明子显示端能力");
    }

    private async Task ListenMessagesAsync()
    {
        var buffer = new byte[8192];

        try
        {
            while (_connected && _ws?.State == WebSocketState.Open)
            {
                WebSocketReceiveResult result;
                using var ms = new MemoryStream();

                do
                {
                    result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer),
                        _stopCts?.Token ?? CancellationToken.None);
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _connected = false;
                    Console.WriteLine("[连接] 连接已关闭");
                    _ = ReconnectAsync();
                    return;
                }

                var json = Encoding.UTF8.GetString(ms.ToArray());
                try
                {
                    var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;

                    if (root.TryGetProperty("type", out var typeElement))
                    {
                        var msgType = typeElement.GetString() ?? "";
                        await HandleMessageAsync(msgType, root);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[消息] 解析消息失败: {ex.Message}");
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (WebSocketException ex)
        {
            Console.WriteLine($"[连接] WebSocket错误: {ex.Message}");
            _connected = false;
            _ = ReconnectAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[连接] 消息监听异常: {ex.Message}");
            _connected = false;
            _ = ReconnectAsync();
        }
    }

    private async Task HandleMessageAsync(string msgType, JsonElement data)
    {
        switch (msgType)
        {
            case "displayId":
                var id = data.TryGetProperty("id", out var idEl) ? idEl.GetString() : "";
                var ip = data.TryGetProperty("ip", out var ipEl) ? ipEl.GetString() : "";
                Console.WriteLine($"[消息] 收到显示端ID: {id}, IP: {ip}");
                break;
            case "serverStartTime":
                var time = data.TryGetProperty("time", out var timeEl) ? timeEl.GetString() : "";
                Console.WriteLine($"[消息] 服务器启动时间: {time}");
                break;
            case "restoreState":
                Console.WriteLine("[消息] 收到恢复状态");
                break;
            case "tts":
                await HandleTTSAsync(data);
                break;
            case "voiceInput":
                Console.WriteLine("[消息] 收到语音输入确认");
                break;
            case "control":
                Console.WriteLine($"[消息] 收到控制指令");
                break;
            case "media":
                Console.WriteLine("[消息] 收到媒体指令（子显示端不支持媒体显示）");
                break;
            case "reminder":
                await HandleReminderAsync(data);
                break;
            case "voiceCommand":
                await HandleVoiceCommandAsync(data);
                break;
            default:
                Console.WriteLine($"[消息] 未知消息类型: {msgType}");
                break;
        }
    }

    private async Task HandleTTSAsync(JsonElement data)
    {
        var action = data.TryGetProperty("action", out var actionEl) ? actionEl.GetString() : "";

        switch (action)
        {
            case "playAudio":
                var audioUrl = data.TryGetProperty("audioUrl", out var urlEl) ? urlEl.GetString() : "";
                var text = data.TryGetProperty("text", out var textEl) ? textEl.GetString() : "";
                if (!string.IsNullOrEmpty(text))
                    Console.WriteLine($"[TTS] 播报: {text}");
                if (!string.IsNullOrEmpty(audioUrl))
                    await PlayAudioFromURLAsync(audioUrl);
                break;
            case "play":
                var playText = data.TryGetProperty("text", out var playTextEl) ? playTextEl.GetString() : "";
                if (!string.IsNullOrEmpty(playText))
                    Console.WriteLine($"[TTS] 播报文本: {playText}");
                break;
            case "stop":
                if (_audio != null)
                {
                    _audio.Stop();
                    _audio.ClearQueue();
                }
                Console.WriteLine("[TTS] 停止播报并清空队列");
                break;
        }
    }

    private async Task HandleReminderAsync(JsonElement data)
    {
        var action = data.TryGetProperty("action", out var actionEl) ? actionEl.GetString() : "";

        switch (action)
        {
            case "voice":
                var audioUrl = data.TryGetProperty("audioUrl", out var urlEl) ? urlEl.GetString() : "";
                var text = data.TryGetProperty("text", out var textEl) ? textEl.GetString() : "";
                if (!string.IsNullOrEmpty(text))
                    Console.WriteLine($"[提醒] 播报: {text}");
                if (!string.IsNullOrEmpty(audioUrl))
                    await PlayAudioFromURLAsync(audioUrl);
                break;
            case "popup":
                var content = data.TryGetProperty("content", out var contentEl) ? contentEl.GetString() : "";
                Console.WriteLine($"[提醒] 弹窗: {content}");
                break;
            default:
                Console.WriteLine($"[提醒] 未知动作: {action}");
                break;
        }
    }

    private async Task HandleVoiceCommandAsync(JsonElement data)
    {
        var action = data.TryGetProperty("action", out var actionEl) ? actionEl.GetString() : "";
        var audioUrl = data.TryGetProperty("audioUrl", out var urlEl) ? urlEl.GetString() : "";
        var text = data.TryGetProperty("text", out var textEl) ? textEl.GetString() : "";

        switch (action)
        {
            case "confirm":
                if (!string.IsNullOrEmpty(audioUrl))
                {
                    Console.WriteLine($"[语音命令] 确认: {text}");
                    await PlayAudioFromURLAsync(audioUrl);
                }
                break;
            case "response":
                if (!string.IsNullOrEmpty(audioUrl))
                {
                    Console.WriteLine($"[语音命令] 响应: {text}");
                    await PlayAudioFromURLAsync(audioUrl);
                }
                break;
            case "searchResult":
                if (!string.IsNullOrEmpty(audioUrl))
                {
                    Console.WriteLine($"[语音命令] 搜索结果: {text}");
                    await PlayAudioFromURLAsync(audioUrl);
                }
                break;
            case "weatherResult":
                if (!string.IsNullOrEmpty(audioUrl))
                {
                    Console.WriteLine($"[语音命令] 天气结果: {text}");
                    await PlayAudioFromURLAsync(audioUrl);
                }
                break;
            case "playChoices":
                if (!string.IsNullOrEmpty(audioUrl))
                {
                    Console.WriteLine($"[语音命令] 播放选项: {text}");
                    await PlayAudioFromURLAsync(audioUrl);
                }
                break;
            default:
                if (!string.IsNullOrEmpty(audioUrl))
                {
                    Console.WriteLine($"[语音命令] {action}: {text}");
                    await PlayAudioFromURLAsync(audioUrl);
                }
                break;
        }
    }

    private Task PlayAudioFromURLAsync(string audioUrl)
    {
        if (_audio == null)
        {
            Console.WriteLine("[TTS] 音频播放器未初始化");
            return Task.CompletedTask;
        }

        var fullUrl = $"{_config.ServerUrl}{audioUrl}";

        try
        {
            _audio.QueueURL(fullUrl);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[TTS] 加入播放队列失败: {ex.Message}");
        }

        return Task.CompletedTask;
    }

    private void SendVoiceInput(string text)
    {
        if (string.IsNullOrEmpty(text)) return;

        var msg = new Dictionary<string, object>
        {
            ["type"] = "voiceInput",
            ["text"] = text,
            ["isFinal"] = true,
            ["fullText"] = text
        };

        _ = SendJsonAsync(msg);
        Console.WriteLine($"[语音] 已发送: {text}");
    }

    private void StartVoiceRecognition()
    {
        if (_asr == null || !_asr.IsReady)
        {
            Console.WriteLine("[语音] 服务器端ASR不可用，语音识别功能将不可用");
            return;
        }

        if (_recorder == null)
        {
            Console.WriteLine("[语音] 录音器不可用，语音识别功能将不可用");
            return;
        }

        Console.WriteLine("[语音] 开始语音识别（服务器端ASR）...");

        var token = _stopCts?.Token ?? CancellationToken.None;

        _recorder.Start(async wavData =>
        {
            try
            {
                var result = await _asr.RecognizeAsync(wavData);
                if (result != null && result.Length > 0)
                {
                    Console.WriteLine($"[语音] 识别结果: {result}");
                    SendVoiceInput(result);
                }
                else if (result == "")
                {
                    Console.WriteLine("[语音] 服务器忽略该段音频");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[语音] 服务器识别失败: {ex.Message}");
            }
        }, token);
    }

    private async Task ReconnectAsync()
    {
        if (_reconnectAttempts >= MaxReconnectAttempts)
        {
            Console.WriteLine("[重连] 达到最大重连次数，退出");
            _stopCts?.Cancel();
            return;
        }

        _reconnectAttempts++;
        var delay = _reconnectAttempts * 2000;

        Console.WriteLine($"[重连] 第{_reconnectAttempts}次尝试重连，{delay / 1000}秒后...");

        await Task.Delay(delay);

        try
        {
            _ws?.Dispose();
            await ConnectAsync();
            Console.WriteLine("[重连] 重连成功");
            _ = ListenMessagesAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[重连] 重连失败: {ex.Message}");
            _ = ReconnectAsync();
        }
    }

    public async Task StartAsync()
    {
        _stopCts = new CancellationTokenSource();

        _audio = new AudioPlayer();

        _asr = new AsrClient(_config.ServerUrl);
        if (!_asr.IsReady)
        {
            Console.WriteLine("[警告] 服务器端ASR不可用，语音识别功能将不可用");
        }

        _recorder = new AudioRecorder(_config.VadThreshold);

        await ConnectAsync();

        if (_asr.IsReady && _recorder != null)
        {
            StartVoiceRecognition();
        }

        _ = ListenMessagesAsync();

        Console.WriteLine("[启动] 语音显示端已启动");
    }

    public void Stop()
    {
        _stopCts?.Cancel();

        _recorder?.Stop();
        _audio?.Stop();
        _asr?.Dispose();

        if (_ws?.State == WebSocketState.Open)
        {
            try
            {
                _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Stopping",
                    CancellationToken.None).GetAwaiter().GetResult();
            }
            catch { }
        }

        _ws?.Dispose();
        _ws = null;

        Console.WriteLine("[停止] 语音显示端已停止");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
        _audio?.Dispose();
        _recorder?.Dispose();
        _asr?.Dispose();
        _stopCts?.Dispose();
    }
}

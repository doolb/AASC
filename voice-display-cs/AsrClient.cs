using System.Text.Json;

namespace VoiceDisplayCs;

public class AsrClient : IDisposable
{
    private readonly string _serverUrl;
    private readonly HttpClient _client;
    private bool _ready;
    private bool _disposed;

    public AsrClient(string serverUrl)
    {
        _serverUrl = serverUrl;

        var handler = new HttpClientHandler();
        handler.ServerCertificateCustomValidationCallback =
            HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;

        _client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(30)
        };

        _ready = CheckReadyAsync().GetAwaiter().GetResult();
        if (_ready)
        {
            Console.WriteLine("[ASR] 服务器端 ASR 可用");
        }
        else
        {
            Console.WriteLine("[ASR] 服务器端 ASR 不可用");
        }
    }

    public bool IsReady => _ready;

    public async Task<bool> RefreshStatusAsync()
    {
        _ready = await CheckReadyAsync();
        return _ready;
    }

    private async Task<bool> CheckReadyAsync()
    {
        try
        {
            var url = $"{_serverUrl}/api/asr/status";
            var response = await _client.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine($"[ASR] 检查ASR状态失败: HTTP {(int)response.StatusCode}");
                return false;
            }

            var json = await response.Content.ReadAsStringAsync();
            var result = JsonSerializer.Deserialize(json, AppJsonContext.Default.AsrStatusResponse);
            if (result == null) return false;

            return result.Ready;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ASR] 检查ASR状态失败: {ex.Message}");
            return false;
        }
    }

    public async Task<string?> RecognizeAsync(byte[] wavData)
    {
        try
        {
            var url = $"{_serverUrl}/api/asr/recognize";

            using var content = new MultipartFormDataContent();
            var byteContent = new ByteArrayContent(wavData);
            byteContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
            content.Add(byteContent, "audio", "audio.wav");

            var response = await _client.PostAsync(url, content);

            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                Console.WriteLine($"[ASR] 服务器返回错误 {(int)response.StatusCode}: {body}");
                return null;
            }

            var json = await response.Content.ReadAsStringAsync();
            var result = JsonSerializer.Deserialize(json, AppJsonContext.Default.AsrRecognizeResponse);
            if (result == null) return null;

            switch (result.Status)
            {
                case "success":
                    return result.Text;
                case "ignored":
                    return "";
                default:
                    Console.WriteLine($"[ASR] 识别失败: {result.Message}");
                    return null;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ASR] 识别请求失败: {ex.Message}");
            return null;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _ready = false;
        _client.Dispose();
    }
}

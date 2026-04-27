using System.Text.Json;
using System.Text.Json.Serialization;

namespace VoiceDisplayCs;

public class Config
{
    [JsonPropertyName("serverUrl")]
    public string ServerUrl { get; set; } = "http://localhost:3000";

    [JsonPropertyName("displayId")]
    public string DisplayId { get; set; } = "voice-display-cs-1";

    [JsonPropertyName("vadThreshold")]
    public double VadThreshold { get; set; } = 0.01;
}

[JsonSerializable(typeof(Config))]
[JsonSerializable(typeof(Dictionary<string, object>))]
[JsonSerializable(typeof(AsrStatusResponse))]
[JsonSerializable(typeof(AsrRecognizeResponse))]
internal partial class AppJsonContext : JsonSerializerContext
{
}

public class AsrStatusResponse
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = "";

    [JsonPropertyName("ready")]
    public bool Ready { get; set; }
}

public class AsrRecognizeResponse
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = "";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonPropertyName("text")]
    public string Text { get; set; } = "";
}

public static class ConfigLoader
{
    public static Config Load(string path)
    {
        var defaultConfig = new Config();

        try
        {
            var json = File.ReadAllText(path);
            var config = JsonSerializer.Deserialize(json, AppJsonContext.Default.Config);
            if (config == null)
            {
                Console.WriteLine($"[配置] 配置文件反序列化为null，使用默认配置");
                return defaultConfig;
            }

            if (string.IsNullOrEmpty(config.ServerUrl))
                config.ServerUrl = defaultConfig.ServerUrl;
            if (config.VadThreshold == 0)
                config.VadThreshold = defaultConfig.VadThreshold;

            return config;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[配置] 加载配置文件失败，使用默认配置: {ex.Message}");
            return defaultConfig;
        }
    }
}

using System.Runtime.InteropServices;

namespace VoiceDisplayCs;

public class Program
{
    public static async Task<int> Main(string[] args)
    {
        var configPath = args.Length > 0 ? args[0] : "config.json";
        var config = ConfigLoader.Load(configPath);

        using var voiceDisplay = new VoiceDisplay(config);

        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            Console.WriteLine("\n收到退出信号，正在关闭...");
            voiceDisplay.Stop();
        };

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux) ||
            RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            AppDomain.CurrentDomain.ProcessExit += (_, _) =>
            {
                voiceDisplay.Stop();
            };
        }

        try
        {
            await voiceDisplay.StartAsync();

            await Task.Delay(Timeout.Infinite);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            Console.WriteLine($"启动失败: {ex.Message}");
            return 1;
        }

        return 0;
    }
}

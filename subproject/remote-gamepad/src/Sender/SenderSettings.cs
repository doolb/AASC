using System.Text.Json;

internal sealed record TargetSettings(string? Mac = null, bool AutoSleep = false, bool RelativeMouse = false, bool InputEnabled = false);
internal sealed record SenderConfiguration(int Version, string? LastHost, Dictionary<string, TargetSettings> Targets, string? Theme = null, double? Zoom = null);

internal sealed class SenderSettings
{
    private readonly object gate = new();
    private readonly string path;
    private Dictionary<string, TargetSettings> targets;
    private string? lastHost;
    private string theme = "dark";
    private double zoom = 1;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public SenderSettings(string? directory = null, string? legacyDirectory = null)
    {
        directory ??= AppContext.BaseDirectory;
        legacyDirectory ??= Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RemoteGamepad");
        path = Path.Combine(directory, "settings.json");
        if (File.Exists(path))
        {
            string json = File.ReadAllText(path);
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException("控制端配置格式无效。");
            if (document.RootElement.TryGetProperty("Version", out var version) && version.ValueKind == JsonValueKind.Number)
            {
                if (!version.TryGetInt32(out int n) || n != 2) throw new JsonException("不支持的控制端配置版本。");
                var config = JsonSerializer.Deserialize<SenderConfiguration>(json) ?? throw new JsonException("控制端配置格式无效。");
                if (config.Targets == null) throw new JsonException("控制端目标配置缺失。");
                targets = new Dictionary<string, TargetSettings>(config.Targets, StringComparer.OrdinalIgnoreCase);
                lastHost = string.IsNullOrWhiteSpace(config.LastHost) ? null : config.LastHost;
                theme = config.Theme == "light" ? "light" : "dark";
                if (config.Zoom is double z && double.IsFinite(z)) zoom = Math.Clamp(z, 0.7, 2.0);
            }
            else
            {
                var saved = JsonSerializer.Deserialize<Dictionary<string, TargetSettings>>(json);
                targets = new Dictionary<string, TargetSettings>(saved ?? new(), StringComparer.OrdinalIgnoreCase);
                if (targets.Count == 1) lastHost = targets.Keys.Single();
            }
            return;
        }
        targets = new(StringComparer.OrdinalIgnoreCase);
        string macPath = PreferredOld(directory, legacyDirectory, "wol.json");
        string autoPath = PreferredOld(directory, legacyDirectory, "auto-power.json");
        bool migrated = false;
        if (File.Exists(macPath))
        {
            var values = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(macPath)) ?? new();
            foreach (var (host, mac) in values) targets[host] = GetUnlocked(host) with { Mac = mac };
            migrated = true;
        }
        if (File.Exists(autoPath))
        {
            var values = JsonSerializer.Deserialize<Dictionary<string, bool>>(File.ReadAllText(autoPath)) ?? new();
            foreach (var (host, enabled) in values) targets[host] = GetUnlocked(host) with { AutoSleep = enabled };
            migrated = true;
        }
        if (targets.Count == 1) lastHost = targets.Keys.Single();
        if (migrated) Write(targets, lastHost);
    }
    private static string PreferredOld(string current, string old, string name)
    {
        string candidate = Path.Combine(current, name);
        return File.Exists(candidate) ? candidate : Path.Combine(old, name);
    }
    private TargetSettings GetUnlocked(string host) => targets.TryGetValue(host, out var value) && value != null ? value : new();
    public TargetSettings Get(string host) { lock (gate) return GetUnlocked(host); }
    public string? LastHost { get { lock (gate) return lastHost; } }
    public string Theme { get { lock (gate) return theme; } }
    public double Zoom { get { lock (gate) return zoom; } }
    public void SetZoom(double value)
    {
        if (!double.IsFinite(value)) throw new ArgumentOutOfRangeException(nameof(value));
        value = Math.Round(Math.Clamp(value, 0.7, 2.0), 2);
        lock (gate)
        {
            if (zoom == value) return;
            var previous = zoom; zoom = value;
            try { Write(targets, lastHost); }
            catch { zoom = previous; throw; }
        }
    }
    public void SetTheme(string value)
    {
        if (value is not ("light" or "dark")) throw new ArgumentException("未知界面主题。", nameof(value));
        lock (gate)
        {
            if (theme == value) return;
            var previous = theme;
            theme = value;
            try { Write(targets, lastHost); }
            catch { theme = previous; throw; }
        }
    }
    public void RememberHost(string host)
    {
        if (string.IsNullOrWhiteSpace(host)) throw new ArgumentException("服务端地址不能为空。", nameof(host));
        lock (gate)
        {
            if (StringComparer.Ordinal.Equals(lastHost, host)) return;
            Write(targets, host);
            lastHost = host;
        }
    }
    public void Update(string host, Func<TargetSettings, TargetSettings> change)
    {
        lock (gate)
        {
            var updated = new Dictionary<string, TargetSettings>(targets, StringComparer.OrdinalIgnoreCase) { [host] = change(GetUnlocked(host)) };
            Write(updated, lastHost);
            targets = updated;
        }
    }
    private void Write(Dictionary<string, TargetSettings> value, string? recentHost)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(new SenderConfiguration(2, recentHost, value, theme, zoom), JsonOptions));
            File.Move(temp, path, true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}

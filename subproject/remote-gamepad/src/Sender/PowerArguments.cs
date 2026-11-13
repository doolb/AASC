internal static class PowerArguments
{
    internal static string[] UseLastHost(string[] args, string? lastHost) =>
        args.Length == 0 && !string.IsNullOrWhiteSpace(lastHost) ? new[] { lastHost } : args;
    internal static bool TryExtract(string[] args, out string[] remaining, out string? mac, out string? error)
    {
        var result = new List<string>();
        mac = null; error = null;
        for (int i = 0; i < args.Length; i++)
        {
            string? value = null;
            if (args[i] == "--mac")
            {
                if (i + 1 == args.Length || args[i + 1].StartsWith("--")) { error = "--mac 后需要填写网卡 MAC 地址。"; break; }
                value = args[++i];
            }
            else if (args[i].StartsWith("--mac=", StringComparison.Ordinal)) value = args[i][6..];
            else { result.Add(args[i]); continue; }
            if (mac != null) { error = "--mac 只能指定一次。"; break; }
            if (!PowerClient.TryParseMac(value, out var parsed)) { error = "MAC 地址无效，例如 30-9C-23-6D-0D-BE。"; break; }
            mac = PowerClient.FormatMac(parsed);
        }
        remaining = result.ToArray();
        return error == null;
    }
}

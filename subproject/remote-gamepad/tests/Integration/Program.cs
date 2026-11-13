using System.Diagnostics;
using System.Runtime.InteropServices;
using Nefarius.ViGEm.Client;

// Requires Windows, ViGEmBus and at least two free XInput slots.
if (args.Length is < 2 or > 3) throw new ArgumentException("Arguments: dotnet executable, subproject root, optional mouse mode flag");
var dotnet = args[0];
var root = Path.GetFullPath(args[1]);
using var bus = new ViGEmClient();
var occupied = Enumerable.Range(0, 4).Where(i => Native.GetState((uint)i, out _) == 0).ToHashSet();
if (occupied.Count > 2) throw new Exception("At least two free XInput slots are required.");
var source = bus.CreateXbox360Controller();
int large = -1, small = -1;
source.FeedbackReceived += (_, e) => { Volatile.Write(ref large, e.LargeMotor); Volatile.Write(ref small, e.SmallMotor); };
Process? server = null, sender = null;
try
{
    source.Connect();
    var sourceSlot = await WaitSlot(occupied);
    occupied.Add(sourceSlot);
    server = Start("src/Server/bin/Debug/net6.0/Server.dll", "127.0.0.1", "29670");
    await Task.Delay(500);
    var senderArgs = new List<string> { "127.0.0.1", args.Length == 3 && args[2] == "--aggregate" ? "29672" : "29670", sourceSlot.ToString() };
    if (args.Length == 3) senderArgs.Add(args[2]);
    sender = Start("src/Sender/bin/Debug/net6.0/Sender.dll", senderArgs.ToArray());
    var targetSlot = await WaitSlot(occupied);
    source.ButtonState = 0x1000;
    source.SubmitReport();
    await Until(() => Native.GetState((uint)targetSlot, out var s) == 0 && s.Gamepad.Buttons == 0x1000, "input forwarding");
    var vibration = new Native.Vibration { Left = 32768, Right = 49152 };
    if (Native.SetState((uint)targetSlot, ref vibration) != 0) throw new Exception("XInputSetState failed");
    await Until(() => Math.Abs(Volatile.Read(ref large) - 128) <= 1 && Math.Abs(Volatile.Read(ref small) - 192) <= 1, "vibration forwarding");
    server.Kill(true);
    await server.WaitForExitAsync();
    await Until(() => Volatile.Read(ref large) == 0 && Volatile.Read(ref small) == 0, "motor reset on disconnect");
    Console.WriteLine("PASS: input, both vibration motors, and disconnect reset");
}
finally
{
    foreach (var process in new[] { sender, server })
    {
        if (process is null) continue;
        if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); }
        process.Dispose();
    }
    source.Disconnect();
}

Process Start(string program, params string[] arguments)
{
    var info = new ProcessStartInfo(dotnet) { UseShellExecute = false };
    info.ArgumentList.Add(Path.Combine(root, program));
    foreach (var argument in arguments) info.ArgumentList.Add(argument);
    return Process.Start(info) ?? throw new Exception("Failed to start " + program);
}
static async Task<int> WaitSlot(HashSet<int> occupied)
{
    int slot = -1;
    await Until(() => { slot = Enumerable.Range(0, 4).FirstOrDefault(i => !occupied.Contains(i) && Native.GetState((uint)i, out _) == 0, -1); return slot >= 0; }, "virtual controller");
    return slot;
}
static async Task Until(Func<bool> condition, string label)
{
    for (int i = 0; i < 100; i++) { if (condition()) return; await Task.Delay(50); }
    throw new Exception("Timed out waiting for " + label);
}
static class Native
{
    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")] public static extern uint GetState(uint i, out State state);
    [DllImport("xinput1_4.dll", EntryPoint = "XInputSetState")] public static extern uint SetState(uint i, ref Vibration vibration);
    [StructLayout(LayoutKind.Sequential)] public struct State { public uint Packet; public Gamepad Gamepad; }
    [StructLayout(LayoutKind.Sequential)] public struct Gamepad { public ushort Buttons; public byte LT, RT; public short LX, LY, RX, RY; }
    [StructLayout(LayoutKind.Sequential)] public struct Vibration { public ushort Left, Right; }
}

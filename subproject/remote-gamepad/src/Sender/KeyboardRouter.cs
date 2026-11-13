using System.Threading.Channels;
using RemoteGamepad;

// All state changes, including connection changes, share one lock with the hook callback.
internal sealed class KeyboardRouter
{
    private readonly object gate = new();
    private readonly HashSet<(byte, byte, byte)> localDown = new();
    private readonly HashSet<(byte, byte, byte)> remoteDown = new();
    private readonly HashSet<(byte, byte, byte)> swallowUntilUp = new();
    private readonly HashSet<byte> physicalCtrl = new();
    private readonly HashSet<byte> localButtons = new(), remoteButtons = new(), swallowButtons = new();
    private ChannelWriter<KeyboardPacket>? output;
    private bool relativeMouse, relativeAvailable;
    private bool enabled, toggleEscDown, savedInputEnabled, restoreOnFirstAttach;
    public event Action<string>? Status;
    public event Action? Overflow;
    public event Action? PreferencesChanged;
    public KeyboardRouter(bool relativeMouse = false, bool restoreInputEnabled = false)
    { this.relativeMouse = relativeMouse; savedInputEnabled = restoreInputEnabled; restoreOnFirstAttach = restoreInputEnabled; }
    public (bool relativeMouse, bool inputEnabled) Preferences { get { lock (gate) return (relativeMouse, savedInputEnabled); } }
    public bool RelativeCaptureEnabled { get { lock (gate) return relativeMouse && enabled && output != null; } }
    public bool RelativeMouse { get { lock (gate) return relativeMouse; } }
    public bool InputEnabled { get { lock (gate) return enabled && output != null; } }
    public bool TrySetInputEnabled(bool value, out string reason)
    {
        lock (gate)
        {
            if (output == null) { reason = "键鼠尚未连接。"; return false; }
            if (enabled == value) { reason = value ? "键鼠转发已开启。" : "键鼠转发已关闭。"; return true; }
            enabled = value; savedInputEnabled = value;
            if (!enabled)
            {
                Queue(new KeyboardPacket(KeyboardPacket.ReleaseAll, 0, 0, 0));
                swallowUntilUp.UnionWith(remoteDown); remoteDown.Clear();
                swallowButtons.UnionWith(remoteButtons); remoteButtons.Clear();
            }
            reason = enabled ? "键鼠转发已开启；按 Ctrl+Esc 关闭。" : "键鼠转发已关闭。";
            string message = reason;
            ThreadPool.QueueUserWorkItem(_ => Status?.Invoke(message));
            ThreadPool.QueueUserWorkItem(_ => PreferencesChanged?.Invoke());
            return true;
        }
    }
    public void SetRelativeAvailable() { lock (gate) relativeAvailable = true; }
    public void SetRelativeUnavailable() { lock (gate) relativeAvailable = false; }
    public bool TrySetMouseMode(bool relative, out string reason)
    {
        lock (gate)
        {
            if (enabled) { reason = "请先按 Ctrl+Esc 关闭键鼠转发。"; return false; }
            if (relative && !relativeAvailable) { reason = "原始鼠标输入尚未就绪或不可用，无法切换到增量模式。"; return false; }
            relativeMouse = relative;
            reason = relative ? "鼠标模式已切换为增量模式。" : "鼠标模式已切换为绝对模式。";
            ThreadPool.QueueUserWorkItem(_ => PreferencesChanged?.Invoke());
            return true;
        }
    }

    public void Attach(ChannelWriter<KeyboardPacket> writer)
    {
        bool currentEnabled;
        lock (gate) { output = writer; enabled = restoreOnFirstAttach; restoreOnFirstAttach = false; currentEnabled = enabled; }
        Status?.Invoke($"键鼠已连接，鼠标模式：{(relativeMouse ? "增量" : "绝对")}；转发{(currentEnabled ? "开启" : "关闭")}，按 Ctrl+Esc 切换。");
    }

    public void Detach()
    {
        lock (gate)
        {
            swallowUntilUp.UnionWith(remoteDown);
            remoteDown.Clear();
            swallowButtons.UnionWith(remoteButtons);
            remoteButtons.Clear();
            enabled = false;
            output = null;
        }
    }

    public bool Process(byte vk, byte scan, byte extended, bool down)
    {
        lock (gate)
        {
            var id = (vk, scan, extended);
            if (vk is 0x11 or 0xA2 or 0xA3)
            {
                if (down) physicalCtrl.Add(vk); else physicalCtrl.Remove(vk);
            }
            if (vk == 0x1B && !down && toggleEscDown) { toggleEscDown = false; return true; }
            if (vk == 0x1B && down && (physicalCtrl.Count > 0 || toggleEscDown) && output != null)
            {
                if (!toggleEscDown)
                {
                    toggleEscDown = true;
                    enabled = !enabled;
                    savedInputEnabled = enabled;
                    if (!enabled)
                    {
                        Queue(new KeyboardPacket(KeyboardPacket.ReleaseAll, 0, 0, 0));
                        swallowUntilUp.UnionWith(remoteDown);
                        remoteDown.Clear();
                        swallowButtons.UnionWith(remoteButtons);
                        remoteButtons.Clear();
                    }
                    var message = enabled ? "键鼠转发已开启；按 Ctrl+Esc 关闭。" : "键鼠转发已关闭。";
                    ThreadPool.QueueUserWorkItem(_ => Status?.Invoke(message));
                    ThreadPool.QueueUserWorkItem(_ => PreferencesChanged?.Invoke());
                }
                return true;
            }
            if (swallowUntilUp.Contains(id))
            {
                if (!down) swallowUntilUp.Remove(id);
                return true;
            }
            if (localDown.Contains(id))
            {
                if (!down) localDown.Remove(id);
                return false;
            }
            if (!enabled || output == null)
            {
                if (down) localDown.Add(id);
                return false;
            }
            if (down) remoteDown.Add(id);
            else if (!remoteDown.Remove(id)) return false;
            Queue(new KeyboardPacket(down ? KeyboardPacket.Down : KeyboardPacket.Up, vk, scan, extended));
            return true;
        }
    }

    // Movement remains visible locally so the physical pointer continues across the desktop.
    public void MouseMove(ushort x, ushort y)
    {
        lock (gate)
            if (!relativeMouse && enabled && output != null) Queue(new KeyboardPacket(KeyboardPacket.MouseMove, 0, 0, 0, x, y));
    }

    public void MouseMoveRelative(int x, int y)
    {
        lock (gate)
        {
            if (!relativeMouse || !enabled || output == null) return;
            // Bound abnormal device reports and split large movement into signed 16-bit frames.
            x = Math.Clamp(x, -131068, 131068);
            y = Math.Clamp(y, -131068, 131068);
            while ((x != 0 || y != 0) && enabled && output != null)
            {
                short dx = (short)Math.Clamp(x, short.MinValue, short.MaxValue);
                short dy = (short)Math.Clamp(y, short.MinValue, short.MaxValue);
                Queue(new KeyboardPacket(KeyboardPacket.MouseRelative, 0, 0, 0, unchecked((ushort)dx), unchecked((ushort)dy)));
                x -= dx; y -= dy;
            }
        }
    }

    public bool MouseButton(byte button, bool down)
    {
        lock (gate)
        {
            if (swallowButtons.Contains(button))
            {
                if (!down) swallowButtons.Remove(button);
                return true;
            }
            if (localButtons.Contains(button))
            {
                if (!down) localButtons.Remove(button);
                return false;
            }
            if (!enabled || output == null)
            {
                if (down) localButtons.Add(button);
                return false;
            }
            if (down) remoteButtons.Add(button);
            else if (!remoteButtons.Remove(button)) return false;
            Queue(new KeyboardPacket(down ? KeyboardPacket.MouseDown : KeyboardPacket.MouseUp, button, 0, 0));
            return true;
        }
    }

    public bool MouseWheel(short delta, bool horizontal)
    {
        lock (gate)
        {
            if (!enabled || output == null) return false;
            Queue(new KeyboardPacket(horizontal ? KeyboardPacket.MouseHorizontalWheel : KeyboardPacket.MouseWheel, 0, 0, 0, unchecked((ushort)delta)));
            return true;
        }
    }

    private void Queue(KeyboardPacket packet)
    {
        if (output != null && !output.TryWrite(packet))
        {
            // Never block the low-level keyboard hook; closing the session releases remote keys.
            swallowUntilUp.UnionWith(remoteDown);
            remoteDown.Clear();
            swallowButtons.UnionWith(remoteButtons);
            remoteButtons.Clear();
            enabled = false;
            output = null;
            ThreadPool.QueueUserWorkItem(_ => Overflow?.Invoke());
        }
    }
}

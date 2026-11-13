internal sealed class AutoSleepCoordinator : IDisposable
{
    private readonly object gate = new();
    private readonly CancellationToken serverStop;
    private readonly TimeSpan delay;
    private readonly Func<Task> sleep;
    private CancellationTokenSource? countdown;
    private int active;
    private bool manualSleep;

    public AutoSleepCoordinator(CancellationToken serverStop, Func<Task> sleep, TimeSpan? delay = null)
    { this.serverStop = serverStop; this.sleep = sleep; this.delay = delay ?? TimeSpan.FromSeconds(60); }

    public void Connect()
    {
        lock (gate) { active++; countdown?.Cancel(); countdown = null; }
    }
    public void CancelPending() { lock (gate) { countdown?.Cancel(); countdown = null; } }
    public void Disconnect(bool disarmed)
    {
        lock (gate)
        {
            if (active > 0) active--;
            if (active != 0 || serverStop.IsCancellationRequested || disarmed || manualSleep) return;
            countdown?.Cancel();
            var next = CancellationTokenSource.CreateLinkedTokenSource(serverStop);
            countdown = next;
            Console.WriteLine("自动电源连接断开，60 秒后睡眠；重连可取消。");
            _ = CountDown(next);
        }
    }
    public void BeginManualSleep() { lock (gate) { manualSleep = true; countdown?.Cancel(); countdown = null; } }
    public void EndManualSleep() { lock (gate) manualSleep = false; }
    private async Task CountDown(CancellationTokenSource timer)
    {
        try
        {
            await Task.Delay(delay, timer.Token);
            lock (gate)
            {
                if (countdown != timer || active != 0 || timer.IsCancellationRequested) return;
                countdown = null;
            }
            await sleep();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Console.WriteLine($"自动睡眠失败: {ex.Message}"); }
        finally { timer.Dispose(); }
    }
    public void Dispose() { lock (gate) { countdown?.Cancel(); countdown = null; } }
}

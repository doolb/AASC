if (args.Contains("--terminate_existing_session")) return;
Console.WriteLine("Application,ProcessID,SwapChainAddress,msBetweenPresents");
while (true)
{
    Console.WriteLine("test.exe,4242,0x1234,20.0");
    await Task.Delay(20);
}

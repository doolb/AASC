# Render 刷新诊断实现规格（伪代码）

```text
control Tts.init() and ttsTextInput:
    bind diagnostics once to the input element
    record init, focus, blur, click, mouse, input, change and DOM mutation events
    record value length and element state only; do not record text content
    print focus/click lifecycle events immediately and aggregate high-frequency events per second
    do not send a TTS request or change the input value

server.broadcastDisplayList():
    if renderRefreshDiagnosticsEnabled is false:
        skip diagnostic counters and prints
    caller = current call-site
    debugWindow.calls += 1
    debugWindow.sources.add(caller)
    if one second window elapsed:
        print actual broadcast count, coalesced call count, sources and display IDs
        reset debug window
    broadcast displayList as before

control WebSocket.handleMessage(displayList):
    if renderRefreshDiagnosticsEnabled is false:
        skip diagnostic counters and prints
    debugWindow.received += 1
    if one second window elapsed:
        print received count and display IDs
        reset debug window
    call DeviceList.setDisplayList(data.list)

DeviceList.setDisplayList(list):
    if renderRefreshDiagnosticsEnabled is false:
        skip diagnostic counters and prints
    print or aggregate incoming list signature
    replace local display list
    call DeviceList.render()

DeviceList.render():
    if renderRefreshDiagnosticsEnabled is false:
        skip diagnostic counters and prints
    debugWindow.renderCalls += 1
    if one second window elapsed:
        print render count, display IDs and caller stack line
        reset debug window
    render device and media display containers as before

display task:renderUpdate:
    if renderRefreshDiagnosticsEnabled is false:
        skip diagnostic counters and prints
    debug state is keyed by instanceId
    increment update count
    once per second print instanceId, update count and data keys
    call the existing render update callback without changing payload
```

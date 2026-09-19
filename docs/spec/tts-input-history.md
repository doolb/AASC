# 控制端 TTS 输入历史实现规格（伪代码）

```text
control page renders ttsForm:
    form.id = ttsForm
    form.autocomplete = on
    form contains a submit button
    do not install custom history popup
    do not install focus, blur, input-content logging, mouse logging or mutation observers

control page renders ttsTextInput inside ttsForm:
    input.type = text
    input.id = ttsTextInput
    input.name = ttsTextInput
    input.autocomplete = on
    keep the input node mounted when focus changes

on ttsForm submit:
    prevent browser page navigation
    call playCustomTts exactly once

Tts.playCustom():
    read ttsTextInput.value
    keep existing validation and WebSocket TTS message flow
```

/* 显示端适配共享音色快选，保留原舞台总线和DOM入口。 */
(function exposeDisplayTtsVoices(root) {
    'use strict';
    let picker;
    root.DisplayTtsVoices = Object.freeze({
        init(options) {
            picker ||= root.TtsVoicePicker.create();
            picker.init({ ...options, prefix: 'display', onOpen: () => root.DisplayMmdLighting?.close() });
        }
    });
}(window));

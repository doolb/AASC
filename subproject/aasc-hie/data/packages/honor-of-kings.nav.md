# 王者荣耀状态识别包

本包当前只负责观察和描述画面。它记录启动、大厅、设置、训练入口、战斗覆盖层和赛后页面的样本，并输出场景、可见 UI、按钮边界与可信状态。识别不到时返回 `unknown`。本阶段不包含战斗自动操作、地图探索或 NavMesh。

```navigation-json
{
  "metadata": {
    "id": "honor-of-kings",
    "name": "王者荣耀状态识别",
    "version": "recognition-0.2.0",
    "navigators": ["recognition"],
    "packageName": "com.tencent.tmgp.sgame",
    "locale": "zh-CN"
  },
  "scenarios": [
    { "id": "startup", "navigators": ["recognition"] },
    { "id": "lobby", "navigators": ["recognition"] },
    { "id": "training-entry", "navigators": ["recognition"] },
    { "id": "battle", "navigators": ["recognition"] },
    { "id": "post-match", "navigators": ["recognition"] }
  ],
  "states": [
    { "id": "hok-startup-splash", "scenarioId": "startup", "labelZh": "腾讯启动画面", "uis": ["hok-startup-splash"], "topmost": "hok-startup-splash", "sampleIds": ["startup-logo"] },
    { "id": "hok-startup-prompt", "scenarioId": "startup", "labelZh": "启动剧情继续提示", "uis": ["hok-startup-prompt"], "topmost": "hok-startup-prompt", "sampleIds": ["startup-prompt"] },
    { "id": "hok-confirm-dialog", "scenarioId": "startup", "labelZh": "确认弹窗", "uis": ["hok-confirm-dialog"], "topmost": "hok-confirm-dialog", "sampleIds": ["system-confirm-dialog"] },
    { "id": "hok-match-loading", "scenarioId": "training-entry", "labelZh": "对局加载", "uis": ["hok-match-loading"], "topmost": "hok-match-loading", "sampleIds": ["match-loading-prior", "match-loading-live"] },
    { "id": "hok-home", "scenarioId": "lobby", "labelZh": "大厅首页", "uis": ["hok-home"], "topmost": "hok-home", "sampleIds": ["home-lobby-live"] },
    { "id": "hok-home-settings-basic", "scenarioId": "lobby", "labelZh": "大厅设置-基础", "uis": ["hok-home", "hok-settings", "hok-home-settings-basic"], "topmost": "hok-home-settings-basic", "sampleIds": ["home-settings-basic"] },
    { "id": "hok-home-settings-image", "scenarioId": "lobby", "labelZh": "大厅设置-图像", "uis": ["hok-home", "hok-settings", "hok-home-settings-image"], "topmost": "hok-home-settings-image", "sampleIds": ["home-settings-image"] },
    { "id": "hok-home-settings-battle", "scenarioId": "lobby", "labelZh": "大厅设置-战斗", "uis": ["hok-home", "hok-settings", "hok-home-settings-battle"], "topmost": "hok-home-settings-battle", "sampleIds": ["home-settings-battle"] },
    { "id": "hok-controls-tutorial", "scenarioId": "lobby", "labelZh": "操作设置说明遮罩", "uis": ["hok-home", "hok-settings", "hok-controls-tutorial"], "topmost": "hok-controls-tutorial", "sampleIds": ["home-settings-controls-tour"] },
    { "id": "hok-home-settings-controls", "scenarioId": "lobby", "labelZh": "大厅设置-操作", "uis": ["hok-home", "hok-settings", "hok-home-settings-controls"], "topmost": "hok-home-settings-controls", "sampleIds": ["home-settings-controls"] },
    { "id": "hok-home-settings-layout", "scenarioId": "lobby", "labelZh": "大厅设置-布局", "uis": ["hok-home", "hok-settings", "hok-home-settings-layout"], "topmost": "hok-home-settings-layout", "sampleIds": ["home-settings-layout"] },
    { "id": "hok-home-settings-sound", "scenarioId": "lobby", "labelZh": "大厅设置-声音", "uis": ["hok-home", "hok-settings", "hok-home-settings-sound"], "topmost": "hok-home-settings-sound", "sampleIds": ["home-settings-sound"] },
    { "id": "hok-home-settings-recording", "scenarioId": "lobby", "labelZh": "大厅设置-录像", "uis": ["hok-home", "hok-settings", "hok-home-settings-recording"], "topmost": "hok-home-settings-recording", "sampleIds": ["home-settings-recording"] },
    { "id": "hok-mode-select", "scenarioId": "training-entry", "labelZh": "竞技模式选择", "uis": ["hok-mode-select"], "topmost": "hok-mode-select", "sampleIds": ["mode-select-live"] },
    { "id": "hok-training-mode-select", "scenarioId": "training-entry", "labelZh": "英雄练习场模式选择", "uis": ["hok-mode-select", "hok-training-mode-select"], "topmost": "hok-training-mode-select", "sampleIds": ["training-mode-live"] },
    { "id": "hok-hero-select", "scenarioId": "training-entry", "labelZh": "英雄选择", "uis": ["hok-hero-select"], "topmost": "hok-hero-select", "sampleIds": ["hero-select-live"] },
    { "id": "hok-skin-select", "scenarioId": "training-entry", "labelZh": "皮肤选择", "uis": ["hok-hero-select", "hok-skin-select"], "topmost": "hok-skin-select", "sampleIds": ["skin-select-live", "skin-ready-live"] },
    { "id": "hok-battle-hud", "scenarioId": "battle", "labelZh": "训练对局 HUD", "uis": ["hok-battle-hud", "hok-minimap", "hok-battle-chat", "hok-battle-controls"], "topmost": "hok-battle-hud", "sampleIds": ["battle-hud-live"] },
    { "id": "hok-battle-scoreboard", "scenarioId": "battle", "labelZh": "战斗计分板", "uis": ["hok-battle-hud", "hok-scoreboard-overlay"], "topmost": "hok-scoreboard-overlay", "sampleIds": ["battle-scoreboard-live"] },
    { "id": "hok-battle-shop", "scenarioId": "battle", "labelZh": "战斗装备商店", "uis": ["hok-battle-hud", "hok-shop-overlay"], "topmost": "hok-shop-overlay", "sampleIds": ["battle-shop-live"] },
    { "id": "hok-battle-settings", "scenarioId": "battle", "labelZh": "战斗设置-图像", "uis": ["hok-battle-hud", "hok-battle-settings"], "topmost": "hok-battle-settings", "sampleIds": ["battle-settings-live"] },
    { "id": "hok-battle-settings-controls", "scenarioId": "battle", "labelZh": "战斗设置-操作", "uis": ["hok-battle-hud", "hok-battle-settings", "hok-battle-settings-controls"], "topmost": "hok-battle-settings-controls", "sampleIds": ["battle-settings-controls"] },
    { "id": "hok-battle-settings-layout", "scenarioId": "battle", "labelZh": "战斗设置-布局", "uis": ["hok-battle-hud", "hok-battle-settings", "hok-battle-settings-layout"], "topmost": "hok-battle-settings-layout", "sampleIds": ["battle-settings-layout"] },
    { "id": "hok-battle-settings-sound", "scenarioId": "battle", "labelZh": "战斗设置-声音", "uis": ["hok-battle-hud", "hok-battle-settings", "hok-battle-settings-sound"], "topmost": "hok-battle-settings-sound", "sampleIds": ["battle-settings-sound"] },
    { "id": "hok-defeat-overlay", "scenarioId": "post-match", "labelZh": "战败遮罩", "uis": ["hok-battle-hud", "hok-defeat-overlay"], "topmost": "hok-defeat-overlay", "sampleIds": ["defeat-overlay-prior"] },
    { "id": "hok-result-summary", "scenarioId": "post-match", "labelZh": "赛后个人评分", "uis": ["hok-result-summary"], "topmost": "hok-result-summary", "sampleIds": ["result-player-summary"] },
    { "id": "hok-result-scoreboard", "scenarioId": "post-match", "labelZh": "赛后战绩榜", "uis": ["hok-result-scoreboard"], "topmost": "hok-result-scoreboard", "sampleIds": ["result-scoreboard"] },
    { "id": "hok-result-team-summary", "scenarioId": "post-match", "labelZh": "赛后队伍统计", "uis": ["hok-result-team-summary"], "topmost": "hok-result-team-summary", "sampleIds": ["result-team-summary"] },
    { "id": "hok-result-continue-prompt", "scenarioId": "post-match", "labelZh": "赛后继续提示", "uis": ["hok-result-summary", "hok-result-continue-prompt"], "topmost": "hok-result-continue-prompt", "sampleIds": ["result-continue-prompt"] }
  ],
  "goals": [],
  "flows": [],
  "navmeshes": [],
  "stateRecognition": {
    "mode": "observe-only",
    "frameSize": { "width": 1480, "height": 720 },
    "target": { "packageName": "com.tencent.tmgp.sgame", "orientation": "landscape" },
    "dataset": {
      "manifest": "data/datasets/honor-of-kings/manifest.jsonl",
      "frameDirectory": "data/datasets/honor-of-kings/frames",
      "reviewedSampleCount": 31,
      "annotationPolicy": "unknown-unless-visually-confirmed"
    },
    "capture": {
      "preferred": { "method": "adb-screenrecord-h264", "outputFramesPerSecond": 2, "testedSourceFramesPerSecond": 25, "maxBitRate": 3000000 },
      "fallback": { "method": "adb-screencap-png", "observedAverageFrameMs": 1880, "estimatedFramesPerSecond": 0.53 }
    },
    "sceneClassifier": {
      "method": "rgb-grid-nearest-neighbor",
      "columns": 48,
      "rows": 24,
      "maxDistance": 0.085,
      "minMargin": 0.003,
      "fingerprintIndex": "data/datasets/honor-of-kings/fingerprints-48x24.json",
      "unknownOnAmbiguous": true
    },
    "sampleEchoMaxDistance": 0.003,
    "buttonOwnersByState": {
      "hok-home-settings-basic": ["hok-settings"],
      "hok-home-settings-image": ["hok-settings", "hok-home-settings-image"],
      "hok-home-settings-battle": ["hok-settings"],
      "hok-controls-tutorial": ["hok-settings", "hok-controls-tutorial"],
      "hok-home-settings-controls": ["hok-settings"],
      "hok-home-settings-layout": ["hok-settings"],
      "hok-home-settings-sound": ["hok-settings"],
      "hok-home-settings-recording": ["hok-settings"],
      "hok-training-mode-select": ["hok-training-mode-select"],
      "hok-skin-select": ["hok-hero-select"],
      "hok-battle-scoreboard": ["hok-scoreboard-overlay"],
      "hok-battle-shop": ["hok-shop-overlay"],
      "hok-battle-settings": ["hok-battle-settings"],
      "hok-battle-settings-controls": ["hok-battle-settings"],
      "hok-battle-settings-layout": ["hok-battle-settings"],
      "hok-battle-settings-sound": ["hok-battle-settings"],
      "hok-defeat-overlay": ["hok-defeat-overlay"],
      "hok-result-continue-prompt": ["hok-result-summary"]
    },
    "buttonAppearanceSamples": [
      { "buttonId": "tab-basic", "bounds": { "x": 40, "y": 80, "width": 140, "height": 85 }, "maxDistance": 0.045, "minMargin": 0.02, "states": [{ "state": "selected", "sampleId": "home-settings-basic" }, { "state": "enabled", "sampleId": "home-settings-image" }] },
      { "buttonId": "tab-image", "bounds": { "x": 40, "y": 160, "width": 140, "height": 80 }, "maxDistance": 0.045, "minMargin": 0.02, "states": [{ "state": "selected", "sampleId": "home-settings-image" }, { "state": "enabled", "sampleId": "home-settings-basic" }] },
      { "buttonId": "tab-battle", "bounds": { "x": 40, "y": 240, "width": 140, "height": 80 }, "maxDistance": 0.045, "minMargin": 0.02, "states": [{ "state": "selected", "sampleId": "home-settings-battle" }, { "state": "enabled", "sampleId": "home-settings-image" }] },
      { "buttonId": "tab-controls", "bounds": { "x": 40, "y": 320, "width": 140, "height": 80 }, "maxDistance": 0.045, "minMargin": 0.02, "states": [{ "state": "selected", "sampleId": "home-settings-controls" }, { "state": "enabled", "sampleId": "home-settings-image" }] },
      { "buttonId": "tab-layout", "bounds": { "x": 40, "y": 400, "width": 140, "height": 80 }, "maxDistance": 0.045, "minMargin": 0.02, "states": [{ "state": "selected", "sampleId": "home-settings-layout" }, { "state": "enabled", "sampleId": "home-settings-image" }] },
      { "buttonId": "tab-sound", "bounds": { "x": 40, "y": 480, "width": 140, "height": 80 }, "maxDistance": 0.045, "minMargin": 0.02, "states": [{ "state": "selected", "sampleId": "home-settings-sound" }, { "state": "enabled", "sampleId": "home-settings-image" }] },
      { "buttonId": "tab-recording", "bounds": { "x": 40, "y": 560, "width": 140, "height": 80 }, "maxDistance": 0.045, "minMargin": 0.02, "states": [{ "state": "selected", "sampleId": "home-settings-recording" }, { "state": "enabled", "sampleId": "home-settings-image" }] },
      { "buttonId": "enter-game", "bounds": { "x": 1270, "y": 638, "width": 190, "height": 64 }, "maxDistance": 0.08, "minMargin": 0.035, "states": [{ "state": "enabled", "sampleId": "skin-ready-live" }, { "state": "disabled", "sampleId": "skin-select-live" }] }
    ],
    "buttonStatePolicy": {
      "values": ["enabled", "disabled", "selected", "pressed", "cooldown", "unknown"],
      "emitKnownOnlyWhen": "exact-curated-frame-or-calibrated-detector",
      "fallback": "unknown"
    },
    "ocr": { "enabledByDefault": false, "urlEnvironmentVariable": "AASC_URL", "route": "/api/vision/ocr" },
    "outputFields": ["observedAt", "frameAgeMs", "source", "scene", "topmost", "uis", "buttons", "values", "visibleTexts", "textReadStatus", "unknowns", "confidence", "summaryZh"],
    "uiInventory": [
      { "id": "hok-home", "labelZh": "大厅首页", "bounds": { "x": 0, "y": 0, "width": 1480, "height": 720 }, "buttons": [
        { "id": "battle-entry", "labelZh": "对战入口", "bounds": { "x": 505, "y": 493, "width": 468, "height": 90 }, "defaultVisibleState": "enabled" },
        { "id": "settings", "labelZh": "设置", "bounds": { "x": 1334, "y": 20, "width": 46, "height": 45 }, "defaultVisibleState": "enabled" }
      ] },
      { "id": "hok-settings", "labelZh": "设置面板", "bounds": { "x": 0, "y": 0, "width": 1480, "height": 720 }, "buttons": [
        { "id": "back", "labelZh": "返回", "bounds": { "x": 58, "y": 18, "width": 70, "height": 45 }, "defaultVisibleState": "enabled" },
        { "id": "tab-basic", "labelZh": "基础", "bounds": { "x": 40, "y": 80, "width": 140, "height": 85 }, "defaultVisibleState": "enabled" },
        { "id": "tab-image", "labelZh": "图像", "bounds": { "x": 40, "y": 160, "width": 140, "height": 80 }, "defaultVisibleState": "enabled" },
        { "id": "tab-battle", "labelZh": "战斗", "bounds": { "x": 40, "y": 240, "width": 140, "height": 80 }, "defaultVisibleState": "enabled" },
        { "id": "tab-controls", "labelZh": "操作", "bounds": { "x": 40, "y": 320, "width": 140, "height": 80 }, "defaultVisibleState": "enabled" },
        { "id": "tab-layout", "labelZh": "布局", "bounds": { "x": 40, "y": 400, "width": 140, "height": 80 }, "defaultVisibleState": "enabled" },
        { "id": "tab-sound", "labelZh": "声音", "bounds": { "x": 40, "y": 480, "width": 140, "height": 80 }, "defaultVisibleState": "enabled" },
        { "id": "tab-recording", "labelZh": "录像", "bounds": { "x": 40, "y": 560, "width": 140, "height": 80 }, "defaultVisibleState": "enabled" }
      ] },
      { "id": "hok-home-settings-image", "labelZh": "图像设置", "bounds": { "x": 270, "y": 90, "width": 1040, "height": 600 }, "buttons": [
        { "id": "fps-high", "labelZh": "高帧率", "bounds": { "x": 720, "y": 110, "width": 120, "height": 45 } },
        { "id": "resolution-ultra", "labelZh": "超高分辨率", "bounds": { "x": 840, "y": 218, "width": 120, "height": 45 } },
        { "id": "camera-near", "labelZh": "近景视角", "bounds": { "x": 600, "y": 318, "width": 120, "height": 45 } },
        { "id": "anti-aliasing", "labelZh": "抗锯齿", "bounds": { "x": 600, "y": 414, "width": 110, "height": 45 } }
      ] },
      { "id": "hok-mode-select", "labelZh": "竞技模式选择", "bounds": { "x": 135, "y": 100, "width": 1205, "height": 510 }, "buttons": [
        { "id": "solo-training", "labelZh": "单人训练", "bounds": { "x": 1120, "y": 18, "width": 160, "height": 46 }, "defaultVisibleState": "enabled" },
        { "id": "training-card", "labelZh": "英雄练习", "bounds": { "x": 625, "y": 110, "width": 230, "height": 500 }, "defaultVisibleState": "enabled" }
      ] },
      { "id": "hok-training-mode-select", "labelZh": "英雄练习场入口", "bounds": { "x": 820, "y": 150, "width": 640, "height": 460 }, "buttons": [
        { "id": "basic-training", "labelZh": "基础训练", "bounds": { "x": 830, "y": 158, "width": 164, "height": 443 }, "defaultVisibleState": "enabled" },
        { "id": "solo-practice", "labelZh": "单人练习场", "bounds": { "x": 1010, "y": 158, "width": 249, "height": 443 }, "defaultVisibleState": "enabled" }
      ] },
      { "id": "hok-hero-select", "labelZh": "英雄选择面板", "bounds": { "x": 0, "y": 0, "width": 1480, "height": 720 }, "buttons": [
        { "id": "tab-hero", "labelZh": "英雄", "bounds": { "x": 25, "y": 0, "width": 112, "height": 65 } },
        { "id": "tab-skin", "labelZh": "皮肤", "bounds": { "x": 145, "y": 0, "width": 120, "height": 65 } },
        { "id": "next", "labelZh": "下一步", "bounds": { "x": 1270, "y": 638, "width": 190, "height": 65 } },
        { "id": "enter-game", "labelZh": "进入游戏", "bounds": { "x": 1270, "y": 638, "width": 190, "height": 64 } }
      ] },
      { "id": "hok-battle-hud", "labelZh": "战斗 HUD", "bounds": { "x": 0, "y": 0, "width": 1480, "height": 720 }, "buttons": [
        { "id": "joystick", "labelZh": "移动摇杆", "bounds": { "x": 194, "y": 475, "width": 170, "height": 190 } },
        { "id": "normal-attack", "labelZh": "普通攻击", "bounds": { "x": 1200, "y": 320, "width": 160, "height": 160 } },
        { "id": "settings", "labelZh": "战斗设置", "bounds": { "x": 1310, "y": 10, "width": 45, "height": 45 }, "defaultVisibleState": "enabled" },
        { "id": "shop", "labelZh": "装备商店", "bounds": { "x": 1384, "y": 0, "width": 85, "height": 70 }, "defaultVisibleState": "enabled" },
        { "id": "scoreboard", "labelZh": "计分板", "bounds": { "x": 1265, "y": 20, "width": 38, "height": 40 }, "defaultVisibleState": "enabled" }
      ] },
      { "id": "hok-scoreboard-overlay", "labelZh": "计分板覆盖层", "bounds": { "x": 100, "y": 70, "width": 1280, "height": 580 }, "buttons": [
        { "id": "close", "labelZh": "关闭", "bounds": { "x": 1292, "y": 72, "width": 50, "height": 48 }, "defaultVisibleState": "enabled" }
      ] },
      { "id": "hok-shop-overlay", "labelZh": "装备商店覆盖层", "bounds": { "x": 100, "y": 35, "width": 1280, "height": 650 }, "buttons": [
        { "id": "close", "labelZh": "关闭", "bounds": { "x": 1280, "y": 35, "width": 55, "height": 56 }, "defaultVisibleState": "enabled" },
        { "id": "recommended", "labelZh": "推荐", "bounds": { "x": 1240, "y": 90, "width": 140, "height": 80 } }
      ] },
      { "id": "hok-battle-settings", "labelZh": "战斗设置面板", "bounds": { "x": 100, "y": 15, "width": 1280, "height": 675 }, "buttons": [
        { "id": "close", "labelZh": "关闭", "bounds": { "x": 1280, "y": 15, "width": 55, "height": 55 }, "defaultVisibleState": "enabled" }
      ] },
      { "id": "hok-defeat-overlay", "labelZh": "战败覆盖层", "bounds": { "x": 0, "y": 0, "width": 1480, "height": 720 }, "buttons": [] },
      { "id": "hok-result-summary", "labelZh": "赛后结算面板", "bounds": { "x": 0, "y": 0, "width": 1480, "height": 720 }, "buttons": [
        { "id": "continue", "labelZh": "继续", "bounds": { "x": 615, "y": 586, "width": 255, "height": 68 }, "defaultVisibleState": "enabled" }
      ] }
    ]
  },
  "battleRecognition": {
    "uiId": "hok-battle-hud",
    "width": 1480,
    "height": 720,
    "healthBar": { "x": 691, "y": 237, "width": 116, "height": 8 },
    "manaBar": { "x": 691, "y": 249, "width": 116, "height": 7 },
    "minGreenRatio": 0.03
  }
}
```

## 当前采样范围

31 张横屏截图位于 `data/datasets/honor-of-kings/frames/`，标注在 `data/datasets/honor-of-kings/manifest.jsonl`。样本包含大厅各设置分区、训练入口、英雄/皮肤选择、战斗 HUD、计分板、商店、设置覆盖层和赛后页面。

分类器使用截图 RGB 网格指纹作候选匹配，并在距离过大或结果相近时退回 `unknown`。战斗 HUD 探针读取血量和蓝量；设置分区与皮肤页入口使用局部 ROI 样本识别按钮状态。其他按钮仅在精确样本或明确可见规则下输出已知状态，其余保留 `unknown`。

ADB H.264 屏幕流已实测源端约 25 FPS；识别目标为 2 FPS，设备实测更新约 1.6 FPS。逐次 PNG 截图的设备链路约 1.88 秒一帧，作为兼容回退。游戏版本、公告、活动和服务器 UI 变化可能造成未命中，识别器必须保留未知状态。

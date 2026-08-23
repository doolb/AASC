# Task 4：显示端文本播放器修复报告

## 范围

基于提交 `9016feb` 与 `task-4-review.md`，仅修复显示端文本恢复、单句 TTS、Markdown 分页和旋转重分页；图片、视频、音频和 HTML 播放分支未改动。

## 根因与修复

1. `restoreState` 只把 `currentMediaProgress` 赋给文本媒体，未读取服务端专用的 `currentTextProgress`。
   - 文本媒体恢复现优先读取 `currentTextProgress`，仅在缺失时回退到 `currentMediaProgress`。
2. TTS 回包前暂停保留了 `requestPending` 和旧 `playbackId`，服务端取消旧请求后再次播放无法重发。
   - 等待回包时暂停会失效旧 ID、清除 pending；再次播放使用新 ID 请求相同页码和句子。
3. Markdown 仅用空行分块，长段、连续列表与代码块会作为一个超页块被隐藏裁切。
   - 改为按可量测源行贪心组页，超页行继续按量测文本片段拆分；每页重新经过既有安全 Markdown 渲染器。
4. 显示层已经对 90°/270° 设置了旋转后的 `#mediaText` 尺寸，播放器再次交换宽高；rotate 控制也未重分页。
   - 播放器直接量测容器尺寸，显示层在旋转布局后的动画帧触发锚点保持的重新分页。

## TDD 记录

先加入恢复、TTS 回包前 pause/play、无空行 Markdown 长段/列表/代码块、四个直角旋转及锚点保持测试。首次 focused 运行共 13 项，其中新增缺陷场景有 5 项失败、既有 8 项通过；完成最小修复后所有 focused 测试通过。

## 验证

```text
node --test tests/text-media-player.test.js tests/display-playback-resume.test.js tests/display-sleep-mode.test.js
14 passed, 0 failed

node --check src/apps/web-mediacenter/ui/public/js/text-media-player.js
git diff --check
```

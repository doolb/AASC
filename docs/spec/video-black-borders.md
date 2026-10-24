# 视频黑边处理实现规格

```text
已有 := display.applyCrop/applyFit/showMedia/restoreState、Controls、WebSocketManager
已有Node := MpvPlayer 当前媒体/代次/串行IPC/几何/动态，NodeMediaController
已有存储 := config.updateDisplayStateById → config.set持久化显示端状态
新增 := autoBlackBorders默认true；contentRect默认完整；检测代次/候选/稳定计数

控制端切换 → type=control, action=autoBlackBorders, value=布尔
服务端独立处理器校验 → 持久化目标状态 → 广播type=autoBlackBordersConfig权威值 → 下发目标
初始化/重连 → 补默认值 → restoreState → 两端恢复权威开关

当前视频播放且开关开启 → 每秒最多一次 → 等比缩至最长边192像素 → RGB最大值亮度
全黑/过暗/有效内部太小 → 无效样本 → 清候选，保留已确认矩形
四边连续近黑行列 → 有效矩形 → 内部亮度校验 → 补一采样像素安全边距
连续四个不同播放位置样本 → 边界在容差内 → 保守外包矩形 → 确认
稳定完整矩形 → 取消旧自动裁边；暗场不得确认新裁剪或清除已确认结果
网页 := 当前video → 小canvas → getImageData → 共享检测器
Node := Lua screenshot-raw video → 小亮度样本+代次+方向 → client-message → JS检测器
结果核对媒体代次/开关/当前视频 → 过期丢弃；取样失败停当前源检测而不停止播放

布局输入 := 原视频尺寸、有效矩形、旋转、视口、填充模式
手动crop := 原视频裁剪框与有效矩形交集；无交集保持人工选择
按旋转映射有效宽高 → contain取较小比例；cover取较大比例；height/width沿用当前轴
求完整视频缩放尺寸及旋转后有效中心偏移 → 居中有效画面
网页 := 尺寸/位置/clip-path；Node := video-zoom/pan，不叠加panscan
dynamic := 网页原宽高过渡；Node在有效画面的contain/cover几何之间插值
换源/清空/关闭/实例失效 → 撤销采样 → 清候选与确认矩形
关闭开关 → 恢复完整画面填充 → 新视频不取样
重新开启当前跨域视频 → 重试相同直连源CORS → 成功/普通直连降级后恢复位置与暂停状态
发布 := servicePackage=true，voiceDisplayNodePackage=true，其他状态原值
Node独立包 := RUNTIME_SUPPORT_FILES显式包含共享video-black-borders.js，Lua与Node模块随应用目录进入包
```

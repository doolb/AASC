# 聊天 TTS 打断与 Offline 定时更新设计

## 需求

- 显示端“聊天”“角色”按钮后增加“停止播报”按钮，停止当前显示端聊天会话的全部思维链/正文 TTS。
- 同一聊天会话发送新消息时，立即停止上一轮已播放和排队的聊天 TTS；新回复到达后只播放新回复。
- 流式回复从 `<think>` 切换到正常答案时，停止思维链 TTS，立即进入正常答案播报。
- Offline APK 在启动/恢复时检查更新，并在前台每 10 分钟检查一次。

## 设计决策

1. TTS 消息携带 `chatTtsConversationId` 和 `chatTtsPhase`（`think`/`answer`），显示端队列按会话和阶段管理；停止聊天不会影响媒体、报时或其他会话 TTS。
2. 服务端为每个聊天会话维护生成代次。新消息或停止消息都会使旧代次的异步 TTS 结果失效，避免旧音频在停止后迟到。
3. 思维链切换到答案时只清理该会话的 `think` 队列和当前音频，保留非聊天 TTS；答案使用同一会话 ID继续进入队列。
4. 控制端播放的 TTS 使用同一会话字段，控制端音频队列也支持按会话清空。
5. 更新检查仅在 Offline APK 前台运行，避免后台重复网络任务；启动/恢复立即检查，之后由主线程每 10 分钟触发。点击“稍后”只隐藏当前提示，候选版本保留并在下一次周期或重启时再次检查。

## 不在本次范围

- 不改变普通媒体文本播放队列和报时全局停止语义。
- 不改变 APK 更新下载、验签、安装和回滚流程。
- 不在后台 Service 中持续轮询更新。

## 已完成实现

- 服务端：`src/apps/server/boot/server-app.js` 维护聊天会话代次，向 TTS 消息写入会话 ID/阶段，并在新消息、阶段切换和停止按钮时发送定向停止消息。
- LLM：`src/external/llm/think-output-filter.js` 和 `src/external/llm/llm-service.js` 将流式播报句子标记为 `think` 或 `answer`。
- Web：`display.html`、`display-chat.js`、`display-stage.js`、`chat.js` 和 `websocket.js` 支持显示端/控制端按会话清理 TTS；显示端按钮位于聊天、角色按钮之后。
- Android：`MainActivity.kt` 在 Offline Activity 前台启动/恢复检查，并以 10 分钟主线程周期再次检查；暂停或销毁 Activity 时取消轮询。
- 验证：Node 定向回归 60/60；Android `:app:testDebugUnitTest` 182/182；JavaScript 语法检查和 `git diff --check` 通过。


## Offline 服务更新后的页面刷新竞态（2026-10-10，网页实现完成）

用户反馈v59后Offline快捷面板未出现「清空媒体」。内外网清单仍为v59，已发布ZIP中的upload.html包含floatingClearMediaBtn；尚未取得用户设备当前服务版本，不能认定设备已应用v59。当前ADB仅有普通com.aasc.display，无com.aasc.display.offline，未操作该设备。

只读执行真实控制端websocket.js及display.html重启消息分支，复现两页共享localStorage.serverStartTime的竞态：显示页先处理则显示页刷新1次、控制页0次；反向顺序则控制页刷新1次、显示页0次。原生更新成功回调只更新提示，控制WebView打开后再次展开复用旧页面；虽禁用HTTP缓存，仍可能保留旧DOM。

将控制页/显示页重启判断改为各自页面实例的内存启动时间和已请求刷新标记用于reload去重，避免其他同源页面更新存储影响判断；首次连接初始化、同版本重连不刷新、重启各页分别刷新一次。首次连接只记录基准，旧共享标记停止使用但保留，其他本地状态保持。仅网页代码，不调整更新源/签名/模型/用户数据，不需要原生APK变更。补两种消息顺序、重复消息、首次连接、冷加载和存储异常回归，通过后发布服务包。用户已确认，网页实现与15文件119项回归通过，服务包构建发布进行中。

验证：新增tests/offline-page-reload.test.js共10项，执行正式控制模块与显示页完整连接/消息处理函数，覆盖两种到达顺序、多控制页、重复/无效消息、冷加载、旧共享记录及存储拒绝访问。Chromium同源双页真实导航各一次，旧控制页更新后出现floatingClearMediaBtn，聊天对象记录保留。15文件119/119、零跳过，JS语法通过。额外旧chat-tts-interruption测试3项中1项失败，HEAD基线同样失败：仍检查已移除的displayChatTtsStop，不扩展本轮范围。

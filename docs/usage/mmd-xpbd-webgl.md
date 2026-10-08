# MMD测试版刚体XPBD WebGL2

重新构建或刷新 `3rd/mmd-ar-test/web-dist/`，在动作面板的“布料计算”中选择 **XPBD（WebGL2）**。这是PMX刚体/骨骼物理的GPU后端；保留原Ammo、CPU XPBD及其独立选择。

GPU版用浮点贴图ping-pong执行预测、锚点插值、六轴约束、球/盒/胶囊接触、摩擦、反弹和风。每帧结束同步读回一次最终刚体状态以更新骨骼。现有本地模型/VMD切换继续使用T-pose、清空速度、下一帧播放的流程。

切换后原“纠错基准”显示为“每帧子步数”：3表示每帧3个子步，**不是3Hz**。物理Hz不参与XPBD步进。建议先用3子步检查效果；提高子步会线性增加绘制pass和同步等待。

状态栏显示帧物理耗时、读回耗时、pass数；支持GPU计时扩展才显示GPU毫秒。无WebGL2/可渲染浮点纹理、容量超限或数值错误时回退CPU XPBD并显示原因。默认仍保留当前求解器；不会自动将所有模型换成GPU。

当前属于实验后端：保守碰撞对、较多pass及同步读回可能使它比CPU更慢。本机软件GPU下默认米娅也明显更慢，不能据此宣称硬件加速。手机实际稳定性及耗时仍待测试，可随时切回XPBD（CPU）或Ammo。

构建：`npm run build:web:mmd-ar-test`。自测：`node --test tests/mmd-ar-xpbd-webgl.test.js tests/mmd-ar-xpbd-webgl-browser.test.js`，需本机Chromium（可通过CHROMIUM_PATH指定数值测试浏览器）和构建后的默认模型。

## “读回耗时”的含义

当前刚体GPU后端在所有物理pass提交后，对`readRenderTargetPixels`调用前后计时。该值包含等待GPU完成此前命令、同步及实际数据传输；显示5ms不能直接认定为拷贝数据花了5ms。它已包含在帧物理总耗时中，不应再次相加。GPU计时来自异步查询，可能对应较早帧，不能与当前读回耗时简单相减。

当前每帧读回6项刚体状态和所有允许碰撞对的累计标记；以183刚体/11540允许对计算，含纹理填充约199KiB。标记即使未打开碰撞诊断仍会读回。另一独立的“顶点布料 GPU（WebGL2）”使用GPU纹理渲染顶点，不能与这里的刚体骨骼回写路径混淆。

参考：[MDN WebGL最佳实践中的同步读回说明](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)。本次为指标说明，未改变求解或读回方式。

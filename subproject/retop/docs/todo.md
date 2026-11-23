# Retop 待办

- 进行中 [2026-11-20] 小闪 CSI 全 69 分区的离散试验已导出，但脸部和胸前斜边仍乱，需改善面带与脸部拟合、验证由低模派生后接入网页；见 subproject/retop/artifacts/moxing-csi-regions-trial-2026-11-20/wire-front.png。
- 待评估 [2026-11-20] 小闪美术 LOW 存在高模 HIGH.png 中较弱的眉间、眼周及胡须绘制细节；确认允许的纹理来源和恢复方式。
- 待复核 [2026-11-20] 小闪高模脸部投射候选检查左右与侧面过渡、眼睑和胡须细节；候选仍有 79 次法线转移未命中。见 subproject/retop/artifacts/moxing-highface-bake-2026-11-20/highface-detail.png。
- 进行中 [2026-11-20] 看图引导的小闪候选仍需改善眼窝、眉间与胡须层次，消除跨面片纹理接缝，检查 79 次源法线未命中并复核肩袖。对照 subproject/retop/artifacts/moxing-ai-guided-2026-11-20/current-detail.png。
- 待美术复核 [2026-11-20] 小闪高模人物的眉眼、鼻翼、手指分界与肩袖走线；胸袋和双腿布线见 subproject/retop/artifacts/moxing-wire-2026-11-20/leg-flow-front.png；美术原件的线框、灰模和贴图参照（另需核对同目录 uv-seams.png 的切缝及中线镜像）见 subproject/retop/artifacts/moxing-artist-study-2026-11-20/front-breakdown.png。
- 进行中 [2026-11-18] Retop 在 2122 三角面内从高模自动生成示例质量的低模、UV 和贴图；高模法线与平滑组恢复已接入。已接入面部包络、眉鼻折线、胸袋成对转角和源平滑断点核对。继续改善同机位灰模衣领（局部灰度差 13.592 → 13.991），待美术复核耳廓与带尾的外轮廓、眉眼、唇线、袋底倒角及手部外形。 人物 UV 继续复核侧脸接缝、左右岛复用范围及与手绘示例的留白差异。人物减面待改善弱鼻尖特征角色的头部定位。LOW 只作验收对照。见 `subproject/retop/docs/task/2026-11-18_Retop复杂人物CSI块面重建.md`。
- 待验证 [2026-11-20] 用人物和硬表面样本分别检验跨模型看图重建原则，比较目标视距下的剪影、UV 拉伸和贴图接缝。

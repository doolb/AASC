'use strict';
// HTML只描述调试操作；所有写入由统一Human接口校验并执行。
function appendPanels(panel) {
    const field = (label, control) => '<label class="mind-basic-field"><span>' + label + '</span>' + control + '</label>';
    const input = (key, value = '', type = 'text', attrs = '') => '<input data-human-field="' + key + '" type="' + type + '" value="' + value + '" ' + attrs + '>';
    const select = (key, options = '') => '<select data-human-field="' + key + '">' + options + '</select>';
    const button = (key, label) => '<button type="button" class="display-mmd-ar-action" data-human="' + key + '">' + label + '</button>';
    panel.append('<div id="mmdArHumanPanel">'
        + '<p class="mind-basic-note">HumanInterfaceElement：生理、反射、后天行为和MPL共用控制层。动作库保存在当前浏览器，按模型匹配；可导出备份。</p>'
        + '<div class="mind-basic-imu-options"><label>' + input('breathing', '', 'checkbox') + '呼吸</label>'
        + '<label>' + input('blinking', '', 'checkbox') + '自然眨眼</label></div>'
        + field('生理强度', input('physiologyStrength', '0.35', 'number', 'min="0" max="1" step="0.05"'))
        + button('physiology', '保存生理设置')
        + '<details open><summary>眼球跟随</summary>'
        + '<p class="mind-basic-note">手动模式优先于自动眼球跟随；拖动滑块实时控制当前模型，恢复自动后重新看向相机。</p>'
        + '<div class="mind-basic-imu-options"><label>' + input('gazeManual', '', 'checkbox') + '手动控制</label></div>'
        + field('左右角度 <output data-human-output="gazeManualYaw">0°</output>', input('gazeManualYaw', '0', 'range', 'min="-30" max="30" step="1"'))
        + field('上下角度 <output data-human-output="gazeManualPitch">0°</output>', input('gazeManualPitch', '0', 'range', 'min="-20" max="20" step="1"'))
        + '<button type="button" class="display-mmd-ar-action" data-human="gaze-auto">恢复自动跟随</button></details>'
        + '<details open><summary>头部注视设置</summary>'
        + '<p class="mind-basic-note">默认看向相机；轻触或点击画面后临时看向点击位置，再平滑返回。拖动不切换目标，显式头眼动作优先。</p>'
        + '<div class="mind-basic-imu-options"><label>' + input('gazeHead', '', 'checkbox') + '头部跟随</label>'
        + '<label>' + input('gazeEyes', '', 'checkbox') + '眼球跟随</label></div>'
        + field('注视强度', input('gazeStrength', '0.7', 'number', 'min="0" max="1" step="0.05"'))
        + [['HeadYaw', '头部水平附加角（°）', 45, 85], ['HeadPitch', '头部垂直附加角（°）', 25, 60],
            ['EyeYaw', '眼球水平附加角（°）', 20, 45], ['EyePitch', '眼球垂直附加角（°）', 15, 40],
            ['HeadMs', '头部缓动（ms）', 200, 2000], ['EyeMs', '眼球缓动（ms）', 60, 2000]]
            .map(([key, label, value, max]) => field(label, input('gaze' + key, String(value), 'number', 'min="0" max="' + max + '" step="1"'))).join('')
        + field('点击目标停留（秒）', input('gazeHoldSeconds', '3', 'number', 'min="0.2" max="30" step="0.1"'))
        + field('模型正面方向', select('gazeForward', '<option value="+Z">+Z（标准PMX）</option><option value="-Z">-Z</option>'))
        + '<div class="display-mmd-ar-actions">' + button('gaze', '保存注视设置') + button('gaze-reset', '返回相机') + '</div></details>'
        + '<details><summary>模型能力与人工映射</summary><p class="mind-basic-note" data-human-capabilities></p>'
        + '<div data-human-mappings></div>' + button('mappings', '保存映射') + '</details>'
        + '<details open><summary>后天动作库 / 版本</summary>'
        + field('行为名称', input('actionId', '', 'text', 'maxlength="80" placeholder="例如：招手"'))
        + field('登记VMD（留空可登记当前基础VMD）', input('vmd', '', 'file', 'accept=".vmd"'))
        + field('组合表情名称（可选）', input('expression', '', 'text', 'maxlength="80"'))
        + field('控制部位（默认全部非根轨道）', select('mask', '<option value="">代码 / VMD涉及的部位</option>'
            + ['head', 'torso', 'leftArm', 'rightArm', 'legs', 'face', 'eyes', 'mouth', 'root', 'all']
                .map(key => '<option value="' + key + '">' + key + '</option>').join('')))
        + '<div class="display-mmd-ar-actions">' + button('register', '登记VMD') + button('register-mpl', '登记下面的MPL') + '</div>'
        + field('已登记行为', select('action')) + field('行为版本', select('version'))
        + '<div class="display-mmd-ar-actions">' + button('perform', '播放行为') + button('version', '切换默认版本')
        + button('stop', '停止本面板动作') + '</div></details>'
        + '<details><summary>MPL覆写 / 叠加原动作</summary>'
        + '<textarea data-human-field="source" rows="9" maxlength="65536" spellcheck="false" aria-label="MPL修正代码" '
            + 'style="width:100%;box-sizing:border-box;background:#171a22;color:#eef2ff;resize:vertical"></textarea>'
        + field('混合方式', select('mode', '<option value="override">覆写指定部位</option><option value="additive">叠加增量</option>'))
        + field('开始时间（秒）', input('start', '0', 'number', 'min="0" max="3600" step="0.1"'))
        + field('时长（秒，留空采用MPL原时长）', input('duration', '', 'number', 'min="0.03333334" max="3600" step="0.1"'))
        + field('强度', input('strength', '1', 'number', 'min="0" max="1" step="0.05"'))
        + '<div class="display-mmd-ar-actions">' + button('copy-mpl', '从MPL分类复制代码')
        + button('preview', '修正当前基础动作') + button('revise', '保存行为的新版本') + '</div>'
        + '<p class="mind-basic-note">修正层不改原VMD文件。保存新版本继承当前默认版本，旧版本可随时切回。动态刚体骨骼继续由物理控制。</p></details>'
        + '<details><summary>组合表情</summary>' + field('表情组合名称', input('preset', '友好'))
        + '<textarea data-human-field="weights" rows="3" aria-label="组合表情权重" style="width:100%;box-sizing:border-box">{"开心":0.7,"害羞":0.3}</textarea>'
        + button('preset', '保存组合') + button('face', '预览组合') + '</details>'
        + '<details><summary>条件反射</summary>'
        + field('规则ID', input('ruleId', 'touch-head')) + field('事件', input('event', 'touch.head'))
        + field('行为名称（可选）', input('reflexAction')) + field('表情（可选）', input('reflexExpression', '害羞'))
        + field('触发阈值', input('threshold', '0.2', 'number', 'min="0" max="1" step="0.1"'))
        + field('冷却（秒）', input('cooldown', '2', 'number', 'min="0" max="60" step="0.1"'))
        + field('反射时长（秒）', input('reflexDuration', '1.5', 'number', 'min="0.2" max="15" step="0.1"'))
        + '<div class="display-mmd-ar-actions">' + button('reflex', '保存规则') + button('emit', '发送测试事件')
        + button('remove-reflex', '删除规则') + '</div><p class="mind-basic-note" data-human-rules></p></details>'
        + '<div class="display-mmd-ar-actions">' + button('export', '导出动作库') + button('import', '导入动作库') + '</div>'
        + input('libraryFile', '', 'file', 'accept=".json" hidden')
        + '<p class="mind-basic-note" data-human-runtime></p>'
        + '<p class="mind-basic-note" role="status" aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere"></p></div>');
}
module.exports = { appendPanels };

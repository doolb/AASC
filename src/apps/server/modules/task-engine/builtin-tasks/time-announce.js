const path = require('path');
const tts = require('../../../../../external/tts/tts-service');
const timeListener = require('../../../../web-mediacenter/modules/time/time-listener-app-service');

module.exports = {
  id: 'time.announce',
  name: '整点报时',
  description: '定时播报当前时间（常驻服务）',
  target: 'server',
  mode: 'service',
  sidebar: { group: 'voiceService', tab: 'announce', label: '整点报时', icon: '🔔', priority: 10 },
  params: [
    { name: 'enabled', type: 'toggle', required: false, default: true, label: '启用' },
    { name: 'interval', type: 'select', required: false, default: 15, options: [15, 30, 60], label: '报时间隔(分钟)' },
    { name: 'repeatCount', type: 'number', required: false, default: 3, label: '重复次数' },
    { name: 'repeatDelay', type: 'number', required: false, default: 3, label: '重复间隔(秒)' }
  ],
  widget: {
    html: '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:13px">' +
        '<span style="color:rgba(255,255,255,0.6)">状态</span>' +
        '<span style="font-weight:600;color:{{_statusColor}}">{{_statusText}}</span>' +
      '</div>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">' +
        '<input type="checkbox" class="task-widget-field" data-field="enabled" {{_enabledChecked}} style="accent-color:#4f9cf7">启用' +
      '</label>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:80px">' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:2px">间隔</div>' +
          '<select class="task-widget-field" data-field="interval" style="width:100%;padding:5px 6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:12px">' +
            '<option value="15" {{_sel15}}>15分钟</option>' +
            '<option value="30" {{_sel30}}>30分钟</option>' +
            '<option value="60" {{_sel60}}>60分钟</option>' +
          '</select>' +
        '</div>' +
        '<div style="flex:1;min-width:60px">' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:2px">重复</div>' +
          '<input type="number" class="task-widget-field" data-field="repeatCount" value="{{repeatCount}}" min="1" max="10" style="width:100%;padding:5px 6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box">' +
        '</div>' +
        '<div style="flex:1;min-width:60px">' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:2px">间隔(秒)</div>' +
          '<input type="number" class="task-widget-field" data-field="repeatDelay" value="{{repeatDelay}}" min="1" max="30" style="width:100%;padding:5px 6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box">' +
        '</div>' +
      '</div>' +
      '<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:8px">' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">' +
          '<span style="color:rgba(255,255,255,0.5)">上次报时</span>' +
          '<span style="color:#4f9cf7;font-weight:500">{{lastTime}}</span>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">' +
          '<span style="color:rgba(255,255,255,0.5)">下次报时</span>' +
          '<span style="color:#4f9cf7;font-weight:500">{{nextTime}}</span>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="task-card-btn" onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'test\')">测试报时</button>' +
        '<button class="task-card-btn primary" onclick="TaskPanel._onWidgetSaveConfig(\'{{instanceId}}\')">保存配置</button>' +
        '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'{{instanceId}}\')">停止服务</button>' +
      '</div>' +
    '</div>',
    actions: [
      { id: 'test', label: '测试报时' },
      { id: 'updateConfig', label: '保存配置' }
    ]
  },
  async run(context) {
    const { params, broadcastToDisplays, postWidgetUpdate, onWidgetAction, taskIO, taskName, instanceId } = context;
    const config = {
      enabled: params.enabled !== undefined ? params.enabled : true,
      interval: params.interval || 15,
      repeatCount: params.repeatCount || 3,
      repeatDelay: (params.repeatDelay || 3) * 1000
    };

    let lastAnnounceMinute = -1;
    let lastAnnounceText = '--';

    function shouldAnnounce(minute) {
      if (!config.enabled) return false;
      if (minute === lastAnnounceMinute) return false;
      switch (config.interval) {
        case 60: return minute === 0;
        case 30: return minute === 0 || minute === 30;
        case 15: return minute === 0 || minute === 15 || minute === 30 || minute === 45;
        default: return false;
      }
    }

    function generateTimeText() {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      let period = '';
      if (hour >= 0 && hour < 6) period = '凌晨';
      else if (hour >= 6 && hour < 9) period = '早上';
      else if (hour >= 9 && hour < 12) period = '上午';
      else if (hour >= 12 && hour < 14) period = '中午';
      else if (hour >= 14 && hour < 18) period = '下午';
      else if (hour >= 18 && hour < 22) period = '晚上';
      else period = '深夜';
      let displayHour = hour;
      if (hour > 12) displayHour = hour - 12;
      else if (hour === 0) displayHour = 12;
      if (minute === 0) return `现在时间是${period}${displayHour}点整`;
      return `现在时间是${period}${displayHour}点${minute}分`;
    }

    function calcNextAnnounce() {
      const now = new Date();
      const minute = now.getMinutes();
      const interval = config.interval;
      const next = Math.ceil(minute / interval) * interval;
      const d = new Date(now);
      d.setMinutes(next, 0, 0);
      if (next >= 60) d.setHours(d.getHours() + 1, 0, 0, 0);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function pushWidgetUpdate() {
      if (!postWidgetUpdate) return;
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const enabled = config.enabled;
      const interval = config.interval;
      postWidgetUpdate({
        enabled, interval,
        repeatCount: config.repeatCount,
        repeatDelay: Math.round(config.repeatDelay / 1000),
        lastTime: lastAnnounceText !== '--' ? lastAnnounceText : currentTime,
        nextTime: enabled ? calcNextAnnounce() : '--',
        _statusColor: enabled ? '#4ade80' : '#fbbf24',
        _statusText: enabled ? '运行中' : '已暂停',
        _enabledChecked: enabled ? 'checked' : '',
        _sel15: interval === 15 ? 'selected' : '',
        _sel30: interval === 30 ? 'selected' : '',
        _sel60: interval === 60 ? 'selected' : ''
      });
    }

    async function checkAndAnnounce(force = false) {
      const minute = new Date().getMinutes();
      if (!force && !shouldAnnounce(minute)) return;

      lastAnnounceMinute = minute;
      const timeText = generateTimeText();
      lastAnnounceText = timeText;
      if (!broadcastToDisplays) {
        console.warn('[time.announce] 广播函数不可用');
        return;
      }

      try {
        const audioPath = await tts.generateTTS(timeText);
        const fileName = path.basename(audioPath);
        const announceData = {
          type: 'tts',
          action: 'playAudio',
          audioUrl: `/uploads/tts/${fileName}`,
          text: timeText
        };

        for (let i = 0; i < config.repeatCount; i++) {
          broadcastToDisplays(announceData, { checkSleep: true });
          if (i < config.repeatCount - 1) {
            await new Promise(resolve => setTimeout(resolve, config.repeatDelay));
          }
        }
      } catch (err) {
        console.error('[time.announce] TTS 生成失败:', err.message);
      }
      pushWidgetUpdate();
    }

    // 注册分钟监听
    const offMinute = timeListener.on('minute', (eventData) => {
      checkAndAnnounce(false);
    });

    // 每分钟推送 widget 更新
    const updateTimer = setInterval(pushWidgetUpdate, 30000);

    // 初始推送
    setTimeout(pushWidgetUpdate, 500);

    // 处理 widget 动作
    if (onWidgetAction) {
      onWidgetAction('test', async () => {
        await checkAndAnnounce(true);
        return { success: true };
      });

      onWidgetAction('updateConfig', async (newConfig) => {
        if (newConfig.enabled !== undefined) config.enabled = newConfig.enabled;
        if (newConfig.interval !== undefined) config.interval = newConfig.interval;
        if (newConfig.repeatCount !== undefined) config.repeatCount = newConfig.repeatCount;
        if (newConfig.repeatDelay !== undefined) config.repeatDelay = newConfig.repeatDelay * 1000;
        if (taskIO) {
          await taskIO.updateIndex(taskName, {
            instanceId,
            params: {
              enabled: config.enabled,
              interval: config.interval,
              repeatCount: config.repeatCount,
              repeatDelay: Math.round(config.repeatDelay / 1000)
            }
          });
        }
        pushWidgetUpdate();
        return { success: true };
      });

      onWidgetAction('widgetRefresh', async () => {
        pushWidgetUpdate();
        return { success: true };
      });
    }

    return {
      type: 'service',
      stop: () => {
        offMinute();
        clearInterval(updateTimer);
        console.log('[time.announce] 报时服务已停止');
      }
    };
  }
};

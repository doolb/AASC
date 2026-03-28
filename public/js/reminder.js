let reminders = [];

function loadReminders() {
    fetch('/api/reminders')
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                reminders = data.reminders;
                renderReminderList();
            }
        })
        .catch(err => {
            console.error('加载提醒列表失败:', err);
        });
}

function renderReminderList() {
    const container = document.getElementById('reminderList');
    if (!container) return;
    
    if (reminders.length === 0) {
        container.innerHTML = '<div class="empty-list">暂无提醒</div>';
        return;
    }
    
    container.innerHTML = reminders.map(r => `
        <div class="reminder-item ${r.enabled ? '' : 'disabled'}" style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 10px; border-left: 3px solid ${r.enabled ? '#4CAF50' : '#666'};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-size: 18px; color: ${r.enabled ? '#4CAF50' : '#888'}; font-weight: 500;">${r.time}</div>
                <div style="display: flex; gap: 5px;">
                    <span style="font-size: 11px; padding: 3px 8px; border-radius: 4px; background: ${r.type === 'daily' ? 'rgba(33, 150, 243, 0.3)' : 'rgba(255, 152, 0, 0.3)'}; color: ${r.type === 'daily' ? '#64B5F6' : '#FFB74D'};">
                        ${r.type === 'daily' ? '每天' : '临时'}
                    </span>
                    <span style="font-size: 11px; padding: 3px 8px; border-radius: 4px; background: ${r.enabled ? 'rgba(76, 175, 80, 0.3)' : 'rgba(158, 158, 158, 0.3)'}; color: ${r.enabled ? '#81C784' : '#9E9E9E'};">
                        ${r.enabled ? '启用' : '禁用'}
                    </span>
                </div>
            </div>
            <div style="font-size: 14px; color: #fff; margin-bottom: 8px;">${r.content}</div>
            <div style="font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 8px;">
                方式: ${r.methods && r.methods.includes('voice') ? '语音播报' : ''}${r.methods && r.methods.includes('voice') && r.methods.includes('popup') ? ' + ' : ''}${r.methods && r.methods.includes('popup') ? '弹窗提示' : ''}
                ${r.repeat && r.repeat.enabled ? ` | 重复: 每${r.repeat.interval}分钟, ${r.repeat.count === 0 ? '无限' : r.repeat.count + '次'}` : ''}
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="control-btn" onclick="toggleReminder('${r.id}', ${!r.enabled})" style="padding: 5px 12px; font-size: 12px; background: ${r.enabled ? 'linear-gradient(135deg, #f44336, #d32f2f)' : 'linear-gradient(135deg, #4CAF50, #45a049)'};">
                    ${r.enabled ? '禁用' : '启用'}
                </button>
                <button class="control-btn" onclick="deleteReminder('${r.id}')" style="padding: 5px 12px; font-size: 12px; background: linear-gradient(135deg, #9E9E9E, #757575);">
                    删除
                </button>
            </div>
        </div>
    `).join('');
}

function addReminder() {
    const content = document.getElementById('reminderContent').value.trim();
    const time = document.getElementById('reminderTime').value;
    const type = document.getElementById('reminderType').value;
    const methodVoice = document.getElementById('reminderMethodVoice').checked;
    const methodPopup = document.getElementById('reminderMethodPopup').checked;
    const repeatEnabled = document.getElementById('reminderRepeatEnabled').checked;
    const repeatInterval = parseInt(document.getElementById('reminderRepeatInterval').value) || 5;
    const repeatCount = parseInt(document.getElementById('reminderRepeatCount').value) || 10;
    
    if (!content) {
        Toast.show('请输入提醒内容', 'error');
        return;
    }
    
    if (!time) {
        Toast.show('请选择提醒时间', 'error');
        return;
    }
    
    const methods = [];
    if (methodVoice) methods.push('voice');
    if (methodPopup) methods.push('popup');
    
    if (methods.length === 0) {
        Toast.show('请选择至少一种提醒方式', 'error');
        return;
    }
    
    fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content,
            time,
            type,
            methods,
            repeat: {
                enabled: repeatEnabled,
                interval: repeatInterval,
                count: repeatCount
            }
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            Toast.show('提醒已创建', 'success');
            document.getElementById('reminderContent').value = '';
            document.getElementById('reminderTime').value = '';
            loadReminders();
        } else {
            Toast.show(data.message || '创建失败', 'error');
        }
    })
    .catch(err => {
        console.error('创建提醒失败:', err);
        Toast.show('创建失败', 'error');
    });
}

function toggleReminder(id, enabled) {
    fetch(`/api/reminders/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            Toast.show(enabled ? '提醒已启用' : '提醒已禁用', 'success');
            loadReminders();
        } else {
            Toast.show(data.message || '操作失败', 'error');
        }
    })
    .catch(err => {
        console.error('切换提醒状态失败:', err);
        Toast.show('操作失败', 'error');
    });
}

function deleteReminder(id) {
    if (!confirm('确定要删除这个提醒吗？')) return;
    
    fetch(`/api/reminders/${id}`, {
        method: 'DELETE'
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            Toast.show('提醒已删除', 'success');
            loadReminders();
        } else {
            Toast.show(data.message || '删除失败', 'error');
        }
    })
    .catch(err => {
        console.error('删除提醒失败:', err);
        Toast.show('删除失败', 'error');
    });
}

function testReminder() {
    const content = document.getElementById('reminderContent').value.trim() || '这是一条测试提醒';
    const methodVoice = document.getElementById('reminderMethodVoice').checked;
    const methodPopup = document.getElementById('reminderMethodPopup').checked;
    
    const methods = [];
    if (methodVoice) methods.push('voice');
    if (methodPopup) methods.push('popup');
    
    if (methods.length === 0) {
        methods.push('voice');
    }
    
    fetch('/api/reminders/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, methods })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            Toast.show('测试提醒已发送', 'success');
        } else {
            Toast.show(data.message || '测试失败', 'error');
        }
    })
    .catch(err => {
        console.error('测试提醒失败:', err);
        Toast.show('测试失败', 'error');
    });
}

window.Reminder = {
    load: loadReminders,
    add: addReminder,
    toggle: toggleReminder,
    delete: deleteReminder,
    test: testReminder
};

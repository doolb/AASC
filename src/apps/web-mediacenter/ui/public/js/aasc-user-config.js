'use strict';

const AascUserConfig = {
    async exportConfig() {
        try {
            const response = await fetch('/api/aasc-user/export');
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || `HTTP ${response.status}`);
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `aasc-user-config-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            window.showToast('aasc-user 配置已导出', 'success');
        } catch (error) {
            window.showToast(`导出配置失败: ${error.message}`, 'error');
        }
    },

    selectImport() {
        const input = document.getElementById('aascUserConfigImportInput');
        if (input) input.click();
    },

    async importConfig(file) {
        if (!file) return;
        try {
            const payload = JSON.parse(await file.text());
            const response = await fetch('/api/aasc-user/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: payload, mode: 'merge' })
            });
            const data = await response.json();
            if (!response.ok || data.status !== 'success') throw new Error(data.message || `HTTP ${response.status}`);
            window.showToast('配置导入完成，请重启服务端使全部配置生效', 'success');
        } catch (error) {
            window.showToast(`导入配置失败: ${error.message}`, 'error');
        }
    }
};

window.AascUserConfig = AascUserConfig;

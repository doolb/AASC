'use strict';

const AascUserConfig = {
    fullPreview: null,
    nativeBackupRequestId: null,

    setFullStatus(message, error = false) {
        const node = document.getElementById('fullConfigBackupStatus');
        if (!node) return;
        node.textContent = message;
        node.style.color = error ? 'var(--danger-color)' : 'var(--text-secondary)';
    },

    setFullBusy(busy) {
        document.querySelectorAll('[data-full-config-control]').forEach(node => {
            node.disabled = busy || (node.id === 'fullConfigBackupMode' && this.fullPreview !== null);
        });
    },

    async readFullResponse(response) {
        let data;
        try { data = await response.json(); } catch (_) { throw new Error(`HTTP ${response.status}`); }
        if (!response.ok || data.status !== 'success') throw new Error(data.message || `HTTP ${response.status}`);
        return data;
    },

    async exportFullConfig() {
        this.setFullBusy(true);
        this.setFullStatus('正在生成全量 ZIP 备份…');
        try {
            const bridge = window.NativeControl;
            if (bridge && typeof bridge.saveFullConfigBackup === 'function') {
                this.nativeBackupRequestId = `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                if (!bridge.saveFullConfigBackup(this.nativeBackupRequestId)) throw new Error('无法开始保存 ZIP 到 Download');
                this.setFullStatus('正在保存 ZIP 到系统 Download…');
                return;
            }
            const response = await fetch('/api/config-backup/export');
            if (!response.ok) await this.readFullResponse(response);
            const blob = await response.blob();
            const fileName = response.headers.get('content-disposition')?.match(/filename="?([^";]+\.zip)/iu)?.[1]
                || `aasc-full-config-${new Date().toISOString().slice(0, 10)}.zip`;
            if (bridge && typeof bridge.saveDownloadFile === 'function') {
                // 旧 APK 继续使用已有小文件保存桥，大包需要新版的流式文档保存入口。
                if (blob.size > 16 * 1024 * 1024) throw new Error('此 ZIP 超过旧 APK 的 16 MiB 保存上限，请更新 min APK');
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result).split(',')[1]);
                    reader.onerror = () => reject(new Error('读取 ZIP 失败'));
                    reader.readAsDataURL(blob);
                });
                const result = JSON.parse(bridge.saveDownloadFile(fileName, 'application/zip', base64));
                if (!result.ok) throw new Error(result.error || '保存 ZIP 失败');
                this.setFullStatus('全量 ZIP 已保存到 Download');
            } else {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url; link.download = fileName;
                document.body.appendChild(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                this.setFullStatus('全量 ZIP 已交给浏览器下载');
            }
            window.showToast('全量配置 ZIP 已导出', 'success');
        } catch (error) {
            this.nativeBackupRequestId = null;
            this.setFullStatus(error.message, true);
            window.showToast(`全量导出失败: ${error.message}`, 'error');
        } finally {
            if (!this.nativeBackupRequestId) this.setFullBusy(false);
        }
    },

    onNativeBackupSaved(result) {
        if (!result || result.requestId !== this.nativeBackupRequestId) return;
        this.nativeBackupRequestId = null;
        this.setFullBusy(false);
        const message = result.status === 'saved' ? (result.message || '全量 ZIP 已保存')
            : result.status === 'cancelled' ? '已取消 ZIP 保存' : (result.message || '保存 ZIP 失败');
        this.setFullStatus(message, result.status === 'error');
        if (result.status !== 'cancelled') window.showToast(message, result.status === 'saved' ? 'success' : 'error');
    },

    selectFullImport() {
        document.getElementById('fullConfigBackupImportInput')?.click();
    },

    async previewFullImport(file) {
        if (!file) return;
        if (this.fullPreview) await this.cancelFullPreview();
        this.setFullBusy(true);
        this.setFullStatus('正在上传并校验 ZIP…');
        try {
            if (!/\.zip$/iu.test(file.name) || file.size > 100 * 1024 * 1024) throw new Error('请选择不超过 100 MiB 的 ZIP 文件');
            const mode = document.getElementById('fullConfigBackupMode').value;
            const form = new FormData(); form.append('mode', mode); form.append('backup', file);
            const data = await this.readFullResponse(await fetch('/api/config-backup/preview', { method: 'POST', body: form }));
            this.fullPreview = data.preview;
            const preview = data.preview;
            document.getElementById('fullConfigBackupPreviewText').textContent =
                `全局配置 ${preview.configFiles} 个，用户配置/聊天文件 ${preview.userFiles} 个；新增 ${preview.added} 个，覆盖 ${preview.overwritten} 个，删除 ${preview.deleted} 个。确认后服务器将自动重启。`;
            document.getElementById('fullConfigBackupPreview').hidden = false;
            this.setFullStatus('ZIP 校验通过，请核对恢复范围');
        } catch (error) {
            this.setFullStatus(error.message, true);
            window.showToast(`ZIP 校验失败: ${error.message}`, 'error');
        } finally {
            this.setFullBusy(false);
            if (this.fullPreview) document.getElementById('fullConfigBackupMode').disabled = true;
        }
    },

    async cancelFullPreview() {
        const preview = this.fullPreview;
        this.fullPreview = null;
        document.getElementById('fullConfigBackupPreview').hidden = true;
        this.setFullBusy(false);
        this.setFullStatus('已取消导入');
        if (!preview) return;
        try { await fetch(`/api/config-backup/preview/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }); }
        catch (_) { /* 页面取消不执行导入；未能联络服务端的临时预览由过期清理回收。 */ }
    },

    async confirmFullImport() {
        const preview = this.fullPreview;
        if (!preview) return;
        this.setFullBusy(true);
        this.setFullStatus('正在确认导入，服务器将自动重启…');
        try {
            const data = await this.readFullResponse(await fetch('/api/config-backup/import', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: preview.id, mode: preview.mode, confirmed: true })
            }));
            this.fullPreview = null;
            document.getElementById('fullConfigBackupPreview').hidden = true;
            this.setFullStatus(data.message);
            await this.waitForFullRestore(data.id);
        } catch (error) {
            this.setFullStatus(error.message, true);
            window.showToast(`配置恢复失败: ${error.message}`, 'error');
        } finally { this.setFullBusy(false); }
    },

    async waitForFullRestore(id) {
        for (let attempt = 0; attempt < 90; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            let data;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            try {
                data = await this.readFullResponse(await fetch('/api/config-backup/status', {
                    cache: 'no-store', signal: controller.signal
                }));
            } catch (_) { continue; }
            finally { clearTimeout(timeout); }
            if (data.result.id !== id) continue;
            if (data.result.status === 'failed') throw new Error(data.result.message || '导入失败，已恢复原配置');
            if (data.result.status === 'applied') {
                this.setFullStatus('配置恢复完成，正在刷新控制端');
                window.showToast('配置恢复完成', 'success');
                setTimeout(() => window.location.reload(), 800);
                return;
            }
        }
        this.setFullStatus('服务器暂未重新连接；若备份更改了地址或端口，请按导入后的服务地址重新打开控制端', true);
    },

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
window.onFullConfigBackupSaved = result => AascUserConfig.onNativeBackupSaved(result);

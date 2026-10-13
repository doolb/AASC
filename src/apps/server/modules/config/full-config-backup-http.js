'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');

/** 这里只传输版本化备份文件；运行参数的日常保存仍走原有 AASC 配置流程。 */
function mountFullConfigBackupRoutes(app, options) {
    const { service, requestRestart, canRestart, logger = () => {} } = options;
    service.prepareUpload();
    const upload = multer({ storage: multer.diskStorage({ destination: service.uploadDir,
        filename: (req, file, done) => done(null, `${crypto.randomUUID()}.zip`) }),
    limits: { fileSize: service.limits.zipBytes, files: 1, fields: 1, fieldSize: 64 } });

    const respondError = (res, error) => {
        logger('error', `全量配置备份失败: ${error.message}`);
        if (!res.headersSent) res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : (error.statusCode || 400))
            .json({ status: 'error', message: error.message });
    };
    const route = action => async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try { await action(req, res); } catch (error) { respondError(res, error); }
    };

    app.get('/api/config-backup/export', route(async (req, res) => {
        const archive = await service.exportArchive();
        logger('info', `导出全量配置 ZIP files=${archive.manifest.files.length}`);
        res.download(archive.archivePath, archive.filename, error => {
            archive.dispose();
            if (error) respondError(res, error);
        });
    }));

    app.post('/api/config-backup/preview', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        upload.single('backup')(req, res, async error => {
            try {
                if (error) throw error;
                if (!req.file) throw new Error('请选择全量配置 ZIP 文件');
                const preview = await service.previewArchive(req.file.path, req.body?.mode || 'merge');
                res.json({ status: 'success', preview });
            } catch (failure) { respondError(res, failure); }
            finally { if (req.file) fs.rmSync(req.file.path, { force: true }); }
        });
    });

    app.post('/api/config-backup/import', route(async (req, res) => {
        // 未受启动器托管的直接启动实例不能只退出后谎称自动重启成功。
        if (!canRestart()) throw Object.assign(new Error('当前服务未受重启启动器托管，请使用 npm start 或 Offline APK 启动后导入'), { statusCode: 409 });
        const result = service.commitPreview(req.body?.id, req.body?.mode, req.body?.confirmed === true);
        let requested = false;
        const restartOnce = () => {
            if (requested) return;
            requested = true;
            requestRestart();
        };
        res.once('finish', restartOnce);
        res.once('close', restartOnce);
        logger('info', `已确认全量配置导入 mode=${req.body.mode} files=${result.files}，即将自动重启`);
        res.json({ status: 'success', message: 'ZIP 校验完成，服务器正在自动重启并恢复配置', ...result });
        if (res.destroyed) restartOnce();
    }));

    app.delete('/api/config-backup/preview/:id', route(async (req, res) => {
        service.cancelPreview(req.params.id);
        res.json({ status: 'success' });
    }));
    app.get('/api/config-backup/status', route(async (req, res) => {
        res.json({ status: 'success', result: service.status() });
    }));
}

module.exports = { mountFullConfigBackupRoutes };

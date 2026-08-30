'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '../../../../..');

function readUpstreamManifest(projectRoot = DEFAULT_ROOT) {
    const rootDir = path.join(projectRoot, '3rd/chat2api-core');
    const manifestText = fs.readFileSync(path.join(rootDir, 'UPSTREAM.md'), 'utf8');
    const readField = (name) => {
        const match = manifestText.match(new RegExp('^- ' + name + ': `([^`]+)`$', 'mu'));
        return match ? match[1] : '';
    };

    const section = (title) => {
        const match = manifestText.match(new RegExp(`## ${title}\\n([\\s\\S]*?)(?=\\n## |$)`, 'u'));
        return match ? [...match[1].matchAll(/^- `([^`]+)`/gmu)].map((item) => item[1]) : [];
    };

    return {
        repository: readField('repository'),
        version: readField('version'),
        commit: readField('commit'),
        license: readField('license'),
        includedPaths: section('计划纳入的核心路径'),
        excludedPaths: section('明确排除的路径')
    };
}

function validateUpstreamTree(projectRoot = DEFAULT_ROOT) {
    const rootDir = path.join(projectRoot, '3rd/chat2api-core');
    const manifest = readUpstreamManifest(projectRoot);
    const requiredFiles = ['UPSTREAM.md', 'LICENSE', 'NOTICE.md'];
    const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(rootDir, file)));
    const forbidden = [];
    const walk = (currentDir) => {
        if (!fs.existsSync(currentDir)) return;
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const entryPath = path.join(currentDir, entry.name);
            const relativePath = path.relative(rootDir, entryPath);
            if (/(^|[/\\])(electron|renderer|ipc|window|tray|updater)([/\\]|$)/iu.test(relativePath)) {
                forbidden.push(relativePath);
            } else if (entry.isDirectory()) {
                walk(entryPath);
            }
        }
    };
    walk(rootDir);

    return {
        valid: missing.length === 0 && forbidden.length === 0 && manifest.license === 'GPL-3.0',
        missing,
        forbidden,
        licenseValid: manifest.license === 'GPL-3.0'
    };
}

module.exports = { readUpstreamManifest, validateUpstreamTree };

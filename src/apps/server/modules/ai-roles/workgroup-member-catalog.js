'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readRoleMetadata(file) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        const primaryMatch = content.match(/^primary:[ \t]*([^\r\n]*)$/imu);
        const secondaryMatch = content.match(/^secondary:[ \t]*([^\r\n]*)$/imu);
        const secondary = secondaryMatch?.[1]
            ? secondaryMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
            : [];
        return {
            primary: primaryMatch?.[1]?.trim() || '',
            secondary,
            hasRoleFile: true
        };
    } catch (_) {
        return { primary: '', secondary: [], hasRoleFile: false };
    }
}

// 只读取 workgroup/members 的直接子目录和角色元数据，不读取或返回文件正文。
class WorkgroupMemberCatalog {
    constructor(projectRoot) {
        this.membersDir = path.join(projectRoot, 'workgroup', 'members');
    }

    list() {
        let entries;
        try {
            entries = fs.readdirSync(this.membersDir, { withFileTypes: true });
        } catch (_) {
            return [];
        }

        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => {
                const memberDir = path.join(this.membersDir, entry.name);
                const roleFile = path.join(memberDir, 'role.md');
                const historyFile = path.join(memberDir, 'history.md');
                const metadata = readRoleMetadata(roleFile);
                return {
                    name: entry.name,
                    primary: metadata.primary,
                    secondary: metadata.secondary,
                    hasRoleFile: metadata.hasRoleFile,
                    hasHistoryFile: fs.existsSync(historyFile)
                };
            });
    }
}

module.exports = WorkgroupMemberCatalog;

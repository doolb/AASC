'use strict';

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function getRoleNames(roles) {
    if (!Array.isArray(roles)) return [];

    return [...new Set(roles
        .map((role) => typeof role === 'string' ? role : role?.name)
        .map(normalizeText)
        .filter(Boolean))];
}

function getRepairModeValues(config = {}) {
    return {
        password: typeof config.password === 'string' ? config.password : '',
        role: normalizeText(config.role)
    };
}

function createPublicRepairModeConfig(config = {}, roles = []) {
    const values = getRepairModeValues(config);
    return {
        passwordConfigured: values.password.length > 0,
        role: values.role,
        roles: getRoleNames(roles)
    };
}

function updateRepairModeConfig({ body, currentConfig = {}, roles = [] } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, message: '修复模式配置必须是对象' };
    }
    if (body.clearPassword !== undefined && typeof body.clearPassword !== 'boolean') {
        return { ok: false, message: 'clearPassword 必须是布尔值' };
    }
    if (body.password !== undefined && typeof body.password !== 'string') {
        return { ok: false, message: 'password 必须是字符串' };
    }

    const current = getRepairModeValues(currentConfig);
    const role = body.role === undefined ? current.role : normalizeText(body.role);
    const roleNames = getRoleNames(roles);
    if (!role || !roleNames.includes(role)) {
        return { ok: false, message: '修复模式工作 Agent 不存在' };
    }

    const password = body.clearPassword === true
        ? ''
        : body.password && body.password.trim()
            ? body.password.trim()
            : current.password;
    const value = { password, role };
    return {
        ok: true,
        value,
        publicConfig: createPublicRepairModeConfig(value, roles)
    };
}

module.exports = {
    createPublicRepairModeConfig,
    getRoleNames,
    updateRepairModeConfig
};

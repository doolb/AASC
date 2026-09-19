/*
 * MMD/VRM 动作协议适配器。
 *
 * 只允许结构化的高级动作计划和有限低级命令，拒绝脚本、URL、文件路径及
 * 未知命令。当前运行时不存在时仍保留校验和本地降级动作，方便离线包逐步接入模型。
 */
(function exposeDisplayMmdCommandAdapter(root) {
    const ALLOWED_COMMANDS = new Set([
        'MOTION_ADD',
        'MOTION_DELETE',
        'MODEL_BINDFACE',
        'MODEL_BINDBONE'
    ]);
    const MAX_PLAN_STEPS = 32;

    function isSafeScalar(value) {
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    }

    function validateCommand(command) {
        if (!command || typeof command !== 'object') return { valid: false, error: '动作命令必须是对象' };
        if (!ALLOWED_COMMANDS.has(command.type)) {
            return { valid: false, error: `不支持的 MMD 命令: ${String(command.type || '')}` };
        }
        if (Object.values(command).some((value) => typeof value === 'string' && /(?:javascript:|https?:\/\/|[\\/].*(?:etc|data|system))/iu.test(value))) {
            return { valid: false, error: '动作命令包含被禁止的 URL 或路径' };
        }
        if (command.weight !== undefined && (!Number.isFinite(Number(command.weight)) || Number(command.weight) < 0 || Number(command.weight) > 1)) {
            return { valid: false, error: '表情权重超出范围' };
        }
        if (command.name !== undefined && !isSafeScalar(command.name)) {
            return { valid: false, error: '动作名称格式无效' };
        }
        return { valid: true };
    }

    function validatePlan(plan) {
        if (!plan || typeof plan !== 'object') return { valid: false, error: '动作计划必须是对象' };
        if (typeof plan.planId !== 'string' && typeof plan.action !== 'string' && typeof plan.fallbackAction !== 'string') {
            return { valid: false, error: '动作计划缺少 planId 或 action' };
        }
        if (Array.isArray(plan.steps) && plan.steps.length > MAX_PLAN_STEPS) {
            return { valid: false, error: '动作步骤数量超限' };
        }
        for (const step of plan.steps || []) {
            const result = validateCommand(step);
            if (!result.valid && step.type) return result;
        }
        return { valid: true };
    }

    function execute(input) {
        const plan = input?.plan && typeof input.plan === 'object' ? input.plan : input;
        const validation = validatePlan(plan);
        if (!validation.valid) {
            console.warn('[显示端 MMD] 拒绝动作计划:', validation.error);
            return { success: false, error: validation.error };
        }
        if (root.DisplayMmd && typeof root.DisplayMmd.handleActionPlan === 'function') {
            root.DisplayMmd.handleActionPlan(plan);
        }
        return { success: true, planId: plan.planId || null };
    }

    root.DisplayMmdCommandAdapter = Object.freeze({
        execute,
        validateCommand,
        validatePlan
    });
}(window));

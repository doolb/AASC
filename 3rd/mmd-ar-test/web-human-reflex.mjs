export const DEFAULT_REFLEXES = [
    { id: 'touch-head', event: 'touch.head', expression: '害羞', threshold: 0.2, cooldown: 2, duration: 1.5, strength: 0.6 },
    { id: 'surprise', event: 'stimulus.surprise', expression: '惊讶', threshold: 0.4, cooldown: 3, duration: 1.2, strength: 0.8 },
];
export function normalizeHumanReflex(value) {
    const rule = { id: String(value.id || '').trim(), event: String(value.event || '').trim(),
        action: String(value.action || ''), expression: String(value.expression || ''),
        threshold: value.threshold ?? 0.2, cooldown: value.cooldown ?? 2,
        duration: value.duration ?? 1.5, strength: value.strength ?? 0.7 };
    if (!rule.id || rule.id.length > 80 || !rule.event || rule.event.length > 80 || (!rule.action && !rule.expression)
        || !Number.isFinite(rule.threshold) || rule.threshold < 0 || rule.threshold > 1
        || !Number.isFinite(rule.cooldown) || rule.cooldown < 0 || rule.cooldown > 60
        || !Number.isFinite(rule.duration) || rule.duration < 0.2 || rule.duration > 15
        || !Number.isFinite(rule.strength) || rule.strength < 0 || rule.strength > 1) throw new Error('反射规则参数无效');
    return rule;
}
export function createHumanReflex({ clock, rules, perform }) {
    const last = new Map();
    return {
        reset: () => last.clear(),
        async emit(event) {
            const strength = event.strength ?? 1;
            if (typeof event.type !== 'string' || !Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error('反射事件需type和0–1强度');
            const matches = rules().map(normalizeHumanReflex).filter(rule => rule.event === event.type
                && strength >= rule.threshold && clock() - (last.get(rule.id) ?? -Infinity) >= rule.cooldown);
            const results = [];
            for (const rule of matches) {
                last.set(rule.id, clock());
                try { results.push(await perform({ action: rule.action, expression: rule.expression,
                    duration: rule.duration, strength: rule.strength * strength, owner: 'reflex:' + rule.id, priority: 90 })); }
                catch (error) { last.delete(rule.id); throw error; }
            }
            return results;
        }
    };
}

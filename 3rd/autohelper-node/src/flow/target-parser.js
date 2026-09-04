const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const TARGET_TYPES = new Set(['daily', 'weekly', 'version']);
const COMPLETIONS = new Set(['state', 'all-discovered-subgoals']);
const parseFields = (contents, filePath) => {
    const fields = {};
    for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const separator = line.indexOf('=');
        if (separator <= 0) {
            throw new Error(`invalid target line ${index + 1}: ${filePath}`);
        }
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (!key || !value || fields[key] !== undefined) {
            throw new Error(`invalid target field ${key || '(empty)'}: ${filePath}`);
        }
        fields[key] = value;
    }
    return fields;
};
const required = (fields, key, filePath) => {
    const value = fields[key];
    if (!value) {
        throw new Error(`missing target field ${key}: ${filePath}`);
    }
    return value;
};
const safeId = (value, field, filePath) => {
    if (!SAFE_ID_PATTERN.test(value) || value === '.' || value === '..') {
        throw new Error(`invalid ${field} in target: ${filePath}`);
    }
    return value;
};
const safePackage = (value, field, filePath) => {
    if (!/^[A-Za-z0-9._]+$/.test(value)) {
        throw new Error(`invalid ${field} in target: ${filePath}`);
    }
    return value;
};
const safeActivity = (value, field, filePath) => {
    if (!/^[A-Za-z0-9._$]+$/.test(value)) {
        throw new Error(`invalid ${field} in target: ${filePath}`);
    }
    return value;
};
const nonNegativeInteger = (value, field, filePath) => {
    if (!/^\d+$/.test(value)) {
        throw new Error(`invalid ${field} in target: ${filePath}`);
    }
    return Number(value);
};
const parseBoolean = (value, filePath) => {
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    throw new Error(`invalid enabled in target: ${filePath}`);
};
export const parseTargetDefinition = (filePath, contents) => {
    const fields = parseFields(contents, filePath);
    const type = required(fields, 'type', filePath);
    if (!TARGET_TYPES.has(type)) {
        throw new Error(`invalid target type: ${filePath}`);
    }
    const completion = required(fields, 'completion', filePath);
    if (!COMPLETIONS.has(completion)) {
        throw new Error(`invalid target completion: ${filePath}`);
    }
    const target = {
        id: safeId(required(fields, 'id', filePath), 'id', filePath),
        type,
        enabled: parseBoolean(required(fields, 'enabled', filePath), filePath),
        feature: safeId(required(fields, 'feature', filePath), 'feature', filePath),
        entryFlow: safeId(required(fields, 'entry-flow', filePath), 'entry-flow', filePath),
        completion,
        filePath,
    };
    const bootstrapRootKey = fields['bootstrap-root'] ? 'bootstrap-root' : 'bootstrap-feature';
    if (fields['bootstrap-root'] && fields['bootstrap-feature']) {
        throw new Error(`target cannot define both bootstrap-root and bootstrap-feature: ${filePath}`);
    }
    const bootstrapFields = [bootstrapRootKey, 'bootstrap-flow', 'bootstrap-done-state']
        .map((key) => ({ key, value: fields[key] }))
        .filter((field) => Boolean(field.value));
    if (bootstrapFields.length > 0 && bootstrapFields.length !== 3) {
        throw new Error(`bootstrap requires bootstrap-feature, bootstrap-flow and bootstrap-done-state: ${filePath}`);
    }
    if (bootstrapFields.length === 3) {
        const root = safeId(required(fields, bootstrapRootKey, filePath), bootstrapRootKey, filePath);
        if (bootstrapRootKey === 'bootstrap-root') {
            target.bootstrapRoot = root;
        }
        else {
            target.bootstrapFeature = root;
        }
        target.bootstrapFlow = safeId(required(fields, 'bootstrap-flow', filePath), 'bootstrap-flow', filePath);
        target.bootstrapDoneState = safeId(required(fields, 'bootstrap-done-state', filePath), 'bootstrap-done-state', filePath);
    }
    const launchFields = ['bootstrap-package', 'bootstrap-activity', 'bootstrap-display']
        .map((key) => ({ key, value: fields[key] }))
        .filter((field) => Boolean(field.value));
    if (launchFields.length > 0 && launchFields.length !== 3) {
        throw new Error(`bootstrap launch requires bootstrap-package, bootstrap-activity and bootstrap-display: ${filePath}`);
    }
    if (launchFields.length === 3) {
        if (bootstrapFields.length !== 3) {
            throw new Error(`bootstrap launch requires a bootstrap flow: ${filePath}`);
        }
        target.bootstrapPackage = safePackage(required(fields, 'bootstrap-package', filePath), 'bootstrap-package', filePath);
        target.bootstrapActivity = safeActivity(required(fields, 'bootstrap-activity', filePath), 'bootstrap-activity', filePath);
        target.bootstrapDisplay = nonNegativeInteger(required(fields, 'bootstrap-display', filePath), 'bootstrap-display', filePath);
    }
    const resultState = fields['result-state'];
    if (resultState) {
        target.resultState = safeId(resultState, 'result-state', filePath);
    }
    const doneState = fields['done-state'];
    if (doneState) {
        target.doneState = safeId(doneState, 'done-state', filePath);
    }
    const period = fields['period-key'];
    if (type === 'version' && !period) {
        throw new Error(`version target requires period-key: ${filePath}`);
    }
    if (period) {
        target.periodKey = safeId(period, 'period-key', filePath);
    }
    if (completion === 'state' && !target.doneState) {
        throw new Error(`state completion requires done-state: ${filePath}`);
    }
    return target;
};

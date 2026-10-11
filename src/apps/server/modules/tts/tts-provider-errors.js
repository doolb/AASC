'use strict';

// 只把官方已知错误码映射成固定提示，禁止把上游原文、密钥或签名地址带进日志。
const QWEN_ERRORS = Object.freeze({
    Arrearage: '账户欠费，请检查百炼余额及 API Key 所属账户',
    InvalidApiKey: 'API Key 无效，请检查凭证及所属地域',
    invalid_api_key: 'API Key 无效，请检查凭证及所属地域',
    AccessDenied: '访问被拒绝，请检查服务开通状态和模型权限',
    access_denied: '访问被拒绝，请检查服务开通状态和模型权限',
    'AccessDenied.Unpurchased': '服务尚未开通，请检查百炼服务开通状态',
    'Model.AccessDenied': '模型访问被拒绝，请检查工作空间与模型授权',
    'App.AccessDenied': '应用访问被拒绝，请检查应用与工作空间授权',
    InvalidParameter: '请求参数无效，请检查模型、音色、文本和语种',
    InvalidInput: '输入无效，请检查合成文本和参数',
    InputRequired: '缺少必需输入，请检查合成文本和参数',
    'InternalError.Algo.InvalidParameter': '模型参数无效，请检查模型、音色和文本',
    'InvalidParameter.UnsupportedModel': '模型不受支持，请检查模型名称与接口地域',
    ModelNotFound: '模型不存在，请检查模型名称与接口地域',
    'Model.NotFound': '模型不存在，请检查模型名称与接口地域',
    DataInspectionFailed: '文本未通过内容检查，请调整合成文本',
    data_inspection_failed: '文本未通过内容检查，请调整合成文本',
    Throttling: '请求被限流，请降低调用频率或并发数',
    'Throttling.RateQuota': '请求频率超限，请降低调用频率',
    'Throttling.BurstRate': '请求频率增长过快，请降低调用频率',
    'Throttling.AllocationQuota': '配额或吞吐超限，请检查配额并降低并发',
    'Throttling.ResourceExhausted': '资源配额已耗尽，请检查配额与资源限制',
    'Throttling.ServiceOverloaded': '上游服务过载，请稍后重试',
    'AllocationQuota.FreeTierOnly': '免费额度已耗尽或过期，请检查额度与付费权限',
    InternalError: '上游内部错误，请稍后重试',
    'InternalError.Algo': '上游模型处理错误，请稍后重试',
    ServiceUnavailable: '上游服务暂不可用，请稍后重试'
});

const DOUBAO_ERRORS = Object.freeze({
    45000000: '请求格式、大小或并发限制异常，请检查请求参数和并发数',
    45000001: '请求参数无效，请检查模型、音色和语种',
    45002000: '音色参数无效或为空，请检查音色 ID',
    45002001: '文本中没有可朗读内容，请检查合成文本',
    55000000: '上游内部错误，请稍后重试'
});

// 豆包有多个原因共用一个业务码；原文仅用于匹配官方固定标记，输出仍为固定中文。
const DOUBAO_REASON_MARKERS = Object.freeze({
    45000000: [
        ['quota exceeded for types: concurrency', '并发数超限，请降低并发或检查并发额度'],
        ['single request size too large', '单次请求过大，请缩短合成文本'],
        ['payload unmarshal', '请求格式无效，请检查 JSON 参数']
    ],
    45000001: [
        ['speaker not found', '音色不存在，请检查音色 ID 和权限'],
        ['invalidmodel', '模型参数无效，请检查模型是否适用于该音色'],
        ['invaliddialect', '方言参数无效，请检查音色支持的方言'],
        ['emptyrequest', '缺少合成请求参数，请检查 req_params']
    ],
    55000000: [
        ['resource id is mismatched with speaker related resource', '音色与资源 ID 不匹配，请检查资源、音色权限及服务开通状态'],
        ['connect downstream service timeout', '上游连接语音服务超时，请稍后重试'],
        ['synthesis processing timeout', '上游合成处理超时，请缩短文本或稍后重试'],
        ['client send timeout', '上游等待请求超时，请检查连接状态']
    ]
});

const HTTP_ERRORS = Object.freeze({
    400: '请求无效，请检查模型、音色和参数',
    401: '凭证失效，请检查 API Key',
    403: '权限不足，请检查服务开通状态、账户和音色权限',
    404: '接口或资源不存在，请检查端点和模型',
    408: '上游请求超时，请稍后重试',
    413: '请求过大，请缩短合成文本',
    415: '请求格式不受支持，请检查接口参数',
    422: '请求参数无法处理，请检查模型、音色和文本',
    429: '请求被限流，请降低调用频率或并发数',
    500: '上游内部错误，请稍后重试',
    502: '上游网关异常，请稍后重试',
    503: '上游服务暂不可用，请稍后重试',
    504: '上游网关超时，请稍后重试'
});

function createProviderError(provider, result, httpStatus = null) {
    const doubao = provider === 'doubao-api';
    const catalog = doubao ? DOUBAO_ERRORS : QWEN_ERRORS;
    const inputCode = result?.code;
    const candidate = doubao ? (Number.isInteger(inputCode) ? String(inputCode) : null)
        : (typeof inputCode === 'string' ? inputCode : null);
    const upstreamCode = candidate !== null && Object.hasOwn(catalog, candidate) ? candidate : null;
    const status = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
    const rawMessage = typeof result?.message === 'string' ? result.message.slice(0, 4096).toLowerCase() : '';
    const marker = doubao && upstreamCode ? DOUBAO_REASON_MARKERS[upstreamCode]?.find(
        ([text]) => rawMessage.includes(text)) : null;
    const reason = marker?.[1] || (upstreamCode && catalog[upstreamCode]) || HTTP_ERRORS[status]
        || '合成失败，请检查模型、音色、凭证与服务状态';
    const error = new Error(`${doubao ? '豆包 API' : 'Qwen API'}${status ? ` HTTP ${status}` : ''}${upstreamCode ? ` [${upstreamCode}]` : ''}：${reason}`);
    error.code = [401, 403].includes(status) ? 'TTS_PROVIDER_AUTH' : (status ? 'TTS_PROVIDER_HTTP' : 'TTS_PROVIDER_UPSTREAM');
    if (status) error.httpStatus = status;
    if (upstreamCode) error.upstreamCode = upstreamCode;
    return error;
}

module.exports = { createProviderError };

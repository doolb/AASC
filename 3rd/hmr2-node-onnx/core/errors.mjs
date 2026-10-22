// 只公开稳定业务错误，不把原生ORT/文件系统的路径、图片或令牌泄露到HTTP。
export class ServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
  }
}

export function requireService(condition, status, code, message) {
  if (!condition) throw new ServiceError(status, code, message);
}

export function publicError(error) {
  return error instanceof ServiceError ? error : new ServiceError(500, 'internal_error', '内部错误；底层路径和输入已隐藏');
}

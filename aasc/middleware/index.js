class MiddlewareManager {
    constructor() {
        this.middlewares = [];
    }

    use(middleware) {
        if (typeof middleware === 'function') {
            this.middlewares.push(middleware);
        } else if (middleware && typeof middleware.handle === 'function') {
            this.middlewares.push((message, context, next) => middleware.handle(message, context, next));
        }
        return this;
    }

    async execute(message, context, finalHandler) {
        let index = 0;

        const next = async () => {
            if (index < this.middlewares.length) {
                const middleware = this.middlewares[index++];
                return middleware(message, context, next);
            } else if (finalHandler) {
                return finalHandler(message, context);
            }
            return { success: true, message: 'No handler' };
        };

        return next();
    }

    clear() {
        this.middlewares = [];
        return this;
    }

    get count() {
        return this.middlewares.length;
    }
}

const ValidationMiddleware = {
    handle(message, context, next) {
        if (!message) {
            return { success: false, error: '消息不能为空' };
        }

        if (!message.type) {
            return { success: false, error: '消息类型不能为空' };
        }

        return next();
    }
};

const LoggingMiddleware = {
    handle(message, context, next) {
        if (message.silent) {
            return next();
        }

        const startTime = Date.now();
        const type = message.type;
        const displayId = message.displayId || 'unknown';

        console.log(`[Middleware] 收到消息: type=${type}, displayId=${displayId}`);

        return next().then(result => {
            const duration = Date.now() - startTime;
            console.log(`[Middleware] 消息处理完成: type=${type}, duration=${duration}ms`);
            return result;
        }).catch(error => {
            const duration = Date.now() - startTime;
            console.error(`[Middleware] 消息处理失败: type=${type}, duration=${duration}ms, error=${error.message}`);
            throw error;
        });
    }
};

const ErrorHandlingMiddleware = {
    handle(message, context, next) {
        return next().catch(error => {
            console.error('[Middleware] 错误处理:', error.message);
            
            if (context.ws && context.ws.readyState === 1) {
                context.ws.send(JSON.stringify({
                    type: 'error',
                    error: error.message,
                    originalType: message.type
                }));
            }

            return { 
                success: false, 
                error: error.message,
                originalType: message.type
            };
        });
    }
};

const AuthenticationMiddleware = {
    handle(message, context, next) {
        return next();
    }
};

const RateLimitMiddleware = (options = {}) => {
    const maxRequests = options.maxRequests || 100;
    const windowMs = options.windowMs || 60000;
    const requests = new Map();
    const exemptTypes = options.exemptTypes || ['voiceStatus', 'voiceInput', 'heartbeat'];

    return {
        handle(message, context, next) {
            if (exemptTypes.includes(message.type)) {
                return next();
            }

            const clientId = context.displayId || context.source?.name || 'unknown';
            const now = Date.now();
            
            if (!requests.has(clientId)) {
                requests.set(clientId, []);
            }

            const clientRequests = requests.get(clientId);
            const validRequests = clientRequests.filter(time => now - time < windowMs);
            
            if (validRequests.length >= maxRequests) {
                console.warn(`[Middleware] 请求频率超限: clientId=${clientId}`);
                return { 
                    success: false, 
                    error: '请求频率超限，请稍后再试' 
                };
            }

            validRequests.push(now);
            requests.set(clientId, validRequests);

            return next();
        }
    };
};

const TimeoutMiddleware = (timeoutMs = 30000) => {
    return {
        handle(message, context, next) {
            return Promise.race([
                next(),
                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`处理超时: ${timeoutMs}ms`));
                    }, timeoutMs);
                })
            ]);
        }
    };
};

const DisplayCheckMiddleware = {
    handle(message, context, next) {
        const typesRequiringDisplay = ['media', 'control', 'tts', 'chat', 'chatMessage'];
        
        if (typesRequiringDisplay.includes(message.type)) {
            const displayId = message.displayId;
            
            if (!displayId) {
                return next();
            }

            const displayClient = context.stateManager?.getDisplayClient(displayId);
            if (!displayClient) {
                return { 
                    success: false, 
                    error: `显示端不存在: ${displayId}` 
                };
            }
        }

        return next();
    }
};

const createMiddlewareChain = (options = {}) => {
    const manager = new MiddlewareManager();

    if (options.validation !== false) {
        manager.use(ValidationMiddleware);
    }

    if (options.logging !== false) {
        manager.use(LoggingMiddleware);
    }

    if (options.errorHandling !== false) {
        manager.use(ErrorHandlingMiddleware);
    }

    if (options.rateLimit) {
        manager.use(RateLimitMiddleware(options.rateLimit));
    }

    if (options.timeout) {
        manager.use(TimeoutMiddleware(options.timeout));
    }

    if (options.displayCheck !== false) {
        manager.use(DisplayCheckMiddleware);
    }

    return manager;
};

module.exports = {
    MiddlewareManager,
    ValidationMiddleware,
    LoggingMiddleware,
    ErrorHandlingMiddleware,
    AuthenticationMiddleware,
    RateLimitMiddleware,
    TimeoutMiddleware,
    DisplayCheckMiddleware,
    createMiddlewareChain
};

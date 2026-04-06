const { Message, MessageType, MessageTopic } = require('../message');

class MessageParser {
    constructor(options = {}) {
        this.validators = new Map();
        this.transformers = new Map();
        this.defaultOptions = {
            maxMessageSize: options.maxMessageSize || 1024 * 1024,
            strictMode: options.strictMode !== false,
            ...options
        };
        
        this._initDefaultValidators();
        this._initDefaultTransformers();
    }

    _initDefaultValidators() {
        this.registerValidator('type', (value) => {
            if (!value || typeof value !== 'string') {
                return { valid: false, error: '消息类型必须是非空字符串' };
            }
            return { valid: true };
        });

        this.registerValidator('displayId', (value) => {
            if (value && typeof value !== 'string') {
                return { valid: false, error: 'displayId 必须是字符串' };
            }
            return { valid: true };
        });
    }

    _initDefaultTransformers() {
        this.registerTransformer('timestamp', (value) => {
            return value || Date.now();
        });

        this.registerTransformer('messageId', (value, data) => {
            return value || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        });
    }

    registerValidator(field, validator) {
        this.validators.set(field, validator);
        return this;
    }

    registerTransformer(field, transformer) {
        this.transformers.set(field, transformer);
        return this;
    }

    parse(rawMessage, options = {}) {
        const opts = { ...this.defaultOptions, ...options };
        
        if (!rawMessage) {
            return this._createError('消息不能为空');
        }

        if (Buffer.isBuffer(rawMessage)) {
            rawMessage = rawMessage.toString('utf8');
        }

        if (typeof rawMessage === 'string') {
            if (rawMessage.length > opts.maxMessageSize) {
                return this._createError(`消息大小超过限制: ${opts.maxMessageSize}`);
            }

            try {
                rawMessage = JSON.parse(rawMessage);
            } catch (e) {
                return this._createError('JSON 解析失败: ' + e.message);
            }
        }

        if (typeof rawMessage !== 'object') {
            return this._createError('消息必须是对象');
        }

        const validationResult = this.validate(rawMessage, opts);
        if (!validationResult.valid) {
            return this._createError(validationResult.error);
        }

        const transformedData = this.transform(rawMessage, opts);
        
        return {
            success: true,
            data: transformedData,
            raw: rawMessage
        };
    }

    validate(data, options = {}) {
        const errors = [];

        for (const [field, validator] of this.validators) {
            const result = validator(data[field], data);
            if (!result.valid) {
                errors.push({ field, error: result.error });
            }
        }

        if (errors.length > 0) {
            return { valid: false, errors, error: errors.map(e => e.error).join('; ') };
        }

        return { valid: true };
    }

    transform(data, options = {}) {
        const result = { ...data };

        for (const [field, transformer] of this.transformers) {
            result[field] = transformer(result[field], result);
        }

        return result;
    }

    parseToMessage(rawMessage, source, options = {}) {
        const parsed = this.parse(rawMessage, options);
        
        if (!parsed.success) {
            return parsed;
        }

        try {
            const message = new Message({
                type: this._mapMessageType(parsed.data.type),
                topic: this._mapMessageTopic(parsed.data.type),
                source: source,
                payload: parsed.data,
                timestamp: parsed.data.timestamp || Date.now()
            });

            return {
                success: true,
                message: message,
                data: parsed.data,
                raw: parsed.raw
            };
        } catch (e) {
            return this._createError('创建消息对象失败: ' + e.message);
        }
    }

    _mapMessageType(type) {
        const typeMap = {
            'command': MessageType.COMMAND,
            'event': MessageType.EVENT,
            'query': MessageType.QUERY,
            'response': MessageType.RESPONSE,
            'broadcast': MessageType.BROADCAST
        };

        const lowerType = (type || '').toLowerCase();
        
        if (typeMap[lowerType]) {
            return typeMap[lowerType];
        }

        if (['media', 'control', 'tts', 'chat', 'voiceCommand'].includes(type)) {
            return MessageType.COMMAND;
        }

        if (['canvasSize', 'browserInfo', 'voiceInput', 'voiceStatus', 'commandAck'].includes(type)) {
            return MessageType.EVENT;
        }

        if (['getState', 'getReminders', 'getSearchHistory', 'getAssistantConfig'].includes(type)) {
            return MessageType.QUERY;
        }

        return MessageType.COMMAND;
    }

    _mapMessageTopic(type) {
        const topicMap = {
            'media': MessageTopic.MEDIA_CONTROL,
            'mediaBatch': MessageTopic.MEDIA_CONTROL,
            'control': MessageTopic.DISPLAY_CONTROL,
            'tts': MessageTopic.VOICE,
            'chat': MessageTopic.CHAT,
            'chatMessage': MessageTopic.CHAT,
            'voiceCommand': MessageTopic.VOICE,
            'voiceInput': MessageTopic.VOICE,
            'voiceStatus': MessageTopic.VOICE,
            'reminder': MessageTopic.REMINDER,
            'getReminders': MessageTopic.REMINDER,
            'timeAnnounce': MessageTopic.SYSTEM
        };

        return topicMap[type] || MessageTopic.SYSTEM;
    }

    _createError(error) {
        return {
            success: false,
            error: error,
            data: null,
            raw: null
        };
    }

    static create(options = {}) {
        return new MessageParser(options);
    }
}

module.exports = { MessageParser };

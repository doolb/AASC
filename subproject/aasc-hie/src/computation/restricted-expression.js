const FORBIDDEN = new Set([
  'process', 'global', 'globalThis', 'require', 'module', 'exports', 'eval', 'Function',
  '__proto__', 'prototype', 'constructor', 'window', 'document', 'fetch', 'import',
  'Object', 'Array', 'Date', 'JSON', 'Math', 'Reflect', 'Proxy', 'Symbol', 'Set', 'Map',
  'Promise', 'Buffer', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
]);
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

const tokenize = (expression) => {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    const operator = rest.match(/^(===|!==|==|!=|>=|<=|&&|\|\||(?:[()+\-*/%!<>]|\.(?!\d)))/);
    if (operator) {
      tokens.push({ type: operator[0], value: operator[0] });
      index += operator[0].length;
      continue;
    }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      tokens.push({ type: 'literal', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    if (rest[0] === '"' || rest[0] === "'") {
      const quote = rest[0];
      let end = 1;
      let escaped = false;
      for (; end < rest.length; end += 1) {
        if (!escaped && rest[end] === quote) break;
        if (!escaped && rest[end] === '\\') escaped = true;
        else escaped = false;
      }
      if (end >= rest.length) throw new Error('invalid expression string');
      const raw = rest.slice(1, end);
      if (raw.includes('\\')) throw new Error('unsafe expression escape');
      tokens.push({ type: 'literal', value: raw });
      index += end + 1;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_$][A-Za-z0-9_$-]*/);
    if (identifier) {
      const value = identifier[0];
      const subtraction = value.search(/-(?=\d)/);
      if (subtraction > 0) {
        tokens.push({ type: 'identifier', value: value.slice(0, subtraction) });
        index += subtraction;
      }
      else {
        tokens.push({ type: 'identifier', value });
        index += value.length;
      }
      continue;
    }
    throw new Error(`unsupported expression character: ${rest[0]}`);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
};

const unsafe = (message) => { throw new Error(`unsafe expression: ${message}`); };

class Parser {
  constructor(expression, context) {
    this.tokens = tokenize(expression);
    this.context = context && typeof context === 'object' ? context : {};
    this.index = 0;
  }

  current() { return this.tokens[this.index]; }
  take(type) {
    if (this.current().type !== type) throw new Error(`invalid expression: expected ${type}`);
    return this.tokens[this.index++];
  }

  parse() {
    const value = this.parseOr();
    if (this.current().type !== 'eof') unsafe(`unexpected token ${this.current().value}`);
    return value;
  }

  parseOr() {
    let value = this.parseAnd();
    while (this.current().type === '||') {
      this.index += 1;
      const right = this.parseAnd();
      value = value || right;
    }
    return value;
  }

  parseAnd() {
    let value = this.parseEquality();
    while (this.current().type === '&&') {
      this.index += 1;
      const right = this.parseEquality();
      value = value && right;
    }
    return value;
  }

  parseEquality() {
    let value = this.parseComparison();
    while (['===', '!==', '==', '!='].includes(this.current().type)) {
      const operator = this.current().type;
      this.index += 1;
      const right = this.parseComparison();
      value = operator === '===' || operator === '==' ? value === right : value !== right;
    }
    return value;
  }

  parseComparison() {
    let value = this.parseAdditive();
    while (['>', '<', '>=', '<='].includes(this.current().type)) {
      const operator = this.current().type;
      this.index += 1;
      const right = this.parseAdditive();
      value = operator === '>' ? value > right : operator === '<' ? value < right : operator === '>=' ? value >= right : value <= right;
    }
    return value;
  }

  parseAdditive() {
    let value = this.parseMultiplicative();
    while (['+', '-'].includes(this.current().type)) {
      const operator = this.current().type;
      this.index += 1;
      const right = this.parseMultiplicative();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  parseMultiplicative() {
    let value = this.parseUnary();
    while (['*', '/', '%'].includes(this.current().type)) {
      const operator = this.current().type;
      this.index += 1;
      const right = this.parseUnary();
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
    }
    return value;
  }

  parseUnary() {
    if (this.current().type === '!') { this.index += 1; return !this.parseUnary(); }
    if (this.current().type === '-') { this.index += 1; return -this.parseUnary(); }
    return this.parsePrimary();
  }

  parsePrimary() {
    if (this.current().type === '(') {
      this.index += 1;
      const value = this.parseOr();
      this.take(')');
      if (this.current().type === '(') unsafe('function calls are not allowed');
      return value;
    }
    if (this.current().type === 'literal') return this.tokens[this.index++].value;
    if (this.current().type !== 'identifier') throw new Error('invalid expression: expected value');
    const first = this.tokens[this.index++].value;
    if (FORBIDDEN.has(first)) unsafe(`external access: ${first}`);
    if (first === 'true' || first === 'false') return first === 'true';
    if (first === 'null') return null;
    if (first === 'undefined') return undefined;
    const path = [first];
    while (this.current().type === '.') {
      this.index += 1;
      const property = this.take('identifier').value;
      if (!IDENTIFIER.test(property) || FORBIDDEN.has(property)) unsafe(`property escape: ${property}`);
      path.push(property);
    }
    if (this.current().type === '(') unsafe('function calls are not allowed');
    if (this.current().type === '[') unsafe('property escapes are not allowed');
    let value = this.context;
    for (const segment of path) {
      if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, segment)) {
        value = undefined;
        break;
      }
      value = value[segment];
    }
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
    return value;
  }
}

/** Evaluate the small, non-JavaScript expression grammar used by package data. */
export const evaluateExpression = (expression, context = {}) => {
  if (typeof expression !== 'string') return expression;
  if (!expression.trim()) throw new Error('invalid expression: expression is empty');
  return new Parser(expression, context).parse();
};

export { tokenize };

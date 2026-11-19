/**
 * A small, safe math expression parser/evaluator for the plotter extension.
 * No eval / new Function: expressions compile to an AST and are interpreted,
 * so the extension stays inside the app's strict CSP.
 *
 * Grammar (low → high precedence): sum, product (with implicit multiplication
 * such as 2x or a(x+1)), unary sign, right-associative power, atoms.
 *
 * @module extensions/lib/expression
 */

/**
 * @typedef {{ type: 'num', value: number }
 *   | { type: 'var', name: string }
 *   | { type: 'neg', operand: Ast }
 *   | { type: 'bin', op: '+' | '-' | '*' | '/' | '%' | '^', left: Ast, right: Ast }
 *   | { type: 'call', name: string, args: Ast[] }} Ast
 */

/** @type {Record<string, (...args: number[]) => number>} */
const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
  min: Math.min, max: Math.max, pow: Math.pow, atan2: Math.atan2,
};
/** @type {Record<string, number>} */
const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
/** @type {Record<string, number>} */
const ARITY = { min: 2, max: 2, pow: 2, atan2: 2 };

/**
 * @typedef {{ kind: 'num', value: number } | { kind: 'id', name: string } | { kind: 'op', op: string }} Token
 */

/**
 * @param {string} source
 * @returns {Token[]}
 */
function tokenize(source) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) { i += 1; continue; }
    if (/[0-9.]/.test(char)) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (!match) throw new Error(`Invalid number at position ${i}.`);
      tokens.push({ kind: 'num', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(source.slice(i));
      if (!match) throw new Error(`Invalid symbol at position ${i}.`);
      tokens.push({ kind: 'id', name: match[0] });
      i += match[0].length;
      continue;
    }
    if ('+-*/%^(),'.includes(char)) {
      tokens.push({ kind: 'op', op: char });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character “${char}” in expression.`);
  }
  return tokens;
}

/**
 * Parse an expression into an AST. Throws on malformed input.
 *
 * @param {string} source
 * @returns {Ast}
 */
export function parseExpression(source) {
  const tokens = tokenize(source);
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const isOp = (/** @type {string[]} */ ...ops) => {
    const token = peek();
    return token?.kind === 'op' && ops.includes(token.op);
  };
  const expect = (/** @type {string} */ op) => {
    if (!isOp(op)) throw new Error(`Expected “${op}” in expression.`);
    take();
  };

  /** @returns {Ast} */
  function parseSum() {
    let left = parseProduct();
    while (isOp('+', '-')) {
      const op = /** @type {'+' | '-'} */ (/** @type {{ op: string }} */ (take()).op);
      left = { type: 'bin', op, left, right: parseProduct() };
    }
    return left;
  }

  /** @returns {Ast} */
  function parseProduct() {
    let left = parseUnary();
    for (;;) {
      if (isOp('*', '/', '%')) {
        const op = /** @type {'*' | '/' | '%'} */ (/** @type {{ op: string }} */ (take()).op);
        left = { type: 'bin', op, left, right: parseUnary() };
      } else if (peek()?.kind === 'num' || peek()?.kind === 'id' || isOp('(')) {
        // Implicit multiplication: 2x, 2(x+1), a(x+1), (x+1)(x-1).
        left = { type: 'bin', op: '*', left, right: parseUnary() };
      } else break;
    }
    return left;
  }

  /** @returns {Ast} */
  function parseUnary() {
    if (isOp('-')) { take(); return { type: 'neg', operand: parseUnary() }; }
    if (isOp('+')) { take(); return parseUnary(); }
    return parsePower();
  }

  /** @returns {Ast} */
  function parsePower() {
    const base = parseAtom();
    if (isOp('^')) {
      take();
      return { type: 'bin', op: '^', left: base, right: parseUnary() };
    }
    return base;
  }

  /** @returns {Ast} */
  function parseAtom() {
    depth += 1;
    if (depth > 100) throw new Error('Expression is too deeply nested.');
    try {
      const token = take();
      if (!token) throw new Error('Unexpected end of expression.');
      const shown = token.kind === 'op' ? token.op : token.kind === 'id' ? token.name : String(token.value);
      if (token.kind === 'num') return { type: 'num', value: token.value };
      if (token.kind === 'id') {
        if (isOp('(') && Object.hasOwn(FUNCTIONS, token.name)) {
          take();
          /** @type {Ast[]} */
          const args = [];
          if (!isOp(')')) {
            args.push(parseSum());
            while (isOp(',')) { take(); args.push(parseSum()); }
          }
          expect(')');
          const arity = ARITY[token.name] ?? 1;
          if (args.length !== arity) throw new Error(`${token.name} expects ${arity} argument${arity > 1 ? 's' : ''}.`);
          return { type: 'call', name: token.name, args };
        }
        return { type: 'var', name: token.name };
      }
      if (token.kind === 'op' && token.op === '(') {
        const inner = parseSum();
        expect(')');
        return inner;
      }
      throw new Error(`Unexpected token “${shown}”.`);
    } finally {
      depth -= 1;
    }
  }

  const ast = parseSum();
  if (pos < tokens.length) throw new Error('Unexpected trailing input in expression.');
  return ast;
}

/**
 * Collect the free symbols (variables/constants) an expression references.
 *
 * @param {Ast} ast
 * @param {Set<string>} [into]
 * @returns {Set<string>}
 */
export function freeSymbols(ast, into = new Set()) {
  if (ast.type === 'var') into.add(ast.name);
  else if (ast.type === 'neg') freeSymbols(ast.operand, into);
  else if (ast.type === 'bin') { freeSymbols(ast.left, into); freeSymbols(ast.right, into); }
  else if (ast.type === 'call') for (const arg of ast.args) freeSymbols(arg, into);
  return into;
}

/**
 * Compile an expression against the allowed variable names. Unknown symbols
 * and malformed syntax throw, so authors get a clear error card.
 *
 * @param {string} source
 * @param {string[]} variables  e.g. ['x', 'a', 'b']
 * @returns {(scope: Record<string, number>) => number}
 */
export function compileExpression(source, variables) {
  const ast = parseExpression(source);
  const allowed = new Set([...variables, ...Object.keys(CONSTANTS)]);
  for (const symbol of freeSymbols(ast)) {
    if (!allowed.has(symbol)) throw new Error(`Unknown symbol “${symbol}” in “${source}”.`);
  }
  return scope => evaluate(ast, scope);
}

/**
 * @param {Ast} ast
 * @param {Record<string, number>} scope
 * @returns {number}
 */
function evaluate(ast, scope) {
  switch (ast.type) {
    case 'num': return ast.value;
    case 'var': {
      if (Object.hasOwn(CONSTANTS, ast.name)) return CONSTANTS[ast.name];
      const value = scope[ast.name];
      if (typeof value !== 'number') throw new Error(`No value for “${ast.name}”.`);
      return value;
    }
    case 'neg': return -evaluate(ast.operand, scope);
    case 'bin': {
      const left = evaluate(ast.left, scope);
      const right = evaluate(ast.right, scope);
      switch (ast.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return left / right;
        case '%': return left % right;
        case '^': return Math.pow(left, right);
      }
      return NaN;
    }
    case 'call': {
      const fn = FUNCTIONS[ast.name];
      const args = ast.args.map(arg => evaluate(arg, scope));
      return fn(...args);
    }
  }
}

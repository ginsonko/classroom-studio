type Expr = (x: number) => number;
const FUNCTIONS: Record<string, (x: number) => number> = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, log: Math.log, ln: Math.log, floor: Math.floor, ceil: Math.ceil };
const PRECEDENCE: Record<string, number> = { '+': 10, '-': 10, '*': 20, '/': 20, '^': 40, '**': 40 };

const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** 板书上常见的书写：x²、2−x、3×x、2·x、π、√x、全角括号 → 算式语法 */
export function normalizeExpression(s: string): string {
  return s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => '^' + [...m].map((c) => SUPS.indexOf(c)).join(''))
    .replace(/[−–—]/g, '-').replace(/[×·⋅∙]/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi').replace(/（/g, '(').replace(/）/g, ')')
    .replace(/√\s*\(/g, 'sqrt(').replace(/√\s*([A-Za-z0-9.]+)/g, 'sqrt($1)').replace(/^\s*[yf]\s*(\(\s*[xt]\s*\))?\s*=\s*/i, '');
}

/** Small arithmetic grammar; never executes JavaScript or resolves object properties. */
export function compileExpression(source: string): Expr {
  source = normalizeExpression(source);
  try {
    if (!source.trim() || source.length > 1024) throw new Error('Expression too long');
    const tokens: string[] = [], re = /\s*(?:(\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([A-Za-z]+)|(\*\*|[+\-*/^()]))/igy;
    let offset = 0;
    while (offset < source.length) {
      if (!source.slice(offset).trim()) break;
      re.lastIndex = offset; const m = re.exec(source); if (!m) throw new Error('Unknown token');
      tokens.push(m[1] ?? m[2] ?? m[3]); offset = re.lastIndex;
      if (tokens.length > 256) throw new Error('Too many tokens');
    }
    let at = 0;
    const parse = (min = 0, depth = 0): Expr => {
      if (depth > 32) throw new Error('Expression nesting limit');
      const token = tokens[at++]; let lhs: Expr;
      if (token === '+' || token === '-') { const rhs = parse(30, depth + 1); lhs = token === '-' ? (x) => -rhs(x) : rhs; }
      else if (token === '(') { lhs = parse(0, depth + 1); if (tokens[at++] !== ')') throw new Error('Missing closing parenthesis'); }
      else if (token && /^\d|^\./.test(token)) { const value = Number(token); if (!Number.isFinite(value)) throw new Error('Nonfinite literal'); lhs = () => value; }
      else if (token === 'x' || token === 't') lhs = (x) => x;
      else if (token === 'pi' || token === 'PI') lhs = () => Math.PI;
      else if (token === 'e') lhs = () => Math.E;
      else if (Object.hasOwn(FUNCTIONS, token)) { if (tokens[at++] !== '(') throw new Error('Function requires parentheses'); const arg = parse(0, depth + 1); if (tokens[at++] !== ')') throw new Error('Missing closing parenthesis'); const fn = FUNCTIONS[token]; lhs = (x) => fn(arg(x)); }
      else throw new Error('Unknown identifier');
      while (at < tokens.length && tokens[at] !== ')') {
        const next = tokens[at], implicit = next === '(' || /^[A-Za-z\d.]/.test(next), op = implicit ? '*' : next, precedence = PRECEDENCE[op];
        if (precedence === undefined || precedence < min) break;
        if (!implicit) at++;
        const rhs = parse(precedence + (op === '^' || op === '**' ? 0 : 1), depth + 1), previous = lhs;
        if (op === '+') lhs = (x) => previous(x) + rhs(x);
        if (op === '-') lhs = (x) => previous(x) - rhs(x);
        if (op === '*') lhs = (x) => previous(x) * rhs(x);
        if (op === '/') lhs = (x) => previous(x) / rhs(x);
        if (op === '^' || op === '**') lhs = (x) => previous(x) ** rhs(x);
      }
      return lhs;
    };
    const result = parse(); if (at !== tokens.length) throw new Error('Unexpected token'); return result;
  } catch { return () => NaN; }
}

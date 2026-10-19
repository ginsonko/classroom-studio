// 立体演示的表达式：模型写的字符串公式（"0.5*a*t^2"、"sind(37)*v0"、"t<1 ? 2*t : 2"）。
// 自己做词法 / 语法分析，编译成闭包；不用 eval / new Function，模型输出一律当作不可信输入。

export interface Scope {
  v: Record<string, number>;
  /** 对象成员：A.x、A.v、E.lat … */
  m?: (obj: string, prop: string) => number;
}
export type Fn = (s: Scope) => number;

export class ExprError extends Error {}

const FUNCS: Record<string, [number, number, (...a: number[]) => number]> = {
  sin: [1, 1, Math.sin], cos: [1, 1, Math.cos], tan: [1, 1, Math.tan],
  asin: [1, 1, (x) => Math.asin(Math.max(-1, Math.min(1, x)))], acos: [1, 1, (x) => Math.acos(Math.max(-1, Math.min(1, x)))], atan: [1, 1, Math.atan],
  atan2: [2, 2, Math.atan2],
  sind: [1, 1, (d) => Math.sin((d * Math.PI) / 180)], cosd: [1, 1, (d) => Math.cos((d * Math.PI) / 180)], tand: [1, 1, (d) => Math.tan((d * Math.PI) / 180)],
  asind: [1, 1, (x) => (Math.asin(Math.max(-1, Math.min(1, x))) * 180) / Math.PI], acosd: [1, 1, (x) => (Math.acos(Math.max(-1, Math.min(1, x))) * 180) / Math.PI], atand: [1, 1, (x) => (Math.atan(x) * 180) / Math.PI],
  sqrt: [1, 1, (x) => Math.sqrt(Math.max(0, x))], abs: [1, 1, Math.abs], sign: [1, 1, Math.sign],
  exp: [1, 1, Math.exp], ln: [1, 1, Math.log], log: [1, 1, Math.log10], log10: [1, 1, Math.log10], log2: [1, 1, Math.log2],
  floor: [1, 1, Math.floor], ceil: [1, 1, Math.ceil], round: [1, 1, Math.round], frac: [1, 1, (x) => x - Math.floor(x)],
  min: [1, 8, Math.min], max: [1, 8, Math.max], hypot: [1, 4, Math.hypot], pow: [2, 2, Math.pow],
  mod: [2, 2, (a, b) => (b ? ((a % b) + b) % b : 0)],
  clamp: [3, 3, (x, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), x))],
  lerp: [3, 3, (a, b, k) => a + (b - a) * k],
  smooth: [3, 3, (a, b, x) => { const k = Math.max(0, Math.min(1, b === a ? 1 : (x - a) / (b - a))); return k * k * (3 - 2 * k); }],
  step: [1, 2, (x, e = 0) => (x >= e ? 1 : 0)],
  rad: [1, 1, (d) => (d * Math.PI) / 180], deg: [1, 1, (r) => (r * 180) / Math.PI],
};
export const FUNC_NAMES = Object.keys(FUNCS).concat('if');
export const CONSTS: Record<string, number> = { pi: Math.PI, PI: Math.PI, e: Math.E, inf: 1e9 };
export const RESERVED = new Set([...FUNC_NAMES, ...Object.keys(CONSTS), 't']);

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

/** 常见的「数学书写」先换成 ASCII：π ² × ÷ − ≤ ≥ … */
export function normalizeText(src: string): string {
  return src
    .replace(/π/g, ' pi ').replace(/²/g, '^2').replace(/³/g, '^3').replace(/[×·∙]/g, '*').replace(/÷/g, '/')
    .replace(/[−–—]/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=').replace(/（/g, '(').replace(/）/g, ')').replace(/，/g, ',')
    .replace(/\*\*/g, '^').replace(/Math\./g, '').replace(/°/g, '')
    .replace(/√\s*\(/g, 'sqrt(').replace(/√\s*(\d+\.?\d*|[\p{L}_][\p{L}\p{N}_]*)/gu, 'sqrt($1)');
}

function lex(src: string): Tok[] {
  const s = normalizeText(src), out: Tok[] = [];
  let i = 0;
  const ID = /[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)?/uy, NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    NUM.lastIndex = i;
    let m = NUM.exec(s);
    if (m) { out.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    ID.lastIndex = i;
    m = ID.exec(s);
    if (m) { out.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/^%(),<>!?:'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    if (c === '=') { out.push({ k: 'op', v: '==' }); i++; continue; }
    throw new ExprError(`不认识的符号「${c}」`);
  }
  // 隐式乘法：2t、2pi、2(…)、)(…)、)x
  const res: Tok[] = [];
  for (let j = 0; j < out.length; j++) {
    const a = res[res.length - 1], b = out[j];
    if (a && ((a.k === 'num' && (b.k === 'id' || (b.k === 'op' && b.v === '('))) || (a.k === 'op' && a.v === ')' && (b.k === 'id' || b.k === 'num' || (b.k === 'op' && b.v === '('))))) res.push({ k: 'op', v: '*' });
    res.push(b);
  }
  return res;
}

type Node =
  | { t: 'n'; v: number }
  | { t: 'id'; v: string }
  | { t: 'mem'; o: string; p: string }
  | { t: 'u'; op: string; a: Node }
  | { t: 'b'; op: string; a: Node; b: Node }
  | { t: 'c'; f: string; args: Node[] }
  | { t: 'q'; c: Node; a: Node; b: Node };

function parse(toks: Tok[]): Node {
  let i = 0, depth = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => { const t = toks[i]; return !!t && t.k === 'op' && t.v === v; };
  const eat = (v: string) => { if (!isOp(v)) throw new ExprError(`这里缺少「${v}」`); i++; };
  const guard = () => { if (++depth > 60) throw new ExprError('表达式嵌套太深'); };
  const ternary = (): Node => {
    guard();
    const c = or();
    if (isOp('?')) { i++; const a = ternary(); eat(':'); const b = ternary(); depth--; return { t: 'q', c, a, b }; }
    depth--; return c;
  };
  const bin = (ops: string[], next: () => Node) => (): Node => {
    let a = next();
    while (peek()?.k === 'op' && ops.includes((peek() as { v: string }).v)) { const op = (toks[i++] as { v: string }).v; a = { t: 'b', op, a, b: next() }; }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) { i++; return { t: 'u', op: '-', a: unary() }; }
    if (isOp('+')) { i++; return unary(); }
    if (isOp('!')) { i++; return { t: 'u', op: '!', a: unary() }; }
    return power();
  };
  const power = (): Node => {
    const a = atom();
    if (isOp('^')) { i++; return { t: 'b', op: '^', a, b: unary() }; }
    return a;
  };
  const mul = bin(['*', '/', '%'], unary);
  const add = bin(['+', '-'], mul);
  const cmp = bin(['<', '>', '<=', '>=', '==', '!='], add);
  const and = bin(['&&'], cmp);
  const or = bin(['||'], and);
  const atom = (): Node => {
    const t = toks[i++];
    if (!t) throw new ExprError('表达式不完整');
    if (t.k === 'num') return { t: 'n', v: t.v };
    if (t.k === 'id') {
      if (isOp('(')) {
        i++; guard();
        const args: Node[] = [];
        if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { i++; args.push(ternary()); } }
        eat(')'); depth--;
        return { t: 'c', f: t.v, args };
      }
      const dot = t.v.indexOf('.');
      return dot > 0 ? { t: 'mem', o: t.v.slice(0, dot), p: t.v.slice(dot + 1) } : { t: 'id', v: t.v };
    }
    if (t.v === '(') { guard(); const e = ternary(); eat(')'); depth--; return e; }
    throw new ExprError(`这里不该出现「${t.v}」`);
  };
  const e = ternary();
  if (i < toks.length) throw new ExprError(`多余的「${(toks[i] as { v: unknown }).v}」`);
  return e;
}

export interface CompileOpts {
  /** 允许的变量名（参数、中间量、t、u、x、y…） */
  names: Set<string> | ((name: string) => boolean);
  /** 允许的对象 id（A.x 这种成员访问） */
  objects?: Set<string>;
}

const FIELDS = new Set(['x', 'y', 'z', 'vx', 'vy', 'vz', 'v', 'speed', 's', 'angle', 'rot', 'lat', 'day', 'month', 'ax', 'ay', 'a']);

function compileNode(n: Node, o: CompileOpts, used: Set<string>): Fn {
  switch (n.t) {
    case 'n': { const v = n.v; return () => v; }
    case 'id': {
      const name = n.v;
      const ok = typeof o.names === 'function' ? o.names(name) : o.names.has(name);
      if (!ok && Object.hasOwn(CONSTS, name)) { const v = CONSTS[name]; return () => v; }
      if (!ok) throw new ExprError(`不认识的变量「${name}」`);
      used.add(name);
      return (s) => { const v = s.v[name]; return v === undefined ? 0 : v; };
    }
    case 'mem': {
      const { o: obj, p } = n;
      if (!o.objects?.has(obj)) throw new ExprError(`「${obj}.${p}」里的对象「${obj}」不存在`);
      if (!FIELDS.has(p)) throw new ExprError(`「${obj}.${p}」：对象只能取 x y z vx vy vz v s angle（地球还有 lat day）`);
      used.add('@' + obj);
      return (s) => (s.m ? s.m(obj, p) : 0);
    }
    case 'u': {
      const a = compileNode(n.a, o, used);
      return n.op === '-' ? (s) => -a(s) : (s) => (a(s) ? 0 : 1);
    }
    case 'q': {
      const c = compileNode(n.c, o, used), a = compileNode(n.a, o, used), b = compileNode(n.b, o, used);
      return (s) => (c(s) ? a(s) : b(s));
    }
    case 'b': {
      const a = compileNode(n.a, o, used), b = compileNode(n.b, o, used);
      switch (n.op) {
        case '+': return (s) => a(s) + b(s);
        case '-': return (s) => a(s) - b(s);
        case '*': return (s) => a(s) * b(s);
        case '/': return (s) => { const d = b(s); return d === 0 ? 0 : a(s) / d; };
        case '%': return (s) => { const d = b(s); return d === 0 ? 0 : a(s) % d; };
        case '^': return (s) => Math.pow(a(s), b(s));
        case '<': return (s) => +(a(s) < b(s));
        case '>': return (s) => +(a(s) > b(s));
        case '<=': return (s) => +(a(s) <= b(s));
        case '>=': return (s) => +(a(s) >= b(s));
        case '==': return (s) => +(Math.abs(a(s) - b(s)) < 1e-9);
        case '!=': return (s) => +(Math.abs(a(s) - b(s)) >= 1e-9);
        case '&&': return (s) => +(!!a(s) && !!b(s));
        case '||': return (s) => +(!!a(s) || !!b(s));
      }
      throw new ExprError('未知运算 ' + n.op);
    }
    case 'c': {
      const name = n.f.toLowerCase() === 'if' ? 'if' : Object.hasOwn(FUNCS, n.f) ? n.f : n.f.toLowerCase();
      const args = n.args.map((x) => compileNode(x, o, used));
      if (name === 'if') {
        if (args.length !== 3) throw new ExprError('if(条件, 成立时, 不成立时) 需要 3 个参数');
        const [c, a, b] = args;
        return (s) => (c(s) ? a(s) : b(s));
      }
      const f = Object.hasOwn(FUNCS, name) ? FUNCS[name] : undefined;
      if (!f) throw new ExprError(`不认识的函数「${n.f}」`);
      if (args.length < f[0] || args.length > f[1]) throw new ExprError(`函数 ${name} 的参数个数不对`);
      const fn = f[2];
      if (args.length === 1) { const a = args[0]; return (s) => fn(a(s)); }
      if (args.length === 2) { const [a, b] = args; return (s) => fn(a(s), b(s)); }
      return (s) => fn(...args.map((g) => g(s)));
    }
  }
}

export interface Compiled { fn: Fn; used: Set<string> }

/** 编译一个表达式。数字直接返回常量函数。出错时抛 ExprError（中文说明）。 */
export function compile(src: string | number, o: CompileOpts): Compiled {
  if (typeof src === 'number') { const v = Number.isFinite(src) ? src : 0; return { fn: () => v, used: new Set() }; }
  const text = String(src).trim();
  if (!text) throw new ExprError('表达式是空的');
  if (text.length > 400) throw new ExprError('表达式太长（最多 400 个字符）');
  const used = new Set<string>();
  const raw = compileNode(parse(lex(text)), o, used);
  // 结果一律有限：NaN / ∞ 当 0，免得把画面弄坏
  const fn: Fn = (s) => { const v = raw(s); return Number.isFinite(v) ? v : 0; };
  return { fn, used };
}

/** 只检查语法（不检查变量名），给校验器找出依赖关系用 */
export function identifiers(src: string): { ids: string[]; members: string[] } {
  const ids: string[] = [], members: string[] = [];
  const walk = (n: Node) => {
    if (n.t === 'id') ids.push(n.v);
    else if (n.t === 'mem') members.push(n.o);
    else if (n.t === 'u') walk(n.a);
    else if (n.t === 'b') { walk(n.a); walk(n.b); }
    else if (n.t === 'q') { walk(n.c); walk(n.a); walk(n.b); }
    else if (n.t === 'c') n.args.forEach(walk);
  };
  walk(parse(lex(src)));
  return { ids, members };
}

/** 方便测试：直接求值 */
export function evaluate(src: string | number, vars: Record<string, number> = {}): number {
  return compile(src, { names: (n) => n in vars }).fn({ v: vars });
}

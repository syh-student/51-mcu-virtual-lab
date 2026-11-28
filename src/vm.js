/* ==========================================================================
 * C51 教学级解释器（纯逻辑，无 DOM 依赖，可在浏览器或 Node 中运行）
 * 支持：变量/数组/函数、static 局部变量、if/while/for/do-while/switch、
 *       位运算、位变量、sbit、P0~P3 端口读写、Delay 虚拟时间、
 *       _crol_/_cror_ 循环移位、定时器 0/1（含中断 1/3）、串口发送（SBUF）。
 * 执行方式为 generator 协程，while(1) 不会卡死界面。
 *
 * 时间基准：vtime 是虚拟毫秒。12MHz 下 1 个机器周期 = 1us，
 * 所以定时器计数 = 初值 + (vtime - 启动时刻) * 1000。
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.C51 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIG = '__c51_signal__';

  function VmError(message, line) {
    this.name = 'VmError';
    this.message = message;
    this.line = line || 0;
  }
  VmError.prototype = Object.create(Error.prototype);
  VmError.prototype.toString = function () {
    return (this.line ? '第 ' + this.line + ' 行：' : '') + this.message;
  };

  /* ---------------- 预处理：条件编译 + 宏 ---------------- */
  /* 支持：#define（对象式与函数式）、#undef、#ifdef/#ifndef/#if/#elif/#else/#endif。
     include 由工程层先展开，这里遇到 #include 直接留空行。 */
  function parseDefine(rest, macros) {
    var nm = /^([A-Za-z_]\w*)/.exec(rest);
    if (!nm) return;
    var name = nm[1];
    var after = rest.slice(name.length);
    if (after.charAt(0) === '(') {
      var close = after.indexOf(')');
      if (close < 0) return;
      var raw = after.slice(1, close).trim();
      macros[name] = {
        params: raw ? raw.split(',').map(function (s) { return s.trim(); }) : [],
        body: after.slice(close + 1).trim()
      };
      return;
    }
    macros[name] = { params: null, body: after.trim() };
  }

  /* #if 的常量表达式解析：只接受整数、括号和运算符，不执行任何代码。
     这里刻意不使用动态代码执行，避免把用户源码里的表达式送进 JS 引擎。 */
  var IF_TOKEN_RE = /^(?:0x[0-9a-fA-F]+|\d+|<<|>>>|>>|<=|>=|==|!=|&&|\|\||[()!~+\-*/%<>&|^?:])/;

  function ifTokenize(text) {
    var s = String(text).replace(/\s+/g, '');
    var tokens = [];
    while (s) {
      var m = IF_TOKEN_RE.exec(s);
      if (!m) throw new Error('bad token');
      tokens.push(m[0]);
      s = s.slice(m[0].length);
    }
    return tokens;
  }

  function ifNumber(token) {
    return token.slice(0, 2).toLowerCase() === '0x' ? parseInt(token, 16) : parseInt(token, 10);
  }

  function ifPrimary(st) {
    var token = st.tokens[st.i++];
    if (token === '(') {
      var v = ifConditional(st);
      if (st.tokens[st.i++] !== ')') throw new Error('missing )');
      return v;
    }
    if (/^(?:0x[0-9a-fA-F]+|\d+)$/.test(token || '')) return ifNumber(token);
    throw new Error('bad number');
  }

  function ifUnary(st) {
    var t = st.tokens[st.i];
    if (t === '!') { st.i++; return !ifUnary(st); }
    if (t === '~') { st.i++; return ~ifUnary(st); }
    if (t === '+') { st.i++; return +ifUnary(st); }
    if (t === '-') { st.i++; return -ifUnary(st); }
    return ifPrimary(st);
  }

  function ifMul(st) {
    var v = ifUnary(st), t;
    while ((t = st.tokens[st.i]) === '*' || t === '/' || t === '%') {
      st.i++;
      var r = ifUnary(st);
      if (t === '*') v = v * r;
      else if (t === '/') v = v / r;
      else v = v % r;
    }
    return v;
  }

  function ifAdd(st) {
    var v = ifMul(st), t;
    while ((t = st.tokens[st.i]) === '+' || t === '-') {
      st.i++;
      var r = ifMul(st);
      v = t === '+' ? v + r : v - r;
    }
    return v;
  }

  function ifShift(st) {
    var v = ifAdd(st), t;
    while ((t = st.tokens[st.i]) === '<<' || t === '>>' || t === '>>>') {
      st.i++;
      var r = ifAdd(st);
      if (t === '<<') v = v << r;
      else if (t === '>>') v = v >> r;
      else v = v >>> r;
    }
    return v;
  }

  function ifRel(st) {
    var v = ifShift(st), t;
    while ((t = st.tokens[st.i]) === '<' || t === '<=' || t === '>' || t === '>=') {
      st.i++;
      var r = ifShift(st);
      if (t === '<') v = v < r;
      else if (t === '<=') v = v <= r;
      else if (t === '>') v = v > r;
      else v = v >= r;
    }
    return v;
  }

  function ifEq(st) {
    var v = ifRel(st), t;
    while ((t = st.tokens[st.i]) === '==' || t === '!=') {
      st.i++;
      var r = ifRel(st);
      v = t === '==' ? v === r : v !== r;
    }
    return v;
  }

  function ifBitAnd(st) {
    var v = ifEq(st);
    while (st.tokens[st.i] === '&') { st.i++; v = v & ifEq(st); }
    return v;
  }

  function ifBitXor(st) {
    var v = ifBitAnd(st);
    while (st.tokens[st.i] === '^') { st.i++; v = v ^ ifBitAnd(st); }
    return v;
  }

  function ifBitOr(st) {
    var v = ifBitXor(st);
    while (st.tokens[st.i] === '|') { st.i++; v = v | ifBitXor(st); }
    return v;
  }

  function ifAnd(st) {
    var v = ifBitOr(st);
    while (st.tokens[st.i] === '&&') { st.i++; v = !!v && !!ifBitOr(st); }
    return v;
  }

  function ifOr(st) {
    var v = ifAnd(st);
    while (st.tokens[st.i] === '||') { st.i++; v = !!v || !!ifAnd(st); }
    return v;
  }

  function ifConditional(st) {
    var c = ifOr(st);
    if (st.tokens[st.i] === '?') {
      st.i++;
      var yes = ifConditional(st);
      if (st.tokens[st.i] === ':') st.i++;
      var no = ifConditional(st);
      return c ? yes : no;
    }
    return c;
  }

  function evalIf(expr, macros) {
    var e = String(expr || '').trim();
    if (!e) return true;
    e = e.replace(/defined\s*\(\s*([A-Za-z_]\w*)\s*\)/g, function (_, n) {
      return macros[n] ? '1' : '0';
    });
    e = e.replace(/\bdefined\s+([A-Za-z_]\w*)/g, function (_, n) {
      return macros[n] ? '1' : '0';
    });
    /* 宏先展开成它的数值，#if VERSION >= 2 这种写法才能算出结果。
       只展开对象式宏；函数式宏在 #if 里没有意义，留给下面按 0 处理。 */
    for (var round = 0; round < 4; round++) {
      var before = e;
      e = e.replace(/\b([A-Za-z_]\w*)\b/g, function (name) {
        var m = macros[name];
        if (!m || m.params) return name;
        var body = String(m.body || '').replace(/\/\/.*$/, '').trim();
        return body ? '(' + body + ')' : '1';
      });
      if (e === before) break;
    }
    e = e.replace(/\b[A-Za-z_]\w*\b/g, '0');
    try {
      var st = { tokens: ifTokenize(e), i: 0 };
      var v = ifConditional(st);
      return st.i === st.tokens.length ? !!v : true;
    } catch (err) { return true; }
  }

  function readMacroArgs(text, openIdx) {
    var depth = 0, args = [], cur = '';
    for (var i = openIdx; i < text.length; i++) {
      var c = text[i];
      if (c === '(') {
        depth++;
        if (depth === 1) continue;
      } else if (c === ')') {
        depth--;
        if (depth === 0) { args.push(cur); return { args: args, end: i }; }
      }
      if (depth === 1 && c === ',') { args.push(cur); cur = ''; continue; }
      cur += c;
    }
    return null;
  }

  function expandMacros(text, macros) {
    for (var round = 0; round < 6; round++) {
      var before = text;
      Object.keys(macros).forEach(function (name) {
        var m = macros[name];
        if (!m.params) {
          text = text.replace(new RegExp('\\b' + name + '\\b', 'g'), m.body);
          return;
        }
        var re = new RegExp('\\b' + name + '\\s*\\(', 'g');
        var out = '', last = 0, hit;
        while ((hit = re.exec(text))) {
          var openIdx = text.indexOf('(', hit.index);
          var got = readMacroArgs(text, openIdx);
          if (!got) break;
          var body = m.body;
          m.params.forEach(function (p, idx) {
            var v = (got.args[idx] || '').trim();
            body = body.replace(new RegExp('\\b' + p + '\\b', 'g'), v);
          });
          out += text.slice(last, hit.index) + body;
          last = got.end + 1;
          re.lastIndex = last;
        }
        if (last) text = out + text.slice(last);
      });
      if (text === before) break;
    }
    return text;
  }

  function preprocess(src) {
    var macros = {};
    var stack = [];                   /* 每层：{ on: 本层是否生效, taken: 本层是否已有分支命中 } */
    function live() {
      for (var i = 0; i < stack.length; i++) if (!stack[i].on) return false;
      return true;
    }
    function liveParent() {
      for (var i = 0; i < stack.length - 1; i++) if (!stack[i].on) return false;
      return true;
    }
    var lines = src.replace(/\r\n?/g, '\n').split('\n').map(function (l) {
      var m = /^\s*#\s*(include|define|undef|ifdef|ifndef|if|elif|else|endif)\b([\s\S]*)$/.exec(l);
      if (!m) return live() ? l : '';
      var kw = m[1], rest = m[2].trim();
      if (kw === 'include') return '';
      if (kw === 'define' || kw === 'undef') {
        if (live()) {
          if (kw === 'define') parseDefine(rest, macros);
          else delete macros[rest.split(/\s+/)[0]];
        }
        return '';
      }
      if (kw === 'ifdef' || kw === 'ifndef' || kw === 'if') {
        var parentOn = live();
        var cond = false;
        if (parentOn) {
          if (kw === 'ifdef') cond = !!macros[rest.split(/\s+/)[0]];
          else if (kw === 'ifndef') cond = !macros[rest.split(/\s+/)[0]];
          else cond = evalIf(rest, macros);
        }
        stack.push({ on: parentOn && cond, taken: parentOn && cond });
        return '';
      }
      if (kw === 'elif') {
        var top = stack[stack.length - 1];
        if (top) {
          var ok = !top.taken && liveParent() && evalIf(rest, macros);
          top.on = ok;
          top.taken = top.taken || ok;
        }
        return '';
      }
      if (kw === 'else') {
        var tp = stack[stack.length - 1];
        if (tp) { tp.on = !tp.taken && liveParent(); tp.taken = true; }
        return '';
      }
      if (kw === 'endif') { stack.pop(); return ''; }
      return '';
    });
    return expandMacros(lines.join('\n'), macros);
  }

  /* ---------------- 词法分析 ---------------- */
  var OPS2 = ['==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '++', '--',
              '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='];

  function tokenize(src) {
    var toks = [], i = 0, line = 1, n = src.length;
    while (i < n) {
      var c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
        i += 2; continue;
      }
      if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      var prevTk = toks.length ? toks[toks.length - 1] : null;
      /* .5 这种浮点只在表达式位置成立；P3.0 的点号留给后面的成员解析 */
      var dotStartsFloat = c === '.' && /[0-9]/.test(src[i + 1] || '')
        && !(prevTk && (prevTk.t === 'id' || prevTk.t === 'num' || prevTk.v === ')' || prevTk.v === ']'));
      if (/[0-9]/.test(c) || dotStartsFloat) {
        var s = '', hex = false, fl = false;
        if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) { hex = true; i += 2; }
        if (hex) {
          while (i < n && /[0-9a-fA-F]/.test(src[i])) s += src[i++];
        } else {
          if (c === '.') { fl = true; s += src[i++]; }
          while (i < n && /[0-9]/.test(src[i])) s += src[i++];
          if (!fl && src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) {
            fl = true; s += src[i++];
            while (i < n && /[0-9]/.test(src[i])) s += src[i++];
          } else if (!fl && src[i] === '.' && !/[A-Za-z_]/.test(src[i + 1] || '')) {
            fl = true; s += src[i++];      /* 16. 这种写法 */
          }
          if (src[i] === 'e' || src[i] === 'E') {
            var ej = i + 1;
            if (src[ej] === '+' || src[ej] === '-') ej++;
            if (/[0-9]/.test(src[ej] || '')) {
              fl = true;
              s += src.slice(i, ej);
              i = ej;
              while (i < n && /[0-9]/.test(src[i])) s += src[i++];
            }
          }
        }
        while (i < n && /[uUlLfF]/.test(src[i])) { if (/[fF]/.test(src[i])) fl = true; i++; }
        var val = hex ? parseInt(s, 16) : (fl ? parseFloat(s) : parseInt(s, 10));
        if (isNaN(val)) throw new VmError('数字格式有误', line);
        var numTok = { t: 'num', v: val, line: line };
        if (fl) numTok.f = true;     /* 浮点常量：除法不能按整数截断 */
        toks.push(numTok);
        continue;
      }
      if (c === "'") {
        i++;
        var cv = 0;
        if (src[i] === '\\') {
          i++;
          var e = src[i++];
          cv = e === 'n' ? 10 : e === '0' ? 0 : e === 't' ? 9 : e === 'r' ? 13 : e.charCodeAt(0);
        } else { cv = src.charCodeAt(i); i++; }
        if (src[i] === "'") i++;
        toks.push({ t: 'num', v: cv, line: line });
        continue;
      }
      if (c === '"') {
        i++;
        var str = '';
        while (i < n && src[i] !== '"') {
          if (src[i] === '\\' && src[i + 1]) {
            i++;
            var es = src[i++];
            str += es === 'n' ? '\n' : es === 'r' ? '\r' : es === 't' ? '\t'
                 : es === '0' ? '\0' : es === '\\' ? '\\' : es === '"' ? '"' : es;
          } else str += src[i++];
        }
        i++;
        toks.push({ t: 'str', v: str, line: line });
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var id = '';
        while (i < n && /[A-Za-z0-9_]/.test(src[i])) id += src[i++];
        toks.push({ t: 'id', v: id, line: line });
        continue;
      }
      var matched = null;
      for (var k = 0; k < OPS2.length; k++) {
        if (src.substr(i, 2) === OPS2[k]) { matched = OPS2[k]; break; }
      }
      if (!matched && /[+\-*/%=<>&|^~!?:;,(){}\[\].]/.test(c)) matched = c;
      if (!matched) throw new VmError('无法识别的字符 “' + c + '”', line);
      i += matched.length;
      toks.push({ t: 'op', v: matched, line: line });
    }
    toks.push({ t: 'eof', v: '(文件结尾)', line: line });
    return toks;
  }

  /* ---------------- 语法分析 ---------------- */
  var TYPE_WORD = /^(unsigned|signed|static|const|volatile|extern|code|data|idata|xdata|pdata|short)$/;
  var BASE_WORD = /^(char|int|void|long|float|bit|sfr|sbit)$/;

  function Parser(toks) {
    this.t = toks;
    this.p = 0;
    this.typedefs = {};               /* 类型别名：u8 / uchar / ... */
    this.structs = {};                /* 具名结构体定义 */
  }
  Parser.prototype.peek = function (k) { return this.t[this.p + (k || 0)]; };
  Parser.prototype.is = function (v) { return this.t[this.p].v === v; };
  Parser.prototype.next = function () { return this.t[this.p++]; };
  Parser.prototype.line = function () { return this.t[this.p].line; };
  Parser.prototype.expect = function (v) {
    if (!this.is(v)) {
      throw new VmError('这里应该是 “' + v + '”，却读到了 “' + this.t[this.p].v + '”', this.t[this.p].line);
    }
    return this.next();
  };
  Parser.prototype.parseType = function () {
    var unsigned = false, base = null, mods = [];
    while (this.peek().t === 'id') {
      var w = this.peek().v;
      if (TYPE_WORD.test(w)) { if (w === 'unsigned') unsigned = true; mods.push(w); this.next(); continue; }
      if (BASE_WORD.test(w)) { base = w; this.next(); continue; }
      if (w === 'struct') {
        this.next();
        var sname = '';
        if (this.peek().t === 'id') sname = this.next().v;
        var inlineFields = this.is('{') ? this.parseFields() : null;
        var known = sname ? this.structs[sname] : null;
        return {
          base: 'struct', unsigned: false, mods: mods, name: sname,
          fields: inlineFields || (known ? known.fields : [])
        };
      }
      if (Object.prototype.hasOwnProperty.call(this.typedefs, w)) {
        var td = this.typedefs[w];
        this.next();
        return {
          base: td.base, unsigned: td.unsigned,
          mods: mods.concat(td.mods || []), name: td.name, fields: td.fields
        };
      }
      break;
    }
    return { base: base || 'int', unsigned: unsigned, mods: mods };
  };
  /* 判断 “(” 后面是不是类型：用来区分强制转换和普通括号表达式 */
  Parser.prototype.isCastAhead = function () {
    if (!this.is('(')) return false;
    var k = 1, saw = false;
    for (;;) {
      var tk = this.peek(k);
      if (!tk || tk.t !== 'id') break;
      if (TYPE_WORD.test(tk.v) || BASE_WORD.test(tk.v)
        || Object.prototype.hasOwnProperty.call(this.typedefs, tk.v)) {
        saw = true; k++; continue;
      }
      break;
    }
    return saw && this.peek(k) && this.peek(k).v === ')';
  };
  /* struct { 类型 名字[长度]; ... } */
  Parser.prototype.parseFields = function () {
    this.expect('{');
    var fields = [];
    while (!this.is('}')) {
      var ty = this.parseType();
      do {
        var nm = this.next().v;
        var size = null;
        if (this.is('[')) {
          this.next();
          if (!this.is(']')) size = this.parseExpr();
          this.expect(']');
        }
        fields.push({ name: nm, type: ty, size: size });
      } while (this.is(',') && this.next());
      this.expect(';');
    }
    this.next();
    return fields;
  };
  Parser.prototype.isTypeStart = function () {
    var tk = this.peek();
    if (tk.t !== 'id') return false;
    return TYPE_WORD.test(tk.v) || BASE_WORD.test(tk.v) || tk.v === 'struct' ||
      Object.prototype.hasOwnProperty.call(this.typedefs, tk.v);
  };

  Parser.prototype.parseProgram = function () {
    var body = [];
    while (this.peek().t !== 'eof') {
      var d = this.parseTopLevel();
      if (d) body.push(d);
    }
    return { t: 'program', body: body };
  };

  Parser.prototype.parseTopLevel = function () {
    var line = this.line();
    if (this.peek().t === 'id' && this.peek().v === 'typedef') {
      this.next();
      var aliased = this.parseType();
      var tname = this.next().v;
      this.expect(';');
      if (aliased.base === 'struct') {
        if (!aliased.name) aliased.name = tname;
        this.structs[aliased.name] = aliased;
      }
      this.typedefs[tname] = aliased;
      return { t: 'typedef', name: tname, line: line };
    }
    var type = this.parseType();
    /* 只定义结构体、不声明变量：struct Point { ... }; */
    if (type.base === 'struct' && type.fields && type.fields.length && this.is(';')) {
      this.next();
      if (type.name) this.structs[type.name] = type;
      return { t: 'typedef', name: type.name || '', line: line };
    }
    if (type.base === 'sbit') {
      var nm = this.next().v;
      this.expect('=');
      var a = this.next(), portName, bit;
      if (this.is('^')) { this.next(); portName = a.v; bit = this.next().v; }
      else {
        var m = /^P([0-3])_([0-7])$/.exec(a.v);
        if (!m) throw new VmError('sbit 请写成 sbit 名字 = P2^0; 这样的形式', line);
        portName = 'P' + m[1]; bit = +m[2];
      }
      this.expect(';');
      return { t: 'sbit', name: nm, port: portName, bit: bit, line: line };
    }
    if (type.base === 'sfr') {
      var sn = this.next().v;
      this.expect('='); this.next(); this.expect(';');
      return { t: 'sfr', name: sn, line: line };
    }
    /* 指针声明的星号在名字前面：unsigned char *p; */
    var gptr = false;
    while (this.is('*')) { this.next(); gptr = true; }
    var name = this.next().v;
    if (this.is('(')) {
      this.next();
      var params = [];
      if (!this.is(')')) {
        do {
          var pt = this.parseType(), pptr = false;
          while (this.is('*')) { this.next(); pptr = true; }
          var pn = '';
          if (this.peek().t === 'id') pn = this.next().v;
          var isArr = false;
          if (this.is('[')) { this.next(); while (!this.is(']')) this.next(); this.next(); isArr = true; }
          params.push({
            name: pn, isArr: isArr,
            type: pptr ? { base: pt.base, unsigned: pt.unsigned, mods: pt.mods, name: pt.name, ptr: true } : pt
          });
        } while (this.is(',') && this.next());
      }
      this.expect(')');
      var interrupt = null;
      if (this.peek().t === 'id' && this.peek().v === 'interrupt') { this.next(); interrupt = this.next().v; }
      if (this.is(';')) { this.next(); return null; }
      var fbody = this.parseBlock();
      return { t: 'func', name: name, params: params, body: fbody, interrupt: interrupt,
               stat: !!(type.mods && type.mods.indexOf('static') >= 0), line: line };
    }
    var vars = [this.parseVarDecl(type, name, gptr)];
    while (this.is(',') && this.next()) vars.push(this.parseVarDecl(type));
    this.expect(';');
    return { t: 'globaldecl', vars: vars, line: line };
  };

  Parser.prototype.parseVarDecl = function (type, knownName, knownPtr) {
    var ptr = !!knownPtr;
    while (this.is('*')) { this.next(); ptr = true; }
    var name = knownName || this.next().v;
    var size = null, init = null;
    if (this.is('[')) {
      this.next();
      if (!this.is(']')) size = this.parseExpr();
      this.expect(']');
    }
    if (this.is('=')) { this.next(); init = this.parseInit(); }
    /* static 局部变量：函数退出后不销毁，讲义里 Timer0_Routine 里的 T0Count 就是它 */
    var stat = !!(type && type.mods && type.mods.indexOf('static') >= 0);
    var ext = !!(type && type.mods && type.mods.indexOf('extern') >= 0);
    if (ptr) type = { base: type.base, unsigned: type.unsigned, mods: type.mods, name: type.name, fields: type.fields, ptr: true };
    return { name: name, size: size, init: init, ptr: ptr, type: type, stat: stat, ext: ext };
  };
  Parser.prototype.parseInit = function () {
    if (this.is('{')) {
      this.next();
      var items = [];
      while (!this.is('}')) {
        items.push(this.parseExpr());
        if (this.is(',')) this.next();
      }
      this.next();
      return { t: 'array', items: items };
    }
    return this.parseExpr();
  };

  Parser.prototype.parseBlock = function () {
    var line = this.line();
    this.expect('{');
    var stmts = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') throw new VmError('缺少右花括号 }', line);
      stmts.push(this.parseStmt());
    }
    this.next();
    return { t: 'block', stmts: stmts, line: line };
  };

  Parser.prototype.parseStmt = function () {
    var tk = this.peek(), line = tk.line, v = tk.v;
    if (v === '{') return this.parseBlock();
    if (v === ';') { this.next(); return { t: 'empty', line: line }; }
    if (this.isTypeStart()) return this.parseLocalDecl();
    if (v === 'if') {
      this.next(); this.expect('(');
      var cond = this.parseExpr(); this.expect(')');
      var thenS = this.parseStmt();
      var elseS = null;
      if (this.peek().v === 'else') { this.next(); elseS = this.parseStmt(); }
      return { t: 'if', cond: cond, thenS: thenS, elseS: elseS, line: line };
    }
    if (v === 'while') {
      this.next(); this.expect('(');
      var wc = this.parseExpr(); this.expect(')');
      return { t: 'while', cond: wc, body: this.parseStmt(), line: line };
    }
    if (v === 'do') {
      this.next();
      var db = this.parseStmt();
      if (this.peek().v !== 'while') throw new VmError('do 后面要跟 while (条件);', this.line());
      this.next(); this.expect('(');
      var dc = this.parseExpr(); this.expect(')'); this.expect(';');
      return { t: 'do', cond: dc, body: db, line: line };
    }
    if (v === 'for') {
      this.next(); this.expect('(');
      var init = null;
      if (!this.is(';')) {
        init = this.isTypeStart() ? this.parseLocalDecl() : this.parseExpr();
      }
      if (!this.is(';') && init && init.t !== 'decl') this.expect(';');
      else if (this.is(';')) this.next();
      var fcond = this.is(';') ? null : this.parseExpr();
      this.expect(';');
      var post = this.is(')') ? null : this.parseExpr();
      this.expect(')');
      return { t: 'for', init: init, cond: fcond, post: post, body: this.parseStmt(), line: line };
    }
    if (v === 'switch') {
      this.next(); this.expect('(');
      var se = this.parseExpr(); this.expect(')'); this.expect('{');
      var cases = [], cur = null;
      while (!this.is('}')) {
        if (this.peek().v === 'case') {
          this.next();
          var cv = this.parseExpr(); this.expect(':');
          cur = { match: cv, stmts: [] }; cases.push(cur);
        } else if (this.peek().v === 'default') {
          this.next(); this.expect(':');
          cur = { match: null, stmts: [] }; cases.push(cur);
        } else {
          var st = this.parseStmt();
          if (cur) cur.stmts.push(st);
        }
      }
      this.next();
      return { t: 'switch', e: se, cases: cases, line: line };
    }
    if (v === 'return') {
      this.next();
      var rv = this.is(';') ? null : this.parseExpr();
      this.expect(';');
      return { t: 'return', e: rv, line: line };
    }
    if (v === 'break') { this.next(); this.expect(';'); return { t: 'break', line: line }; }
    if (v === 'continue') { this.next(); this.expect(';'); return { t: 'continue', line: line }; }
    var e = this.parseExpr();
    this.expect(';');
    return { t: 'expr', e: e, line: line };
  };

  Parser.prototype.parseLocalDecl = function () {
    var line = this.line();
    var type = this.parseType();
    var vars = [this.parseVarDecl(type)];
    while (this.is(',') && this.next()) vars.push(this.parseVarDecl(type));
    this.expect(';');
    return { t: 'decl', vars: vars, line: line };
  };

  /* 表达式：自低优先级向高优先级 */
  var ASSIGN_OPS = ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='];
  Parser.prototype.parseExpr = function () {
    var left = this.parseCond();
    if (ASSIGN_OPS.indexOf(this.peek().v) >= 0) {
      var op = this.next().v, line = this.line();
      var right = this.parseExpr();
      return { t: 'assign', op: op, left: left, right: right, line: line };
    }
    return left;
  };
  Parser.prototype.parseCond = function () {
    var c = this.parseBin(0);
    if (this.is('?')) {
      var line = this.line();
      this.next();
      var a = this.parseExpr();
      this.expect(':');
      var b = this.parseExpr();
      return { t: 'cond', c: c, a: a, b: b, line: line };
    }
    return c;
  };
  var BIN_LEVELS = [
    ['||'], ['&&'], ['|'], ['^'], ['&'],
    ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'],
    ['+', '-'], ['*', '/', '%']
  ];
  Parser.prototype.parseBin = function (lv) {
    if (lv >= BIN_LEVELS.length) return this.parseUnary();
    var left = this.parseBin(lv + 1);
    while (BIN_LEVELS[lv].indexOf(this.peek().v) >= 0) {
      var op = this.next().v, line = this.line();
      var right = this.parseBin(lv + 1);
      left = { t: 'bin', op: op, left: left, right: right, line: line };
    }
    return left;
  };
  Parser.prototype.parseUnary = function () {
    var v = this.peek().v, line = this.line();
    if (v === '(' && this.isCastAhead()) {
      this.next();
      var ctype = this.parseType();
      this.expect(')');
      return { t: 'cast', type: ctype, e: this.parseUnary(), line: line };
    }
    if (v === '+' || v === '-' || v === '!' || v === '~') {
      this.next();
      return { t: 'un', op: v, e: this.parseUnary(), line: line };
    }
    if (v === '++' || v === '--') {
      this.next();
      return { t: 'pre', op: v, e: this.parseUnary(), line: line };
    }
    /* 取地址与解引用：指针值在运行时就是“指向某个变量/数组元素的引用” */
    if (v === '&') {
      this.next();
      return { t: 'addr', e: this.parseUnary(), line: line };
    }
    if (v === '*') {
      this.next();
      return { t: 'deref', e: this.parseUnary(), line: line };
    }
    return this.parsePostfix();
  };
  Parser.prototype.parsePostfix = function () {
    var e = this.parsePrimary();
    for (;;) {
      if (this.is('(')) {
        var line = this.line();
        this.next();
        var args = [];
        while (!this.is(')')) {
          args.push(this.parseExpr());
          if (this.is(',')) this.next();
        }
        this.next();
        e = { t: 'call', name: e.v, args: args, line: line };
      } else if (this.is('[')) {
        var line2 = this.line();
        this.next();
        var idx = this.parseExpr();
        this.expect(']');
        e = { t: 'index', obj: e, index: idx, line: line2 };
      } else if (this.is('.')) {
        var line3 = this.line();
        this.next();
        var fname = this.next().v;
        /* P3.0 这种点号写法：等价于 P3_0，课程代码里偶尔会这么写 */
        if (e.t === 'id' && /^P[0-3]$/.test(e.v) && /^[0-7]$/.test(String(fname))) {
          e = { t: 'id', v: e.v + '_' + fname, line: line3 };
        } else {
          e = { t: 'member', obj: e, name: fname, line: line3 };
        }
      } else if (this.is('++') || this.is('--')) {
        var op = this.next().v;
        e = { t: 'post', op: op, e: e, line: this.line() };
      } else break;
    }
    return e;
  };
  Parser.prototype.parsePrimary = function () {
    var tk = this.peek();
    if (tk.t === 'num') {
      this.next();
      var numNode = { t: 'num', v: tk.v, line: tk.line };
      if (tk.f) numNode.f = true;      /* 保留浮点标记，除法要靠它 */
      return numNode;
    }
    if (tk.t === 'str') { this.next(); return { t: 'str', v: tk.v, line: tk.line }; }
    if (tk.t === 'id') { this.next(); return { t: 'id', v: tk.v, line: tk.line }; }
    if (tk.v === '(') { this.next(); var e = this.parseExpr(); this.expect(')'); return e; }
    throw new VmError('读到了不该出现在这里的 “' + tk.v + '”', tk.line);
  };

  /* ---------------- 虚拟机 ---------------- */
  function truthy(v) { return Array.isArray(v) ? v.length > 0 : !!v; }
  function coerce(type, v) {
    if (v === undefined || v === null) return 0;
    /* 数组赋给指针 = 指向首元素；这一步必须在“对象原样保留”之前 */
    if (type && type.ptr && Array.isArray(v)) return { __ref: true, kind: 'elem', arr: v, idx: 0 };
    if (typeof v === 'object') return v;      /* 数组和结构体原样保留 */
    if (!type) return v;
    var b = type.base;
    if (b === 'char') return v & 0xFF;
    /* C51 的 int 是 16 位有符号：赋值时按补码截断，DS18B20 的负温要靠它 */
    if (b === 'int') {
      v = v & 0xFFFF;
      return type.unsigned ? v : (v << 16) >> 16;
    }
    if (b === 'long') return v & 0xFFFF;
    if (b === 'bit') return v ? 1 : 0;
    return v;
  }
  /* 表达式是不是浮点：除法靠它决定要不要按整数截断 */
  function exprIsFloat(vm, n) {
    if (!n || typeof n !== 'object') return false;
    if (n.t === 'num') return !!n.f;
    if (n.t === 'cast') return !!(n.type && n.type.base === 'float');
    if (n.t === 'id') return vm.typeOfName(n.v) === 'float';
    if (n.t === 'un') return exprIsFloat(vm, n.e);
    if (n.t === 'bin') return exprIsFloat(vm, n.left) || exprIsFloat(vm, n.right);
    if (n.t === 'cond') return exprIsFloat(vm, n.a) || exprIsFloat(vm, n.b);
    return false;
  }
  /* 结构体的默认值：数值 0、数组全 0、嵌套结构体递归 */
  function structDefault(type) {    var o = {};
    (type.fields || []).forEach(function (f) {
      var n = f.size && f.size.t === 'num' ? f.size.v : 1;
      var one = (f.type && f.type.base === 'struct')
        ? function () { return structDefault(f.type); }
        : function () { return 0; };
      if (n > 1) {
        var arr = [];
        for (var i = 0; i < n; i++) arr.push(one());
        o[f.name] = arr;
      } else {
        o[f.name] = one();
      }
    });
    return o;
  }
  function newFrame(name, line) { return { vars: {}, types: {}, fn: name || '', callLine: line || 0 }; }

  /* ---------------- 头文件 ----------------
     尖括号头不一定都在工程里；只有这些内置系统头允许缺失，其余自定义头缺失按错误处理。 */
  var SYSTEM_HEADERS = {
    'reg52.h': 1, 'regx52.h': 1, 'reg51.h': 1, 'intrins.h': 1,
    'stdio.h': 1, 'string.h': 1, 'stdlib.h': 1, 'math.h': 1,
    'ctype.h': 1, 'absacc.h': 1, 'stddef.h': 1, 'stdarg.h': 1,
    'float.h': 1, 'limits.h': 1, 'stc89c52.h': 1, 'stc89c52rc.h': 1
  };

  function isSystemHeader(name) {
    return !!SYSTEM_HEADERS[String(name || '').replace(/\\/g, '/').split('/').pop().toLowerCase()];
  }

  /* ---------------- 8051 特殊功能寄存器 ----------------
     这些名字在 REGX52.H 里，源码没有 #include 也能直接用，避免"变量没有定义"的误导报错。
     它们本质是普通字节，只有定时器 / 串口相关的几个会被下面的模型接管。 */
  var SFR_NAMES = ['TMOD', 'TCON', 'TH0', 'TL0', 'TH1', 'TL1', 'SCON', 'SBUF',
                   'IE', 'IP', 'PCON', 'PSW', 'ACC', 'B'];
  /* 可位寻址的位名 -> [字节寄存器, 位序号] */
  var BIT_ALIAS = {
    IT0: ['TCON', 0], IE0: ['TCON', 1], IT1: ['TCON', 2], IE1: ['TCON', 3],
    TR0: ['TCON', 4], TF0: ['TCON', 5], TR1: ['TCON', 6], TF1: ['TCON', 7],
    EX0: ['IE', 0], ET0: ['IE', 1], EX1: ['IE', 2], ET1: ['IE', 3],
    ES: ['IE', 4], EA: ['IE', 7],
    PX0: ['IP', 0], PT0: ['IP', 1], PX1: ['IP', 2], PT1: ['IP', 3], PS: ['IP', 4],
    RI: ['SCON', 0], TI: ['SCON', 1], RB8: ['SCON', 2], TB8: ['SCON', 3],
    REN: ['SCON', 4], SM2: ['SCON', 5], SM1: ['SCON', 6], SM0: ['SCON', 7]
  };
  var TIMER_BYTE = { TH0: ['T0', 1], TL0: ['T0', 0], TH1: ['T1', 1], TL1: ['T1', 0] };

  var BUILTINS = {
    Delay: function* (vm, args, line) {
      var ms = Math.max(0, Math.min(60000, Math.round(args[0] || 0)));
      vm.line = line;
      /* 有定时器在跑时必须按 1ms 推进，否则一个 Delay(1000) 只会补一次中断，
         计数就比真板子慢一大截。外部中断（边沿靠轮询发现）和串口接收同样
         按 1ms 切片服务，Delay 期间按 K3、收到字节都能立刻进中断。 */
      if (vm.timers && ((vm.timers.T0.on || vm.timers.T1.on) || vm.isr[0] || vm.isr[2])) {
        for (var k = 0; k < ms; k++) {
          yield { wait: 1, line: line };
          yield* vm.serviceTimers();
          yield* vm.serviceExternals();
          yield* vm.serviceSerial();
        }
        return 0;
      }
      yield { wait: ms, line: line };
      return 0;
    },
    DelayMs: null,
    LCD_Delay: function* (vm, args, line) {
      vm.line = line;
      yield { wait: args.length ? (args[0] || 0) : 1, line: line };
      return 0;
    },
    Delay500us: function* (vm, args, line) { yield { wait: 0.5, line: line }; return 0; },
    Buzzer_Delay500us: function* (vm, args, line) { yield { wait: 0.5, line: line }; return 0; },
    _nop_: function* () { return 0; },
    _crol_: function* (vm, args) {
      var v = (args[0] || 0) & 0xFF, n = (args[1] || 0) & 7;
      return n === 0 ? v : (((v << n) | (v >> (8 - n))) & 0xFF);
    },
    _cror_: function* (vm, args) {
      var v = (args[0] || 0) & 0xFF, n = (args[1] || 0) & 7;
      return n === 0 ? v : (((v >> n) | (v << (8 - n))) & 0xFF);
    }
  };
  BUILTINS.DelayMs = BUILTINS.Delay;

  function VM(source, hw, ast) {
    this.hw = hw || null;
    this.ports = { P0: 0xFF, P1: 0xFF, P2: 0xFF, P3: 0xFF };
    this.sfr = {};
    for (var si = 0; si < SFR_NAMES.length; si++) this.sfr[SFR_NAMES[si]] = 0;
    this.sbits = {};
    this.globals = {};
    this.gtypes = {};
    this.statics = {};                 /* static 局部变量：'函数名#变量名' -> 值 */
    this.stype = {};
    this.funcs = {};
    this.isr = {};                     /* 中断向量号 -> 函数节点 */
    this.frames = [];
    this.logs = [];
    this.line = 1;
    this.stepCount = 0;
    this.waitMs = 0;
    this.vtime = 0;
    this.done = false;
    this.error = null;
    this.inIsr = false;                /* 中断服务函数执行中，避免重入 */
    this.serial = '';                  /* 串口已发送的字符（写 SBUF 立刻完成） */
    this.serialDirty = false;
    this.rxQueue = [];                 /* 串口接收队列：UI 送来的字节先排队，等 RI 空了再送进去 */
    this.extPrev = { 0: 1, 2: 1 };     /* INT0/INT1 引脚上一次的电平，用来发现下降沿 */
    this.timers = {
      T0: { init: 0, t0: 0, on: false },
      T1: { init: 0, t0: 0, on: false }
    };
    this.ast = ast || new Parser(tokenize(preprocess(source))).parseProgram();
    if (!this.ast.body.some(function (d) { return d.t === 'func' && d.name === 'main'; })) {
      throw new VmError('没有找到 main 函数：程序需要有 void main() { ... } 作为入口', 0);
    }
    var self = this;
    this.gen = (function* () {
      yield* self._initGlobals(self.ast);
      if (self.hw) self.hw.syncAll(self);
      yield* self.callFunction('main', [], 1);
      self.done = true;
    })();
  }

  VM.prototype.log = function (msg) {
    this.logs.push(msg);
    if (this.logs.length > 300) this.logs.shift();
  };

  /* 变量读写 */
  VM.prototype.findFrame = function (name) {
    for (var i = this.frames.length - 1; i >= 0; i--) {
      if (Object.prototype.hasOwnProperty.call(this.frames[i].vars, name)) return this.frames[i];
    }
    return null;
  };
  /* 变量的声明类型（只看浮点/整数，够 exprIsFloat 用） */
  VM.prototype.typeOfName = function (name) {
    for (var i = this.frames.length - 1; i >= 0; i--) {
      var f = this.frames[i];
      if (f.types && Object.prototype.hasOwnProperty.call(f.types, name)) {
        return f.types[name] && f.types[name].base;
      }
    }
    var sk = this.staticKey(name);
    if (this.stype[sk]) return this.stype[sk].base;
    if (this.gtypes[name]) return this.gtypes[name].base;
    return '';
  };
  VM.prototype.getVar = function (name, line) {
    var f = this.findFrame(name);
    if (f) return f.vars[name];
    var sk = this.staticKey(name);
    if (Object.prototype.hasOwnProperty.call(this.statics, sk)) return this.statics[sk];
    if (Object.prototype.hasOwnProperty.call(this.globals, name)) return this.globals[name];
    if (/^P[0-3]$/.test(name)) return this.readPort(name);
    if (/^P[0-3]_[0-7]$/.test(name)) return (this.readPort(name.slice(0, 2)) >> (+name[3])) & 1;
    if (this.sbits[name]) { var s = this.sbits[name]; return (this.readPort(s.port) >> s.bit) & 1; }
    if (TIMER_BYTE[name]) return this.readTimerByte(name);
    if (BIT_ALIAS[name]) { var ba = BIT_ALIAS[name]; return (this.sfr[ba[0]] >> ba[1]) & 1; }
    if (Object.prototype.hasOwnProperty.call(this.sfr, name)) return this.sfr[name];
    throw new VmError('变量 “' + name + '” 没有定义（注意大小写；P0~P3、P2_0 这类位名和 TMOD/TH0/TF0 等寄存器名已内置）', line || this.line);
  };
  VM.prototype.setVar = function (name, val, line) {
    var f = this.findFrame(name);
    if (f) { f.vars[name] = coerce(f.types[name], val); return; }
    var sk = this.staticKey(name);
    if (Object.prototype.hasOwnProperty.call(this.statics, sk)) {
      this.statics[sk] = coerce(this.stype[sk], val); return;
    }
    if (Object.prototype.hasOwnProperty.call(this.globals, name)) {
      this.globals[name] = coerce(this.gtypes[name], val); return;
    }
    if (/^P[0-3]$/.test(name)) { this.writePort(name, val); return; }
    if (/^P[0-3]_[0-7]$/.test(name)) { this.writePortBit(name.slice(0, 2), +name[3], val); return; }
    if (this.sbits[name]) { var s = this.sbits[name]; this.writePortBit(s.port, s.bit, val); return; }
    if (TIMER_BYTE[name]) { this.writeTimerByte(name, val); return; }
    if (name === 'SBUF') { this.transmit(val); return; }
    if (BIT_ALIAS[name]) { this.writeBitAlias(name, val); return; }
    if (Object.prototype.hasOwnProperty.call(this.sfr, name)) { this.writeSfr(name, val); return; }
    throw new VmError('变量 “' + name + '” 没有定义，不能赋值', line || this.line);
  };

  /* static 局部变量按"函数名#变量名"区分，两个函数里的同名 static 互不干扰 */
  VM.prototype.staticKey = function (name) {
    var f = this.frames[this.frames.length - 1];
    return (f ? f.fn : '') + '#' + name;
  };

  VM.prototype.writePort = function (port, v) {
    var old = this.ports[port];
    var nv = (typeof v === 'number' ? v : 0) & 0xFF;
    this.ports[port] = nv;
    if (this.hw) this.hw.onPortWrite(port, old, nv, this);
  };
  VM.prototype.writePortBit = function (port, bit, v) {
    var old = this.ports[port];
    var nv = v ? (old | (1 << bit)) : (old & ~(1 << bit));
    this.ports[port] = nv;
    if (this.hw) {
      this.hw.onBitWrite(port, bit, v ? 1 : 0, this);
      this.hw.onPortWrite(port, old, nv, this);
    }
  };
  /* 输入（按键等）只改电平，不触发“程序写端口”的硬件动作 */
  VM.prototype.setInputBit = function (port, bit, v) {
    var old = this.ports[port];
    this.ports[port] = v ? (old | (1 << bit)) : (old & ~(1 << bit));
  };
  /* 读端口：矩阵键盘这类外设会在"读"的瞬间把某些位拉低，
     所以读到的值不一定等于程序写进去的值。 */
  VM.prototype.readPort = function (port) {
    var w = this.ports[port];
    return this.hw && this.hw.readPort ? this.hw.readPort(port, w, this.vtime) : w;
  };

  /* ---------------- 定时器 0 / 1 ----------------
     只模拟教学里真正用到的两种模式：
       模式 1：16 位定时，溢出后从 0 继续（讲义 1ms 定时：TH0=0xFC, TL0=0x18）
       模式 2：8 位自动重装，TH 作为重装值（串口波特率发生器就是这么用的）
     计数单位是机器周期，12MHz 下 1us 一个，所以 1ms = 1000 个计数。
  ------------------------------------------------------------------ */
  VM.prototype.timerMode = function (nm) {
    return (this.sfr.TMOD >> (nm === 'T0' ? 0 : 4)) & 3;
  };
  VM.prototype.timerSpan = function (nm) {
    var m = this.timerMode(nm);
    /* 模式 0 是 13 位（TH 8 位 + TL 低 5 位），模式 2 是 8 位自动重装 */
    return m === 2 ? 256 : (m === 0 ? 8192 : 65536);
  };
  VM.prototype.timerCount = function (nm) {
    var tm = this.timers[nm];
    if (!tm.on) return tm.init;
    return tm.init + Math.floor((this.vtime - tm.t0) * 1000);
  };
  VM.prototype.readTimerByte = function (name) {
    var tb = TIMER_BYTE[name], nm = tb[0], hi = tb[1];
    var tm = this.timers[nm];
    if (!tm.on) return this.sfr[name] & 0xFF;
    var mode = this.timerMode(nm);
    var cnt = this.timerCount(nm) % this.timerSpan(nm);
    if (mode === 0) return hi ? ((cnt >> 5) & 0xFF) : (cnt & 0x1F);
    return hi ? ((cnt >> 8) & 0xFF) : (cnt & 0xFF);
  };
  VM.prototype.writeTimerByte = function (name, val) {
    var tb = TIMER_BYTE[name], nm = tb[0], hi = tb[1], b = val & 0xFF;
    this.sfr[name] = b;
    var tm = this.timers[nm];
    var span = this.timerSpan(nm), mode = this.timerMode(nm);
    var cur = tm.on ? (this.timerCount(nm) % span) : tm.init;
    if (mode === 0) cur = hi ? ((b << 5) | (cur & 0x1F)) : ((cur & ~0x1F) | (b & 0x1F));
    else cur = hi ? (((cur & 0x00FF) | (b << 8)) % span) : ((cur & 0xFF00) | b);
    tm.init = cur;
    tm.t0 = this.vtime;      /* 写初值 = 从这一刻重新开始计数 */
  };
  VM.prototype.switchTimer = function (nm, on) {
    var tm = this.timers[nm];
    if (on === tm.on) return;
    if (on) {
      var mode = this.timerMode(nm);
      var hi = this.sfr[nm === 'T0' ? 'TH0' : 'TH1'] & 0xFF;
      var lo = this.sfr[nm === 'T0' ? 'TL0' : 'TL1'] & 0xFF;
      tm.init = (mode === 2 ? lo : (mode === 0 ? ((hi << 5) | (lo & 0x1F)) : ((hi << 8) | lo))) % this.timerSpan(nm);
      tm.t0 = this.vtime;
      tm.on = true;
    } else {
      tm.init = this.timerCount(nm) % this.timerSpan(nm);
      tm.on = false;
    }
  };
  /* 每条语句执行前检查一次：溢出就置 TF 标志，开了中断就去执行中断服务函数 */
  VM.prototype.serviceTimers = function* () {
    if (this.inIsr) return;
    var list = [['T0', 0x20, 0x02, 1], ['T1', 0x80, 0x08, 3]];
    for (var i = 0; i < list.length; i++) {
      var nm = list[i][0], tfBit = list[i][1], etBit = list[i][2], vec = list[i][3];
      var tm = this.timers[nm];
      if (!tm.on) continue;
      var span = this.timerSpan(nm);
      var cnt = this.timerCount(nm);
      if (cnt < span) continue;
      this.sfr.TCON |= tfBit;
      var extra = cnt - span;
      if (this.timerMode(nm) === 2) tm.init = this.sfr[nm === 'T0' ? 'TH0' : 'TH1'] & 0xFF;
      else tm.init = 0;
      /* 保留不足 1 个计数的余数，长时间跑不会越走越慢 */
      tm.t0 = this.vtime - extra / 1000;
      var ie = this.sfr.IE, f = this.isr[vec];
      if ((ie & 0x80) && (ie & etBit) && f && !this.inIsr) {
        /* 真硬件在转入中断服务函数时会自动清掉 TF 标志（所以讲义里的中断函数不用手动清） */
        this.sfr.TCON &= ~tfBit;
        this.inIsr = true;
        try { yield* this.callFunction(f.name, [], this.line); }
        finally { this.inIsr = false; }
      }
    }
  };

  /* ---------------- 外部中断 INT0 / INT1 ----------------
     INT0 接 P3.2（板上 K3），INT1 接 P3.3（板上 K4）。
     IT0/IT1=1 下降沿触发：引脚 1→0 时锁存 IE0/IE1，进 ISR 时硬件自动清；
     IT0/IT1=0 低电平触发：引脚为低期间请求一直存在（与真硬件一致，
     按住不放会反复进中断）。
  ------------------------------------------------------------------ */
  VM.prototype.serviceExternals = function* () {
    if (this.inIsr) return;
    var p3 = this.readPort('P3');
    var defs = [
      { bit: 2, vec: 0, itM: 0x01, flagM: 0x02, exM: 0x01 },
      { bit: 3, vec: 2, itM: 0x04, flagM: 0x08, exM: 0x04 }
    ];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var cur = (p3 >> d.bit) & 1;
      var prev = this.extPrev[d.vec];
      var edgeMode = (this.sfr.TCON & d.itM) !== 0;
      if (edgeMode) {
        if (prev === 1 && cur === 0) this.sfr.TCON |= d.flagM;   /* 锁存请求 */
      } else {
        /* 电平模式：标志跟着引脚走 */
        if (cur === 0) this.sfr.TCON |= d.flagM;
        else this.sfr.TCON &= ~d.flagM;
      }
      this.extPrev[d.vec] = cur;
      var f = this.isr[d.vec], ie = this.sfr.IE;
      if ((this.sfr.TCON & d.flagM) && (ie & 0x80) && (ie & d.exM) && f) {
        if (edgeMode) this.sfr.TCON &= ~d.flagM;    /* 转中断时自动清 IE */
        this.inIsr = true;
        try { yield* this.callFunction(f.name, [], this.line); }
        finally { this.inIsr = false; }
      }
    }
  };

  /* ---------------- 串口接收 ----------------
     UI 把字节放进 rxQueue；每条语句检查一次：RI 是 0（上一字节已被程序
     读走并清零）就把下一字节送进 SBUF、置 RI=1；开了 ES+EA 且有 interrupt 4
     就直接转进串口中断（真硬件收完一字节也这么干）。
  ------------------------------------------------------------------ */
  VM.prototype.receive = function (byte) {
    if (this.rxQueue.length < 64) this.rxQueue.push(byte & 0xFF);
  };
  VM.prototype.serviceSerial = function* () {
    if (this.inIsr) return;
    if (!this.rxQueue.length) return;
    if (this.sfr.SCON & 0x01) return;                 /* RI 还置着，等程序先消化 */
    var b = this.rxQueue.shift();
    this.sfr.SBUF = b;
    this.sfr.SCON |= 0x01;                            /* RI = 1 */
    var f = this.isr[4], ie = this.sfr.IE;
    if ((ie & 0x80) && (ie & 0x10) && f) {
      this.inIsr = true;
      try { yield* this.callFunction(f.name, [], this.line); }
      finally { this.inIsr = false; }
    }
  };

  /* ---------------- 串口：写 SBUF 就当发送完成 ----------------
     仿真里没有真实波特率延迟，写进去立刻置 TI=1，所以
     “SBUF = x; while (TI == 0); TI = 0;” 这套讲义写法能原样跑通。
  ------------------------------------------------------------------ */
  VM.prototype.transmit = function (v) {
    var b = v & 0xFF;
    this.sfr.SBUF = b;
    this.serial += String.fromCharCode(b);
    if (this.serial.length > 20000) this.serial = this.serial.slice(-20000);
    this.serialDirty = true;
    this.sfr.SCON |= 0x02;       /* TI = 1 */
  };

  VM.prototype.writeBitAlias = function (name, val) {
    var ba = BIT_ALIAS[name];
    var oldB = this.sfr[ba[0]];
    this.sfr[ba[0]] = val ? (oldB | (1 << ba[1])) : (oldB & ~(1 << ba[1]));
    if (name === 'TR0') this.switchTimer('T0', !!val);
    else if (name === 'TR1') this.switchTimer('T1', !!val);
  };
  VM.prototype.writeSfr = function (name, val) {
    this.sfr[name] = val & 0xFF;
    /* 直接写 TCON / TMOD 也要让定时器跟着动，否则 TR0=1 和 TCON=0x10 的行为不一致 */
    if (name === 'TCON') {
      this.switchTimer('T0', !!(val & 0x10));
      this.switchTimer('T1', !!(val & 0x40));
    } else if (name === 'TMOD') {
      var t0 = this.timers.T0.on, t1 = this.timers.T1.on;
      this.switchTimer('T0', false); if (t0) this.switchTimer('T0', true);
      this.switchTimer('T1', false); if (t1) this.switchTimer('T1', true);
    }
  };

  VM.prototype.refGet = function (ref) {
    if (ref.kind === 'var') return this.getVar(ref.name, ref.line);
    if (ref.kind === 'member') return ref.obj[ref.name];
    return ref.arr[ref.idx];
  };
  VM.prototype.refSet = function (ref, v) {
    if (ref.kind === 'var') this.setVar(ref.name, v, ref.line);
    else if (ref.kind === 'member') ref.obj[ref.name] = v;
    else ref.arr[ref.idx] = typeof v === 'number' ? v : 0;
  };
  /* 指针自增 / 加减偏移：只对 "指向数组元素" 的指针有意义，越界直接报错 */
  VM.prototype.ptrStep = function (p, d, line) {
    if (p.kind !== 'elem') throw new VmError('只有指向数组元素的指针才能做加减', line || this.line);
    var i = p.idx + (d | 0);
    if (i < 0 || i >= p.arr.length) {
      throw new VmError('指针移出了数组范围（下标 ' + i + '，数组长度 ' + p.arr.length + '）', line || this.line);
    }
    return { __ref: true, kind: 'elem', arr: p.arr, idx: i, line: p.line };
  };
  VM.prototype.incValue = function (v, d, line) {
    if (v && v.__ref) return this.ptrStep(v, d, line);
    return v + d;
  };
  VM.prototype.ptrOp = function (op, a, b) {
    var pa = !!(a && a.__ref), pb = !!(b && b.__ref);
    if (op === '+' && pa) return this.ptrStep(a, b, this.line);
    if (op === '-' && pa && !pb) return this.ptrStep(a, -b, this.line);
    if (op === '-' && pa && pb) {
      if (a.kind !== 'elem' || b.kind !== 'elem' || a.arr !== b.arr) {
        throw new VmError('两个指针相减时，必须指向同一个数组', this.line);
      }
      return a.idx - b.idx;
    }
    if (op === '==' || op === '!=') {
      var eq = pa && pb && a.kind === b.kind && a.arr === b.arr && a.idx === b.idx && a.name === b.name;
      return (op === '==' ? eq : !eq) ? 1 : 0;
    }
    throw new VmError('指针只能做加减偏移或相等比较', this.line);
  };

  VM.prototype._initGlobals = function* (ast) {
    for (var i = 0; i < ast.body.length; i++) {
      var d = ast.body[i];
      if (d.t === 'func') {
        this.funcs[d.name] = d;
        if (d.interrupt != null && d.interrupt !== '') this.isr[+d.interrupt] = d;
      } else if (d.t === 'sbit') this.sbits[d.name] = { port: d.port, bit: d.bit };
      else if (d.t === 'sfr') this.sfr[d.name] = 0;
      else if (d.t === 'globaldecl') {
        for (var j = 0; j < d.vars.length; j++) {
          var v = d.vars[j];
          this.globals[v.name] = yield* this.makeValue(v);
          this.gtypes[v.name] = v.type;
        }
      }
    }
  };
  VM.prototype.makeValue = function* (v) {
    var size = null;
    if (v.size) size = yield* this.evalExpr(v.size);
    var isStruct = v.type && v.type.base === 'struct';
    var val;
    if (size !== null) {
      val = [];
      for (var k = 0; k < size; k++) val.push(isStruct ? structDefault(v.type) : 0);
    } else {
      val = isStruct ? structDefault(v.type) : 0;
    }
    if (v.init) {
      if (v.init.t === 'array') {
        var items = [];
        for (var i = 0; i < v.init.items.length; i++) items.push(yield* this.evalExpr(v.init.items[i]));
        val = items;
      } else {
        val = yield* this.evalExpr(v.init);
      }
    }
    /* 初始化也要按声明类型截断：int n = 0xFFF6; 必须得到 -10 */
    return coerce(v.type, val);
  };

  VM.prototype.callFunction = function* (name, args, line) {
    if (BUILTINS[name]) return yield* BUILTINS[name](this, args, line);
    var f = this.funcs[name];
    if (!f) throw new VmError('函数 “' + name + '” 没有定义（虚拟机已内置 Delay、_nop_、_crol_、_cror_）', line);
    if (this.frames.length > 60) throw new VmError('函数调用层次过深，可能是递归没有出口', line);
    var frame = newFrame(name, line);
    for (var i = 0; i < f.params.length; i++) {
      var p = f.params[i];
      frame.vars[p.name] = p.isArr && Array.isArray(args[i]) ? args[i] : coerce(p.type, args[i]);
      frame.types[p.name] = p.type;
    }
    this.frames.push(frame);
    /* 进函数先把行号定位到函数声明那一行，并让出一拍：
       这样断点可以打在 void main() 这种函数头上，单步进入也能停在函数头。 */
    this.line = f.line || line;
    yield { entry: name };
    try {
      yield* this.execBlock(f.body);
      return 0;
    } catch (e) {
      if (e && e[SIG] && e.kind === 'return') return e.value;
      throw e;
    } finally {
      this.frames.pop();
    }
  };

  VM.prototype.tick = function* (line) {
    this.line = line;
    this.stepCount++;
    if (this.hw && this.hw.service) this.hw.service(this);   /* 单总线等“按语句数计时”的器件 */
    if (!this.inIsr) {
      if (this.timers.T0.on || this.timers.T1.on) yield* this.serviceTimers();
      yield* this.serviceExternals();     /* 电平触发/标志位轮询式代码也要它喂 */
      if (this.rxQueue.length) yield* this.serviceSerial();
    }
    /* 语句时间：平均 5us（12MHz 下一条语句几个机器周期）。
       以前是每 200 条语句一次跳 1ms，红外 560us/1690us 这种时序会被抹成 1ms 网格；
       现在每 10 条让出 50us，平均速度不变，但分辨率够解红外和单总线。 */
    if (this.stepCount % 10 === 0) yield { wait: 0.05, line: line };
    else yield { step: 1, line: line };
  };

  VM.prototype.execBlock = function* (b) {
    for (var i = 0; i < b.stmts.length; i++) yield* this.execStmt(b.stmts[i]);
  };

  VM.prototype.execStmt = function* (s) {
    yield* this.tick(s.line);
    var i, v, r;
    switch (s.t) {
      case 'empty': return;
      case 'block': yield* this.execBlock(s); return;
      case 'expr': yield* this.evalExpr(s.e); return;
      case 'decl':
        for (i = 0; i < s.vars.length; i++) {
          v = s.vars[i];
          if (v.stat) {
            /* static：只在第一次执行到这里时初始化，之后跨函数调用一直保留 */
            var skey = this.staticKey(v.name);
            if (!Object.prototype.hasOwnProperty.call(this.statics, skey)) {
              this.statics[skey] = yield* this.makeValue(v);
              this.stype[skey] = v.type;
            }
            continue;
          }
          var frame = this.frames[this.frames.length - 1];
          frame.vars[v.name] = yield* this.makeValue(v);
          frame.types[v.name] = v.type;
        }
        return;
      case 'if':
        if (truthy(yield* this.evalExpr(s.cond))) yield* this.execStmt(s.thenS);
        else if (s.elseS) yield* this.execStmt(s.elseS);
        return;
      case 'while':
        while (truthy(yield* this.evalExpr(s.cond))) {
          try { yield* this.execStmt(s.body); }
          catch (e) {
            if (e && e[SIG]) {
              if (e.kind === 'break') break;
              if (e.kind === 'continue') continue;
            }
            throw e;
          }
        }
        return;
      case 'do':
        do {
          try { yield* this.execStmt(s.body); }
          catch (e) {
            if (e && e[SIG]) {
              if (e.kind === 'break') break;
              if (e.kind === 'continue') { /* 落到条件判断 */ }
              else if (e.kind !== 'continue') throw e;
            } else throw e;
          }
          r = truthy(yield* this.evalExpr(s.cond));
        } while (r);
        return;
      case 'for':
        if (s.init) {
          if (s.init.t === 'decl') yield* this.execStmt(s.init);
          else yield* this.evalExpr(s.init);
        }
        while (s.cond ? truthy(yield* this.evalExpr(s.cond)) : true) {
          var brk = false;
          try { yield* this.execStmt(s.body); }
          catch (e) {
            if (e && e[SIG]) {
              if (e.kind === 'break') { brk = true; }
              else if (e.kind !== 'continue') throw e;
            } else throw e;
          }
          if (brk) break;
          if (s.post) yield* this.evalExpr(s.post);
        }
        return;
      case 'switch':
        v = yield* this.evalExpr(s.e);
        var start = -1, def = -1;
        for (i = 0; i < s.cases.length; i++) {
          var c = s.cases[i];
          if (c.match === null) def = i;
          else {
            var mv = yield* this.evalExpr(c.match);
            if (mv === v) { start = i; break; }
          }
        }
        if (start < 0) start = def;
        if (start >= 0) {
          try {
            for (i = start; i < s.cases.length; i++) {
              for (var j = 0; j < s.cases[i].stmts.length; j++) yield* this.execStmt(s.cases[i].stmts[j]);
            }
          } catch (e) {
            if (e && e[SIG] && e.kind === 'break') return;
            throw e;
          }
        }
        return;
      case 'return':
        v = s.e ? yield* this.evalExpr(s.e) : 0;
        var sig = {}; sig[SIG] = true; sig.kind = 'return'; sig.value = v;
        throw sig;
      case 'break':
        var sb = {}; sb[SIG] = true; sb.kind = 'break'; throw sb;
      case 'continue':
        var sc = {}; sc[SIG] = true; sc.kind = 'continue'; throw sc;
      default:
        throw new VmError('暂不支持的语句类型 ' + s.t, s.line);
    }
  };

  VM.prototype.evalRef = function* (n) {
    if (n.t === 'id') return { kind: 'var', name: n.v, line: n.line };
    if (n.t === 'deref') {
      var pv = yield* this.evalExpr(n.e);
      if (pv && pv.__ref) return pv;
      if (Array.isArray(pv)) return { kind: 'elem', arr: pv, idx: 0, line: n.line };
      throw new VmError('“*” 前面不是指针：仿真里的指针要由 &变量、&数组元素或字符串得到', n.line);
    }
    if (n.t === 'member') {
      var base = yield* this.evalExpr(n.obj);
      if (!base || typeof base !== 'object' || Array.isArray(base)) {
        throw new VmError('「' + n.name + '」前面不是结构体变量', n.line);
      }
      if (!Object.prototype.hasOwnProperty.call(base, n.name)) {
        throw new VmError('结构体里没有成员「' + n.name + '」', n.line);
      }
      return { kind: 'member', obj: base, name: n.name, line: n.line };
    }
    if (n.t === 'index') {
      var arr = yield* this.evalExpr(n.obj);
      var idx = yield* this.evalExpr(n.index);
      if (arr && arr.__ref) {
        if (arr.kind !== 'elem') throw new VmError('这个指针没有可用的下标（只有指向数组元素的指针能这样用）', n.line);
        idx = arr.idx + (idx | 0);
        arr = arr.arr;
      }
      if (!Array.isArray(arr)) throw new VmError('只有数组才能用下标', n.line);
      idx = idx | 0;
      if (idx < 0 || idx >= arr.length) {
        throw new VmError('数组越界：这个数组只有 ' + arr.length + ' 项（下标 0~' + (arr.length - 1) + '），却用了下标 ' + idx, n.line);
      }
      return { kind: 'elem', arr: arr, idx: idx, line: n.line };
    }
    throw new VmError('这个表达式的结果不能被赋值', n.line);
  };

  VM.prototype.evalExpr = function* (n) {
    var a, b, ref, old;
    switch (n.t) {
      case 'num': return n.v;
      case 'str':
        var codes = [];
        for (var i = 0; i < n.v.length; i++) codes.push(n.v.charCodeAt(i) & 0xFF);
        codes.push(0);
        return codes;
      case 'id': return this.getVar(n.v, n.line);
      case 'cast': return coerce(n.type, yield* this.evalExpr(n.e));
      case 'addr':
        var r = yield* this.evalRef(n.e);
        r.__ref = true;                 /* 指针值 = 带标记的引用 */
        return r;
      case 'deref':
        ref = yield* this.evalRef(n);
        return this.refGet(ref);
      case 'index':
      case 'member':
        ref = yield* this.evalRef(n);
        return this.refGet(ref);
      case 'call':
        var args = [];
        for (var k = 0; k < n.args.length; k++) args.push(yield* this.evalExpr(n.args[k]));
        return yield* this.callFunction(n.name, args, n.line);
      case 'assign':
        ref = yield* this.evalRef(n.left);
        a = yield* this.evalExpr(n.right);
        if (n.op !== '=') {
          old = this.refGet(ref);
          a = this.binOp(n.op.slice(0, -1), old, a);
        }
        this.refSet(ref, a);
        return this.refGet(ref);
      case 'cond':
        return truthy(yield* this.evalExpr(n.c)) ? yield* this.evalExpr(n.a) : yield* this.evalExpr(n.b);
      case 'un':
        a = yield* this.evalExpr(n.e);
        if (n.op === '-') return -a;
        if (n.op === '+') return +a;
        if (n.op === '!') return truthy(a) ? 0 : 1;
        if (n.op === '~') return ~a;
        throw new VmError('不支持的一元运算符 ' + n.op, n.line);
      case 'pre':
        ref = yield* this.evalRef(n.e);
        a = this.incValue(this.refGet(ref), n.op === '++' ? 1 : -1, n.line);
        this.refSet(ref, a);
        return a;
      case 'post':
        ref = yield* this.evalRef(n.e);
        old = this.refGet(ref);
        this.refSet(ref, this.incValue(old, n.op === '++' ? 1 : -1, n.line));
        return old;
      case 'bin':
        if (n.op === '&&') {
          a = yield* this.evalExpr(n.left);
          if (!truthy(a)) return 0;
          return truthy(yield* this.evalExpr(n.right)) ? 1 : 0;
        }
        if (n.op === '||') {
          a = yield* this.evalExpr(n.left);
          if (truthy(a)) return 1;
          return truthy(yield* this.evalExpr(n.right)) ? 1 : 0;
        }
        a = yield* this.evalExpr(n.left);
        b = yield* this.evalExpr(n.right);
        return this.binOp(n.op, a, b, exprIsFloat(this, n));
      default:
        throw new VmError('暂不支持的表达式 ' + n.t, n.line);
    }
  };

  VM.prototype.binOp = function (op, a, b, isFloat) {
    if ((a && a.__ref) || (b && b.__ref)) return this.ptrOp(op, a, b);
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new VmError('除以 0：请检查除数是否可能为零', this.line);
        return isFloat ? a / b : Math.trunc(a / b);
      case '%':
        if (b === 0) throw new VmError('对 0 取余', this.line);
        return a % b;
      case '<<': return a << b;
      case '>>': return a >> b;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      default: throw new VmError('暂不支持的运算符 ' + op, this.line);
    }
  };

  /* 驱动一帧：最多 stepsBudget 条语句、timeBudget 毫秒虚拟时间 */
  VM.prototype.pump = function (stepsBudget, timeBudget, shouldStop) {
    var steps = 0, timeUsed = 0;
    while (steps < stepsBudget && !this.done && !this.error) {
      if (this.waitMs > 0) {
        var remaining = timeBudget - timeUsed;
        if (remaining <= 0) break;
        var c = Math.min(this.waitMs, remaining);
        this.waitMs -= c;
        this.vtime += c;
        timeUsed += c;
        if (this.waitMs > 0.0001) break;
        this.waitMs = 0;
      }
      var r;
      try {
        r = this.gen.next();
      } catch (e) {
        this.error = e instanceof VmError ? e.toString() : ('运行出错：' + (e.message || e));
        this.done = true;
        break;
      }
      if (r.done) { this.done = true; break; }
      steps++;
      if (r.value && r.value.wait !== undefined) this.waitMs = r.value.wait;
      /* 断点/单步：每执行完一条语句问一次要不要停，停的位置是“下一条语句执行前” */
      if (shouldStop && shouldStop(this)) {
        return { steps: steps, timeUsed: timeUsed, stopped: true };
      }
    }
    return { steps: steps, timeUsed: timeUsed, stopped: false };
  };

  /* ---------------- 工程级编译：逐文件解析 + 链接 ---------------- */
  function baseName(p) { return String(p).split('/').pop(); }
  function cmpName(a, b) {
    return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  }
  function rankOf(p) { return /(^|\/)main\.c$/i.test(p) ? 1 : 0; }

  function walkAst(node, fn) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(function (x) { walkAst(x, fn); }); return; }
    fn(node);
    Object.keys(node).forEach(function (k) { walkAst(node[k], fn); });
  }
  function shiftLines(ast, offset) {
    walkAst(ast, function (n) {
      if (typeof n.line === 'number' && n.line > 0) n.line += offset;
    });
  }
  function renameSymbols(ast, nameMap) {
    if (!Object.keys(nameMap).length) return;
    walkAst(ast, function (n) {
      if (n.t === 'id' && nameMap[n.v]) n.v = nameMap[n.v];
      else if (n.t === 'call' && nameMap[n.name]) n.name = nameMap[n.name];
      else if ((n.t === 'func' || n.t === 'sbit' || n.t === 'sfr') && nameMap[n.name]) n.name = nameMap[n.name];
      else if (n.t === 'globaldecl' && n.vars) {
        n.vars.forEach(function (v) { if (nameMap[v.name]) v.name = nameMap[v.name]; });
      }
    });
  }

  /* 把一个 .c 展开成翻译单元：工程内的 #include "x.h" 就地展开，
     同一头文件在一个单元里只展开一次；系统头留空行占位。
     每行都记着它在原文件里的行号，编译错误才能定位回具体文件。 */
  function expandUnit(file, files) {
    var byPath = {}, byBase = {};
    files.forEach(function (f) {
      if (!/\.h$/i.test(f.path)) return;
      byPath[f.path] = f;
      var b = baseName(f.path).toLowerCase();
      if (!byBase[b]) byBase[b] = f;
    });
    var out = [], map = [], seen = {}, missing = [];
    function pushLine(text, f, line) { out.push(text); map.push({ file: f, line: line }); }
    function walk(f, depth) {
      if (depth > 8) return;
      String(f.content == null ? '' : f.content).replace(/\r\n?/g, '\n').split('\n').forEach(function (row, i) {
        var m = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/.exec(row);
        if (!m) { pushLine(row, f.path, i + 1); return; }
        var hit = byPath[m[2]] || byBase[baseName(m[2]).toLowerCase()];
        if (!hit) {
          pushLine('', f.path, i + 1);
          /* 引号头找不到是错误；尖括号头只有内置系统头可以放行，
             自定义头（headfile.h、led.h 等）找不到也必须报错。 */
          if (m[1] === '"' || !isSystemHeader(m[2])) {
            missing.push({ file: f.path, line: i + 1, name: m[2] });
          }
          return;
        }
        if (seen[hit.path]) { pushLine('', f.path, i + 1); return; }
        seen[hit.path] = 1;
        pushLine('/* ===== ' + hit.path + ' ===== */', f.path, i + 1);
        walk(hit, depth + 1);
      });
    }
    walk(file, 0);
    return { path: file.path, src: out.join('\n'), lines: out.length, map: map, missing: missing };
  }

  /* files: [{path, content}] → 可执行的合并 AST。
     static 符号按文件改名隔离；重名定义报错；调用没有定义的函数按硬错误处理。 */
  function compileProject(files) {
    var srcs = (files || []).filter(function (f) { return /\.(c|inc)$/i.test(f.path); });
    srcs.sort(function (a, b) { return rankOf(a.path) - rankOf(b.path) || cmpName(a.path, b.path); });
    var units = [], errors = [], warnings = [], map = [], body = [], offset = 0;

    srcs.forEach(function (f, i) {
      var u = expandUnit(f, files);
      u.idx = i;
      try {
        u.ast = parseUnit(u.src);
      } catch (e) {
        var ln = (e && e.line) || 0;
        var r = u.map[ln - 1];
        errors.push({ file: f.path, line: r ? r.line : ln, msg: e && e.message ? e.message : String(e) });
        u.ast = null;
      }
      units.push(u);
    });

    units.forEach(function (u) {
      if (u.ast) {
        var statics = {};
        u.ast.body.forEach(function (d) {
          if (d.t === 'func' && d.stat) statics[d.name] = 1;
          if (d.t === 'globaldecl') d.vars.forEach(function (v) { if (v.stat) statics[v.name] = 1; });
        });
        var nameMap = {};
        Object.keys(statics).forEach(function (n) { nameMap[n] = n + '$' + u.idx; });
        renameSymbols(u.ast, nameMap);
        shiftLines(u.ast, offset);
      }
      map = map.concat(u.map);
      offset += u.lines;
      if (u.ast) u.ast.body.forEach(function (d) { body.push(d); });
    });

    function where(line) {
      var r = map[(line || 0) - 1];
      return r ? { file: r.file, line: r.line } : { file: '', line: line || 0 };
    }

    var defined = {};
    function declare(name, loc, kind) {
      if (!name) return;
      if (defined[name]) {
        var hint = /\.h$/i.test(loc.file)
          ? '（定义写在头文件里，会被每个包含它的 .c 各复制一份；把定义放回 .c，头文件里只留 extern 声明）'
          : '';
        errors.push({
          file: loc.file, line: loc.line,
          msg: kind + '「' + name + '」重复定义：' + loc.file + '(' + loc.line + ') 与 '
            + defined[name].file + '(' + defined[name].line + ')' + hint
        });
        return;
      }
      defined[name] = loc;
    }
    var regKey = {};
    var externRef = {};
    var drop = [];
    body.forEach(function (d) {
      if (d.t === 'func') {
        declare(d.name, where(d.line), '函数');
      } else if (d.t === 'globaldecl') {
        var lg = where(d.line);
        d.vars.forEach(function (v) {
          if (v.ext) {
            /* extern 只是声明，不进定义表；最后再检查有没有人真的定义它 */
            externRef[v.name] = lg;
            drop.push(d);
            return;
          }
          declare(v.name, lg, '变量');
        });
      } else if (d.t === 'sbit' || d.t === 'sfr') {
        var ls = where(d.line);
        var key = d.t === 'sbit' ? ('sbit ' + d.port + '^' + d.bit) : ('sfr ' + d.name);
        if (regKey[d.name] !== undefined) {
          /* 头文件被多个 .c 包含时，同一条 sbit 会出现很多次，属于重复声明 */
          if (regKey[d.name] !== key) {
            errors.push({
              file: ls.file, line: ls.line,
              msg: '寄存器「' + d.name + '」在两处定义不一致：' + ls.file + '(' + ls.line + ') 与 '
                + defined[d.name].file + '(' + defined[d.name].line + ')'
            });
          }
          drop.push(d);
          return;
        }
        regKey[d.name] = key;
        declare(d.name, ls, '寄存器位');
      }
    });
    if (drop.length) {
      body = body.filter(function (d) { return drop.indexOf(d) < 0; });
    }

    var missSeen = {};
    units.forEach(function (u) {
      (u.missing || []).forEach(function (mi) {
        var key = mi.file + ':' + mi.name;
        if (missSeen[key]) return;
        missSeen[key] = 1;
        errors.push({ file: mi.file, line: mi.line, msg: '找不到头文件「' + mi.name + '」' });
      });
    });

    Object.keys(externRef).forEach(function (n) {
      if (defined[n]) return;
      errors.push({
        file: externRef[n].file, line: externRef[n].line,
        msg: '变量「' + n + '」声明为 extern，但工程里没有它的定义'
      });
    });

    if (!defined.main) {
      errors.push({ file: 'main.c', line: 0, msg: '没有找到 main 函数：工程里需要一个 void main() 作为入口' });
    }

    var builtin = {};
    Object.keys(BUILTINS).forEach(function (n) { builtin[n] = 1; });
    var warned = {};
    body.forEach(function (d) {
      walkAst(d, function (n) {
        if (n.t !== 'call' || !n.name) return;
        if (defined[n.name] || builtin[n.name] || warned[n.name]) return;
        warned[n.name] = 1;
        var w = where(n.line);
        errors.push({
          file: w.file, line: w.line,
          msg: '函数「' + n.name + '」没有定义；Keil 链接会失败，运行到这一句也会出错'
        });
      });
    });

    return {
      ast: { t: 'program', body: body },
      map: map, units: units, errors: errors, warnings: warnings, count: srcs.length
    };
  }

  /* 单独编译一个 .c：预处理 + 词法 + 语法，返回 AST。
     供工程的「逐文件编译 → 链接」流程使用。 */
  function parseUnit(src) {
    return new Parser(tokenize(preprocess(src))).parseProgram();
  }

  /* 把整个工程压成一个翻译单元：工程内的头文件按包含顺序各展开一次，
     源文件排在后面（main.c 最后）。引脚板那套精简解释器只认单个文件，
     用这个函数喂它，就不必再复制一份工程级链接器。
     它不做 static 改名、也不查重复定义，所以只适合教学规模的小工程；
     调用方应先 parseUnit() 试一遍，解析失败就退回当前文件。 */
  function flattenProject(files) {
    var list = (files || []).filter(function (f) { return /\.(c|h|inc)$/i.test(f.path); });
    var byPath = {}, byBase = {};
    list.forEach(function (f) {
      if (!/\.h$/i.test(f.path)) return;
      byPath[f.path] = f;
      var b = baseName(f.path).toLowerCase();
      if (!byBase[b]) byBase[b] = f;
    });
    var out = [], seenH = {}, seenReg = {};
    function emit(f) {
      out.push('/* ===== ' + f.path + ' ===== */');
      String(f.content == null ? '' : f.content).replace(/\r\n?/g, '\n').split('\n').forEach(function (row) {
        var inc = /^\s*#\s*include\s*"([^"]+)"/.exec(row);
        if (inc) {
          var hit = byPath[inc[1]] || byBase[baseName(inc[1]).toLowerCase()];
          if (hit) { emitHeader(hit, 0); return; }
          out.push('');
          return;
        }
        /* 头文件被多个 .c 包含时 sbit / sfr 会重复声明，按声明内容去重 */
        var reg = /^\s*(?:sbit|sfr)\s+([^;]+);/.exec(row);
        if (reg) {
          var key = reg[1].replace(/\s+/g, '');
          if (seenReg[key]) { out.push(''); return; }
          seenReg[key] = 1;
        }
        out.push(row);
      });
    }
    function emitHeader(h, depth) {
      if (!h || depth > 8 || seenH[h.path]) return;
      seenH[h.path] = 1;
      emit(h);
    }
    list.filter(function (f) { return /\.h$/i.test(f.path); }).forEach(function (h) { emitHeader(h, 0); });
    var srcs = list.filter(function (f) { return !/\.h$/i.test(f.path); });
    srcs.sort(function (a, b) { return rankOf(a.path) - rankOf(b.path) || cmpName(a.path, b.path); });
    srcs.forEach(function (f) { emit(f); });
    return out.join('\n');
  }

  return { VM: VM, VmError: VmError, preprocess: preprocess, tokenize: tokenize,
           parseUnit: parseUnit, compileProject: compileProject, flattenProject: flattenProject,
           builtinNames: Object.keys(BUILTINS),
           sfrNames: SFR_NAMES.slice(), bitNames: Object.keys(BIT_ALIAS) };
});

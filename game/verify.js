// GhostEcho 自動驗證 — 用腳本輸入逐幀驅動 core.js 的同一套物理與判定(60fps 固定步進; 遊戲本體 game.js 用的也是 core.js)。
// 執行: node game/verify.js [all|terrain|expected|variants|shortcuts|only|windows|gate] [1~4] [--fast]
//   不帶參數 = 全跑(約 5~10 分鐘); 帶關卡編號只跑那一關; --fast 以較粗的步長掃描(站位 0.2 格 / 幽靈變體每 2~3 幀)。
// 結構: 1) 腳本 DSL + runLife(逐幀) 2) 各關預期解腳本(SC) 3) 落地餘量 / 執行窗 4) 捷徑掃描零件(famHead / famHookStand / famHookAir)
//       5) 各關捷徑(SHORT) / 變體 / 只紀錄 6) 通關條件門檻校正 7) 報告。地形參數與通關門檻寫在 core.js(PARAMS / GATE)。
'use strict';
var Core = require('./core.js');
var FPS = 60, EPS = 1e-6;

// ------------------------------------------------------------------ 腳本 DSL
// 每個步驟 {n:名稱, c:條件(P,ctx), hold:-1|0|1, jump:true, hook:true, jh:n}
// 條件評估在「上一幀算完」的狀態上, 動作作用在下一幀。
function dsc(fn, text) { fn.desc = text; return fn; }
var C = {
  x: function (v) { return dsc(function (P) { return P.x >= v - EPS; }, '中心 x 到 ' + v); },
  xl: function (v) { return dsc(function (P) { return P.x <= v + EPS; }, '中心 x 退到 ' + v); },
  t: function (sec) { var n = Math.round(sec * FPS); return dsc(function (P) { return P.k + 1 >= n; }, sec.toFixed(2) + ' 秒'); },
  tf: function (n) { return dsc(function (P) { return P.k + 1 >= n; }, '第 ' + n + ' 幀'); },
  af: function (n) { return dsc(function (P, c) { return P.k - c.last >= n; }, '前一步後 ' + n + ' 幀'); },
  now: dsc(function () { return true; }, '出生'),
  gnd: dsc(function (P) { return P.grounded && !P.pulling; }, '站立'),
  air: dsc(function (P) { return !P.grounded && !P.pulling; }, '騰空'),
  onGhost: dsc(function (P) { return P.grounded && P.onGhost; }, '站在幽靈頭頂'),
  notPulling: dsc(function (P) { return !P.pulling; }, '拉動結束'),
  and: function () { var f = arguments, d = []; for (var j = 0; j < f.length; j++) if (f[j].desc) d.push(f[j].desc); return dsc(function (P, c) { for (var i = 0; i < f.length; i++) if (!f[i](P, c)) return false; return true; }, d.join(' 且 ')); }
};
function S(n, c, a) { var o = { n: n, c: c }; for (var k in a) o[k] = a[k]; return o; }

// 跑一條命。回傳統計。opts: {target:{col,h}}, 紀錄輸入以便反事實重播
function runLife(lv, E, steps, opts) {
  opts = opts || {};
  var P = Core.newPlayer(lv), dir = 0, idx = 0, ctx = { last: 0 };
  var fire = {}, jh = 0;
  var st = { maxH: P.h, maxXAbove: null, stood: false, trace: null };
  var tgt = opts.target;
  var inputs = opts.margins ? [] : null, snaps = opts.margins ? [] : null;
  var xs = [P.x], hs = [P.h], gk = [1], fc = [1];
  var segStart = null, segs = opts.margins ? [] : null;
  var wasGround = true;
  var evh = opts.ev || null;
  var kmax = Core.REC_LIMIT + 5;
  while (!P.dead && !P.goal && P.k < kmax) {
    var jump = false, hook = false;
    while (idx < steps.length && steps[idx].c(P, ctx)) {
      var a = steps[idx];
      if (a.hold !== undefined) dir = typeof a.hold === 'function' ? a.hold(P) : a.hold;
      if (a.jump) { jump = true; jh = a.jh || 1; }
      if (a.hook) hook = true;
      if (a.n) fire[a.n] = P.k + 1;
      ctx.last = P.k; idx++;
      if (a.jump || a.hook) break;
    }
    var held = jh > 0; if (jh > 0) jh--;
    if (opts.margins) { snaps.push(Core.clonePlayer(P)); inputs.push([dir, jump, hook, held]); }
    Core.stepPlayer(P, dir, jump, hook, held, E, evh);
    xs.push(P.x); hs.push(P.h); gk.push(P.grounded ? (P.onGhost ? 2 : 1) : 0); fc.push(P.fc);
    if (P.h > st.maxH) st.maxH = P.h;
    if (tgt) {
      if (P.h >= tgt.h - EPS && (st.maxXAbove === null || P.x > st.maxXAbove)) st.maxXAbove = P.x;
      if (P.grounded && !P.onGhost && P.h >= tgt.h - EPS && Math.floor(P.x + 1e-9) >= tgt.col) st.stood = true;
    }
  }
  st.goal = P.goal; st.dead = P.dead; st.k = P.k; st.fire = fire; st.idxDone = idx; st.nsteps = steps.length;
  st.P = P;
  st.rec = Core.buildRec(new Float64Array(xs), new Float64Array(hs), new Uint8Array(gk), new Int8Array(fc));
  if (opts.margins) { st.inputs = inputs; st.snaps = snaps; }
  return st;
}

// 連跑 3 名角色(或少於 3), 後一名用前一名實際錄出的幽靈。scripts[i] = 角色 i+1 的步驟; 回傳 {lives:[st...], rec}
function runSeq(lv, scripts, opts) {
  opts = opts || {};
  var lives = [], rec = null;
  for (var i = 0; i < scripts.length; i++) {
    var E = Core.makeE(lv, rec);
    var st = runLife(lv, E, scripts[i], i === scripts.length - 1 ? opts : { target: opts.target, margins: opts.margins });
    lives.push(st); rec = st.rec;
    if (st.goal && i < scripts.length - 1) break;
  }
  return { lives: lives, last: lives[lives.length - 1] };
}

// ------------------------------------------------------------------ 各關預期解腳本
// 參數 p 可覆寫位置 / 時刻; p.ov = {步驟名: 絕對幀} 把該步驟的觸發改成「第 N 幀」(其餘條件不留), 用於執行窗掃描
function D(p, d) { p = p || {}; var o = {}, k; for (k in d) o[k] = d[k]; for (k in p) o[k] = p[k]; return o; }
function mk(p, list) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i], cond = e[1];
    if (p.ov && p.ov[e[0]] !== undefined) cond = C.tf(p.ov[e[0]]);
    var a = e[2], st = { n: e[0], c: cond, desc: (p.ov && p.ov[e[0]] !== undefined) ? ('第 ' + p.ov[e[0]] + ' 幀') : (cond.desc || '') };
    for (var k in a) st[k] = a[k];
    out.push(st);
  }
  return out;
}
var R = { hold: 1 }, N0 = { hold: 0 }, JR = { jump: true, hold: 1 }, J = { jump: true }, HK = { hook: true };
var afterPull = dsc(function (P) { return !P.pulling && P.hookUsed && !P.grounded; }, '拉動結束');

var SC = {};

// ---- 第 1 關
SC[1] = {
  target: function (lv) { return { col: lv.info.platCol, h: 5 }; },
  defaults: function (lv) { return { dx: lv.params.s || 0, dg: lv.params.g || 0 }; },
  c1: function (p) {
    p = D(p, { dx: 0, dg: 0, sA: 23.5, sB: 26.5, tGo: 4.0 });
    return mk(p, [
      ['born', C.now, R], ['j1', C.and(C.x(9.6), C.gnd), J], ['j2', C.and(C.x(17.6), C.gnd), J],
      ['stopA', C.x(p.sA + p.dx), N0], ['goB', C.t(p.tGo), R], ['stopB', C.x(p.sB + p.dx + p.dg), N0]
    ]);
  },
  c2: function (p) {
    p = D(p, { dx: 0, dg: 0, sA: 23.5, sB: 25.5, tGo: 4.0, tJ: 4.55, rel: 10, tJ2: 5.4 });
    return mk(p, [
      ['born', C.now, R], ['j1', C.and(C.x(9.6), C.gnd), J], ['j2', C.and(C.x(17.6), C.gnd), J],
      ['stopA', C.x(p.sA + p.dx), N0], ['goB', C.t(p.tGo), R], ['stopB', C.x(p.sB + p.dx + p.dg), N0],
      ['jh', C.t(p.tJ), JR], ['rel', C.af(p.rel), N0], ['j3', C.and(C.t(p.tJ2), C.onGhost), JR]
    ]);
  }
};

// ---- 第 2 關
SC[2] = {
  target: function (lv) { return { col: lv.info.platCol, h: 13 }; },
  defaults: function (lv) { return { dz: lv.params.sl - 25 }; },
  c1: function (p) {
    p = D(p, { dz: 0 });
    return mk(p, [
      ['born', C.now, R], ['j1', C.and(C.x(7.6), C.gnd), J], ['stop', C.x(13.4), N0],
      ['jmp', C.t(5.0), JR], ['rel', C.x(15.5), N0]
    ]);
  },
  c2: function (p) {
    p = D(p, { dz: 0, relA: 14.5, tJ2: 6.8, relB: 15.5, tJ3: 7.6, tGo: 10.0, relC: p._lv.params.sl + 3.0 });
    return mk(p, [
      ['born', C.now, R], ['j1', C.and(C.x(7.6), C.gnd), J], ['stop', C.x(13.4), N0],
      ['jmp', C.t(5.0), JR], ['relA', C.x(p.relA), N0],
      ['jmp2', C.and(C.t(p.tJ2), C.gnd), JR], ['relB', C.x(p.relB), N0],
      ['jmp3', C.and(C.t(p.tJ3), C.onGhost), JR], ['stopB', C.x(24.5 + p.dz), N0],
      ['goC', C.t(p.tGo), R], ['stopD', C.x(p.relC), N0]
    ]);
  },
  c3: function (p) {
    p = D(p, { dz: 0, relA: 14.3, tJ2: 5.65, tJ3: 6.45, tJ4: 10.4, relB: p._lv.params.sl + 3.4, tJ5: 11.3 });
    return mk(p, [
      ['born', C.now, R], ['j1', C.and(C.x(7.6), C.gnd), J], ['stop', C.x(13.4), N0],
      ['jmp', C.t(5.0), JR], ['relA', C.x(p.relA), N0],
      ['jmp2', C.and(C.t(p.tJ2), C.gnd), J], ['jmp3', C.and(C.t(p.tJ3), C.onGhost), JR],
      ['stopB', C.x(24.5 + p.dz), N0],
      ['jmp4', C.and(C.t(p.tJ4), C.gnd), JR], ['relC', C.x(p.relB), N0],
      ['jmp5', C.and(C.t(p.tJ5), C.onGhost), JR]
    ]);
  }
};

// ---- 第 3 關
function s3pre(p) {
  return [['born', C.now, R], ['stopS', C.x(3.7), N0], ['goS', C.t(2.0), R]];
}
SC[3] = {
  target: function (lv) { return { col: lv.info.bCol, h: 7.5 }; },
  defaults: function (lv) { return {}; },
  c1: function (p) {
    p = D(p, { jx: p._lv.info.stump[1] - 0.2 });
    return mk(p, s3pre(p).concat([['jmp', C.and(C.x(p.jx), C.gnd), JR]]));
  },
  c2: function (p) {
    p = D(p, { zx: p._lv.info.zone[0] - 0.1, sx: 9.9, tX: 3.93, tGo: 10.0, relD: p._lv.info.zone[0] + 3.0 });
    return mk(p, s3pre(p).concat([
      ['stopE', C.x(p.sx), N0], ['hk', C.t(p.tX), HK], ['jmp', afterPull, JR],
      ['stopB', C.x(p.zx), N0], ['goC', C.t(p.tGo), R], ['stopD', C.x(p.relD), N0]
    ]));
  },
  c3: function (p) {
    p = D(p, { zx: p._lv.info.zone[0] - 0.5, sx: 9.9, tJ: 3.35, tX: 4.25, tJ2: 10.2, relD: p._lv.info.zone[0] + 3.4, tJ3: 11.2 });
    return mk(p, s3pre(p).concat([
      ['stopE', C.x(p.sx), N0], ['jmpA', C.and(C.t(p.tJ), C.gnd), JR], ['hk', C.t(p.tX), HK], ['jmp', afterPull, JR],
      ['stopB', C.x(p.zx), N0], ['jmp2', C.and(C.t(p.tJ2), C.gnd), JR], ['relD', C.x(p.relD), N0],
      ['jmp3', C.and(C.t(p.tJ3), C.onGhost), JR]
    ]));
  }
};

// ---- 第 4 關
function s4pre(p) {
  return [['born', C.now, R], ['j1', C.and(C.x(5.9), C.gnd), J], ['j2', C.and(C.t(6.0), C.gnd), J]];
}
SC[4] = {
  target: function (lv) { return { col: lv.info.platCol, h: 16 }; },
  defaults: function (lv) { return {}; },
  c1: function (p) {
    p = D(p, { relA: 14.5 });
    return mk(p, s4pre(p).concat([['relA', C.x(p.relA), N0]]));
  },
  c2: function (p) {
    p = D(p, { relA: 13.5, tJ3: 6.65, relB: 14.5, tJ4: 7.45, tJ5: 12.0, jx: p._lv.info.stump[0] + 2.5 });
    return mk(p, s4pre(p).concat([
      ['relA', C.x(p.relA), N0], ['jmp3', C.and(C.t(p.tJ3), C.gnd), JR], ['relB', C.x(p.relB), N0],
      ['jmp4', C.and(C.t(p.tJ4), C.onGhost), JR], ['relC', C.and(C.gnd, C.x(17)), N0],
      ['jmp5', C.and(C.t(p.tJ5), C.gnd), JR], ['stopJ', C.x(p.jx), N0], ['jmp6', C.gnd, JR]
    ]));
  },
  c3: function (p) {
    p = D(p, { relA: 13.5, tX1: 7.60, relB: 18.0, tJ5: 12.0, relC: p._lv.info.zone[1] + 0.9, tJ6: 13.67, relD: p._lv.info.stump[0] + 4.0, tX2: 14.85 });
    return mk(p, s4pre(p).concat([
      ['relA', C.x(p.relA), N0], ['hk1', C.t(p.tX1), HK], ['jmp4', afterPull, JR], ['relB', C.x(p.relB), N0],
      ['jmp5', C.and(C.t(p.tJ5), C.gnd), JR], ['relC', C.x(p.relC), N0], ['jmp6', C.and(C.t(p.tJ6), C.gnd), JR],
      ['relD', C.x(p.relD), N0], ['hk2', C.t(p.tX2), HK], ['jmp7', afterPull, JR]
    ]));
  }
};

// 跑預期解: 回傳 {lives, last}。reuse = {n, lives}: 前 n 名沿用已跑好的結果(執行窗掃描用, 省時間)
function runExpected(lv, p, ovs, reuse) {
  var s = SC[lv.id];
  var dflt = s.defaults(lv);
  var runners = lv.id === 1 ? ['c1', 'c2'] : ['c1', 'c2', 'c3'];
  var lives = [], rec = null, tgt = s.target(lv);
  for (var i = 0; i < runners.length; i++) {
    if (reuse && i < reuse.n) { lives.push(reuse.lives[i]); rec = reuse.lives[i].rec; continue; }
    var pp = D(p && p[runners[i]], dflt); pp._lv = lv;
    if (ovs && ovs[runners[i]]) pp.ov = ovs[runners[i]];
    var st = runLife(lv, Core.makeE(lv, rec), s[runners[i]](pp), { target: tgt, margins: !!(p && p.margins) });
    lives.push(st); rec = st.rec;
    if (st.goal && i < runners.length - 1) break;
  }
  return { lives: lives, last: lives[lives.length - 1] };
}

// ------------------------------------------------------------------ 預期解落地餘量
// 對一條命(需以 margins:true 跑出)的每一段「落上不比起跳面低的目標」量:
//  高度餘量 = 該段最高腳底 - 目標面高度
//  水平餘量 = 同一段方向鍵全速(往行進方向)時, 腳底仍在目標面高度以上的最遠中心 x - 站上目標所需最小中心 x
function blockEdges(lv, c) {
  var h = lv.cols[c], a = c, b = c;
  while (a - 1 >= 0 && lv.cols[a - 1] === h) a--;
  while (b + 1 < 40 && lv.cols[b + 1] === h) b++;
  return [a, b + 1];
}
function landingMargins(lv, E, life) {
  var r = life.rec, out = [], n = r.n, i;
  // 以「離地 → 落地」切段
  i = 1;
  while (i < n) {
    if (!(r.gk[i] === 0 && r.gk[i - 1] !== 0)) { i++; continue; }
    var s = i, e = i;
    while (e < n && r.gk[e] === 0) e++;
    var goalEnd = false;
    if (e >= n) { if (!life.goal) break; e = n - 1; goalEnd = true; }   // 沒落地: 死了不計; 空中碰旗過關當作落上旗下那塊地
    var seg = { s: s, e: e, kind: goalEnd ? 1 : r.gk[e] };
    var takeKind = r.gk[s - 1], takeX = r.xs[s - 1], takeH = r.hs[s - 1];
    var tH = goalEnd ? lv.goalH : r.hs[e], dirv = 1, needX, edges;
    // 行進方向: 起跳到落地 x 位移
    if (r.xs[e] < r.xs[s - 1] - 1e-9) dirv = -1;
    if (goalEnd) {
      edges = blockEdges(lv, lv.goalCol);
      needX = edges[0];
    } else if (r.gk[e] === 1) {
      edges = blockEdges(lv, Core.colOf(r.xs[e]));
      needX = dirv > 0 ? edges[0] : edges[1];
    } else {
      needX = dirv > 0 ? r.xs[e] - 0.5 : r.xs[e] + 0.5;   // 以落上那一幀幽靈頭頂位置計
    }
    var skip = tH < takeH - 1e-9;
    if (!skip && takeKind === 1 && r.gk[e] === 1) {
      var tb = blockEdges(lv, Core.colOf(takeX)), lb = blockEdges(lv, Core.colOf(r.xs[e]));
      if (tb[0] === lb[0] && lv.cols[Core.colOf(takeX)] === tH) skip = true;   // 同一塊地
    }
    if (!skip) {
      var mh = -1e9;
      for (var q = s; q <= e; q++) if (r.hs[q] > mh) mh = r.hs[q];
      // 反事實重播: 從離地前一幀的狀態, 沿用原輸入、方向改成全速行進方向
      var P = Core.clonePlayer(life.snaps[s - 1]);
      var far = -1e9, farLeft = 1e9, f = s - 1, rmax = -1e9;
      for (var guard = 0; guard < 400; guard++) {
        var inp = life.inputs[f] || [dirv, false, false, false];
        Core.stepPlayer(P, dirv, inp[1], inp[2], inp[3], E, null);
        f++;
        if (P.h > rmax) rmax = P.h;
        if (P.dead) { if (P.h >= tH - 1e-9) { far = Math.max(far, P.x); farLeft = Math.min(farLeft, P.x); } break; }
        if (P.h >= tH - 1e-9) { far = Math.max(far, P.x); farLeft = Math.min(farLeft, P.x); }
        if (f > e && (P.grounded || (P.vy < 0 && P.h < tH - 1e-9))) break;
        if (P.grounded && f > s) break;
      }
      var xm = dirv > 0 ? far - needX : needX - farLeft;
      if (goalEnd && rmax > mh) mh = rmax;   // 空中碰旗提早結束, 高度取不被打斷的完整跳
      seg.hMargin = mh - tH; seg.xMargin = xm; seg.tH = tH; seg.needX = needX; seg.far = far;
      seg.t = s / FPS; seg.tl = e / FPS; seg.dir = dirv;
      out.push(seg);
    }
    i = e;
  }
  return out;
}

// ------------------------------------------------------------------ 執行窗
// 時間窗: 固定其餘輸入, 只把某一步的觸發改成「第 f 幀」, f 以 nominal 為中心逐幀前後移動, 記錄可過關的連續幀數。
// 只有「該步真的在第 f 幀觸發」才算(否則是被前一步卡住、等效於同一個動作, 會灌水)。
var RUNNER_IDX = { c1: 0, c2: 1, c3: 2 };
function longestRun(arr) {            // arr: [{f, ok}] 依 f 遞增; 回傳最長連續成功 {a, b, len}
  var best = null, cur = null;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].ok && cur && arr[i].f === cur.b + 1) cur.b = arr[i].f;
    else if (arr[i].ok) cur = { a: arr[i].f, b: arr[i].f };
    else cur = null;
    if (cur && (!best || cur.b - cur.a > best.b - best.a)) best = { a: cur.a, b: cur.b };
  }
  if (best) best.len = best.b - best.a + 1;
  return best;
}
function cloneP(p) { return JSON.parse(JSON.stringify(p || {})); }
function setPath(p, r, key, val) { if (!p[r]) p[r] = {}; p[r][key] = val; }

// w = {r, step, stage?:{r,key,vals}} ; 回傳 {nominal, best, atNominal}
function timeWindow(lv, w, baseP, D2) {
  D2 = D2 || 240;
  var ri = RUNNER_IDX[w.r];
  var base = runExpected(lv, baseP, null);
  var life = base.lives[ri];
  if (!life || life.fire[w.step] === undefined) return null;
  var f0 = life.fire[w.step], arr = [];
  for (var d = -D2; d <= D2; d++) {
    var f = f0 + d;
    if (f < 1) continue;
    var ov = {}; ov[w.r] = {}; ov[w.r][w.step] = f;
    var res = runExpected(lv, baseP, ov, { n: ri, lives: base.lives });
    var lf = res.lives[ri];
    var ok = !!(res.last.goal && lf && lf.fire[w.step] === f);
    arr.push({ f: f, ok: ok });
  }
  var best = longestRun(arr), atN = null;
  // 含 nominal 的連續段
  var a = f0, b = f0, okMap = {};
  arr.forEach(function (e) { okMap[e.f] = e.ok; });
  if (okMap[f0]) { while (okMap[a - 1]) a--; while (okMap[b + 1]) b++; atN = { a: a, b: b, len: b - a + 1 }; }
  return { nominal: f0, best: best, atNominal: atN, baseOK: base.last.goal, runs: allRuns(arr) };
}

// 空間窗: 某個「位置觸發」數值 key 以 0.1 為步長逐步移動, 其餘輸入不變(adapt 可讓後面的角色跟著調站位)
function spaceWindow(lv, w, baseP) {
  var vals = [], x;
  for (x = w.from; x <= w.to + 1e-9; x += 0.1) vals.push(Math.round(x * 10) / 10);
  var arr = vals.map(function (v, i) {
    var p = cloneP(baseP);
    setPath(p, w.r, w.key, v);
    if (w.adapt) w.adapt(p, v, lv);
    var res = runExpected(lv, p, null);
    return { f: i, v: v, ok: !!res.last.goal };
  });
  var best = longestRun(arr);
  return { best: best, from: best ? vals[best.a] : null, to: best ? vals[best.b] : null, vals: vals, ok: arr.map(function (e) { return e.ok; }), count: arr.filter(function (e) { return e.ok; }).length };
}

// ------------------------------------------------------------------ 捷徑掃描共用零件
// 統計: 每個組合只關心「有沒有到目標」與「差多少」
function newS() { return { maxH: -1e9, maxXA: -1e9, stood: false, goal: false }; }
function copyS(s) { return { maxH: s.maxH, maxXA: s.maxXA, stood: s.stood, goal: s.goal }; }
function sstep(P, E, dir, jump, hook, held, S, tgt) {
  Core.stepPlayer(P, dir, jump, hook, held, E, null);
  if (P.h > S.maxH) S.maxH = P.h;
  if (P.h >= tgt.h - 1e-6) {
    if (P.x > S.maxXA) S.maxXA = P.x;
    if (P.grounded && !P.onGhost && Math.floor(P.x + 1e-9) >= tgt.col) S.stood = true;
  }
  if (P.goal) S.goal = true;
}
// 不足量: 到了回 -Infinity; 否則「高度不足量 / 水平不足量」較大者(沒升到目標高度時只有高度不足量)
function deficit(S, tgt) {
  if (S.stood || S.goal || S.maxXA >= tgt.col) return -Infinity;
  var hDef = tgt.h - S.maxH;
  if (hDef > 1e-6) return hDef;
  return tgt.col - S.maxXA;
}
function Agg(name) { return { name: name, n: 0, reached: 0, min: Infinity, arg: null, ex: [], maxHBest: -1e9 }; }
function aggAdd(A, S, tgt, desc) {
  A.n++;
  var d = deficit(S, tgt);
  if (d === -Infinity) {
    A.reached++;
    var dd = (A.ex.length < 6 || A.cb) ? (typeof desc === 'function' ? desc() : desc) : null;
    if (A.ex.length < 6) A.ex.push(dd);
    if (A.cb) A.cb(dd);
  }
  else if (d < A.min) { A.min = d; A.arg = typeof desc === 'function' ? desc() : desc; A.argS = copyS(S); }
}

// 跑腳本直到「全部步驟都觸發過且站穩」, 回傳 {P, S}; 中途死亡 / 過關 / 逾時回 null
function prepare(lv, E, steps, tgt) {
  var P = Core.newPlayer(lv), dir = 0, idx = 0, ctx = { last: 0 }, S = newS(), jh = 0, settle = 0;
  S.maxH = P.h;
  for (var guard = 0; guard < 2000; guard++) {
    var jump = false, hook = false;
    while (idx < steps.length && steps[idx].c(P, ctx)) {
      var a = steps[idx];
      if (a.hold !== undefined) dir = typeof a.hold === 'function' ? a.hold(P) : a.hold;
      if (a.jump) { jump = true; jh = a.jh || 1; }
      if (a.hook) hook = true;
      ctx.last = P.k; idx++;
      if (a.jump || a.hook) break;
    }
    var held = jh > 0; if (jh > 0) jh--;
    sstep(P, E, dir, jump, hook, held, S, tgt);
    if (P.dead || P.goal) return null;
    if (idx >= steps.length) { if (P.grounded && P.vy === 0 && !P.pulling && !jump) { settle++; if (settle >= 2) return { P: P, S: S }; } else settle = 0; }
  }
  return null;
}

// 站著等、在第 f 幀起跳, 落上幽靈頭頂後再跳。
// o: {tgt, rels:[null|n], dMax, span(掃幾幀), hold2:[1,0]}
function famHead(lv, rec, preFn, stages, o, agg, tag) {
  var E = Core.makeE(lv, rec), tgt = o.tgt;
  var rels = o.rels || [null], dMax = o.dMax || 400, modes = o.modes || [1, 0];
  for (var si = 0; si < stages.length; si++) {
    var xs = stages[si];
    var pr = o.init ? o.init(xs) : prepare(lv, E, preFn(xs), tgt);
    if (!pr) continue;
    var base = pr.P, SB = pr.S;
    var span = o.span || (E.loopLen || 600);
    var kEnd = Math.min(base.k + span, Core.REC_LIMIT - 130);
    for (var f = base.k; f < kEnd; f++) {
      if (!base.grounded || base.dead) break;
      for (var ri = 0; ri < rels.length; ri++) {
        var rel = rels[ri];
        var P = Core.clonePlayer(base), S = copyS(SB), fr = 0;
        sstep(P, E, 1, true, false, true, S, tgt); fr = 1;
        while (!P.grounded && !P.dead && !P.goal && fr < 140) {
          sstep(P, E, (rel === null || fr < rel) ? 1 : 0, false, false, false, S, tgt); fr++;
        }
        if (P.dead || P.goal || !P.onGhost) { aggAdd(agg, S, tgt, function () { return [tag, xs, f, rel]; }); continue; }
        // 站上頭頂: 再跳(等 δ 幀, 站著或按住 →)
        if (!o.needStatic) aggAdd(agg, S, tgt, function () { return [tag, xs, f, rel, 'head-stay']; });
        var gx0 = E.rec ? E.rec.xs[P.k % E.loopLen] : 0;
        for (var mi = 0; mi < modes.length; mi++) {
          var W = Core.clonePlayer(P), SW = copyS(S);
          var isStatic = true;
          for (var dl = 0; dl <= dMax; dl++) {
            if (W.dead || W.goal) break;
            var onHead = W.grounded && W.onGhost;
            if (o.needStatic && E.rec && Math.abs(E.rec.xs[W.k % E.loopLen] - gx0) > 1e-9) isStatic = false;
            if (o.needStatic && !isStatic) break;
            if (!onHead && !(o.hook && !W.grounded)) break;   // hook 模式: 離開頭頂後在空中繼續嘗試 X
            if (onHead) {
              var Q = Core.clonePlayer(W), T = copyS(SW), q = 0;
              sstep(Q, E, 1, true, false, true, T, tgt); q = 1;
              while (!Q.grounded && !Q.dead && !Q.goal && q < 140) { sstep(Q, E, 1, false, false, false, T, tgt); q++; }
              (function (dl2, mi2) { aggAdd(agg, T, tgt, function () { return [tag, xs, f, rel, 'head-jump', modes[mi2], dl2]; }); })(dl, mi);
            }
            if (o.hook && lv.hook) {
              var gg = E.loopLen ? W.k % E.loopLen : -1;
              if (Core.hookReason(W, E, gg) === 0) hookBranch(lv, E, W, SW, tgt, agg, tag + '-headhook', xs, f, { dirAtHook: modes[mi] });
            }
            sstep(W, E, modes[mi], false, false, false, SW, tgt);
          }
        }
      }
      sstep(base, E, 0, false, false, false, SB, tgt);
    }
  }
}

// 站著等、在第 f 幀按 X(第 3 關起); 鉤中後立即跳, 方向鍵 → 按住或在 0~18 幀內放開各試一次
function famHookStand(lv, rec, preFn, stages, o, agg, tag) {
  var E = Core.makeE(lv, rec), tgt = o.tgt;
  for (var si = 0; si < stages.length; si++) {
    var xs = stages[si];
    var pr = o.init ? o.init(xs) : prepare(lv, E, preFn(xs), tgt);
    if (!pr) continue;
    var base = pr.P, SB = pr.S;
    var span = o.span || (E.loopLen || 600);
    var kEnd = Math.min(base.k + span, Core.REC_LIMIT - 130);
    for (var f = base.k; f < kEnd; f++) {
      if (!base.grounded || base.dead) break;
      // 這一幀按 X 會不會鉤中: 先看看 hookReason
      var g = E.loopLen ? f % E.loopLen : -1;
      if (Core.hookReason(base, E, g) === 0) hookBranch(lv, E, base, SB, tgt, agg, tag, xs, f, o);
      sstep(base, E, 0, false, false, false, SB, tgt);
    }
  }
}
// 鉤中後的後續: 拉動中就按住空白鍵(拉動結束那一幀立刻空中跳); → 按住或在 0~18 幀內放開各試一次
function hookBranch(lv, E, P0, S0, tgt, agg, tag, xs, f, o) {
  var xk = P0.k, P = Core.clonePlayer(P0), S = copyS(S0);
  sstep(P, E, o.dirAtHook === undefined ? 0 : o.dirAtHook, false, true, false, S, tgt);   // 按 X
  var fr = 0, first = true;
  while (P.pulling && !P.dead && fr < 60) { sstep(P, E, 1, first, false, true, S, tgt); first = false; fr++; }
  if (P.dead || P.goal) { aggAdd(agg, S, tgt, function () { return [tag, xs, f, 'pull-end', 0, xk]; }); return; }
  for (var rel = -1; rel <= 18; rel++) {   // rel -1 = → 一直按住
    var Q = Core.clonePlayer(P), T = copyS(S), q = 0;
    if (Q.vy <= 0) { sstep(Q, E, 1, true, false, true, T, tgt); q = 1; }   // 拉動結束同幀沒跳成: 下一幀補跳
    while (!Q.grounded && !Q.dead && !Q.goal && q < 160) {
      sstep(Q, E, (rel < 0 || q < rel) ? 1 : 0, false, false, false, T, tgt); q++;
    }
    (function (rel2) { aggAdd(agg, T, tgt, function () { return [tag, xs, f, 'hook-jump', rel2, xk]; }); })(rel);
  }
}

// 起跳後在空中每幀 X: 起跳點 xj(站著等到 t_j 起跳, 全速 →), 在空中第 q 幀按 X
function famHookAir(lv, rec, preFn, stages, o, agg, tag) {
  var E = Core.makeE(lv, rec), tgt = o.tgt;
  for (var si = 0; si < stages.length; si++) {
    var xs = stages[si];
    var pr = o.init ? o.init(xs) : prepare(lv, E, preFn(xs), tgt);
    if (!pr) continue;
    var base = pr.P, SB = pr.S;
    var tLo = o.tLo(base.k), tHi = o.tHi(base.k);
    for (var f = base.k; f < tHi; f++) {
      if (!base.grounded || base.dead) break;
      if (f >= tLo) {
        // 起跳(全速 →), 之後每幀 X 各試一次
        var P = Core.clonePlayer(base), S = copyS(SB), q = 0;
        sstep(P, E, 1, true, false, true, S, tgt);
        while (!P.grounded && !P.dead && !P.goal && q < 140) {
          var g = E.loopLen ? P.k % E.loopLen : -1;
          if (Core.hookReason(P, E, g) === 0) {
            hookBranch(lv, E, P, S, tgt, agg, tag, xs, f, { dirAtHook: 1 });
          }
          sstep(P, E, 1, false, false, false, S, tgt); q++;
        }
        aggAdd(agg, S, tgt, function () { return [tag, xs, f, 'no-hook']; });
      }
      sstep(base, E, 0, false, false, false, SB, tgt);
    }
  }
}

function frange(a, b, st) { var o = []; for (var x = a; x <= b + 1e-9; x += (st || 0.1)) o.push(Math.round(x * 100) / 100); return o; }

// ------------------------------------------------------------------ 捷徑 第 1 關
var SHORT = {};
function st2S(st) { return { maxH: st.maxH, maxXA: st.maxXAbove === null ? -1e9 : st.maxXAbove, stood: st.stood, goal: st.goal }; }
function runPlain(lv, rec, steps, tgt) { return runLife(lv, Core.makeE(lv, rec), steps, { target: tgt }); }

SHORT[1] = function (lv, opt) {
  var I = lv.info, dx = lv.params.s || 0, tgt = { col: I.platCol, h: 5 }, out = [];
  var rels = [null]; for (var r = 0; r <= 24; r += 2) rels.push(r);
  function pre(xs) {
    var st = [['born', C.now, R]];
    if (xs >= 10) st.push(['j1', C.and(C.x(9.6), C.gnd), J]);
    if (xs >= 18) st.push(['j2', C.and(C.x(17.6), C.gnd), J]);
    if (xs >= 24 + dx) st.push(['stopA', C.x(23.5 + dx), N0], ['goB', C.t(4.0), R]);
    st.push(['stop', C.and(C.x(xs), C.gnd), N0]);
    return mk({}, st);
  }
  var stages = frange(3.0, 9.9).concat(frange(12.0, 17.9), frange(21.0, 28.4 + dx));
  // S1 少用一代
  var A1 = Agg('1-S1 少用一代');
  frange(23.0, 28.4 + dx).forEach(function (jx) {
    var st = runPlain(lv, null, mk({}, [['born', C.now, R], ['j1', C.and(C.x(9.6), C.gnd), J], ['j2', C.and(C.x(17.6), C.gnd), J], ['j3', C.and(C.x(jx), C.gnd), J]]), tgt);
    aggAdd(A1, st2S(st), tgt, function () { return ['jx=' + jx]; });
  });
  out.push(A1);
  // S2 直覺全速往右跑跳: 角色 1 不停
  var g2 = runPlain(lv, null, mk({}, [['born', C.now, R], ['j1', C.and(C.x(9.6), C.gnd), J], ['j2', C.and(C.x(17.6), C.gnd), J]]), tgt);
  var A2 = Agg('1-S2 直覺全速(幽靈 1 死於 ' + (g2.k / 60).toFixed(2) + 's)');
  famHead(lv, g2.rec, pre, stages, { tgt: tgt, rels: rels, dMax: 120 }, A2, 'S2');
  out.push(A2);
  // S3 幽靈停在刺區外
  var g3 = runPlain(lv, null, mk({}, [['born', C.now, R], ['j1', C.and(C.x(9.6), C.gnd), J], ['j2', C.and(C.x(17.6), C.gnd), J], ['stop', C.x(23.9 + dx), N0]]), tgt);
  var A3 = Agg('1-S3 幽靈停 ' + (23.9 + dx) + ' 到錄影上限(' + (g3.k / 60).toFixed(1) + 's)');
  famHead(lv, g3.rec, pre, frange(21.0, 23.9 + dx), { tgt: tgt, rels: rels, dMax: 14, span: 40 }, A3, 'S3');
  out.push(A3);
  return out;
};

// ------------------------------------------------------------------ 捷徑 第 2 關
// 取預期解某名角色的腳本; 可覆寫參數
function expScript(lv, runner, p) {
  var d = D(p, SC[lv.id].defaults(lv)); d._lv = lv;
  return SC[lv.id][runner](d);
}
// 取到某個步驟(含)為止
function upTo(steps, name) {
  var o = [];
  for (var i = 0; i < steps.length; i++) { o.push(steps[i]); if (steps[i].n === name) return o; }
  throw new Error('no step ' + name);
}
// 走到 xs 停下(往較近的一側走), 需站在地上
function stageTo(xs, name) {
  var sign = 0;
  return [
    { n: (name || 'stage') + 'Go', c: C.gnd, hold: function (P) { sign = P.x < xs - 1e-9 ? 1 : (P.x > xs + 1e-9 ? -1 : 0); return sign; } },
    { n: (name || 'stage'), c: function (P) { return P.grounded && !P.pulling && (sign === 0 || (sign > 0 ? P.x >= xs - 1e-6 : P.x <= xs + 1e-6)); }, hold: 0 }
  ];
}
function standsOn(rec, pred) { for (var i = 0; i < rec.n; i++) if (rec.gk[i] === 1 && pred(rec.xs[i], rec.hs[i])) return true; return false; }
// 幽靈頭頂延續時間之類的診斷: 該錄影站在 pred 內的幀數
function framesOn(rec, pred) { var c = 0; for (var i = 0; i < rec.n; i++) if (rec.gk[i] === 1 && pred(rec.xs[i], rec.hs[i])) c++; return c; }
function landAfter(d) {      // 落地後再等 d 幀才觸發
  var lk = -1;
  return function (P) { if (!P.grounded) return false; if (lk < 0) lk = P.k; return P.k - lk >= d; };
}

SHORT[2] = function (lv, opt) {
  opt = opt || {};
  var I = lv.info, sl = lv.params.sl, dz = sl - 25, cl = lv.params.cl, out = [];
  var tB = { col: 17, h: 8 }, tC = { col: cl, h: 13 };
  var pl = [14, 16];
  var rel3 = [null, 4, 8, 12, 16, 20, 24];
  var gstep = opt.fast ? 3 : 1, xstep = opt.fast ? 0.2 : 0.1;
  var c1 = expScript(lv, 'c1');
  var g1 = runPlain(lv, null, c1, tB);                                   // 預期解的幽靈 1
  var preGround = function (xs) {                                          // 地面站位(欄 0~13)
    var st = [['born', C.now, R]];
    if (xs >= 8) st.push(['j1', C.and(C.x(7.6), C.gnd), J]);
    st.push(['stop', C.and(C.x(xs), C.gnd), N0]);
    return mk({}, st);
  };
  var prePillar = function (xs) {                                          // 柱頂站位(跳上去後放開於 xs)
    return mk({}, [['born', C.now, R], ['j1', C.and(C.x(7.6), C.gnd), J], ['stop', C.x(13.4), N0], ['jmp', C.t(5.0), JR], ['rel', C.x(xs), N0]]);
  };
  // S1 少用一代: 角色 1 在柱頂任一處跳並按 →
  var A1 = Agg('2-S1 角色 1 自己上 B(柱頂 14.0~16.5 掃)');
  famHead(lv, null, prePillar, frange(14.0, 16.5), { tgt: tB, rels: [null], span: 300 }, A1, 'S1');
  out.push(A1);
  // S2 少用一代: 角色 2 上 C
  var A2a = Agg('2-S2a 角色 2 在 B 任一處跳(目標 C)');
  var preB2 = function (xs) {
    var base = upTo(expScript(lv, 'c2'), 'jmp3');
    return base.concat(stageTo(xs, 'stg'));
  };
  famHead(lv, g1.rec, preB2, frange(17.6, sl - 0.1, gstep ? xstep : 0.1), { tgt: tC, rels: [null], span: 700 }, A2a, 'S2a');
  out.push(A2a);
  var A2b = Agg('2-S2b 角色 2 踩幽靈 1 任一站立位置再跳(目標 C)');
  famHead(lv, g1.rec, preGround, frange(4.0, 7.9, xstep).concat(frange(10.0, 13.4, xstep)), { tgt: tC, rels: rel3, dMax: 80, span: 540 }, A2b, 'S2b-ground');
  famHead(lv, g1.rec, prePillar, frange(14.0, 16.5, xstep), { tgt: tC, rels: rel3, dMax: 80, span: 540 }, A2b, 'S2b-pillar');
  out.push(A2b);
  // S3 直覺全速往右跑跳: 角色 1 起跳時刻掃 0~5.0 每幀
  var A3 = Agg('2-S3 角色 1 全速跑跳, 柱下起跳時刻 0~5.0 掃(排除站上柱頂的幽靈)'); A3.excluded = 0; A3.ghosts = 0;
  for (var t0 = 0; t0 <= 300; t0 += gstep) {
    var gs = runPlain(lv, null, mk({}, [['born', C.now, R], ['j1', C.and(C.x(7.6), C.gnd), J], ['j2', C.and(C.tf(t0), C.gnd, function (P) { return P.x > 8; }), J]]), tB);
    if (standsOn(gs.rec, function (x, h) { return x >= pl[0] && x < pl[1] + 1 && Math.abs(h - 3) < 1e-6; })) { A3.excluded++; continue; }
    A3.ghosts++;
    famHead(lv, gs.rec, preGround, frange(4.0, 7.9, xstep).concat(frange(10.0, 13.4, xstep)), { tgt: tB, rels: [null, 6, 12], dMax: 60, span: Math.min(300, gs.rec.L + 60) }, A3, 'S3-t0=' + t0);
  }
  out.push(A3);
  // S4 幽靈 1 站地面(13.0~13.4)到錄影上限
  var A4 = Agg('2-S4 幽靈 1 站地面 13.0~13.4 到錄影上限');
  frange(13.0, 13.4).forEach(function (xg) {
    var gs = runPlain(lv, null, mk({}, [['born', C.now, R], ['j1', C.and(C.x(7.6), C.gnd), J], ['stop', C.and(C.x(xg), C.gnd), N0]]), tB);
    famHead(lv, gs.rec, preGround, frange(10.0, 13.4, xstep), { tgt: tB, rels: rel3, dMax: 14, span: 40 }, A4, 'S4-xg=' + xg);
    famHead(lv, gs.rec, prePillar, frange(14.0, 16.5, 0.5), { tgt: tB, rels: rel3, dMax: 14, span: 200 }, A4, 'S4p-xg=' + xg);
  });
  out.push(A4);
  // S5 幽靈 2 不在柱頂停留: 角色 2 柱頂落地後 0~6 幀內就跳向幽靈 1
  var A5 = Agg('2-S5 幽靈 2 在柱頂落地後 0~6 幀內就跳(角色 3 從柱頂踩頭, 目標 B)');
  for (var dd = 0; dd <= 6; dd++) {
    var c2s = mk({}, [['born', C.now, R], ['j1', C.and(C.x(7.6), C.gnd), J], ['stop', C.x(13.4), N0], ['jmp', C.t(5.0), JR], ['relA', C.x(14.5), N0],
      ['jmp2', landAfter(dd), JR], ['relB', C.x(15.5), N0], ['jmp3', C.and(C.t(7.0), C.onGhost), JR], ['stopB', C.x(sl - 0.5), N0],
      ['goC', C.t(10.0), R], ['stopD', C.x(sl + 3.0), N0]]);
    var g2 = runPlain(lv, g1.rec, c2s, tB);
    famHead(lv, g2.rec, prePillar, frange(14.0, 16.5, 0.1), { tgt: tB, rels: [null, 4, 8], dMax: 60, span: 400 }, A5, 'S5-d=' + dd);
  }
  out.push(A5);
  // S6 幽靈 2 停在刺區外(B 上, 欄 sl-1 邊緣)到錄影上限
  var c2std = expScript(lv, 'c2', { relC: 0 });
  var c2stop = upTo(c2std, 'jmp3').concat([{ n: 'stg', c: C.and(C.x(sl - 0.1), C.gnd), hold: 0 }]);
  var g2s = runPlain(lv, g1.rec, c2stop, tC);
  var A6 = Agg('2-S6 幽靈 2 停 ' + (sl - 0.1).toFixed(1) + ' 到錄影上限(' + (g2s.k / 60).toFixed(1) + 's, 目標 C)');
  var preB3 = function (xs) { return upTo(expScript(lv, 'c3'), 'jmp3').concat(stageTo(xs, 'stg')); };
  famHead(lv, g2s.rec, preB3, frange(17.6, sl - 0.1, xstep), { tgt: tC, rels: rel3, dMax: 14, span: 60 }, A6, 'S6');
  out.push(A6);
  return out;
};

// ------------------------------------------------------------------ 捷徑 第 3 關
function airStart(rec, pred) {        // 第一段「從站立 pred 離地」的騰空起點幀; 沒有回 -1
  for (var i = 1; i < rec.n; i++) if (rec.gk[i] === 0 && rec.gk[i - 1] !== 0 && pred(rec.xs[i - 1], rec.hs[i - 1], rec.gk[i - 1])) return i;
  return -1;
}
function s3pre() { return [['born', C.now, R], ['stopS', C.x(3.7), N0], ['goS', C.t(2.0), R]]; }

SHORT[3] = function (lv, opt) {
  opt = opt || {};
  var I = lv.info, bl = I.bCol, z0 = I.zone[0], st = I.stump, out = [];
  var tB = { col: bl, h: 7.5 }, tC = { col: 39, h: 12.5 };
  var gstep = opt.fast ? 2 : 1, xstep = opt.fast ? 0.2 : 0.1;
  var edgeStages = frange(9.0, 9.9, 0.1);
  var preEdge = function (xs) { return mk({}, s3pre().concat([['stopE', C.and(C.x(xs), C.gnd), N0]])); };
  var hookOpt = function (rec) {
    var j = airStart(rec, function (x, h, k) { return Math.floor(x + 1e-9) === 9; });
    if (j < 0) j = 0;
    return { tgt: tB, span: Math.min(900, rec.L + 60), tLo: function (k0) { return Math.max(k0, j - 36); }, tHi: function (k0) { return j + 36 + 1; } };
  };
  // S1 / S6 直覺全速: 坑邊 9.0~9.9 起跳(越過矮樁落坑)
  var A1 = Agg('3-S1/S6 角色 1 坑邊 9.0~9.9 全速直跳; 角色 2 (a)站坑邊 X (b)全速起跳再 X');
  edgeStages.forEach(function (jx) {
    var gs = runPlain(lv, null, mk({}, s3pre().concat([['j', C.and(C.x(jx), C.gnd), JR]])), tB);
    var ho = hookOpt(gs.rec);
    famHookStand(lv, gs.rec, preEdge, edgeStages, { tgt: tB, span: Math.min(900, gs.rec.L + 60) }, A1, 'S1a-jx=' + jx);
    famHookAir(lv, gs.rec, preEdge, edgeStages, ho, A1, 'S1b-jx=' + jx);
  });
  out.push(A1);
  // S2 直覺跑跳落上矮樁後續走: 走廊 7.0~8.9 起跳
  var A2 = Agg('3-S2 角色 1 走廊 7.0~8.9 起跳落上矮樁後續走; 角色 2 (a)(b)');
  frange(7.0, 8.9, 0.1).forEach(function (jx) {
    var gs = runPlain(lv, null, mk({}, s3pre().concat([['j', C.and(C.x(jx), C.gnd), JR]])), tB);
    var ho = hookOpt(gs.rec);
    famHookStand(lv, gs.rec, preEdge, edgeStages, { tgt: tB, span: Math.min(900, gs.rec.L + 60) }, A2, 'S2a-jx=' + jx);
    famHookAir(lv, gs.rec, preEdge, edgeStages, ho, A2, 'S2b-jx=' + jx);
  });
  out.push(A2);
  // S3 少用一代: 角色 1 停在坑邊 9.9 到錄影上限, 角色 2 踩頭
  var g3 = runPlain(lv, null, mk({}, s3pre().concat([['stop', C.and(C.x(9.9), C.gnd), N0]])), tB);
  var A3 = Agg('3-S3 角色 1 停坑邊 9.9 到錄影上限(' + (g3.k / 60).toFixed(1) + 's); 角色 2 踩頭(目標 B)');
  var preAny = function (xs) { var s = [['born', C.now, R]]; if (xs >= 3.7) s.push(['stopS', C.x(3.7), N0], ['goS', C.t(2.0), R]); s.push(['stop', C.and(C.x(xs), C.gnd), N0]); return mk({}, s); };
  famHead(lv, g3.rec, preAny, frange(0.6, 3.6, xstep).concat(frange(3.8, 9.8, xstep)), { tgt: tB, rels: [null, 4, 8, 12, 16, 20, 24], dMax: 14, span: 60 }, A3, 'S3');
  out.push(A3);
  // S4 少用一代: 角色 2 上 B 後在 B 任一處跳 / 對幽靈 1 按 X
  var g1 = runPlain(lv, null, expScript(lv, 'c1'), tB);
  var preB = function (xs) { return upTo(expScript(lv, 'c2'), 'jmp').concat(stageTo(xs, 'stg')); };
  var A4 = Agg('3-S4 角色 2 上 B 後在 B 任一處跳(目標 C) / 在 B 對幽靈 1 按 X');
  famHead(lv, g1.rec, preB, frange(bl + 0.2, z0 - 0.2, xstep), { tgt: tC, rels: [null], span: 480 }, A4, 'S4-jump');
  famHookStand(lv, g1.rec, preB, frange(bl + 0.2, z0 - 0.2, 0.5), { tgt: tC, span: 480 }, A4, 'S4-X');
  out.push(A4);
  // S5 站矮樁鉤
  var A5 = Agg('3-S5 角色 2 站矮樁 ' + st[0] + '.0~' + (st[1] + 0.9).toFixed(1) + ' 於幽靈 1 騰空每一幀 X');
  famHookStand(lv, g1.rec, function (xs) { return mk({}, s3pre().concat([['onStump', function (P) { return P.grounded && P.x > 10.5; }, {}]])).concat(stageTo(xs, 'stg')); }, frange(st[0], st[1] + 0.9, 0.1), { tgt: tB, span: 480 }, A5, 'S5');
  out.push(A5);
  // S8 幽靈 2 停在刺區外(B 上 z0-0.1)到錄影上限; 角色 3 踩頭全速往右
  var c2e = expScript(lv, 'c2');
  var g2s = runPlain(lv, g1.rec, upTo(c2e, 'jmp').concat([{ n: 'stg', c: C.and(C.x(z0 - 0.1), C.gnd), hold: 0 }]), tC);
  var A8 = Agg('3-S8 幽靈 2 停 ' + (z0 - 0.1).toFixed(1) + ' 到錄影上限(' + (g2s.k / 60).toFixed(1) + 's); 角色 3 踩頭(目標 C)');
  var preB3 = function (xs) { return upTo(expScript(lv, 'c3'), 'jmp').concat(stageTo(xs, 'stg')); };
  famHead(lv, g2s.rec, preB3, frange(bl + 0.2, z0 - 0.1, xstep), { tgt: tC, rels: [null, 4, 8, 12, 16, 20, 24], dMax: 14, span: 60 }, A8, 'S8');
  out.push(A8);
  // S9 角色 3 在 B 任一處對幽靈 2 跨坑段 X
  var g2e = runPlain(lv, g1.rec, c2e, tC);
  var A9 = Agg('3-S9 角色 3 上 B 後在 B 任一處對幽靈 2 X(目標 C)');
  famHookStand(lv, g2e.rec, preB3, frange(bl + 0.2, z0 - 0.2, xstep), { tgt: tC }, A9, 'S9');
  out.push(A9);
  return out;
};

// S10 只紀錄: 直覺落上矮樁即跳
SHORT.only3 = function (lv, opt) {
  var I = lv.info, bl = I.bCol, st = I.stump, tB = { col: bl, h: 7.5 };
  var res = { a: [], b: [] };
  var edgeStages = [9.9];
  var preEdge = function (xs) { return mk({}, s3pre().concat([['stopE', C.and(C.x(xs), C.gnd), N0]])); };
  function tryGhost(gs, label, bucket) {
    var A = Agg(label);
    var j = airStart(gs.rec, function (x) { return Math.floor(x + 1e-9) === 9; });
    if (j < 0) j = 0;
    famHookStand(lv, gs.rec, preEdge, frange(9.0, 9.9), { tgt: tB, span: Math.min(900, gs.rec.L + 60) }, A, 'S10');
    famHookAir(lv, gs.rec, preEdge, frange(9.0, 9.9), { tgt: tB, span: 900, tLo: function (k0) { return Math.max(k0, j - 36); }, tHi: function () { return j + 37; } }, A, 'S10air');
    bucket.push({ label: label, reached: A.reached > 0, nReached: A.reached, n: A.n, min: A.min, ex: A.ex[0] });
  }
  // (a) 走出坑邊落上矮樁後 → 不放, 在矮樁任一處跳
  frange(st[0], st[1] + 0.9).forEach(function (jx) {
    var gs = runPlain(lv, null, mk({}, s3pre().concat([['j', C.and(C.x(jx), C.gnd, function (P) { return P.x > 10; }), JR]])), tB);
    tryGhost(gs, 'a jx=' + jx, res.a);
  });
  // (b) 走廊欄 7 跳落上矮樁後立即跳
  frange(7.0, 7.9).forEach(function (jx) {
    var gs = runPlain(lv, null, mk({}, s3pre().concat([['j', C.and(C.x(jx), C.gnd, function (P) { return P.x < 9; }), JR], ['j2', C.and(C.gnd, function (P) { return P.x > 10; }), JR]])), tB);
    tryGhost(gs, 'b jx=' + jx, res.b);
  });
  return res;
};

// ------------------------------------------------------------------ 捷徑 第 4 關
SHORT[4] = function (lv, opt) {
  opt = opt || {};
  var I = lv.info, re = lv.params.re, sl = I.stump[0], sr = I.stump[1], cl = lv.params.cl, out = [];
  var tC = { col: cl, h: 16 }, tB = { col: 17, h: 8 };
  var xstep = opt.fast ? 0.2 : 0.1;
  var rel3 = [null, 4, 8, 12, 16, 20, 24];
  var c1e = expScript(lv, 'c1'), c2e = expScript(lv, 'c2'), c3e = expScript(lv, 'c3');
  var g1 = runPlain(lv, null, c1e, tC);                                   // 預期解幽靈 1
  var g2 = runPlain(lv, g1.rec, c2e, tC);                                 // 預期解幽靈 2
  // c2 到刺區(落上 B 刺區)為止的前綴
  var c2toZone = function () { return upTo(expScript(lv, 'c2'), 'jmp5'); };
  var c3toZone = function () { return upTo(expScript(lv, 'c3'), 'jmp5'); };
  var landZone = ['onZone', function (P) { return P.grounded && P.x >= 19 && P.h > 9; }, {}];
  var onStump = ['onStump', function (P) { return P.grounded && P.x > re + 1.5 && P.h < 8; }, {}];
  var preSafeZ4 = function (xs) { return c3toZone().concat(mk({}, [landZone]), stageTo(xs, 'stg')); };
  // ---- S1 直覺全速往右跑跳: 角色 2 在刺區右緣 re+0~re+0.9 跳落坑
  var A1 = Agg('4-S1/S3 角色 2 從坑邊 ' + re + '.0~' + re + '.9 起跳落坑; 角色 3 (a)站坑邊 X (b)全速起跳再 X (c)跳上該幽靈頭頂隨它起跳再 X');
  var preZoneEdge = function (xs) { return c3toZone().concat(mk({}, [landZone]), stageTo(xs, 'stg')); };
  var edgeSt = frange(re, re + 0.9);
  edgeSt.forEach(function (jx) {
    var gs = runPlain(lv, g1.rec, c2toZone().concat([{ n: 'j', c: C.and(C.x(jx), C.gnd, function (P) { return P.h > 9; }), jump: true }]), tC);
    var j = airStart(gs.rec, function (x, h) { return h > 9 && Math.floor(x + 1e-9) >= re; });
    if (j < 0) j = 0;
    famHookStand(lv, gs.rec, preZoneEdge, edgeSt, { tgt: tC, span: 360 }, A1, 'S1a-jx=' + jx);
    famHookAir(lv, gs.rec, preZoneEdge, edgeSt, { tgt: tC, tLo: function (k0) { return Math.max(k0, j - 36); }, tHi: function () { return Math.min(j + 37, 14.2 * 60); } }, A1, 'S1b-jx=' + jx);
    // (c) 從刺區跳上該幽靈頭頂, 隨它起跳後再 X
    famHead(lv, gs.rec, preSafeZ4, frange(19.0, re + 0.4, 0.5), { tgt: tC, rels: [null, 6, 12], dMax: 150, span: 400, hook: true }, A1, 'S1c-jx=' + jx);
  });
  out.push(A1);
  // ---- S2 直覺跑跳落上矮樁後續走: 角色 2 從刺區欄 re-2~re-0.1 全速跳, 落上矮樁後 → 不放
  var A2 = Agg('4-S2 角色 2 從刺區 ' + (re - 2) + '.0~' + (re - 0.1) + ' 全速跳落上矮樁後續走; 角色 3 (a)(b)');
  frange(re - 2, re - 0.1).forEach(function (jx) {
    var gs = runPlain(lv, g1.rec, c2toZone().concat([{ n: 'j', c: C.and(C.x(jx), C.gnd, function (P) { return P.h > 9; }), jump: true }]), tC);
    var j = airStart(gs.rec, function (x, h) { return h > 9 && Math.floor(x + 1e-9) >= re - 2; });
    if (j < 0) j = 0;
    famHookStand(lv, gs.rec, preZoneEdge, edgeSt, { tgt: tC, span: 360 }, A2, 'S2a-jx=' + jx);
    famHookAir(lv, gs.rec, preZoneEdge, edgeSt, { tgt: tC, tLo: function (k0) { return Math.max(k0, j - 36); }, tHi: function () { return Math.min(j + 37, 14.2 * 60); } }, A2, 'S2b-jx=' + jx);
  });
  out.push(A2);
  // ---- S4 站矮樁鉤
  var A4 = Agg('4-S4 角色 3 走下矮樁 ' + sl + '.0~' + (sr + 0.9).toFixed(1) + ' 於幽靈 2 騰空每一幀 X');
  var preStump3 = function (xs) { return c3toZone().concat(mk({}, [onStump]), stageTo(xs, 'stg')); };
  famHookStand(lv, g2.rec, preStump3, frange(sl, sr + 0.9), { tgt: tC }, A4, 'S4');
  out.push(A4);
  // ---- S5 從安全區起跳越過刺區鉤(避開收起窗)
  var A5 = Agg('4-S5 角色 3 在安全區 17.0~18.4 任意時刻跳並按 →, 空中每幀 X 幽靈 2');
  var preSafe = function (xs) { return upTo(expScript(lv, 'c3'), 'relB').concat(stageTo(xs, 'stg')); };
  famHookAir(lv, g2.rec, preSafe, frange(17.0, 18.4), { tgt: tC, tLo: function (k0) { return k0; }, tHi: function (k0) { return Math.min(k0 + 1080, Core.REC_LIMIT - 140); } }, A5, 'S5');
  out.push(A5);
  // ---- S6 踩幽靈 2 頭頂上 C: 幽靈 2 停在刺區 re+0.9 或矮樁 sr+0.9 到死亡或錄影上限
  var A6 = Agg('4-S6 幽靈 2 停刺區 ' + (re + 0.9).toFixed(1) + ' 或矮樁 ' + (sr + 0.9).toFixed(1) + '; 角色 3 踩頭(目標 C)');
  var gz = runPlain(lv, g1.rec, c2toZone().concat([{ n: 'stg', c: C.and(C.x(re + 0.9), C.gnd, function (P) { return P.h > 9; }), hold: 0 }]), tC);
  var gst = runPlain(lv, g1.rec, c2toZone().concat(mk({}, [onStump]), [{ n: 'stg', c: C.and(C.x(sr + 0.9), C.gnd), hold: 0 }]), tC);
  var preSafeZ = function (xs) {
    if (xs < 19) return upTo(expScript(lv, 'c3'), 'relB').concat(stageTo(xs, 'stg'));
    return c3toZone().concat(mk({}, [landZone]), stageTo(xs, 'stg'));
  };
  var st6 = frange(17.0, 18.9, xstep).concat(frange(19.0, re + 0.4, xstep));
  famHead(lv, gz.rec, preSafeZ, st6, { tgt: tC, rels: rel3, dMax: 60, span: 540 }, A6, 'S6-zone');
  famHead(lv, gst.rec, preSafeZ, st6, { tgt: tC, rels: rel3, dMax: 60, span: 540 }, A6, 'S6-stump');
  out.push(A6);
  // ---- S7 少用一代: 角色 2 上刺區後在任一處跳 / 對幽靈 1 按 X
  var A7 = Agg('4-S7 角色 2 上刺區後在任一處跳(目標 C) / 對幽靈 1 按 X');
  var preZone2 = function (xs) { return c2toZone().concat(mk({}, [landZone]), stageTo(xs, 'stg')); };
  famHead(lv, g1.rec, preZone2, frange(19.0, re + 0.4, xstep), { tgt: tC, rels: [null], span: 300 }, A7, 'S7-jump');
  famHookStand(lv, g1.rec, preZone2, frange(19.0, re + 0.4, 0.5), { tgt: tC, span: 300 }, A7, 'S7-X');
  out.push(A7);
  // ---- S8 從地面鉤上 B
  var A8 = Agg('4-S8 角色 2/3 站地面 8.0~11.4 / 15.0~16.4 對前一代任一騰空段每幀 X(目標 B)');
  var preGround1 = function (xs) { return mk({}, [['born', C.now, R], ['j1', C.and(C.x(5.9), C.gnd), J], ['stg', C.and(C.x(xs), C.gnd), N0]]); };
  var preGround2 = function (xs) { return mk({}, [['born', C.now, R], ['j1', C.and(C.x(5.9), C.gnd), J], ['j2', C.and(C.t(6.0), C.gnd), J], ['stg', C.and(C.x(xs), C.gnd, function (P) { return P.h < 1; }), N0]]); };
  var stG1 = frange(8.0, 11.4).concat([]), stG2 = frange(15.0, 16.4);
  famHookStand(lv, g1.rec, preGround1, stG1, { tgt: tB }, A8, 'S8-c2-low');
  famHookStand(lv, g1.rec, preGround2, stG2, { tgt: tB }, A8, 'S8-c2-mid');
  famHookStand(lv, g2.rec, preGround1, stG1, { tgt: tB }, A8, 'S8-c3-low');
  famHookStand(lv, g2.rec, preGround2, stG2, { tgt: tB }, A8, 'S8-c3-mid');
  out.push(A8);
  // ---- S9 踩站地面的幽靈上 B: 角色 1 停在地面 11.4 到錄影上限
  var gg = runPlain(lv, null, mk({}, [['born', C.now, R], ['j1', C.and(C.x(5.9), C.gnd), J], ['stop', C.and(C.x(11.4), C.gnd), N0]]), tB);
  var A9 = Agg('4-S9 角色 1 停地面 11.4 到錄影上限; 角色 2 踩頭跳(目標 B)');
  famHead(lv, gg.rec, preGround1, frange(8.0, 11.3, xstep), { tgt: tB, rels: rel3, dMax: 14, span: 60 }, A9, 'S9');
  out.push(A9);
  return out;
};

// ------------------------------------------------------------------ 預期解變體 / 只紀錄 / 執行窗清單
function allRuns(arr) {
  var out = [], cur = null;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].ok && cur && arr[i].f === cur.b + 1) cur.b = arr[i].f;
    else if (arr[i].ok) { cur = { a: arr[i].f, b: arr[i].f }; out.push(cur); }
    else cur = null;
  }
  out.forEach(function (r) { r.len = r.b - r.a + 1; });
  return out;
}
function tsec(k) { return (k / FPS).toFixed(2) + 's'; }

var VARIANTS = {};
VARIANTS[1] = function () { return []; };
VARIANTS[2] = function () { return []; };
VARIANTS[3] = function (lv) {
  var I = lv.info, tB = { col: I.bCol, h: 7.5 }, out = [];
  var g1 = runPlain(lv, null, expScript(lv, 'c1'), tB);
  var A = Agg('3 變體: 角色 2 起跳後再鉤幽靈 1'); var fs = {};
  A.cb = function (d) { if (d && d[3] === 'hook-jump') fs[d[2]] = d; };
  var preEdge = function (xs) { return mk({}, s3pre().concat([['stopE', C.and(C.x(xs), C.gnd), N0]])); };
  var j = airStart(g1.rec, function (x) { return Math.floor(x + 1e-9) === 9; });
  famHookAir(lv, g1.rec, preEdge, frange(9.0, 9.9), { tgt: tB, tLo: function (k0) { return Math.max(k0, j - 60); }, tHi: function () { return j + 60; } }, A, 'V3');
  var ks = Object.keys(fs).map(Number).sort(function (a, b) { return a - b; });
  var d0 = ks.length ? fs[ks[0]] : null;
  out.push({ name: A.name, ok: A.reached > 0, n: A.n, reached: A.reached, jumpFrames: ks.length, example: d0 ? '站 x=' + d0[1] + ', 第 ' + d0[2] + ' 幀(' + tsec(d0[2]) + ')起跳 →, 第 ' + d0[5] + ' 幀(' + tsec(d0[5]) + ')按 X, 拉動結束立刻跳' : null });
  return out;
};
VARIANTS[4] = function (lv) {
  var I = lv.info, re = lv.params.re, tC = { col: lv.params.cl, h: 16 }, out = [];
  var c1e = expScript(lv, 'c1'), g1 = runPlain(lv, null, c1e, tC), g2 = runPlain(lv, g1.rec, expScript(lv, 'c2'), tC);
  var c3toZone = function () { return upTo(expScript(lv, 'c3'), 'jmp5'); };
  var landZone = ['onZone', function (P) { return P.grounded && P.x >= 19 && P.h > 9; }, {}];
  // V1 幽靈頭頂轉鉤 / V2 站在刺區不跳直接 X: 幽靈 2(角色 2)在矮樁的起跳時刻是自由度(規格: 13.6~15.1), 逐個試
  var A1 = Agg('4 變體 1: 角色 3 從刺區跳上站在矮樁的幽靈 2 頭頂, 幽靈起跳後下落再 X'), got1 = null, f1 = {};
  var A2 = Agg('4 變體 2: 角色 3 站在刺區不跳直接 X'), got2 = null, f2s = {};
  var rels = [null]; for (var r = 24; r <= 70; r += 2) rels.push(r);
  var baseRun = runExpected(lv, {}, null);
  for (var f2 = 800; f2 <= 960; f2 += 4) {
    var gl = runExpected(lv, {}, { c2: { jmp6: f2 } }, { n: 1, lives: [g1] }).lives[1];
    if (gl.fire.jmp6 !== f2) continue;
    A1.cb = function (d) { if (d && !got1) got1 = d; f1[f2] = d; };
    famHead(lv, gl.rec, function (xs) { return c3toZone().concat(mk({}, [landZone]), stageTo(xs, 'stg')); }, frange(re - 1.0, re + 0.9, 0.2), { tgt: tC, rels: rels, dMax: 200, span: 330, hook: true }, A1, 'V1');
  }
  for (var jxs = I.stump[0]; jxs <= I.stump[1] + 0.9; jxs += 0.5) {
    for (var f3 = 810; f3 <= 960; f3 += 3) {
      var gl2 = runExpected(lv, { c2: { jx: jxs } }, { c2: { jmp6: f3 } }, { n: 1, lives: [g1] }).lives[1];
      if (gl2.fire.jmp6 !== f3) continue;
      (function (jxs2, f32) { A2.cb = function (d) { if (d && !got2) got2 = d; f2s[f32] = [jxs2, d]; }; })(jxs, f3);
      famHookStand(lv, gl2.rec, function (xs) { return c3toZone().concat(mk({}, [landZone]), stageTo(xs, 'stg')); }, frange(19.0, re + 0.9, 0.2), { tgt: tC }, A2, 'V2-jx=' + jxs);
    }
  }
  var k1 = Object.keys(f1).map(Number), k2 = Object.keys(f2s).map(Number);
  out.push({ name: A1.name, ok: A1.reached > 0, n: A1.n, reached: A1.reached, c2StumpJumpFrames: k1.length ? k1[0] + '~' + k1[k1.length - 1] + ' (' + tsec(k1[0]) + '~' + tsec(k1[k1.length - 1]) + ')' : null, example: got1 ? JSON.stringify(got1) : null });
  out.push({ name: A2.name, ok: A2.reached > 0, n: A2.n, reached: A2.reached, c2StumpJumpFrames: k2.length ? k2[0] + '~' + k2[k2.length - 1] + ' (' + tsec(k2[0]) + '~' + tsec(k2[k2.length - 1]) + ')' : null, example: got2 ? JSON.stringify(got2) : null });
  // V3 柱頂鉤角色 2 從柱頂跳向幽靈 1 頭頂的那段騰空: 角色 3 的 hk1 時間窗有兩段(第一段 = 柱頂→幽靈 1 頭頂)
  var w = timeWindow(lv, { r: 'c3', step: 'hk1' }, {}, 300, true);
  var runs = w && w.runs ? w.runs : [];
  out.push({ name: '4 變體 3: 角色 3 在柱頂鉤角色 2 從柱頂跳向幽靈 1 頭頂那段', ok: runs.length >= 2, runs: runs.map(function (r) { return r.a + '-' + r.b + '(' + tsec(r.a) + '~' + tsec(r.b) + ', ' + r.len + ' 幀)'; }) });
  return out;
};

// ---- 只紀錄 ----
function bestWindowL3C3(lv, p1, l1, l2) {   // 角色 3 鉤爪: 對所有起跳幀取 X 時間窗最長者
  var best = 0, bt = 0;
  for (var tj = 170; tj <= 240; tj++) {
    var arr = [];
    for (var tx = tj + 20; tx <= tj + 100; tx++) {
      var l3 = runExpected(lv, p1, { c3: { jmpA: tj, hk: tx } }, { n: 2, lives: [l1, l2] }).lives[2];
      arr.push({ f: tx, ok: l3.fire.jmpA === tj && l3.fire.hk === tx && l3.stood });
    }
    var b = longestRun(arr); if (b && b.len > best) { best = b.len; bt = tj; }
  }
  return { len: best, tj: bt };
}
function onlyRecord3(lv) {
  var I = lv.info, st = I.stump, tB = { col: I.bCol, h: 7.5 }, res = [], sr = st[1];
  function tryGhost(label, steps) {
    var l1 = runLife(lv, Core.makeE(lv, null), steps, { target: tB });
    var arr2 = [];
    for (var f = 150; f <= 330; f++) {
      var l2 = runExpected(lv, {}, { c2: { hk: f } }, { n: 1, lives: [l1] }).lives[1];
      arr2.push({ f: f, ok: l2.fire.hk === f && l2.stood });
    }
    var b2 = longestRun(arr2), w2 = b2 ? b2.len : 0, w3 = 0, pass3 = false;
    if (w2 > 0) {
      var fc = Math.round((b2.a + b2.b) / 2);
      var l2c = runExpected(lv, {}, { c2: { hk: fc } }, { n: 1, lives: [l1] }).lives[1];
      var r3 = bestWindowL3C3(lv, {}, l1, l2c); w3 = r3.len;
      var tj = r3.tj;
      pass3 = w3 > 0;
    }
    res.push({ label: label, w2: w2, w3: w3, pass2: w2 > 0, pass3: w3 > 0, pass3win: w3 >= 18 });
  }
  frange(st[0], sr + 0.9).forEach(function (jx) {
    tryGhost('(a) 矮樁 jx=' + jx, mk({}, s3pre().concat([['j', C.and(C.x(jx), C.gnd, function (P) { return P.x > 10; }), JR]])));
  });
  frange(7.0, 7.9).forEach(function (jx) {
    tryGhost('(b) 走廊 jx=' + jx, mk({}, s3pre().concat([['j', C.and(C.x(jx), C.gnd, function (P) { return P.x < 9; }), JR], ['j2', C.and(C.gnd, function (P) { return P.x > 10; }), JR]])));
  });
  return res;
}
function onlyRecord4(lv) {
  var I = lv.info, re = lv.params.re, sl = I.stump[0], sr = I.stump[1], tC = { col: lv.params.cl, h: 16 }, res = [];
  var l1 = runPlain(lv, null, expScript(lv, 'c1'), tC);
  var c2zone = upTo(expScript(lv, 'c2'), 'jmp5');
  function tryGhost(label, steps) {
    var l2 = runLife(lv, Core.makeE(lv, l1.rec), steps, { target: tC });
    var best = 0, bt = null;
    for (var tj = 780; tj <= 852; tj++) {
      var arr = [];
      for (var tx = tj + 15; tx <= tj + 100; tx++) {
        var l3 = runExpected(lv, {}, { c3: { jmp6: tj, hk2: tx } }, { n: 2, lives: [l1, l2] }).lives[2];
        arr.push({ f: tx, ok: l3.goal && l3.fire.jmp6 === tj && l3.fire.hk2 === tx });
      }
      var b = longestRun(arr); if (b && b.len > best) { best = b.len; bt = [tj, b.a, b.b]; }
    }
    res.push({ label: label, w3: best, pass3: best > 0, pass3win: best >= 18, ghostAnchor: null });
  }
  var landed = function (P) { return P.grounded && P.x > re + 1.5 && P.h < 8; };
  // (a) 從刺區欄 re-2 ~ re-0.1 全速跳, 落上矮樁後 → 不放, 在矮樁任一處立即跳
  frange(re - 2, re - 0.1, 0.1).forEach(function (zj) {
    frange(sl, sr + 0.9, 0.5).forEach(function (sj) {
      tryGhost('(a) 刺區跳 x=' + zj + ', 矮樁跳 x=' + sj, c2zone.concat(mk({}, [['zj', C.and(C.x(zj), C.gnd, function (P) { return P.h > 9; }), J], ['sj', C.and(C.x(sj), function (P) { return P.grounded && P.x > re + 1.5 && P.h < 8; }), JR]])));
    });
  });
  // (b) 走出坑邊落上矮樁後, 在矮樁任一處立即跳
  frange(sl, sr + 0.9, 0.1).forEach(function (sj) {
    tryGhost('(b) 走出坑邊, 矮樁跳 x=' + sj, c2zone.concat(mk({}, [['sj', C.and(C.x(sj), function (P) { return P.grounded && P.x > re + 1.5 && P.h < 8; }), JR]])));
  });
  return res;
}

// ------------------------------------------------------------------ 執行窗清單與量測
// spec: true = 規格「執行窗(估)」明列的動作; 其餘為輔助紀錄(其餘角色固定不動時的窗, 通常比規格列的小)
function WINS(lv) {
  var id = lv.id, I = lv.info, p = lv.params, L = [];
  var T = function (id2, r, step, label, spec, stage, need) { L.push({ id: id2, kind: 'time', r: r, step: step, label: label, spec: spec, stage: stage || null, need: need || 18 }); };
  if (id === 1) {
    var off = (p.s || 0) + (p.g || 0);
    T('c1.goB', 'c1', 'goB', '角色 1 進刺區的時刻(等尖刺收起)', false);
    T('c2.goB', 'c2', 'goB', '角色 2 進刺區的時刻', false);
    T('c2.jh', 'c2', 'jh', '角色 2 跳上幽靈 1 頭頂的起跳時刻', true, { r: 'c2', key: 'sB', vals: frange(24.0 - off, 28.4 - (p.g || 0)), note: '角色 2 站位(在刺區內, 欄 ' + I.zone[0] + '~' + (I.zone[1]) + ')' });
    T('c2.j3', 'c2', 'j3', '角色 2 從幽靈頭頂跳向高台的起跳時刻', true);
    L.push({ id: 'c1.stopB(空間窗)', kind: 'space', r: 'c1', key: 'sB', label: '角色 1 停點(角色 2 站位跟著調成停點 - 1.0)', spec: true, from: 24.0 - off, to: 28.4 - (p.g || 0), shift: off, need: 18 });
  } else if (id === 2) {
    T('c1.jmp', 'c1', 'jmp', '角色 1 從柱下起跳上柱頂', false);
    T('c2.jmp', 'c2', 'jmp', '角色 2 從柱下起跳上柱頂', false);
    T('c2.jmp2', 'c2', 'jmp2', '角色 2 從柱頂起跳向幽靈 1 頭頂', false);
    T('c2.jmp3', 'c2', 'jmp3', '角色 2 從幽靈 1 頭頂起跳上 B', false);
    T('c2.goC', 'c2', 'goC', '角色 2 進刺區的時刻(等尖刺收起)', false);
    T('c3.jmp', 'c3', 'jmp', '角色 3 從柱下起跳上柱頂', false);
    T('c3.jmp2', 'c3', 'jmp2', '角色 3 從柱頂起跳(原地跳上幽靈 2 頭頂)', true, { r: 'c3', key: 'relA', vals: frange(14.0, 14.9), note: '角色 3 在柱頂的站位(須在幽靈 2 頭頂範圍 14.0~15.0 內)' });
    T('c3.jmp3', 'c3', 'jmp3', '角色 3 從幽靈 2 頭頂起跳上 B', true);
    T('c3.jmp4', 'c3', 'jmp4', '角色 3 跳向刺區幽靈 2 頭頂的起跳時刻', true, { r: 'c3', key: 'zxStage', vals: [], note: '' });
    T('c3.jmp5', 'c3', 'jmp5', '角色 3 從刺區幽靈 2 頭頂起跳上 C', true);
  } else if (id === 3) {
    T('c1.goS', 'c1', 'goS', '角色 1 走出 3.7 站位進尖刺走廊的時刻', false);
    T('c2.goS', 'c2', 'goS', '角色 2 進尖刺走廊的時刻', false);
    T('c3.goS', 'c3', 'goS', '角色 3 進尖刺走廊的時刻', false);
    T('c2.hk', 'c2', 'hk', '角色 2 鉤爪(教學那一下, 目標 ≥ 24 幀)', true, { r: 'c2', key: 'sx', vals: frange(9.0, 9.9), note: '角色 2 站位(坑邊欄 9)' }, 24);
    T('c2.goC', 'c2', 'goC', '角色 2 進刺區的時刻', false);
    T('c3.jmpA', 'c3', 'jmpA', '角色 3 坑邊起跳', true, { r: 'c3', key: 'sx', vals: frange(9.0, 9.9), note: '角色 3 站位(坑邊欄 9)' });
    T('c3.hk', 'c3', 'hk', '角色 3 鉤爪(固定起跳時刻)', true, { r: 'c3', key: 'sx', vals: frange(9.0, 9.9), note: '角色 3 站位(坑邊欄 9)' });
    T('c3.jmp2', 'c3', 'jmp2', '角色 3 跳向刺區幽靈 2 頭頂的起跳時刻', true);
    T('c3.jmp3', 'c3', 'jmp3', '角色 3 從刺區幽靈 2 頭頂起跳上 C', true);
    L.push({ id: 'c1.jmp(矮樁上起跳窗)', kind: 'l3c1', label: '角色 1 從矮樁起跳(矮樁上可起跳的連續幀; 角色 2、3 的鉤爪時刻可自行配合)', spec: true, need: 18 });
  } else {
    T('c1.j2', 'c1', 'j2', '角色 1 從柱下起跳', false);
    T('c2.j2', 'c2', 'j2', '角色 2 從柱下起跳', false);
    T('c3.j2', 'c3', 'j2', '角色 3 從柱下起跳', false);
    T('c2.jmp3', 'c2', 'jmp3', '角色 2 從柱頂起跳向幽靈 1 頭頂', false);
    T('c2.jmp4', 'c2', 'jmp4', '角色 2 從幽靈 1 頭頂起跳上安全區', false);
    T('c2.jmp5', 'c2', 'jmp5', '角色 2 從安全區起跳上刺區(尖刺收起窗內)', false);
    T('c3.hk1', 'c3', 'hk1', '角色 3 柱頂鉤爪', true, { r: 'c3', key: 'relA', vals: frange(12.0, 14.9), note: '角色 3 在柱 A 頂的站位' });
    T('c3.jmp5', 'c3', 'jmp5', '角色 3 從安全區起跳上刺區', false);
    T('c3.jmp6', 'c3', 'jmp6', '角色 3 從刺區起跳時刻(受 14.2 伸出限制)', true, { r: 'c3', key: 'relC', vals: frange(23.0, lv.params.re + 0.9), note: '角色 3 在刺區的站位' });
    T('c3.hk2', 'c3', 'hk2', '角色 3 上方鉤爪', true);
    L.push({ id: 'c2.jmp6(鉤爪重疊)', kind: 'overlap4', label: '角色 2 從矮樁起跳時刻(角色 3 的起跳與 X 時刻可自行配合)', spec: true, need: 18 });
  }
  return L;
}

// 站位掃描: 對 stage.vals 每個值量一次, 回傳每個站位的最長窗
function stageScan(lv, w, baseP) {
  var res = [];
  w.stage.vals.forEach(function (v) {
    var p = cloneP(baseP); setPath(p, w.stage.r, w.stage.key, v);
    var tw = timeWindow(lv, w, p);
    res.push({ v: v, len: tw && tw.best ? tw.best.len : 0, a: tw && tw.best ? tw.best.a : null, b: tw && tw.best ? tw.best.b : null, base: tw ? tw.baseOK : false });
  });
  return res;
}

// 第 3 關角色 1 從矮樁起跳的窗: 對 c1.jmp 的每個起跳幀 f, 角色 2(鉤爪時刻)與角色 3(起跳與 X 時刻)取最有利者
function l3c1Window(lv) {
  var base = runExpected(lv, {}, null);
  var f0 = base.lives[0].fire.jmp, arr = [];
  for (var d = -90; d <= 90; d++) {
    var f = f0 + d;
    var l1 = runExpected(lv, {}, { c1: { jmp: f } }, null).lives[0];
    if (l1.fire.jmp !== f) { arr.push({ f: f, ok: false }); continue; }
    var arr2 = [];
    for (var h = 150; h <= 330; h++) {
      var l2 = runExpected(lv, {}, { c2: { hk: h } }, { n: 1, lives: [l1] }).lives[1];
      arr2.push({ f: h, ok: l2.fire.hk === h && l2.stood });
    }
    var b2 = longestRun(arr2);
    if (!b2) { arr.push({ f: f, ok: false }); continue; }
    var fc = Math.round((b2.a + b2.b) / 2);
    var l2c = runExpected(lv, {}, { c2: { hk: fc } }, { n: 1, lives: [l1] }).lives[1];
    var bw = bestWindowL3C3(lv, {}, l1, l2c);
    arr.push({ f: f, ok: bw.len >= 1 });
  }
  var b = longestRun(arr);
  return { nominal: f0, best: b, runs: allRuns(arr) };
}
// 第 4 關鉤爪重疊: 角色 2 在矮樁起跳的第 f 幀, 角色 3(從刺區起跳時刻與上方 X 時刻)取最有利者
function l4overlap(lv) {
  var base = runExpected(lv, {}, null);
  var f0 = base.lives[1].fire.jmp6, arr = [];
  for (var d = -90; d <= 120; d++) {
    var f = f0 + d;
    var l2 = runExpected(lv, {}, { c2: { jmp6: f } }, { n: 1, lives: [base.lives[0]] }).lives[1];
    if (l2.fire.jmp6 !== f) { arr.push({ f: f, ok: false }); continue; }
    var ok = false;
    for (var tj = 780; tj <= 852 && !ok; tj += 2) {
      for (var tx = tj + 15; tx <= tj + 110; tx++) {
        var l3 = runExpected(lv, {}, { c3: { jmp6: tj, hk2: tx } }, { n: 2, lives: [base.lives[0], l2] }).lives[2];
        if (l3.goal) { ok = true; break; }
      }
    }
    arr.push({ f: f, ok: ok });
  }
  return { nominal: f0, best: longestRun(arr), runs: allRuns(arr) };
}

function runWindowsReport(lv) {
  var out = [];
  WINS(lv).forEach(function (w) {
    var rec = { id: w.id, label: w.label, spec: w.spec, need: w.need, kind: w.kind };
    if (w.kind === 'time') {
      var tw = timeWindow(lv, w, {});
      rec.nominalFrame = tw ? tw.nominal : null;
      rec.atNominal = tw && tw.atNominal ? tw.atNominal.len : 0;
      rec.best = tw && tw.best ? tw.best.len : 0;
      rec.bestRange = tw && tw.best ? [tw.best.a, tw.best.b] : null;
      if (w.stage && w.stage.vals.length) {
        var ss = stageScan(lv, w, {});
        var feas = ss.filter(function (e) { return e.len > 0; });
        rec.stage = { note: w.stage.note, n: ss.length, feasible: feas.length, min: feas.length ? Math.min.apply(null, feas.map(function (e) { return e.len; })) : 0, minAt: null, max: feas.length ? Math.max.apply(null, feas.map(function (e) { return e.len; })) : 0, all: ss };
        feas.forEach(function (e) { if (e.len === rec.stage.min && rec.stage.minAt === null) rec.stage.minAt = e.v; });
        rec.stage.feasRange = feas.length ? [feas[0].v, feas[feas.length - 1].v] : null;
      }
    } else if (w.kind === 'space') {
      var sw = spaceWindow(lv, { r: w.r, key: w.key, from: w.from, to: w.to, adapt: function (pp, v) { setPath(pp, 'c2', 'sB', v - 1.0); } }, {});
      rec.best = sw.best ? sw.best.len : 0;
      rec.bestRange = sw.best ? [sw.from + (w.shift || 0), sw.to + (w.shift || 0)] : null;
      rec.atNominal = rec.best;
    } else if (w.kind === 'l3c1') {
      var r3 = l3c1Window(lv);
      rec.nominalFrame = r3.nominal; rec.best = r3.best ? r3.best.len : 0; rec.bestRange = r3.best ? [r3.best.a, r3.best.b] : null; rec.atNominal = rec.best;
    } else if (w.kind === 'overlap4') {
      var r4 = l4overlap(lv);
      rec.nominalFrame = r4.nominal; rec.best = r4.best ? r4.best.len : 0; rec.bestRange = r4.best ? [r4.best.a, r4.best.b] : null; rec.atNominal = rec.best;
    }
    out.push(rec);
  });
  return out;
}

// ------------------------------------------------------------------ 通關條件門檻校正
// 做法: 造出一批「角色 2 的幽靈」變體, 各自算(a)規格的判定關鍵量, (b)角色 3 在該幽靈下可過關的最長連續起跳窗(幀)。
// 窗 >= 18 幀 視為「可過關」; 再於關鍵量上找門檻, 使「判定 ⇔ 可過關」。
function bestRunOverKeys(map) {      // map: key -> {frame:true}; 回傳所有 key 中最長的連續幀長度
  var best = 0;
  Object.keys(map).forEach(function (k) {
    var fr = Object.keys(map[k]).map(Number).sort(function (a, b) { return a - b; });
    var run = 0, prev = null;
    fr.forEach(function (f) { run = (prev !== null && f === prev + 1) ? run + 1 : 1; prev = f; if (run > best) best = run; });
  });
  return best;
}
function unionRun(set) { return bestRunOverKeys({ u: set }); }

// 在關卡的站立面(B)上起跳的 c3 合成初始態: 站在 xs, 時間從 k0 起(已站穩)
function synthInit(lv, h, k0) {
  return function (xs) {
    var P = Core.newPlayer(lv);
    P.x = xs; P.h = h; P.k = k0; P.lastTH = h; P.grounded = true; P.vy = 0;
    return { P: P, S: { maxH: h, maxXA: -1e9, stood: false, goal: false } };
  };
}
function preL1(lv) {
  var dx = lv.params.s || 0;
  return function (xs) {
    var st = [['born', C.now, R]];
    if (xs >= 10) st.push(['j1', C.and(C.x(9.6), C.gnd), J]);
    if (xs >= 18) st.push(['j2', C.and(C.x(17.6), C.gnd), J]);
    if (xs >= 24 + dx) st.push(['stopA', C.x(23.5 + dx), N0], ['goB', C.t(4.0), R]);
    st.push(['stop', C.and(C.x(xs), C.gnd), N0]);
    return mk({}, st);
  };
}
function runStat(rec, pred) {         // 最長連續站在 pred 的幀數與其最小 x
  var best = { n: 0, x: null }, cur = 0, mn = 1e9;
  for (var i = 0; i < rec.n; i++) {
    if (rec.gk[i] === 1 && pred(rec.xs[i], rec.hs[i])) { cur++; if (rec.xs[i] < mn) mn = rec.xs[i]; if (cur > best.n) best = { n: cur, x: mn }; }
    else { cur = 0; mn = 1e9; }
  }
  return best;
}
function fit1(rows, key, okKey) {      // 單一下限: key >= T
  var cands = rows.map(function (r) { return r[key]; }).filter(function (v) { return v !== null && v !== undefined; });
  cands = cands.filter(function (v, i) { return cands.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  var best = null;
  cands.forEach(function (T) {
    var mis = 0; rows.forEach(function (r) { var pred = r[key] !== null && r[key] !== undefined && r[key] >= T - 1e-9; if (pred !== r.ok) mis++; });
    if (!best || mis < best.mis) best = { T: T, mis: mis };
  });
  return best || { T: null, mis: rows.filter(function (r) { return r.ok; }).length };
}
function fit2(rows, k1, k2) {          // 兩個下限
  var c1 = rows.map(function (r) { return r[k1]; }), c2 = rows.map(function (r) { return r[k2]; });
  function uniq(a) { return a.filter(function (v, i) { return v !== null && v !== undefined && a.indexOf(v) === i; }).sort(function (x, y) { return x - y; }); }
  c1 = uniq(c1); c2 = uniq(c2);
  var best = null;
  c1.forEach(function (T1) { c2.forEach(function (T2) {
    var mis = 0;
    rows.forEach(function (r) { var pred = r[k1] !== null && r[k2] !== null && r[k1] >= T1 - 1e-9 && r[k2] >= T2 - 1e-9; if (pred !== r.ok) mis++; });
    if (!best || mis < best.mis || (mis === best.mis && (T1 + T2) < (best.T1 + best.T2))) best = { T1: T1, T2: T2, mis: mis };
  }); });
  return best || { T1: null, T2: null, mis: rows.length };
}

function standSub(rec, base, X) {     // 站在 base 內且 x >= X 的最長連續幀數
  var best = 0, cur = 0;
  for (var i = 0; i < rec.n; i++) {
    if (rec.gk[i] === 1 && base(rec.xs[i], rec.hs[i]) && rec.xs[i] >= X - 1e-9) { cur++; if (cur > best) best = cur; } else cur = 0;
  }
  return best;
}
function fitStand(rows, base, Tvals, Xvals) {   // 門檻 (T 秒, X): 判定 = standSub >= T*60; 取錯判最少、並列時取中間值
  var min = 1e9, all = [];
  Xvals.forEach(function (X) {
    var subs = rows.map(function (r) { return standSub(r.rec, base, X); });
    Tvals.forEach(function (T) {
      var mis = 0;
      for (var i = 0; i < rows.length; i++) if ((subs[i] >= T * FPS - 1e-9) !== rows[i].ok) mis++;
      if (mis < min) { min = mis; all = []; }
      if (mis === min) all.push([T, X]);
    });
  });
  var mt = 0, mx = 0; all.forEach(function (p) { mt += p[0]; mx += p[1]; });
  var T0 = Math.round(mt / all.length * 20) / 20, X0 = Math.round(mx / all.length * 10) / 10;
  var chk = 0, sb = rows.map(function (r) { return standSub(r.rec, base, X0); });
  for (var i = 0; i < rows.length; i++) if ((sb[i] >= T0 * FPS - 1e-9) !== rows[i].ok) chk++;
  return { T: T0, X: X0, mis: chk, bestMis: min, tie: all.length };
}
function calibrate(lv, opt) {
  opt = opt || {};
  var id = lv.id, I = lv.info, out = { id: id, parts: [] };
  var NEED = 18;
  var xs01 = opt.fast ? 0.2 : 0.1;
  if (id === 1) {
    var dx = lv.params.s || 0, tgt = { col: I.platCol, h: 5 }, rows = [];
    var pre = preL1(lv);
    var gates = []; for (var gg = 3.8; gg <= 5.95; gg += 0.15) gates.push(Math.round(gg * 100) / 100);
    gates.forEach(function (tGo) {
      frange(24 + dx, 28.4 + dx, 0.1).forEach(function (xst) {
        var gs = runPlain(lv, null, mk({}, [['born', C.now, R], ['j1', C.and(C.x(9.6), C.gnd), J], ['j2', C.and(C.x(17.6), C.gnd), J], ['stopA', C.x(23.5 + dx), N0], ['goB', C.t(tGo), R], ['stopB', C.x(xst), N0]]), tgt);
        var rs = runStat(gs.rec, function (x, h) { return Math.abs(h) < 1e-6 && inRange2(Core.colOf(x), I.zone); });
        var A = Agg('c1'), feas = {};
        A.cb = function (d) { if (d) feas[d[2]] = true; };
        var kArr = Math.round((tGo + 0.05) * 60);
        famHead(lv, gs.rec, pre, frange(Math.max(21.0, xst - 3.5), xst - 0.2, 0.2), { tgt: tgt, rels: [null, 0, 4, 8, 12, 16, 20, 24], dMax: 60, span: 260, needStatic: true }, A, 'cal1');
        rows.push({ tGo: tGo, xStop: xst, standSec: rs.n / FPS, x: rs.x, W: unionRun(feas), ok: unionRun(feas) >= NEED, rec: gs.rec });
      });
    });
    var fz = fitStand(rows, function (x, h) { return Math.abs(h) < 1e-6 && inRange2(Core.colOf(x), I.zone); }, frange(0.05, 2.5, 0.05), frange(23.5, 28.5, 0.1));
    out.parts.push({ name: '第 1 關', rows: rows, fit: { 連續站立秒數: fz.T, 中心x: fz.X, 錯判數: fz.mis, 並列最佳組數: fz.tie } });
  } else if (id === 2) {
    var sl = lv.params.sl, cl = lv.params.cl, tB = { col: 17, h: 8 }, tC = { col: cl, h: 13 };
    var g1 = runPlain(lv, null, expScript(lv, 'c1'), tB);
    // (a) 柱頂
    var rowsA = [];
    frange(14.0, 16.5, 0.5).forEach(function (relA) {
      [0, 10, 20, 30, 45, 60, 75, 90, 105, 120, 135, 150].forEach(function (d) {
        var c2s = mk({}, [['born', C.now, R], ['j1', C.and(C.x(7.6), C.gnd), J], ['stop', C.x(13.4), N0], ['jmp', C.t(5.0), JR], ['relA', C.x(relA), N0],
          ['jmp2', landAfter(d), JR], ['relB', C.x(15.5), N0], ['jmp3', C.and(C.t(7.0), C.onGhost), JR], ['stopB', C.x(sl - 0.5), N0]]);
        var gs = runLife(lv, Core.makeE(lv, g1.rec), c2s, { target: tB });
        var rs = runStat(gs.rec, function (x, h) { return Math.abs(h - 3) < 1e-6 && inRange2(Core.colOf(x), I.pillar); });
        var A = Agg('a'), feas = {};
        A.cb = function (dd) { if (dd) feas[dd[2]] = true; };
        famHead(lv, gs.rec, function (xs) { return mk({}, [['born', C.now, R], ['j1', C.and(C.x(7.6), C.gnd), J], ['stop', C.x(13.4), N0], ['jmp', C.t(5.0), JR], ['rel', C.x(xs), N0]]); }, frange(14.0, 16.5, 0.1), { tgt: tB, rels: [null, 4, 8, 12], dMax: 60, span: 300, needStatic: true }, A, 'cal2a');
        var W = unionRun(feas);
        rowsA.push({ relA: relA, stay: d, pillarSec: rs.n / FPS, W: W, ok: W >= NEED, rec: gs.rec });
      });
    });
    var fa2 = fitStand(rowsA, function (x, h) { return Math.abs(h - 3) < 1e-6 && inRange2(Core.colOf(x), I.pillar); }, frange(0.05, 3.0, 0.05), [0]);
    out.parts.push({ name: '第 2 關 (a) 柱頂', rows: rowsA, fit: { 柱頂連續站立秒數: fa2.T, 錯判數: fa2.mis, 並列最佳組數: fa2.tie } });
    // (b) 刺區
    var rowsB = [];
    var c2base = expScript(lv, 'c2');
    [10.0, 10.25, 10.5, 10.75, 11.0, 11.25, 11.5, 11.75, 12.0, 12.25, 12.5].forEach(function (tGo) {
      frange(sl + 0.4, sl + 4.4, 0.2).forEach(function (xst) {
        var c2s = upTo(c2base, 'jmp3').concat(mk({}, [['stopB', C.x(sl - 0.5), N0], ['goC', C.t(tGo), R], ['stopD', C.x(xst), N0]]));
        var gs = runLife(lv, Core.makeE(lv, g1.rec), c2s, { target: tC });
        var rs = runStat(gs.rec, function (x, h) { return Math.abs(h - 8) < 1e-6 && inRange2(Core.colOf(x), I.zone); });
        var A = Agg('b'), feas = {};
        A.cb = function (dd) { if (dd) feas[dd[2]] = true; };
        famHead(lv, gs.rec, null, frange(sl - 4.5, sl - 0.1, 0.2), { tgt: tC, rels: [null, 4, 8, 12, 16, 20], dMax: 60, span: 500, init: synthInit(lv, 8, 540), needStatic: true }, A, 'cal2b');
        var W = unionRun(feas);
        rowsB.push({ tGo: tGo, xStop: xst, zoneSec: rs.n / FPS, W: W, ok: W >= NEED, rec: gs.rec });
      });
    });
    var fb = fitStand(rowsB, function (x, h) { return Math.abs(h - 8) < 1e-6 && inRange2(Core.colOf(x), I.zone); }, frange(0.05, 3.0, 0.05), frange(sl - 0.5, sl + 4.5, 0.1));
    out.parts.push({ name: '第 2 關 (b) 刺區', rows: rowsB, fit: { 刺區連續站立秒數: fb.T, 中心x: fb.X, 錯判數: fb.mis, 並列最佳組數: fb.tie } });
  } else if (id === 3) {
    var bl = I.bCol, z0 = I.zone[0], tB3 = { col: bl, h: 7.5 }, tC3 = { col: 39, h: 12.5 };
    var g13 = runPlain(lv, null, expScript(lv, 'c1'), tB3);
    var rowsA3 = [];
    var g13s = frange(I.stump[0] + 1.5, I.stump[1] + 0.9, 0.8).map(function (jx1) { return { jx: jx1, life: runPlain(lv, null, expScript(lv, 'c1', { jx: jx1 }), tB3) }; });
    var preEdge = function (xs) { return mk({}, s3pre().concat([['stopE', C.and(C.x(xs), C.gnd), N0]])); };
    g13s.forEach(function (g1v) { [9.9].forEach(function (sx) {
      for (var hkF = 214; hkF <= 266; hkF += 4) {
        [0, 6, 12, 24, 36].forEach(function (dly) {
          var c2s = mk({}, s3pre().concat([['stopE', C.x(sx), N0], ['hk', C.tf(hkF), HK], ['jmp', C.and(afterPull, C.af(dly)), JR], ['stopB', C.x(z0 - 0.1), N0]]));
          var gs = runLife(lv, Core.makeE(lv, g1v.life.rec), c2s, { target: tC3 });
          var gk = Core.gateEval(lv, gs.rec, { ah: 0, ax: 0, zoneStand: 0, zoneX: 0 }).keys;
          var A = Agg('a3'), feas = {};
          A.cb = function (dd) { if (dd && dd[3] === 'hook-jump') { var key = dd[1] + '|' + dd[2]; if (!feas[key]) feas[key] = {}; feas[key][dd[5]] = true; } };
          var j = airStart(gs.rec, function (x) { return Math.floor(x + 1e-9) === 9; });
          if (j < 0) j = 0;
          famHookAir(lv, gs.rec, preEdge, [9.9], { tgt: tB3, tLo: function (k0) { return Math.max(k0, 150); }, tHi: function () { return 290; } }, A, 'cal3a');
          var W = bestRunOverKeys(feas);
          rowsA3.push({ jx1: g1v.jx, sx: sx, hk: hkF, delay: dly, ax: gk.ax, ah: gk.ah, W: W, ok: W >= NEED });
        });
      }
    }); });
    var fa = fit2(rowsA3, 'ah', 'ax');
    out.parts.push({ name: '第 3 關 (a) 鉤爪錨點', rows: rowsA3, fit: { 錨點ah: fa.T1, 錨點ax: fa.T2, 錯判數: fa.mis } });
    var rowsB3 = [];
    var c2b = expScript(lv, 'c2');
    [10.0, 10.25, 10.5, 10.75, 11.0, 11.25, 11.5, 11.75, 12.0, 12.25, 12.5].forEach(function (tGo) {
      frange(z0 + 0.4, z0 + 4.4, 0.2).forEach(function (xst) {
        var c2s = upTo(c2b, 'jmp').concat(mk({}, [['stopB', C.x(z0 - 0.1), N0], ['goC', C.t(tGo), R], ['stopD', C.x(xst), N0]]));
        var gs = runLife(lv, Core.makeE(lv, g13.rec), c2s, { target: tC3 });
        var rs = runStat(gs.rec, function (x, h) { return Math.abs(h - 7.5) < 1e-6 && inRange2(Core.colOf(x), I.zone); });
        var A = Agg('b3'), feas = {};
        A.cb = function (dd) { if (dd) feas[dd[2]] = true; };
        famHead(lv, gs.rec, null, frange(z0 - 4.5, z0 - 0.1, 0.2), { tgt: tC3, rels: [null, 4, 8, 12, 16, 20], dMax: 60, span: 500, init: synthInit(lv, 7.5, 540), needStatic: true }, A, 'cal3b');
        var W = unionRun(feas);
        rowsB3.push({ tGo: tGo, xStop: xst, zoneSec: rs.n / FPS, W: W, ok: W >= NEED, rec: gs.rec });
      });
    });
    var fb3 = fitStand(rowsB3, function (x, h) { return Math.abs(h - 7.5) < 1e-6 && inRange2(Core.colOf(x), I.zone); }, frange(0.05, 3.0, 0.05), frange(z0 - 0.5, z0 + 4.5, 0.1));
    out.parts.push({ name: '第 3 關 (b) 刺區', rows: rowsB3, fit: { 刺區連續站立秒數: fb3.T, 中心x: fb3.X, 錯判數: fb3.mis, 並列最佳組數: fb3.tie } });
  } else {
    var re = lv.params.re, sl4 = I.stump[0], sr4 = I.stump[1], tC4 = { col: lv.params.cl, h: 16 };
    var l1 = runPlain(lv, null, expScript(lv, 'c1'), tC4);
    var rows4 = [];
    for (var jxs = sl4; jxs <= sr4 + 0.9; jxs += 0.5) {
      for (var f2 = 830; f2 <= 1000; f2 += 5) {
        var l2 = runExpected(lv, { c2: { jx: jxs } }, { c2: { jmp6: f2 } }, { n: 1, lives: [l1] }).lives[1];
        if (l2.fire.jmp6 !== f2) continue;
        var gkeys = Core.gateEval(lv, l2.rec, { ah: 0, ax: 0, cMin: -1e9, cMax: 1e9 }).keys;
        var A = Agg('c4'), feas = {};
        A.cb = function (dd) { if (dd && dd[3] === 'hook-jump') { var key = dd[1] + '|' + dd[2]; if (!feas[key]) feas[key] = {}; feas[key][dd[5]] = true; } };
        famHookAir(lv, l2.rec, null, frange(19.0, re + 0.9, 0.4), { tgt: tC4, init: synthInit(lv, 9.5, 768), tLo: function (k0) { return k0; }, tHi: function () { return 852; } }, A, 'cal4');
        var W = bestRunOverKeys(feas);
        rows4.push({ jx: jxs, f2: f2, ax: gkeys.ax, ah: gkeys.ah, since: gkeys.startSinceRetract, W: W, ok: W >= NEED });
      }
    }
    // (b) ax / ah 下限, (c) 起點距收起開始秒數的上下限
    var best = null, axs = rows4.map(function (r) { return r.ax; }), cs = rows4.map(function (r) { return r.since; });
    function uq(a) { return a.filter(function (v, i) { return v !== null && v !== undefined && a.indexOf(v) === i; }).sort(function (x, y) { return x - y; }); }
    var oks = rows4.filter(function (r) { return r.ok; });
    if (oks.length) {
      var T = { ax: Math.min.apply(null, oks.map(function (r) { return r.ax; })), ah: Math.min.apply(null, oks.map(function (r) { return r.ah; })), cMin: Math.min.apply(null, oks.map(function (r) { return r.since; })), cMax: Math.max.apply(null, oks.map(function (r) { return r.since; })) };
      var mis = 0; rows4.forEach(function (r) { var pred = r.ax >= T.ax - 1e-9 && r.ah >= T.ah - 1e-9 && r.since >= T.cMin - 1e-9 && r.since <= T.cMax + 1e-9; if (pred !== r.ok) mis++; });
      best = { T: T, mis: mis };
    }
    out.parts.push({ name: '第 4 關 (b)(c) 矮樁鉤爪', rows: rows4, fit: best ? { 錨點ax下限: best.T.ax, 錨點ah下限: best.T.ah, 起點距收起開始最小秒數: best.T.cMin, 最大秒數: best.T.cMax, 錯判數: best.mis } : null });
  }
  return out;
}
function inRange2(c, r) { return c >= r[0] && c <= r[1]; }

// ------------------------------------------------------------------ 報告 / CLI
var SPEC_INIT = {
  1: { s: 0 }, 2: { sl: 25, cl: 30 }, 3: { sl: 11, w: 3, bl: 19, sp: 0 }, 4: { re: 25, sl: 28, w: 3, cl: 35 }
};
var SPEC_EST = {
  1: { rec: [6.0], total: 14 }, 2: { rec: [8, 13], total: 34 }, 3: { rec: [4.6, 12], total: 29 }, 4: { rec: [8.2, 15.3], total: 40 }
};
function colsText(lv) {   // 地表高度連續段
  var out = [], i = 0;
  while (i < 40) {
    var h = lv.cols[i], j = i;
    while (j + 1 < 40 && lv.cols[j + 1] === h) j++;
    var tag = '';
    for (var q = i; q <= j; q++) if (lv.spike[q]) { tag = '+尖刺'; break; }
    var allSp = true, anySp = false;
    for (q = i; q <= j; q++) { if (lv.spike[q]) anySp = true; else allSp = false; }
    out.push('欄 ' + i + (j > i ? '~' + j : '') + ': ' + (h <= Core.PIT ? '坑' : 'h=' + h) + (anySp ? (allSp ? ' 全為尖刺' : ' 部分尖刺') : ''));
    i = j + 1;
  }
  return out;
}
function terrainDiff(id) {
  var cur = Core.PARAMS[id], ini = SPEC_INIT[id], d = [];
  for (var k in cur) if (cur[k] !== ini[k]) d.push(k + ': 規格初值 ' + ini[k] + ' → 最終 ' + cur[k]);
  return d;
}
function actText(st) {
  var a = [];
  if (st.hold !== undefined && typeof st.hold !== 'function') a.push(st.hold === 1 ? '按 →' : st.hold === -1 ? '按 ←' : '放 →');
  if (st.jump) a.push('跳');
  if (st.hook) a.push('X');
  if (typeof st.hold === 'function') a.push('走到定點');
  return a.join(' + ');
}
function pct(a, b) { return Math.round((a - b) / b * 1000) / 10; }

function reportExpected(lv, out) {
  var res = runExpected(lv, { margins: true }, null);
  var names = lv.id === 1 ? ['c1', 'c2'] : ['c1', 'c2', 'c3'];
  var dflt = SC[lv.id].defaults(lv);
  var okAll = res.last.goal;
  var total = 0, recs = [];
  out('  預期解過關: ' + (res.last.goal ? '是' : '否'));
  res.lives.forEach(function (st, i) {
    var E = Core.makeE(lv, i ? res.lives[i - 1].rec : null);
    var pp = D(null, dflt); pp._lv = lv;
    var steps = SC[lv.id][names[i]](pp);
    out('  角色 ' + (i + 1) + ': 錄影 ' + (st.rec.L / FPS).toFixed(2) + ' s, 一圈 ' + (Core.loopLenFor(lv, st.rec) / FPS) + ' s, ' + (st.goal ? '到終點' : st.dead === 1 ? '死因: 坑' : st.dead === 2 ? '死因: 陷阱' : '死因: 錄影上限'));
    var line = [];
    steps.forEach(function (sp) {
      var fr = st.fire[sp.n];
      line.push((fr !== undefined ? (fr / FPS).toFixed(2) + 's' : '--') + ' ' + actText(sp) + '[' + sp.desc + ']');
    });
    out('    輸入序列(實際觸發時刻; 位置觸發以位置為準): ' + line.join(' → '));
    if (!st.goal) { recs.push(st.rec.L / FPS); total += st.rec.L / FPS + 0.5; } else total += st.k / FPS;
    landingMargins(lv, E, st).forEach(function (m) {
      var ok = m.hMargin >= 0.5 - 1e-4 && m.xMargin >= 0.5 - 1e-4;
      if (!ok) okAll = false;
      out('    落地 ' + m.t.toFixed(2) + 's→' + m.tl.toFixed(2) + 's ' + (m.kind === 2 ? '幽靈頭頂' : '地形') + ' 目標面 h=' + m.tH + ': 高度餘量 ' + m.hMargin.toFixed(2) + ' / 水平餘量 ' + m.xMargin.toFixed(2) + (ok ? '' : '  <<< 未達 0.5'));
    });
  });
  var est = SPEC_EST[lv.id];
  var devs = [];
  recs.forEach(function (r, i) { if (est.rec[i] !== undefined) devs.push('角色' + (i + 1) + '錄影 ' + r.toFixed(2) + ' vs 估計 ' + est.rec[i] + ' (' + pct(r, est.rec[i]) + '%)'); });
  out('  時長: ' + devs.join('; ') + '; 設計者時長 ' + total.toFixed(1) + ' s vs 估計 ' + est.total + ' (' + pct(total, est.total) + '%)' + (Math.abs(pct(total, est.total)) > 20 ? '  <<< 超過 20%' : ''));
  return okAll;
}
function reportShortcuts(lv, out, opt) {
  var res = SHORT[lv.id](lv, opt);
  res.forEach(function (A) {
    var ok = A.reached === 0 && A.min >= 1.0 - 1e-4;
    out('  ' + A.name + ': 組合 ' + A.n + ', 到達 ' + A.reached + ', 最小不足量 ' + (A.min === Infinity ? '-' : A.min.toFixed(3)) + (ok ? '  OK' : '  <<< 不通過') + (A.excluded !== undefined ? ' (排除站上柱頂的幽靈 ' + A.excluded + ' 條, 實測 ' + A.ghosts + ' 條)' : ''));
    if (A.arg) out('      最小不足量發生於 ' + JSON.stringify(A.arg) + ' (腳底最高 ' + (A.argS ? A.argS.maxH.toFixed(2) : '?') + ', 目標高度以上最遠 x ' + (A.argS && A.argS.maxXA > -1e8 ? A.argS.maxXA.toFixed(2) : '-') + ')');
    if (A.ex.length) out('      到達的組合: ' + JSON.stringify(A.ex));
  });
  return res;
}
function reportWindows(lv, out) {
  runWindowsReport(lv).forEach(function (r) {
    var ok = r.best >= r.need;
    out('  ' + (r.spec ? '[規格列舉]' : '[輔助]') + ' ' + r.id + ' ' + r.label + ': 實測最長連續 ' + r.best + ' 幀' + (r.bestRange ? ' (' + (r.kind === 'space' ? r.bestRange.join('~') + ' 格' : r.bestRange.join('~') + ' 幀 = ' + (r.bestRange[0] / FPS).toFixed(2) + '~' + (r.bestRange[1] / FPS).toFixed(2) + ' s') + ')' : '') + ', 預期解名義位置含窗 ' + r.atNominal + ' 幀' + (r.spec ? (ok ? '  OK' : '  <<< 未達 ' + r.need + ' 幀') : ''));
    if (r.stage) out('      站位掃描(' + r.stage.note + '): 掃 ' + r.stage.n + ' 個站位, 可行 ' + r.stage.feasible + ' 個(範圍 ' + (r.stage.feasRange ? r.stage.feasRange.join('~') : '-') + '), 可行站位最小窗 ' + r.stage.min + ' 幀 @ x=' + r.stage.minAt + ', 最大 ' + r.stage.max + ' 幀');
  });
}
function reportVariants(lv, out) {
  VARIANTS[lv.id](lv).forEach(function (v) { out('  ' + v.name + ': ' + (v.ok ? '可過關' : '<<< 沒找到過關組合') + (v.runs ? ' 窗 ' + v.runs.join(' / ') : '') + (v.c2StumpJumpFrames ? ' (角色 2 在矮樁起跳 ' + v.c2StumpJumpFrames + ')' : '') + (v.example ? ' 例: ' + v.example : '')); });
}
function reportOnly(lv, out) {
  if (lv.id === 3) {
    var rs = onlyRecord3(lv);
    var p2 = rs.filter(function (r) { return r.pass2; }), p3 = rs.filter(function (r) { return r.pass3win; });
    out('  3-S10 直覺落上矮樁即跳(只紀錄): 幽靈 1 變體 ' + rs.length + ' 個, 角色 2 可鉤上 B ' + p2.length + ' (' + Math.round(p2.length / rs.length * 100) + '%), 其中角色 3 窗 >= 18 幀 ' + p3.length + ' (' + Math.round(p3.length / rs.length * 100) + '%)');
    ['a', 'b'].forEach(function (g) {
      var sub = rs.filter(function (r) { return r.label.indexOf('(' + g + ')') === 0; });
      if (!sub.length) return;
      var w2 = sub.filter(function (r) { return r.pass2; }).map(function (r) { return r.w2; }).sort(function (a, b) { return a - b; });
      var w3 = sub.filter(function (r) { return r.pass3; }).map(function (r) { return r.w3; }).sort(function (a, b) { return a - b; });
      out('    (' + g + ') 變體 ' + sub.length + ': 角色 2 可過 ' + w2.length + ', 窗 ' + (w2.length ? w2[0] + '~' + w2[w2.length - 1] + ' 幀(中位 ' + w2[Math.floor(w2.length / 2)] + ')' : '-') + '; 角色 3 可過 ' + w3.length + ', 窗 ' + (w3.length ? w3[0] + '~' + w3[w3.length - 1] + ' 幀(中位 ' + w3[Math.floor(w3.length / 2)] + ')' : '-'));
    });
  } else if (lv.id === 4) {
    var r4 = onlyRecord4(lv);
    var q3 = r4.filter(function (r) { return r.pass3; }), q3w = r4.filter(function (r) { return r.pass3win; });
    out('  4-S11 直覺落上矮樁即跳(只紀錄): 角色 2 幽靈變體 ' + r4.length + ' 個, 角色 3 可過關 ' + q3.length + ' (' + Math.round(q3.length / r4.length * 100) + '%), 窗 >= 18 幀 ' + q3w.length + ' (' + Math.round(q3w.length / r4.length * 100) + '%)');
    ['a', 'b'].forEach(function (g) {
      var sub = r4.filter(function (r) { return r.label.indexOf('(' + g + ')') === 0; });
      var w3 = sub.filter(function (r) { return r.pass3; }).map(function (r) { return r.w3; }).sort(function (a, b) { return a - b; });
      out('    (' + g + ') 變體 ' + sub.length + ': 角色 3 可過 ' + w3.length + (w3.length ? ', 窗 ' + w3[0] + '~' + w3[w3.length - 1] + ' 幀(中位 ' + w3[Math.floor(w3.length / 2)] + ')' : ''));
    });
  }
}
function reportGate(lv, out, opt) {
  var cal = calibrate(lv, opt);
  var cur = Core.GATE[lv.id];
  cal.parts.forEach(function (p) {
    var n = p.rows.length, okN = p.rows.filter(function (r) { return r.ok; }).length;
    out('  ' + p.name + ': 變體 ' + n + ' 個, 角色 3 窗 >= 18 幀者 ' + okN + ' 個; 擬合門檻 ' + JSON.stringify(p.fit));
  });
  out('  目前 core.js 的門檻: ' + JSON.stringify(cur));
  return cal;
}

function main(argv) {
  var what = 'all', lvSel = null, opt = {};
  argv.forEach(function (a) { if (/^[1-4]$/.test(a)) lvSel = +a; else if (a === '--fast') opt.fast = true; else if (a[0] !== '-') what = a; });
  var out = function (s) { console.log(s); };
  var levels = lvSel ? [lvSel] : [1, 2, 3, 4];
  levels.forEach(function (id) {
    var lv = Core.buildLevel(id);
    out('==== 第 ' + id + ' 關 ====');
    if (what === 'all' || what === 'terrain') {
      out('[地形] 參數 ' + JSON.stringify(Core.PARAMS[id]) + (terrainDiff(id).length ? ' ; 與規格初值不同: ' + terrainDiff(id).join(', ') : ' ; 與規格初值相同'));
      colsText(lv).forEach(function (l) { out('  ' + l); });
    }
    if (what === 'all' || what === 'expected') { out('[預期解]'); reportExpected(lv, out); }
    if (what === 'all' || what === 'variants') { out('[預期解變體]'); reportVariants(lv, out); }
    if (what === 'all' || what === 'shortcuts') { out('[捷徑]'); reportShortcuts(lv, out, opt); }
    if (what === 'all' || what === 'only') { if (id === 3 || id === 4) { out('[只紀錄]'); reportOnly(lv, out); } }
    if (what === 'all' || what === 'windows') { out('[執行窗]'); reportWindows(lv, out); }
    if (what === 'all' || what === 'gate') { out('[通關條件門檻校正]'); reportGate(lv, out, opt); }
  });
}
if (require.main === module) main(process.argv.slice(2));

//@@MORE@@

module.exports = { C: C, S: S, runLife: runLife, runSeq: runSeq, Core: Core, SC: SC, runExpected: runExpected, landingMargins: landingMargins, timeWindow: timeWindow, spaceWindow: spaceWindow, SHORT: SHORT, VARIANTS: VARIANTS, onlyRecord3: onlyRecord3, onlyRecord4: onlyRecord4, runWindowsReport: runWindowsReport, calibrate: calibrate, main: main, famHead: famHead, Agg: Agg, aggAdd: aggAdd, frange: frange, D: D, mk: mk };

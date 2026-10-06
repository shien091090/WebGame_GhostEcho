// GhostEcho core: 純邏輯(關卡地形 / 物理 / 幽靈重播 / 關內流程), 不碰 DOM、不碰 Art。
// 瀏覽器: 傳統 <script> 載入後取用 window.GhostCore; node: require('./core.js')。
// 固定步進 60fps, 全部以整數幀計時; 單位 = 格 / 秒。
(function (root) {
  'use strict';

  var FPS = 60, DT = 1 / 60;
  var WALK = 6 * DT;              // 每幀走 0.1 格
  var GRAV = 34.6;                // 重力(規格驗算基準)
  var V0 = Math.sqrt(2 * GRAV * 3.5); // 跳躍初速 ≈ 15.563: 規格寫 15.56, 取精確值才會剛好跳 3.5 格(15.56 只有 3.4988)
  var EPS = 1e-9;
  var PIT = -1e9;                 // 坑欄的內部地表值
  var REC_LIMIT = 1800;           // 錄影上限 30 秒
  var FADE = 45;                  // 淡出 0.75 秒
  var EXPIRE = 60;                // 即將消失 1.0 秒
  var DELAY = 30;                 // 換人延遲 0.5 秒
  var HOOK_RANGE = 8, PULL_SPEED = 25, LIFT = 3.5;

  // ---------------------------------------------------------------- 關卡
  // 自動驗證後的最終地形參數(可調範圍內)。與規格初值不同處見 verify.js 報告。
  var PARAMS = {
    1: { s: 0 },
    2: { sl: 25, cl: 31 },
    3: { sl: 11, w: 4, bl: 19, sp: -1 },
    4: { re: 25, sl: 28, w: 3, cl: 35 }
  };

  function fill(cols, a, b, h) { for (var i = a; i <= b; i++) cols[i] = h; }

  function buildLevel(id, p) {
    p = p || PARAMS[id];
    var cols = [], spike = [], i;
    for (i = 0; i < 40; i++) { cols[i] = PIT; spike[i] = 0; }
    var lv = { id: id, hook: id >= 3, spawnCol: 2, info: {} };
    var inf = lv.info;
    if (id === 1) {
      var s = p.s || 0;
      var g = p.g || 0;   // 刺區與高台之間多出的平地欄數(規格沒有; 只供建議方案驗證, 預設 0)
      fill(cols, 0, 9, 0); fill(cols, 12, 17, 0); fill(cols, 21, 28 + s + g, 0); fill(cols, 29 + s + g, 39, 5);
      for (i = 24 + s; i <= 28 + s; i++) spike[i] = 1;
      lv.period = 240; lv.outS = 120; lv.outE = 240;
      lv.goalCol = 35;
      inf.zone = [24 + s, 28 + s]; inf.platCol = 29 + s + g;
    } else if (id === 2) {
      fill(cols, 0, 7, 0); fill(cols, 10, 13, 0); fill(cols, 14, 16, 3);
      fill(cols, 17, p.cl - 1, 8); fill(cols, p.cl, 39, 13);
      for (i = 14; i <= 16; i++) spike[i] = 1;
      for (i = p.sl; i <= p.sl + 4; i++) spike[i] = 1;
      lv.period = 300; lv.outS = 180; lv.outE = 300;
      lv.goalCol = 35;
      inf.pillar = [14, 16]; inf.zone = [p.sl, p.sl + 4]; inf.bCol = 17; inf.platCol = p.cl;
    } else if (id === 3) {
      var sr = p.sl + p.w - 1;
      fill(cols, 0, 9, 1);
      for (i = 4; i <= 8; i++) spike[i] = 1;
      fill(cols, p.sl, sr, -1);
      fill(cols, p.bl, 38, 7.5); cols[39] = 12.5;
      var z0 = 34 + p.sp;
      for (i = z0; i <= z0 + 4; i++) spike[i] = 1;
      lv.period = 240; lv.outS = 0; lv.outE = 120;
      lv.goalCol = 39;
      inf.corridor = [4, 8]; inf.edge = 9; inf.stump = [p.sl, sr]; inf.bCol = p.bl;
      inf.zone = [z0, z0 + 4]; inf.platCol = 39;
    } else {
      fill(cols, 0, 5, 0); fill(cols, 8, 11, 0); fill(cols, 12, 14, 3); fill(cols, 15, 16, 0);
      fill(cols, 17, 18, 8); fill(cols, 19, p.re, 9.5);
      var sr4 = p.sl + p.w - 1;
      fill(cols, p.sl, sr4, 7.5); fill(cols, p.cl, 39, 16);
      for (i = 12; i <= 14; i++) spike[i] = 1;
      for (i = 19; i <= p.re; i++) spike[i] = 1;
      lv.period = 360; lv.outS = 132; lv.outE = 360;
      lv.goalCol = 38;
      inf.pillar = [12, 14]; inf.safe = [17, 18]; inf.zone = [19, p.re]; inf.stump = [p.sl, sr4];
      inf.platCol = p.cl;
    }
    lv.cols = cols; lv.spike = spike;
    lv.spawnX = lv.spawnCol + 0.5; lv.spawnH = cols[lv.spawnCol];
    lv.goalH = cols[lv.goalCol];
    lv.params = p;
    return lv;
  }

  // 給 Art.drawTerrain / drawPit 用的 cols(坑 = null)
  function artCols(lv) {
    var o = [];
    for (var i = 0; i < 40; i++) o[i] = lv.cols[i] <= PIT ? null : lv.cols[i];
    return o;
  }

  function spikeOut(lv, k) {
    var s = k % lv.period;
    return s >= lv.outS && s < lv.outE;
  }

  // ---------------------------------------------------------------- 錄影 / 幽靈
  // frames: 逐幀 {x,h,gk(0 騰空 1 站地形 2 站幽靈頭頂),fc}; 錄影長度 L = n - 1 幀
  function buildRec(xs, hs, gk, fc) {
    var n = xs.length, i;
    var rec = { n: n, L: n - 1, xs: xs, hs: hs, gk: gk, fc: fc, gr: new Uint8Array(n), ax: new Float64Array(n), ah: new Float64Array(n) };
    for (i = 0; i < n; i++) rec.gr[i] = gk[i] ? 1 : 0;
    i = 0;
    while (i < n) {
      if (rec.gr[i]) { i++; continue; }
      var j = i, m = i;
      while (j + 1 < n && !rec.gr[j + 1]) { j++; if (hs[j] > hs[m] + 1e-12) m = j; }
      for (var q = i; q <= j; q++) { rec.ax[q] = xs[m]; rec.ah[q] = hs[m] + 2; }
      i = j + 1;
    }
    return rec;
  }

  function loopLenFor(lv, rec) {
    return Math.ceil((rec.L + FADE) / lv.period) * lv.period;
  }

  // E = 一名角色的環境: 關卡 + 他看到的幽靈
  function makeE(lv, rec) {
    var E = { lv: lv, rec: rec || null, loopLen: 0, L: -1, ev: null };
    if (rec) { E.loopLen = loopLenFor(lv, rec); E.L = rec.L; }
    return E;
  }

  // 幽靈相位: 0 播放, 1 淡出, 2 空檔, -1 沒有幽靈
  function ghostPhase(E, g) {
    if (!E.rec) return -1;
    if (g <= E.L) return 0;
    if (g <= E.L + FADE) return 1;
    return 2;
  }

  // 繪圖用的幽靈視圖(沒有 / 空檔回 null)
  function ghostView(E, clk) {
    if (!E.rec) return null;
    var g = clk % E.loopLen, ph = ghostPhase(E, g), r = E.rec;
    if (ph === 2) return null;
    if (ph === 0) {
      return { phase: 'play', x: r.xs[g], h: r.hs[g], grounded: r.gr[g] === 1, expiring: g > E.L - EXPIRE, fade: 0, facing: r.fc[g], g: g };
    }
    return { phase: 'fading', x: r.xs[E.L], h: r.hs[E.L], grounded: r.gr[E.L] === 1, expiring: false, fade: (g - E.L) / FADE, facing: r.fc[E.L], g: g };
  }

  // ---------------------------------------------------------------- 玩家
  function newPlayer(lv) {
    return {
      k: 0, x: lv.spawnX, h: lv.spawnH, vy: 0, grounded: true, onGhost: false, fc: 1,
      lastTH: lv.spawnH, hookUsed: false, airJump: false,
      pulling: false, ptx: 0, pth: 0, pax: 0, pah: 0, bufJump: false,
      dead: 0, goal: false
    };
  }
  function clonePlayer(P) {
    return {
      k: P.k, x: P.x, h: P.h, vy: P.vy, grounded: P.grounded, onGhost: P.onGhost, fc: P.fc,
      lastTH: P.lastTH, hookUsed: P.hookUsed, airJump: P.airJump,
      pulling: P.pulling, ptx: P.ptx, pth: P.pth, pax: P.pax, pah: P.pah, bufJump: P.bufJump,
      dead: P.dead, goal: P.goal
    };
  }

  function rnd(v) { return Math.round(v * 1e9) / 1e9; }

  // 身體(x±0.5, h~h+2)是否與地形重疊
  function overlaps(cols, x, h) {
    var c0 = Math.floor(x - 0.5 + EPS), c1 = Math.ceil(x + 0.5 - EPS) - 1;
    if (x - 0.5 < -EPS || x + 0.5 > 40 + EPS) return true;
    for (var c = c0; c <= c1; c++) if (cols[c] > h + EPS) return true;
    return false;
  }

  function moveX(P, cols, dx) {
    var nx = P.x + dx, c;
    if (dx > 0) {
      var r0 = P.x + 0.5, r1 = nx + 0.5;
      for (c = Math.ceil(r0 - EPS); c < r1 - EPS; c++) {
        if (c > 39) { nx = 39.5; break; }
        if (cols[c] > P.h + EPS) { nx = c - 0.5; break; }
      }
    } else if (dx < 0) {
      var l0 = P.x - 0.5, l1 = nx - 0.5;
      for (c = Math.floor(l0 + EPS) - 1; c + 1 > l1 + EPS; c--) {
        if (c < 0) { nx = 0.5; break; }
        if (cols[c] > P.h + EPS) { nx = c + 1.5; break; }
      }
    }
    P.x = rnd(nx);
  }

  // 下落中身體與地形重疊、但腳底中心不在該欄: 水平推回腳底中心那一側
  function cornerPush(P, cols) {
    var cc = Math.floor(P.x + EPS);
    var c0 = Math.floor(P.x - 0.5 + EPS), c1 = Math.ceil(P.x + 0.5 - EPS) - 1;
    for (var c = c0; c <= c1; c++) {
      if (c === cc) continue;
      if (cols[c] > P.h + EPS) {
        P.x = rnd(c < cc ? c + 1.5 : c - 0.5);
        return;
      }
    }
  }

  // 鉤爪判定; 回傳 0 = 鉤中, 1 未騰空, 2 淡出中, 3 超出射程, 4 錨點不高於腳底, 5 已達上限
  function hookReason(P, E, g) {
    if (!E.rec) return 1;
    var ph = ghostPhase(E, g);
    if (ph !== 0) return 2;
    var r = E.rec;
    if (r.gr[g]) return 1;
    var dx = r.xs[g] - P.x, dh = r.hs[g] - P.h;
    if (dx * dx + dh * dh > HOOK_RANGE * HOOK_RANGE) return 3;
    if (!(r.hs[g] > P.h + EPS)) return 4;
    if (P.hookUsed || !(P.h < P.lastTH + LIFT - EPS)) return 5;
    return 0;
  }

  function startPull(P, E, g) {
    var r = E.rec, ax = r.ax[g], ah = r.ah[g];
    var cap = P.lastTH + LIFT;
    var tx = ax, th = ah;
    if (ah > cap) {
      var t = (cap - P.h) / (ah - P.h);
      tx = P.x + (ax - P.x) * t; th = cap;
    }
    P.pulling = true; P.pax = ax; P.pah = ah; P.ptx = tx; P.pth = th;
    P.grounded = false; P.onGhost = false; P.vy = 0; P.hookUsed = true; P.airJump = true; P.bufJump = false;
  }

  // 拉動: 25 格/秒直線走向終點; 撞地形 / 到終點 / 到上限即結束。回傳 true = 這幀拉動結束
  function doPull(P, E, out, ev) {
    var lv = E.lv, cols = lv.cols;
    var remain = PULL_SPEED * DT, ended = false, why = 0;
    while (remain > 1e-12) {
      var dx = P.ptx - P.x, dh = P.pth - P.h, d = Math.sqrt(dx * dx + dh * dh);
      if (d <= 1e-9) { ended = true; why = 1; break; }
      var m = Math.min(0.05, remain, d);
      var nx = P.x + dx / d * m, nh = P.h + dh / d * m;
      if (overlaps(cols, nx, nh)) {
        var lo = 0, hi = 1, i;
        for (i = 0; i < 12; i++) {
          var mid = (lo + hi) / 2;
          if (overlaps(cols, P.x + (nx - P.x) * mid, P.h + (nh - P.h) * mid)) hi = mid; else lo = mid;
        }
        P.x = rnd(P.x + (nx - P.x) * lo); P.h = P.h + (nh - P.h) * lo;
        ended = true; why = 2; break;
      }
      P.x = nx; P.h = nh; remain -= m;
      if (m >= d - 1e-9) { P.x = P.ptx; P.h = P.pth; ended = true; why = (P.pth < P.pah - 1e-9) ? 3 : 1; break; }
      if (out) {
        var c = Math.floor(P.x + EPS);
        if (lv.spike[c]) { var s = cols[c]; if (P.h >= s - EPS && P.h < s + 1 - EPS) { P.dead = 2; break; } }
      }
    }
    if (P.dead) { P.pulling = false; return true; }
    if (ended) {
      // 終點格若是伸出的尖刺格也要判
      if (out) {
        var c2 = Math.floor(P.x + EPS);
        if (lv.spike[c2]) { var s2 = cols[c2]; if (P.h >= s2 - EPS && P.h < s2 + 1 - EPS) P.dead = 2; }
      }
      P.pulling = false; P.vy = 0;
      if (ev) ev('pullEnd', { x: P.x, h: P.h, why: why });
    }
    return ended;
  }

  // 前進一幀。dir: -1/0/1(按住); jumpEdge / hookEdge: 這幀新按下; jumpHeld: 空白鍵目前是否按住
  function stepPlayer(P, dir, jumpEdge, hookEdge, jumpHeld, E, ev) {
    var lv = E.lv, cols = lv.cols, rec = E.rec;
    var k0 = P.k, wantJump = jumpEdge;
    var g0 = E.loopLen ? k0 % E.loopLen : -1;

    // 1) X 先處理(鉤中則這次空白鍵作廢)
    if (hookEdge && lv.hook && !P.pulling) {
      var why = hookReason(P, E, g0);
      if (ev) ev('hook', { why: why, g: g0, k: k0 });
      if (why === 0) { startPull(P, E, g0); wantJump = false; if (ev) ev('hookHit', { g: g0 }); }
    } else if (wantJump && P.pulling) {
      P.bufJump = true;
    }

    P.k = k0 + 1;
    var k = P.k, out = spikeOut(lv, k);
    var g = E.loopLen ? k % E.loopLen : -1;
    var gp = ghostPhase(E, g);
    var gOK = gp === 0 && rec.gr[g] === 1;   // 幽靈此幀站立且未淡出 -> 頭頂存在

    if (dir !== 0) P.fc = dir;

    if (P.pulling) {
      var fin = doPull(P, E, out, ev);
      if (fin && !P.dead && P.bufJump && jumpHeld) { P.vy = V0; P.airJump = false; if (ev) ev('jump', { kind: 'airjump' }); }
      if (fin) P.bufJump = false;
    } else {
      // 2) 跳躍
      if (wantJump) {
        if (P.grounded) {
          if (ev) ev('jump', { kind: P.onGhost ? 'ghost' : 'terrain' });
          P.vy = V0; P.grounded = false; P.onGhost = false;
        } else if (P.airJump) {
          if (ev) ev('jump', { kind: 'airjump' });
          P.vy = V0; P.airJump = false;
        }
      }
      // 3) 水平(站在幽靈頭頂時加上幽靈該幀位移)
      var dx = dir * WALK;
      if (P.grounded && P.onGhost && gOK) {
        var gp0 = k0 % E.loopLen;
        dx += rec.xs[g] - rec.xs[gp0];
      }
      if (dx !== 0) moveX(P, cols, dx);
      // 4) 支撐檢查
      if (P.grounded) {
        if (P.onGhost) {
          if (gOK && Math.abs(P.x - rec.xs[g]) <= 0.5 + EPS) {
            P.h = rec.hs[g] + 2;
          } else { P.grounded = false; P.onGhost = false; P.vy = 0; if (ev) ev('fall', { from: 'ghost', fading: gp === 1 }); }
        } else {
          var c = Math.floor(P.x + EPS), sf = cols[c];
          if (!(sf > PIT && Math.abs(P.h - sf) < 1e-9)) { P.grounded = false; P.vy = 0; if (ev) ev('fall', { from: 'terrain' }); }
        }
      }
      // 5) 垂直
      if (!P.grounded) {
        var oldh = P.h, nh = oldh + P.vy * DT - 0.5 * GRAV * DT * DT;
        P.vy -= GRAV * DT;
        var landed = false;
        if (nh < oldh) {
          var cs = -1e18, kind = 0;
          var c0 = Math.floor(P.x + EPS), s0 = cols[c0];
          if (s0 > PIT && oldh >= s0 - EPS && nh <= s0) { cs = s0; kind = 1; }
          if (gOK && Math.abs(P.x - rec.xs[g]) <= 0.5 + EPS) {
            var top = rec.hs[g] + 2;
            if (oldh >= top - EPS && nh <= top && top > cs) { cs = top; kind = 2; }
          }
          if (kind) {
            landed = true;
            P.h = cs; P.vy = 0; P.grounded = true; P.onGhost = kind === 2;
            P.hookUsed = false; P.airJump = false;
            if (kind === 1) P.lastTH = cs;
            if (ev) ev('land', { kind: kind, g: g });
          }
        }
        if (!landed) {
          P.h = nh;
          if (nh < oldh) cornerPush(P, cols);
        }
      }
    }

    // 6) 死亡 / 過關判定: 坑 > 陷阱 > 錄影上限; 同幀碰旗判過關
    var gc = lv.goalCol, gh = lv.goalH;
    if (P.x + 0.5 > gc + EPS && P.x - 0.5 < gc + 1 - EPS && P.h < gh + 2 + EPS && P.h + 2 > gh - EPS) {
      P.goal = true; P.dead = 0;
      if (ev) ev('goal', {});
      return;
    }
    if (P.h < -2) { P.dead = 1; }
    else if (!P.dead) {
      if (out && !(P.grounded && P.onGhost)) {
        var cx = Math.floor(P.x + EPS);
        if (lv.spike[cx]) { var ss = cols[cx]; if (P.h >= ss - EPS && P.h < ss + 1 - EPS) P.dead = 2; }
      }
      if (!P.dead && k >= REC_LIMIT) P.dead = 3;
    }
    if (P.dead && ev) ev('death', { cause: P.dead });
  }

  // ---------------------------------------------------------------- 關內流程
  // cb(type, data): 給埋點 / UI 的通知
  function Session(levelId, params, cb) {
    this.id = levelId;
    this.lv = buildLevel(levelId, params);
    this.cb = cb || function () {};
    this.runner = 1;
    this.recs = [null, null, null, null];   // recs[i] = 角色 i 的錄影(角色 i+1 的幽靈)
    this.round = 0;
    this.frames = 0;                        // 本關總幀(含待命, 不含凍結)
    this.deathCause = 0;
    this.delayF = 0;
    this.standbyF = 0;
    this.lifeId = 0;
    this._toStandby(true);
  }

  Session.prototype._toStandby = function (first) {
    this.phase = 'standby';
    this.clk = 0;
    this.standbyF = 0;
    this.P = newPlayer(this.lv);
    this.E = makeE(this.lv, this.recs[this.runner - 1]);
    this.E.ev = null;
    this.cb('standby', { runner: this.runner, first: !!first, ghostLoop: this.E.loopLen });
  };

  Session.prototype._birth = function () {
    this.phase = 'alive';
    this.clk = 0;
    this.P = newPlayer(this.lv);
    this.lifeId++;
    if (this.runner === 1) this.round++;
    this.rx = [this.P.x]; this.rh = [this.P.h]; this.rg = [1]; this.rf = [1];
    this.cb('birth', { runner: this.runner, round: this.round, lifeId: this.lifeId, standbyF: this.standbyF });
  };

  // inp: {dir, left, right, jump, hook, jumpHeld, r, b}  (left/right/jump/hook/r/b 皆為「這幀新按下」)
  Session.prototype.step = function (inp) {
    var self = this;
    if (this.phase === 'goal') return;
    this.frames++;
    if (this.phase === 'standby') {
      if (inp.b && this.runner > 1) {
        this.cb('redo', { kind: 'B', runner: this.runner, born: false });
        this.recs[this.runner - 1] = null; this.runner--; this._toStandby(false);
        return;
      }
      if (inp.left || inp.right || inp.jump) { this._birth(); return; }
      this.standbyF++; this.clk++;
      return;
    }
    if (this.phase === 'delay') {
      this.delayF++; this.clk++;
      if (this.delayF >= DELAY) {
        var prevRunner = this.runner;
        if (this.runner < 3) this.runner++;
        this.cb('redo', { kind: prevRunner === 3 ? 'auto3' : 'next', runner: this.runner, born: false });
        this._toStandby(false);
      }
      return;
    }
    // alive
    if (inp.r) {
      this.cb('redo', { kind: 'R', runner: this.runner, born: true });
      this.cb('lifeVoid', { runner: this.runner });
      this._toStandby(false);
      return;
    }
    if (inp.b && this.runner > 1) {
      this.cb('redo', { kind: 'B', runner: this.runner, born: true });
      this.cb('lifeVoid', { runner: this.runner });
      this.recs[this.runner - 1] = null; this.runner--; this._toStandby(false);
      return;
    }
    var P = this.P;
    this.E.ev = function (t, d) { self.cb('ev:' + t, d); };
    stepPlayer(P, inp.dir, inp.jump, inp.hook, inp.jumpHeld, this.E, this.E.ev);
    this.clk = P.k;
    this.rx.push(P.x); this.rh.push(P.h); this.rg.push(P.grounded ? (P.onGhost ? 2 : 1) : 0); this.rf.push(P.fc);
    this.cb('afterStep', { P: P });
    if (P.goal) {
      this.recs[this.runner] = this._makeRec();
      this.phase = 'goal';
      this.cb('goal', { runner: this.runner });
    } else if (P.dead) {
      this.deathCause = P.dead;
      this.recs[this.runner] = this._makeRec();
      this.phase = 'delay'; this.delayF = 0;
      this.cb('death', { cause: P.dead, runner: this.runner });
    }
  };

  Session.prototype._makeRec = function () {
    return buildRec(new Float64Array(this.rx), new Float64Array(this.rh), new Uint8Array(this.rg), new Int8Array(this.rf));
  };

  // ---------------------------------------------------------------- 通關條件判定(telemetry.md「本輪幽靈是否滿足通關條件」)
  // 門檻由 verify.js 校正後寫在這裡
  var GATE = {
    // 由 verify.js「gate」校正(角色 3 以最佳應對掃描, 起跳窗 >= 18 幀 ⇔ 判定「是」); 單位: 幀 / 格
    1: { stand: 18, x: 24.7 },
    2: { pillarStand: 48, zoneStand: 18, zoneX: 26.8 },
    3: { ah: 8.0, ax: 18.5, zoneStand: 27, zoneX: 34.3 },
    4: { ah: 12.99, ax: 31.2, cMin: 110, cMax: 175 }
  };

  function runsOf(n, pred) {
    var out = [], i = 0;
    while (i < n) {
      if (!pred(i)) { i++; continue; }
      var j = i;
      while (j + 1 < n && pred(j + 1)) j++;
      out.push([i, j]);
      i = j + 1;
    }
    return out;
  }
  function colOf(x) { return Math.floor(x + EPS); }

  // 回傳 {ok, keys} ; keys 為判定關鍵量
  function gateEval(lv, rec, G) {
    G = G || GATE[lv.id];
    var inf = lv.info, n = rec.n, xs = rec.xs, hs = rec.hs, gk = rec.gk, cols = lv.cols;
    var res = { ok: false, keys: {} }, i, runs, best, r;
    function standRuns(c0, c1, h) {
      return runsOf(n, function (f) { var c = colOf(xs[f]); return gk[f] === 1 && c >= c0 && c <= c1 && Math.abs(hs[f] - h) < 1e-6; });
    }
    function standRunsX(c0, c1, h, X) {   // 站在該段、且中心 x >= X 的連續幀(走進來那幾幀 x 不夠的不算)
      return runsOf(n, function (f) { var c = colOf(xs[f]); return gk[f] === 1 && c >= c0 && c <= c1 && Math.abs(hs[f] - h) < 1e-6 && xs[f] >= X - 1e-9; });
    }
    function minX(r) { var m = 1e9; for (var f = r[0]; f <= r[1]; f++) if (xs[f] < m) m = xs[f]; return m; }
    if (lv.id === 1) {
      runs = standRuns(inf.zone[0], inf.zone[1], 0);
      best = null;
      for (i = 0; i < runs.length; i++) {
        r = runs[i];
        // 取這段站立中「中心 x ≥ 門檻」的最長連續子段
        var sub = runsOf(r[1] + 1, function (f) { return f >= r[0] && xs[f] >= G.x - 1e-9; });
        for (var q = 0; q < sub.length; q++) { var len = sub[q][1] - sub[q][0] + 1; if (!best || len > best.len) best = { len: len, x: xs[sub[q][1]] }; }
      }
      res.keys = { standSec: best ? best.len / FPS : 0, x: best ? best.x : null };
      res.ok = !!best && best.len >= G.stand;
    } else if (lv.id === 2) {
      var a = standRuns(inf.pillar[0], inf.pillar[1], 3), bz = standRunsX(inf.zone[0], inf.zone[1], 8, G.zoneX);
      var aBest = null, bBest = null;
      for (i = 0; i < a.length; i++) if (!aBest || a[i][1] - a[i][0] > aBest[1] - aBest[0]) aBest = a[i];
      var aOK = aBest && (aBest[1] - aBest[0] + 1) >= G.pillarStand;
      // (b) 要晚於 (a)
      for (i = 0; i < bz.length; i++) {
        r = bz[i];
        var okB = (r[1] - r[0] + 1) >= G.zoneStand && aBest && r[0] > aBest[1];
        if (okB && (!bBest || r[1] - r[0] > bBest[1] - bBest[0])) bBest = r;
      }
      res.keys = {
        pillarSec: aBest ? (aBest[1] - aBest[0] + 1) / FPS : 0,
        zoneSec: bBest ? (bBest[1] - bBest[0] + 1) / FPS : 0, zoneX: bBest ? xs[bBest[1]] : null
      };
      res.ok = !!(aOK && bBest);
    } else if (lv.id === 3) {
      var segs = airSegs(rec), okA = null, kx = null, kh = null;
      for (i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (s.start < 1) continue;
        var pf = s.start - 1;
        if (gk[pf] !== 1 || colOf(xs[pf]) !== inf.edge) continue;
        if (kx === null || rec.ax[s.start] > kx) { kx = rec.ax[s.start]; kh = rec.ah[s.start]; }
        if (rec.ah[s.start] >= G.ah - 1e-9 && rec.ax[s.start] >= G.ax - 1e-9) okA = s;
      }
      var zr = standRunsX(inf.zone[0], inf.zone[1], 7.5, G.zoneX), zb = null;
      for (i = 0; i < zr.length; i++) {
        r = zr[i];
        if ((r[1] - r[0] + 1) >= G.zoneStand && (!zb || r[1] - r[0] > zb[1] - zb[0])) zb = r;
      }
      res.keys = { ax: kx, ah: kh, zoneSec: zb ? (zb[1] - zb[0] + 1) / FPS : 0, zoneX: zb ? xs[zb[1]] : null };
      res.ok = !!(okA && zb);
    } else {
      var onB = false;
      for (i = 0; i < n; i++) { var cc = colOf(xs[i]); if (gk[i] === 1 && cc >= 17 && cc <= inf.zone[1] && hs[i] >= 8 - 1e-6) { onB = true; break; } }
      var sg = airSegs(rec), okSeg = null, bx = null, bh = null, bc = null;
      for (i = 0; i < sg.length; i++) {
        var s4 = sg[i];
        if (s4.start < 1) continue;
        var p4 = s4.start - 1;
        var c4 = colOf(xs[p4]);
        if (gk[p4] !== 1 || c4 < inf.stump[0] || c4 > inf.stump[1] || Math.abs(hs[p4] - 7.5) > 1e-6) continue;
        var ph = s4.start % lv.period;
        if (bx === null || rec.ax[s4.start] > bx) { bx = rec.ax[s4.start]; bh = rec.ah[s4.start]; bc = ph / FPS; }
        if (rec.ah[s4.start] >= G.ah - 1e-9 && rec.ax[s4.start] >= G.ax - 1e-9 && ph >= G.cMin && ph <= G.cMax) okSeg = s4;
      }
      res.keys = { onB: onB, ax: bx, ah: bh, startSinceRetract: bc };
      res.ok = !!(onB && okSeg);
    }
    return res;
  }

  function airSegs(rec) {
    var out = [], i = 0, n = rec.n;
    while (i < n) {
      if (rec.gr[i]) { i++; continue; }
      var j = i;
      while (j + 1 < n && !rec.gr[j + 1]) j++;
      out.push({ start: i, end: j });
      i = j + 1;
    }
    return out;
  }

  var API = {
    FPS: FPS, DT: DT, WALK: WALK, V0: V0, GRAV: GRAV, PIT: PIT, REC_LIMIT: REC_LIMIT, FADE: FADE, EXPIRE: EXPIRE, DELAY: DELAY,
    PARAMS: PARAMS, GATE: GATE,
    buildLevel: buildLevel, artCols: artCols, spikeOut: spikeOut,
    buildRec: buildRec, makeE: makeE, ghostPhase: ghostPhase, ghostView: ghostView, loopLenFor: loopLenFor,
    newPlayer: newPlayer, clonePlayer: clonePlayer, stepPlayer: stepPlayer, hookReason: hookReason,
    Session: Session, gateEval: gateEval, airSegs: airSegs, runsOf: runsOf, colOf: colOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.GhostCore = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

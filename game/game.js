// GhostEcho game: 畫面流程 / 輸入 / 繪製(只呼叫 Art.drawXxx) / 埋點。物理與判定都在 core.js。
(function () {
  'use strict';
  var Core = window.GhostCore, Art = window.Art;
  var FPS = Core.FPS, STEP = 1 / FPS;

  // ------------------------------------------------------------------ 佔位圖形
  // style.md 的物件表涵蓋所有遊戲物件, 目前沒有需要佔位的圖形。
  var Placeholder = {};

  // ------------------------------------------------------------------ 關卡中繼資料(埋點用)
  function inRange(c, r) { return c >= r[0] && c <= r[1]; }
  function colOf(x) { return Math.floor(x + 1e-9); }
  function blockLeft(lv, c) { var h = lv.cols[c]; while (c > 0 && lv.cols[c - 1] === h) c--; return c; }
  function blockRight(lv, c) { var h = lv.cols[c]; while (c < 39 && lv.cols[c + 1] === h) c++; return c; }

  function meta(lv) {
    var I = lv.info, id = lv.id, m = { surf: null, points: [], traps: [], pitTraps: [], layers: [], checks: [], zoneRange: I.zone };
    if (id === 1) {
      m.surf = function (c) { return inRange(c, I.zone) ? '1-刺區' : c >= I.platCol ? '高台' : '地面'; };
      m.points = [{ name: '1-刺區', r: I.zone }];
      m.traps = [{ name: '1-刺區', r: I.zone, layer: 0 }];
      m.layers = [{ name: '高台', r: [I.platCol, 39], h: 5, need: { type: 'head', point: '1-刺區' } }];
      m.trapLayer = [{ r: [21, I.zone[1]], h: 0 }];
      m.checks = ['進入1-刺區', '在1-刺區踩頭成功', '站上高台'];
    } else if (id === 2) {
      m.surf = function (c) { return inRange(c, I.pillar) ? '2-柱(柱A頂)' : inRange(c, I.zone) ? '2-刺區' : c >= I.platCol ? '平台C' : c >= 17 ? '平台B' : '地面'; };
      m.points = [{ name: '2-柱', r: I.pillar }, { name: '2-刺區', r: I.zone }];
      m.traps = [{ name: '2-柱', r: I.pillar, layer: 0 }, { name: '2-刺區', r: I.zone, layer: 1 }];
      m.layers = [{ name: '平台B', r: [17, I.platCol - 1], h: 8, need: { type: 'head', point: '2-柱' } },
                  { name: '平台C', r: [I.platCol, 39], h: 13, need: { type: 'head', point: '2-刺區' } }];
      m.trapLayer = [{ r: I.pillar, h: 3 }, { r: [17, I.platCol - 1], h: 8 }];
      m.checks = ['站上柱A頂', '在柱A頂連續站立>=1.2秒', '在2-柱踩頭成功', '站上平台B', '進入2-刺區', '在2-刺區踩頭成功', '站上平台C'];
    } else if (id === 3) {
      m.surf = function (c) { return inRange(c, I.corridor) ? '尖刺走廊' : c === I.edge ? '3-坑邊' : inRange(c, I.stump) ? '3-矮樁' : inRange(c, I.zone) ? '3-刺區' : c === 39 ? '平台C' : c >= I.bCol ? '平台B' : '地面'; };
      m.points = [{ name: '3-坑邊', r: [I.edge, I.edge] }, { name: '3-刺區', r: I.zone }];
      m.traps = [{ name: '3-刺區', r: I.zone, layer: 0 }];
      m.pitTraps = [{ name: '3-矮樁', r: I.stump }];
      m.layers = [{ name: '平台B', r: [I.bCol, 38], h: 7.5, need: { type: 'hook', point: '3-坑邊' } },
                  { name: '平台C', r: [39, 39], h: 12.5, need: { type: 'head', point: '3-刺區' } }];
      m.trapLayer = [{ r: [I.bCol, 38], h: 7.5 }];
      m.checks = ['通過尖刺走廊', '站上3-矮樁', '從3-矮樁起跳', '從3-坑邊鉤中', '站上平台B', '進入3-刺區', '在3-刺區踩頭成功', '站上平台C'];
    } else {
      m.surf = function (c) { return inRange(c, I.pillar) ? '4-柱(柱A頂)' : inRange(c, I.safe) ? '4-安全區' : inRange(c, I.zone) ? '4-B刺區' : inRange(c, I.stump) ? '4-矮樁' : c >= I.platCol ? '平台C' : '地面'; };
      m.points = [{ name: '4-柱', r: I.pillar }, { name: '4-B刺區', r: I.zone }];
      m.traps = [{ name: '4-柱', r: I.pillar, layer: 0 }];
      m.pitTraps = [{ name: '4-矮樁', r: I.stump }];
      m.layers = [{ name: '平台B', r: [17, I.zone[1]], h: null, need: { type: 'headOrHook', point: '4-柱' } },
                  { name: '平台C', r: [I.platCol, 39], h: 16, need: { type: 'hook', point: '4-B刺區' } }];
      m.trapLayer = [{ r: I.pillar, h: 3 }];
      m.checks = ['站上柱A頂', '在4-柱踩頭或鉤中', '站上安全區', '尖刺收起中站上B刺區', '站上4-矮樁', '從4-矮樁起跳', '從4-B刺區鉤中', '站上平台C'];
    }
    return m;
  }

  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function secs(frames) { return r2(frames / FPS); }

  // ------------------------------------------------------------------ 埋點(telemetry.md v3)
  function Tele(sess, runMode) {
    this.sess = sess; this.lv = sess.lv; this.m = meta(sess.lv); this.runMode = runMode;
    this.events = []; this.lives = [];
    this.life = null;
    this.stand = { id: null, f: 0 };
    this.hkPending = null;
    this.flight = null;
    this.take = null;
    this.lastInter = null;
    this.hookMiss = 0;
    this.redoList = []; this.auto3Run = 0;
    this.maxRound = 0;
    this.stints = []; this.stint = null;
    this.gateNow = null;
    this.pendingRedo = null;
    this.pauseSec = 0; this.ratingSec = 0;
    this.finished = false; this.logTime = null;
    this.abandoned = false; this.abandonAt = null; this.gotGoal = null; this.rating = null;
    this.firstBirth = false;
  }
  Tele.prototype.T = function () { return r3(this.sess.frames / FPS); };
  Tele.prototype.ev = function (name, f) {
    var o = { 事件: name, 時刻: this.T(), 關卡: this.lv.id };
    for (var k in f) o[k] = f[k];
    this.events.push(o);
    return o;
  };
  Tele.prototype.pointAt = function (x) {
    var c = colOf(x);
    for (var i = 0; i < this.m.points.length; i++) if (inRange(c, this.m.points[i].r)) return this.m.points[i].name;
    return '';
  };
  Tele.prototype.surfName = function (c) { return this.m.surf(c); };
  Tele.prototype.loopSec = function () { var E = this.sess.E; return E.loopLen ? E.loopLen / FPS : 0; };

  // ---- Session 通知
  Tele.prototype.on = function (type, d) {
    var s = this.sess;
    if (!s || this.finished) return;
    var fn = this['h_' + type.replace(':', '_')];
    if (fn) fn.call(this, d);
  };
  Tele.prototype.h_standby = function (d) {
    this.startStandbyAt = this.sess.frames;
    if (d.runner === 3) {
      var rec2 = this.sess.recs[2];
      var res = rec2 ? Core.gateEval(this.lv, rec2) : { ok: false, keys: {} };
      this.gateNow = res;
      if (!res.ok) {
        if (!this.stint) this.stint = { lives: 0, startFrame: this.sess.frames, rec: rec2 };
        else if (this.stint.rec !== rec2) { this.closeStint(); this.stint = { lives: 0, startFrame: this.sess.frames, rec: rec2 }; }
      } else if (this.stint) this.closeStint();
    } else if (this.stint) this.closeStint();
    this.stand = { id: null, f: 0 };
    this.flight = null; this.take = null;
  };
  Tele.prototype.closeStint = function () {
    if (!this.stint) return;
    this.stints.push({ 命數: this.stint.lives, 合計秒數: secs(this.sess.frames - this.stint.startFrame) });
    this.stint = null;
  };
  Tele.prototype.h_birth = function (d) {
    var s = this.sess, lv = this.lv, E = s.E, runner = d.runner;
    this.maxRound = Math.max(this.maxRound, d.round);
    var loop = E.loopLen ? E.loopLen / FPS : (lv.period / FPS);
    var o = { 關卡: lv.id, 輪次: d.round, 角色序號: runner, 命ID: d.lifeId, 待命秒數: secs(d.standbyF), 待命秒數除以一圈長度: r3((d.standbyF / FPS) / loop) };
    var ev = { 輪次: d.round, 角色序號: runner, 命ID: d.lifeId, 待命秒數: o.待命秒數, 待命秒數除以一圈長度: o.待命秒數除以一圈長度 };
    if (runner === 3) {
      var g = this.gateNow || (s.recs[2] ? Core.gateEval(lv, s.recs[2]) : { ok: false, keys: {} });
      ev.本輪幽靈是否滿足通關條件 = g.ok ? '是' : '否'; ev.判定關鍵量 = g.keys;
    }
    this.ev('角色出生', ev);
    this.life = {
      rec: o, runner: runner, lifeId: d.lifeId, round: d.round,
      zeroInput: 0, curStill: 0, maxStill: 0, maxH: s.P.h, lastInputK: 0, lastPos: [s.P.x, s.P.h],
      jumpsTotal: 0, dwell: null, stillInPoint: 0, lastJump: null, lastJumpDir: 0, fullSpeed: false,
      firstPointK: null, firstSuccessK: null, ghostFall: 0, layerFirst: {}, unexpected: false, shortcut: '',
      lastOnLayer: {}, curLayerId: null, fromLayerId: null,
      pillarFrames: 0, pillarLeaveK: null, wasPillar: false,
      zoneIn: [], zoneOut: [], safeStints: [], safeRun: 0, wasZone: false,
      checks: {}, standRunPillar: 0, fromTrapLayer: null
    };
    this.stand = { id: null, f: 0 };
    this.take = null; this.flight = null;
    this.lastInter = null;
    this.hkPending = null;
    // 出生當幀: 起點站立面
    var c = colOf(s.P.x);
    this.life.curLayerId = this.layerIdAt(c, s.P.h);
    var self = this;
    this.checkAt(0, s.P, 'birth');
  };
  Tele.prototype.layerIdAt = function (c, h) {
    var L = this.m.layers;
    for (var i = 0; i < L.length; i++) if (inRange(c, L[i].r) && (L[i].h === null ? h >= 8 - 1e-6 : Math.abs(h - L[i].h) < 1e-6)) return i;
    return null;
  };
  Tele.prototype.trapLayerAt = function (c, h) {
    var T = this.m.trapLayer || [];
    for (var i = 0; i < T.length; i++) if (inRange(c, T[i].r) && Math.abs(h - T[i].h) < 1e-6) return i;
    return null;
  };
  Tele.prototype.h_redo = function (d) {
    var s = this.sess;
    var rec = { 種類: '', 發生在第幾名角色: d.runner };
    this.pendingRedo = d;
    if (d.kind === 'auto3') {
      this.auto3Run++;
      this.redoList.push({ 種類: '自動重錄角色3', 發生在第幾名角色: 3 });
      this.ev('重來', { 種類: '自動重錄角色3', 發生在第幾名角色: 3 });
    } else if (d.kind === 'R') {
      this.auto3Run = 0;
      this.redoList.push({ 種類: '重錄這一名', 發生在第幾名角色: d.runner });
      this.ev('重來', { 種類: '重錄這一名', 發生在第幾名角色: d.runner });
    } else if (d.kind === 'B') {
      var o = { 種類: '退回上一名', 發生在第幾名角色: d.runner };
      if (d.runner === 3) o.按B前角色3連續自動重錄次數 = this.auto3Run;
      this.redoList.push(o);
      this.ev('重來', o);
      this.auto3Run = 0;
      if (this.stint) this.closeStint();
    } else { this.auto3Run = 0; }
  };
  Tele.prototype.h_lifeVoid = function () {
    var kind = this.pendingRedo ? this.pendingRedo.kind : 'R';
    this.endLife('', kind === 'B' ? '被B作廢' : '被R作廢');
  };
  Tele.prototype.h_death = function (d) {
    if (this.stint && d.runner === 3) this.stint.lives++;
    var cause = d.cause === 1 ? '坑' : d.cause === 2 ? '陷阱' : '錄影上限';
    this.endLife(cause, '死亡');
  };
  Tele.prototype.h_goal = function (d) {
    this.endLife('', '到終點');
    this.gotGoal = { 時刻: this.T(), 通關時用了幾名角色: d.runner };
    this.ev('過關', { 通關時用了幾名角色: d.runner });
    if (this.stint && d.runner === 3) this.stint.lives++;
    this.closeStint();
  };

  // ---- 每步結束(core 的 afterStep)
  Tele.prototype.h_afterStep = function (d) {
    var s = this.sess, P = d.P, L = this.life, inp = s.lastInp || {};
    if (!L) return;
    var k = P.k, c = colOf(P.x);
    // 輸入統計
    var dir = inp.dir || 0;
    if (!dir && !inp.jumpHeld && !inp.xHeld) L.zeroInput++;
    var moved = Math.abs(P.x - L.lastPos[0]) > 1e-9 || Math.abs(P.h - L.lastPos[1]) > 1e-9;
    if (!moved) { L.curStill++; if (L.curStill > L.maxStill) L.maxStill = L.curStill; } else L.curStill = 0;
    L.lastPos = [P.x, P.h];
    if (P.h > L.maxH) L.maxH = P.h;
    if (L.lastJump && dir !== L.lastJumpDir) L.fullSpeed = false;
    // 站立面連續站立
    if (P.grounded) {
      var id = P.onGhost ? 'G' : 'T' + blockLeft(this.lv, c) + ':' + this.lv.cols[c];
      if (this.stand.id === id) this.stand.f++; else this.stand = { id: id, f: 1 };
    } else this.stand = { id: null, f: 0 };
    // 設計死亡點停留 / 靜止
    var tp = null;
    for (var i = 0; i < this.m.traps.length; i++) if (inRange(c, this.m.traps[i].r)) { tp = this.m.traps[i]; break; }
    if (tp) {
      if (!L.dwell || L.dwell.tp !== tp) {
        var ph = k % this.lv.period, out = Core.spikeOut(this.lv, k);
        var toOut = out ? 0 : (ph < this.lv.outS ? this.lv.outS - ph : this.lv.period - ph + this.lv.outS);
        L.dwell = { tp: tp, startK: k, jumps: 0, toOut: toOut / FPS };
        L.stillInPoint = 0;
      }
      if (!moved && !dir && !(P.vy > 0 && !P.grounded) && P.grounded) L.stillInPoint++; else L.stillInPoint = 0;
    } else { L.dwell = null; L.stillInPoint = 0; }
    // 互動點
    if (L.firstPointK === null) {
      var pn = this.pointAt(P.x);
      if (pn) L.firstPointK = k;
    }
    this.checkAt(k, P, 'step');
    // 第 2 關角色 2 柱頂停留 / 離開
    if (this.lv.id === 2 && L.runner === 2) {
      var onPillar = P.grounded && !P.onGhost && inRange(c, this.lv.info.pillar) && Math.abs(P.h - 3) < 1e-6;
      if (onPillar) { L.pillarFrames++; L.pillarLeaveK = null; }
      else if (L.wasPillar) L.pillarLeaveK = k;
      L.wasPillar = onPillar;
    }
    // 第 4 關安全區等待 / 刺區進出
    if (this.lv.id === 4) {
      var onSafe = P.grounded && !P.onGhost && inRange(c, this.lv.info.safe) && Math.abs(P.h - 8) < 1e-6;
      if (onSafe) L.safeRun++; else if (L.safeRun) { L.safeStints.push(secs(L.safeRun)); L.safeRun = 0; }
      var onZone = P.grounded && !P.onGhost && inRange(c, this.lv.info.zone) && Math.abs(P.h - 9.5) < 1e-6;
      if (L.wasZone && !onZone) L.zoneOut.push(r2((k % this.lv.period) / FPS));
      L.wasZone = onZone;
    }
    // 踩頭落空的飛行追蹤
    var fl = this.flight;
    if (fl && !P.grounded) {
      if (P.h > fl.maxH) fl.maxH = P.h;
      var E = s.E;
      if (E.rec) {
        var g = k % E.loopLen;
        if (g <= E.L && E.rec.gr[g]) {
          var top = E.rec.hs[g] + 2;
          if (top <= fl.maxH + 1e-9 && Math.abs(P.x - E.rec.xs[g]) < 1.0) fl.could = true;
        }
      }
    }
  };

  // ---- 預期動作進度檢查點(首次達成時刻)
  Tele.prototype.mark = function (name, k) {
    var L = this.life, idx = this.m.checks.indexOf(name);
    if (idx < 0 || L.checks[name] !== undefined) return;
    L.checks[name] = r2(k / FPS);
  };
  Tele.prototype.checkAt = function (k, P, why) {
    var L = this.life, lv = this.lv, I = lv.info, c = colOf(P.x), id = lv.id;
    var gT = P.grounded && !P.onGhost;
    if (id === 1) {
      if (inRange(c, I.zone)) this.mark('進入1-刺區', k);
      if (gT && c >= I.platCol && Math.abs(P.h - 5) < 1e-6) this.mark('站上高台', k);
    } else if (id === 2) {
      if (gT && inRange(c, I.pillar) && Math.abs(P.h - 3) < 1e-6) {
        this.mark('站上柱A頂', k);
        L.standRunPillar++; if (L.standRunPillar >= 72) this.mark('在柱A頂連續站立>=1.2秒', k);
      } else L.standRunPillar = 0;
      if (gT && c >= 17 && c <= I.platCol - 1 && Math.abs(P.h - 8) < 1e-6) this.mark('站上平台B', k);
      if (inRange(c, I.zone) && P.h >= 8 - 1e-6) this.mark('進入2-刺區', k);
      if (gT && c >= I.platCol && Math.abs(P.h - 13) < 1e-6) this.mark('站上平台C', k);
    } else if (id === 3) {
      if (c >= I.edge) this.mark('通過尖刺走廊', k);
      if (gT && inRange(c, I.stump)) this.mark('站上3-矮樁', k);
      if (gT && c >= I.bCol && Math.abs(P.h - 7.5) < 1e-6) this.mark('站上平台B', k);
      if (inRange(c, I.zone) && P.h >= 7.5 - 1e-6) this.mark('進入3-刺區', k);
      if (gT && c === 39 && Math.abs(P.h - 12.5) < 1e-6) this.mark('站上平台C', k);
    } else {
      if (gT && inRange(c, I.pillar) && Math.abs(P.h - 3) < 1e-6) this.mark('站上柱A頂', k);
      if (gT && inRange(c, I.safe) && Math.abs(P.h - 8) < 1e-6) this.mark('站上安全區', k);
      if (gT && inRange(c, I.stump)) this.mark('站上4-矮樁', k);
      if (gT && c >= I.platCol && Math.abs(P.h - 16) < 1e-6) this.mark('站上平台C', k);
    }
  };

  // ---- 輸入(按下 / 放開 ←、→、空白鍵、X): 由遊戲層呼叫
  Tele.prototype.noteInput = function () { if (this.life && this.sess.phase === 'alive') this.life.lastInputK = this.sess.P.k; };

  // ---- 起跳
  Tele.prototype.h_ev_jump = function (d) {
    var s = this.sess, P = s.P, L = this.life, lv = this.lv, inp = s.lastInp || {};
    if (!L) return;
    if (d.kind === 'airjump') return;
    var c = colOf(P.x), dir = inp.dir || 0;
    var surfId = this.stand.id, standSec = secs(this.stand.f);
    var edge, name, sL, sR;
    if (d.kind === 'ghost') {
      var E = s.E, g = (P.k - 1) % E.loopLen;
      var gx = E.rec ? E.rec.xs[(P.k - 1) % E.loopLen] : P.x;
      sL = gx - 0.5; sR = gx + 0.5; name = '幽靈頭頂';
    } else {
      sL = blockLeft(lv, c); sR = blockRight(lv, c) + 1; name = this.surfName(c) + '(欄' + sL + '~' + (sR - 1) + ')';
    }
    edge = dir > 0 ? sR - P.x : dir < 0 ? P.x - sL : Math.min(sR - P.x, P.x - sL);
    this.ev('起跳', { 命ID: L.lifeId, 起跳座標: { x: r2(P.x), h: r2(P.h) }, 起跳時刻: r2(P.k / FPS), 站立面: name, 站立面邊緣距離: r2(edge), 起跳前連續站立秒數: standSec });
    L.jumpsTotal++;
    if (L.dwell && inRange(c, L.dwell.tp.r)) L.dwell.jumps++;
    if (d.kind === 'terrain') {
      L.lastJump = { x: r1(P.x), h: r1(P.h), t: r2(P.k / FPS), standSec: standSec };
      L.lastJumpDir = dir; L.fullSpeed = dir !== 0;
    }
    // 離地記錄
    var fromId = null;
    if (d.kind === 'terrain') fromId = { layer: this.trapLayerAt(c, P.h), name: this.surfName(c) };
    this.take = { x: P.x, h: P.h, k: P.k, point: this.pointAt(P.x), kind: d.kind, col: c, surf: d.kind === 'ghost' ? '幽靈頭頂' : this.surfName(c), trapLayer: fromId ? fromId.layer : null };
    L.fromTrapLayer = fromId ? fromId.layer : null;
    if (d.kind === 'terrain' && inRange(c, [lv.info.stump ? lv.info.stump[0] : -9, lv.info.stump ? lv.info.stump[1] : -9]) && (lv.id === 3 || lv.id === 4)) this.mark(lv.id === 3 ? '從3-矮樁起跳' : '從4-矮樁起跳', P.k);
    // 踩頭落空追蹤(從幽靈頭頂起跳的不算: 腳下那顆頭頂本來就在範圍內)
    this.flight = d.kind === 'ghost' ? null : { maxH: P.h, could: false, point: this.pointAt(P.x), startK: P.k };
  };
  Tele.prototype.h_ev_fall = function (d) {
    var s = this.sess, P = s.P, L = this.life, lv = this.lv;
    if (!L) return;
    if (d.from === 'ghost') {
      if (d.fading) L.ghostFall++;
      this.take = { x: P.x, h: P.h, k: P.k, point: this.pointAt(P.x), kind: 'ghost', col: colOf(P.x), surf: '幽靈頭頂', trapLayer: null };
    } else {
      var c = colOf(P.x);
      this.take = { x: P.x, h: P.h, k: P.k, point: this.pointAt(P.x), kind: 'walk', col: c, surf: this.surfName(c), trapLayer: this.trapLayerAt(c, P.h) };
      L.fromTrapLayer = this.take.trapLayer;
    }
  };

  // ---- 落地(含踩頭)
  Tele.prototype.h_ev_land = function (d) {
    var s = this.sess, P = s.P, L = this.life, lv = this.lv, E = s.E;
    if (!L) return;
    var c = colOf(P.x), k = P.k;
    var flight = this.flight; this.flight = null;
    if (d.kind === 2) {
      var g = d.g, rec = E.rec;
      var j = g;
      while (j + 1 <= E.L && rec.gr[j + 1]) j++;
      var remain = (j - g + (j < E.L ? 1 : 0)) / FPS;
      var pn = this.pointAt(P.x);
      this.ev('踩頭', { 命ID: L.lifeId, 成功與否: true, 所在互動點: pn, 落上時距幽靈本段站立結束剩幾秒: r2(remain), 落腳偏移: r2(P.x - rec.xs[g]) });
      if (L.firstPointK !== null && L.firstSuccessK === null) L.firstSuccessK = k;
      this.lastInter = { type: 'head', point: pn, ghostSurf: this.surfName(colOf(rec.xs[g])), ghostCol: colOf(rec.xs[g]), take: this.take };
      // 檢查點
      var lvid = lv.id;
      if (lvid === 1 && pn === '1-刺區') this.mark('在1-刺區踩頭成功', k);
      if (lvid === 2 && pn === '2-柱') this.mark('在2-柱踩頭成功', k);
      if (lvid === 2 && pn === '2-刺區') this.mark('在2-刺區踩頭成功', k);
      if (lvid === 3 && pn === '3-刺區') this.mark('在3-刺區踩頭成功', k);
      if (lvid === 4 && pn === '4-柱') this.mark('在4-柱踩頭或鉤中', k);
    } else if (flight && flight.could && flight.point) {
      this.ev('踩頭', { 命ID: L.lifeId, 成功與否: false, 所在互動點: flight.point, 落上時距幽靈本段站立結束剩幾秒: null, 落腳偏移: null });
    }
    // 鉤爪「是否站上下一層」
    if (this.hkPending) {
      var up = d.kind === 1 && P.h > this.hkPending.lastTH + 1e-9;
      this.hkPending.rec.是否站上下一層 = up;
      this.hkPending = null;
    }
    if (d.kind === 1) {
      // 站上分層
      var lid = this.layerIdAt(c, P.h);
      if (lid !== null && L.layerFirst[lid] === undefined) {
        L.layerFirst[lid] = k;
        this.judgeRoute(lid, P);
      }
      // 最後一次站上該(陷阱型死亡點所屬)分層
      var tl = this.trapLayerAt(c, P.h);
      if (tl !== null && L.fromTrapLayer !== tl) L.lastOnLayer[tl] = k;
      L.fromTrapLayer = tl;
      // 第 4 關刺區落上時機
      if (lv.id === 4 && inRange(c, lv.info.zone) && Math.abs(P.h - 9.5) < 1e-6) {
        L.zoneIn.push(r2((k % lv.period) / FPS));
        if (!Core.spikeOut(lv, k) && (k % lv.period) < lv.outS) this.mark('尖刺收起中站上B刺區', k);
      }
      this.checkAt(k, P, 'land');
    } else {
      L.fromTrapLayer = null;
    }
  };

  // 是否經過非預期路線 / 捷徑旗標: 首次站上某一分層時判定
  Tele.prototype.judgeRoute = function (lid, P) {
    var L = this.life, lv = this.lv, lay = this.m.layers[lid], li = this.lastInter;
    var ok = false;
    if (li && lay.need) {
      if (lay.need.type === 'head') ok = li.type === 'head' && li.point === lay.need.point;
      else if (lay.need.type === 'hook') ok = li.type === 'hook' && li.point === lay.need.point;
      else ok = (li.type === 'head' || li.type === 'hook') && li.point === lay.need.point;
    }
    if (!ok) L.unexpected = true;
    // 捷徑旗標(只第 3、4 關)
    if (lv.id < 3 || L.shortcut) return;
    var code = '';
    var id = lv.id, I = lv.info;
    if (id === 3) {
      if (lid === 0) {   // 上平台 B
        if (li && li.type === 'hook') {
          if (li.ghostTakeoff === '3-坑邊' && li.ghostPlain) code = '3-S1';
          else if (li.ghostTakeoff === '尖刺走廊') code = '3-S2';
          else if (li.ghostTakeoff === '3-矮樁' && li.charTakeoff === '3-矮樁') code = '3-S5';
        } else if (li && li.type === 'head' && li.ghostSurf === '3-坑邊') code = '3-S3';
      } else {           // 上平台 C
        if (li && li.type === 'head' && !inRange(li.ghostCol, I.zone)) code = '3-S8';
        else if (li && li.type === 'hook' && li.charTakeoff === '平台B') code = '3-S9';
        else if (!li || li.type === 'self') code = '3-S4';
      }
    } else {
      if (lid === 0) {
        if (li && li.type === 'head' && li.ghostSurf === '地面') code = '4-S9';
        else if (li && li.type === 'hook' && li.charTakeoff === '地面') code = '4-S8';
      } else {
        if (li && li.type === 'hook') {
          if (li.charTakeoff === '4-矮樁') code = '4-S4';
          else if (li.charTakeoff === '4-安全區') code = '4-S5';
          else if (li.ghostTakeoff === '4-B刺區') code = li.ghostTakeX >= lv.params.re ? '4-S1' : '4-S2';
          else if (li.charTakeoff === '4-B刺區' && li.ghostSurf === '4-柱') code = '4-S7';
        } else if (li && li.type === 'head' && (li.ghostSurf === '4-B刺區' || li.ghostSurf === '4-矮樁')) code = '4-S6';
        else if (!li || li.type === 'self') code = '4-S7';
      }
    }
    L.shortcut = code;
  };

  // ---- 鉤爪
  Tele.prototype.h_ev_hook = function (d) {
    var s = this.sess, P = s.P, L = this.life, E = s.E, lv = this.lv;
    if (!L) return;
    var g = d.g, rec = E.rec, why = d.why;
    var reasons = ['', '未騰空', '淡出中', '超出射程', '錨點不高於腳底', '已達上限'];
    var o = { 命ID: L.lifeId, 成功與否: why === 0, 落空原因: why === 0 ? null : reasons[why] };
    if (rec) {
      var gx = rec.xs[g] !== undefined ? rec.xs[g] : P.x, gh = rec.hs[g] !== undefined ? rec.hs[g] : P.h;
      if (g <= E.L) {
        o.按下時距離 = r2(Math.sqrt((gx - P.x) * (gx - P.x) + (gh - P.h) * (gh - P.h)));
        if (!rec.gr[g]) {
          var j = g; while (j > 0 && !rec.gr[j - 1]) j--;
          o.幽靈已騰空秒數 = secs(g - j);
        } else o.幽靈已騰空秒數 = null;
      } else { o.按下時距離 = null; o.幽靈已騰空秒數 = null; }
      o.幽靈循環相位 = r2(g / E.loopLen);
    } else { o.按下時距離 = null; o.幽靈已騰空秒數 = null; o.幽靈循環相位 = null; }
    o.按下時角色腳底高度 = r1(P.h);
    if (P.grounded) o.角色起跳點與角色已騰空秒數 = { x: r2(P.x), h: r2(P.h), 騰空秒數: 0 };
    else if (this.take) o.角色起跳點與角色已騰空秒數 = { x: r2(this.take.x), h: r2(this.take.h), 騰空秒數: secs(P.k - this.take.k) };
    else o.角色起跳點與角色已騰空秒數 = null;
    o.實際拉動距離 = null; o.拉動終點 = null; o.是否站上下一層 = null;
    var evo = this.ev('鉤爪', o);
    this.pendingHook = { rec: evo, lastTH: P.lastTH, sx: P.x, sh: P.h, why: why };
    if (why !== 0) this.hookMiss++;
    else {
      // 鉤爪起點資訊(供路線判定)
      var take = P.grounded ? { x: P.x, h: P.h, col: colOf(P.x), point: this.pointAt(P.x), surf: this.surfName(colOf(P.x)) } : (this.take || { x: P.x, h: P.h, col: colOf(P.x), point: this.pointAt(P.x), surf: this.surfName(colOf(P.x)) });
      var s0 = g; while (s0 > 0 && !rec.gr[s0 - 1]) s0--;
      var gt = s0 > 0 ? rec.xs[s0 - 1] : rec.xs[0];
      var gTakeSurf = s0 > 0 ? this.surfName(colOf(gt)) : '';
      var gTakeH = s0 > 0 ? rec.hs[s0 - 1] : rec.hs[0];
      var gPlain = (rec.ah[g] - 2) - gTakeH <= 3.5 + 1e-3;   // 幽靈那段騰空只是單純一跳(不含拉動 + 空中跳)
      if (s0 > 0 && rec.gk[s0 - 1] === 2) gTakeSurf = '幽靈頭頂';
      var pt = take.point;
      this.lastInter = { type: 'hook', point: pt, ghostTakeoff: gTakeSurf, ghostTakeX: gt, ghostPlain: gPlain, charTakeoff: take.surf, ghostSurf: gTakeSurf, take: take };
      if (P.grounded && !P.onGhost) L.fromTrapLayer = this.trapLayerAt(colOf(P.x), P.h);
      var lvid = lv.id;
      if (lvid === 3 && pt === '3-坑邊') this.mark('從3-坑邊鉤中', P.k);
      if (lvid === 4 && pt === '4-柱') this.mark('在4-柱踩頭或鉤中', P.k);
      if (lvid === 4 && pt === '4-B刺區') this.mark('從4-B刺區鉤中', P.k);
      if (L.firstPointK !== null && L.firstSuccessK === null) L.firstSuccessK = P.k;
    }
  };
  Tele.prototype.h_ev_hookHit = function () {
    this.hkPending = this.pendingHook;
    if (this.stand.id !== null) { /* 離地 */ }
    this.stand = { id: null, f: 0 };
    this.flight = null;
  };
  Tele.prototype.h_ev_pullEnd = function (d) {
    var hp = this.hkPending;
    if (!hp) return;
    var dist = Math.sqrt((d.x - hp.sx) * (d.x - hp.sx) + (d.h - hp.sh) * (d.h - hp.sh));
    hp.rec.實際拉動距離 = r2(dist);
    hp.rec.拉動終點 = { x: r2(d.x), h: r2(d.h) };
    this.take = { x: d.x, h: d.h, k: this.sess.P.k, point: this.pointAt(d.x), kind: 'pull', col: colOf(d.x), surf: '空中', trapLayer: null };
  };

  // ---- 命結束
  Tele.prototype.endLife = function (cause, how) {
    var s = this.sess, L = this.life, P = s.P, lv = this.lv;
    if (!L) return;
    // 踩頭落空(死前還在飛行)
    if (this.flight && this.flight.could && this.flight.point) {
      this.ev('踩頭', { 命ID: L.lifeId, 成功與否: false, 所在互動點: this.flight.point, 落上時距幽靈本段站立結束剩幾秒: null, 落腳偏移: null });
    }
    this.flight = null;
    if (this.hkPending) { this.hkPending.rec.是否站上下一層 = false; this.hkPending = null; }
    var k = P.k, rec = L.rec;
    rec.存活時長 = secs(k);
    rec.死因 = cause;
    rec.死亡座標 = { x: r1(P.x), h: r1(P.h) };
    rec.結束方式 = how;
    rec.死前最後一次輸入距死亡秒數 = secs(k - L.lastInputK);
    var c = colOf(P.x);
    var tp = null, i;
    for (i = 0; i < this.m.traps.length; i++) if (inRange(c, this.m.traps[i].r)) tp = this.m.traps[i];
    var trapDeath = cause === '陷阱' && tp;
    rec.死前在設計死亡點靜止站立秒數 = (cause !== '' && tp) ? secs(L.stillInPoint) : (this.m.traps.length ? 0 : null);
    if (trapDeath && L.dwell) {
      rec.在設計死亡點停留期間的起跳次數 = L.dwell.jumps;
      rec.落上陷阱型死亡點時距伸出秒數 = r2(L.dwell.toOut);
      var tl = this.m.traps.indexOf(tp);
      var layerI = this.trapLayerAt(c, P.h);
      var lk = layerI !== null && L.lastOnLayer[layerI] !== undefined ? L.lastOnLayer[layerI] : null;
      rec.最後一次站上該分層到死亡秒數 = lk === null ? null : secs(k - lk);
      rec.死亡時陷阱相位 = r2((k % lv.period) / lv.period);
      rec.死亡時第幾圈幽靈循環 = s.E.loopLen ? Math.floor(k / s.E.loopLen) + 1 : null;
    } else if (cause === '陷阱') {
      rec.死亡時陷阱相位 = r2((k % lv.period) / lv.period);
      rec.死亡時第幾圈幽靈循環 = s.E.loopLen ? Math.floor(k / s.E.loopLen) + 1 : null;
    }
    if (cause === '坑' && L.lastJump) {
      rec.死前最後一次起跳 = { x: L.lastJump.x, h: L.lastJump.h, 時刻: L.lastJump.t, 是否全速: !!L.fullSpeed, 起跳前站立秒數: L.lastJump.standSec };
    }
    rec.錄影中零輸入總秒數 = secs(L.zeroInput);
    rec.最長連續靜止秒數 = secs(L.maxStill);
    rec.到達互動點到第一次成功互動的等待秒數 = (L.firstPointK !== null && L.firstSuccessK !== null) ? secs(L.firstSuccessK - L.firstPointK) : null;
    rec.這條命經過幾次幽靈循環 = s.E.loopLen ? Math.floor(k / s.E.loopLen) : 0;
    rec.最高到達高度 = r1(L.maxH);
    rec.是否經過非預期路線 = L.unexpected ? '是' : '否';
    if (lv.id >= 3) rec.捷徑路線使用旗標 = L.shortcut || '';
    rec.循環重置時站在幽靈上而墜落的次數 = L.ghostFall;
    if (lv.id === 2 && L.runner === 2) {
      rec.第2關角色2柱頂停留秒數 = secs(L.pillarFrames);
      rec.第2關角色2離開柱頂時刻 = (L.wasPillar || L.pillarLeaveK === null) ? '' : secs(L.pillarLeaveK);
    }
    if (lv.id === 4) {
      if (L.safeRun) { L.safeStints.push(secs(L.safeRun)); L.safeRun = 0; }
      if (L.wasZone) L.zoneOut.push(r2((k % lv.period) / FPS));
      rec.第4關刺區時機 = { 落上距收起開始秒數: L.zoneIn, 離開距收起開始秒數: L.zoneOut };
      rec.第4關安全區等待秒數 = L.safeStints;
    }
    var cps = {}, cnt = 0;
    for (i = 0; i < this.m.checks.length; i++) { var nm = this.m.checks[i]; cps[nm] = L.checks[nm] !== undefined ? L.checks[nm] : null; if (L.checks[nm] !== undefined) cnt++; }
    rec.預期動作進度檢查點 = { 各檢查點首次達成秒數: cps, 達成的檢查點數: cnt };
    this.lives.push(rec);
    this.ev('命結束', { 命ID: L.lifeId, 角色序號: L.runner, 結束方式: how, 死因: cause, 存活時長: rec.存活時長 });
    this.life = null;
  };

  Tele.prototype.abandon = function () {
    var s = this.sess;
    if (s.phase === 'alive') this.endLife('', '本關被放棄');
    this.abandoned = true; this.abandonAt = this.T();
    this.ev('放棄', { 放棄前耗時: this.abandonAt });
    this.closeStint();
  };
  Tele.prototype.doRating = function (choice) {
    var names = { 1: '碰運氣湊出來', 2: '試了幾次才想通', 3: '一開始就規劃好' };
    this.rating = choice ? names[choice] : '跳過';
    this.ev('自評', { 過關自評: this.rating, 本關鉤爪落空次數: this.hookMiss, 自評畫面停留秒數: r2(this.ratingSec) });
  };
  Tele.prototype.levelRecord = function () {
    var s = this.sess;
    var rec = {
      關卡: this.lv.id, 進關方式: this.runMode === 'select' ? '標題選關' : '依序',
      這關總耗時: this.abandoned ? this.abandonAt : r3(s.frames / FPS),
      暫停與說明累計秒數: r2(this.pauseSec), 跑了幾輪: this.maxRound,
      每次重來的種類與發生在第幾名角色: this.redoList,
      角色3拿到無解幽靈時的命數與秒數: this.stints,
      是否放棄這關: this.abandoned ? '是' : '否',
      放棄前耗時: this.abandoned ? this.abandonAt : null,
      通關時用了幾名角色: this.gotGoal ? this.gotGoal.通關時用了幾名角色 : null
    };
    if (this.lv.id === 1) rec.第1關角色3出生次數 = this.events.filter(function (e) { return e.事件 === '角色出生' && e.角色序號 === 3; }).length;
    return rec;
  };
  Tele.prototype.build = function () {
    this.closeStint();
    return { 遊戲: 'GhostEcho', 埋點版本: 'telemetry v3', 產生時間: new Date().toISOString(), 關卡紀錄: this.levelRecord(), 事件: this.events, 命紀錄: this.lives };
  };

  // ------------------------------------------------------------------ 下載
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function download(tele) {
    var data = tele.build();
    var d = new Date();
    var name = 'gamelog-WebGame_GhostEcho-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()) + '.json';
    try {
      var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    } catch (err) { console.error('下載紀錄失敗', err); }
    G.lastLogName = name;
  }

  // ------------------------------------------------------------------ 遊戲狀態與流程
  var canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  var W = Art.canvas.width, H = Art.canvas.height;
  var dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = ''; // 由 CSS 控制顯示大小
  var G = {
    screen: 'title', guidePage: 1, guideFrom: null,
    level: 0, sess: null, tele: null, runMode: 'seq',
    acc: 0, last: 0, clockPaused: 0,
    held: { left: false, right: false, jump: false, x: false },
    edge: { left: false, right: false, jump: false, hook: false, r: false, b: false },
    artCols: null, lastLogName: ''
  };

  function startLevel(n, mode) {
    G.level = n; G.runMode = mode || G.runMode;
    var tele = null;
    var sess = new Core.Session(n, null, function (type, d) { if (tele) tele.on(type, d); });
    tele = new Tele(sess, G.runMode);
    G.sess = sess; G.tele = tele;
    G.artCols = Core.artCols(sess.lv);
    tele.on('standby', { runner: 1, first: true });
    G.screen = 'play';
    G.edge = { left: false, right: false, jump: false, hook: false, r: false, b: false };
    G.acc = 0;
  }
  function finishLevel() {
    download(G.tele);
    G.tele.finished = true;
    if (G.level < 4) startLevel(G.level + 1, G.runMode);
    else { G.screen = 'end'; G.sess = null; G.tele = null; }
  }

  // 以 e.code 為準
  var KEY = { ArrowLeft: 'left', ArrowRight: 'right', Space: 'jump', KeyX: 'x', KeyR: 'r', KeyB: 'b', Escape: 'esc', KeyH: 'h', KeyN: 'n', Enter: 'enter', NumpadEnter: 'enter',
    Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4' };

  function onKeyDown(e) {
    var k = KEY[e.code];
    if (!k) return;
    e.preventDefault();
    if (e.repeat) return;
    if (k === 'left' || k === 'right' || k === 'jump' || k === 'x') G.held[k] = true;
    handlePress(k);
  }
  function onKeyUp(e) {
    var k = KEY[e.code];
    if (!k) return;
    e.preventDefault();
    if (k === 'left' || k === 'right' || k === 'jump' || k === 'x') {
      G.held[k] = false;
      if (G.screen === 'play' && G.tele) G.tele.noteInput();
    }
  }
  function onBlur() { G.held.left = G.held.right = G.held.jump = G.held.x = false; }

  function clearEdge() { G.edge = { left: false, right: false, jump: false, hook: false, r: false, b: false }; }
  // 新按下: 依畫面分派。凍結畫面的按鍵不進入遊戲
  function handlePress(k) {
    var sc = G.screen;
    if (sc === 'title') {
      if (k === 'enter') { G.runMode = 'seq'; G.guidePage = 1; G.guideFrom = 'title'; G.screen = 'guide'; }
      else if (k === '1' || k === '2' || k === '3' || k === '4') { G.runMode = 'select'; startLevel(+k, 'select'); }
    } else if (sc === 'guide') {
      if (k === 'left') G.guidePage = Math.max(1, G.guidePage - 1);
      else if (k === 'right') G.guidePage = Math.min(Art.guidePageCount, G.guidePage + 1);
      else if (k === 'enter') {
        var from = G.guideFrom; G.guideFrom = null;
        if (from === 'title') startLevel(1, 'seq');
        else if (from === 'pause') G.screen = 'pause';
        else G.screen = 'play';
      }
    } else if (sc === 'play') {
      if (k === 'esc') { clearEdge(); G.screen = 'pause'; return; }
      if (k === 'h') { clearEdge(); G.guidePage = 1; G.guideFrom = 'play'; G.screen = 'guide'; return; }
      if (k === 'left') G.edge.left = true;
      else if (k === 'right') G.edge.right = true;
      else if (k === 'jump') G.edge.jump = true;
      else if (k === 'x') G.edge.hook = true;
      else if (k === 'r') G.edge.r = true;
      else if (k === 'b') G.edge.b = true;
      if ((k === 'left' || k === 'right' || k === 'jump' || k === 'x') && G.tele) G.tele.noteInput();
    } else if (sc === 'pause') {
      if (k === 'esc') G.screen = 'play';
      else if (k === 'n') { G.tele.abandon(); finishLevel(); }
      else if (k === 'h') { G.guidePage = 1; G.guideFrom = 'pause'; G.screen = 'guide'; }
    } else if (sc === 'rating') {
      if (k === '1' || k === '2' || k === '3' || k === 'enter') {
        G.tele.doRating(k === 'enter' ? 0 : +k);
        finishLevel();
      }
    } else if (sc === 'end') {
      if (k === 'enter') { G.screen = 'title'; G.runMode = 'seq'; }
    }
  }

  // ------------------------------------------------------------------ 更新
  function simStep() {
    var s = G.sess, held = G.held;
    var dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    var e = G.edge;
    var inp = { dir: dir, left: e.left, right: e.right, jump: e.jump, hook: e.hook, jumpHeld: held.jump, xHeld: held.x, r: e.r, b: e.b };
    G.edge = { left: false, right: false, jump: false, hook: false, r: false, b: false };
    s.lastInp = inp;
    s.step(inp);
    if (s.phase === 'goal') { G.screen = 'rating'; G.tele.ratingSec = 0; }
  }
  function update(dt) {
    if (G.screen === 'play') {
      G.acc += Math.min(dt, 1 / 30);
      var guard = 0;
      while (G.acc >= STEP && G.screen === 'play' && guard++ < 4) { G.acc -= STEP; simStep(); }
      if (G.screen !== 'play') G.acc = 0;
    } else {
      G.acc = 0;
      var d = Math.min(dt, 0.25);
      if (G.tele && !G.tele.finished) {
        if (G.screen === 'pause' || (G.screen === 'guide' && G.guideFrom !== 'title')) G.tele.pauseSec += d;
        else if (G.screen === 'rating') G.tele.ratingSec += d;
      }
    }
  }

  // ------------------------------------------------------------------ 繪製
  function drawWorld() {
    var s = G.sess, lv = s.lv, P = s.P, E = s.E, t = s.frames / FPS;
    var i;
    Art.drawBackground(ctx);
    Art.drawPit(ctx, { cols: G.artCols });
    Art.drawTerrain(ctx, { cols: G.artCols });
    Art.drawSpawn(ctx, { x: lv.spawnX, h: lv.spawnH });
    var out = Core.spikeOut(lv, s.clk);
    for (i = 0; i < 40; i++) if (lv.spike[i]) Art.drawSpikeTrap(ctx, { col: i, h: lv.cols[i], out: out });
    Art.drawGoalFlag(ctx, { col: lv.goalCol, h: lv.goalH, reached: s.phase === 'goal', t: t });
    var gv = Core.ghostView(E, s.clk);
    if (gv) {
      var hookable = false;
      if (lv.hook && gv.phase === 'play' && !gv.grounded && (s.phase === 'alive' || s.phase === 'standby') && !P.pulling) {
        hookable = Core.hookReason(P, E, gv.g) === 0;
      }
      Art.drawGhost(ctx, { x: gv.x, h: gv.h, phase: gv.phase, grounded: gv.grounded, hookable: hookable, expiring: gv.expiring, fade: gv.fade, facing: gv.facing, t: t });
    }
    var status = s.phase === 'standby' ? 'idle' : s.phase === 'delay' ? 'dead' : s.phase === 'goal' ? 'goal' : (P.pulling ? 'pulled' : 'active');
    if (P.pulling) Art.drawHookRope(ctx, { x: P.x, h: P.h, ax: P.pax, ah: P.pah, active: true });
    Art.drawPlayer(ctx, { x: P.x, h: P.h, status: status, facing: P.fc, air: !P.grounded, anchor: P.pulling ? { x: P.pax, h: P.pah } : undefined, t: t });
    Art.drawStandbyHint(ctx, { visible: s.phase === 'standby', x: lv.spawnX, h: lv.spawnH });
    Art.drawHud(ctx, { level: lv.id, runner: s.runner, hookEnabled: lv.hook });
  }
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    switch (G.screen) {
      case 'title': Art.drawTitleScreen(ctx, {}); break;
      case 'guide': Art.drawGuidePage(ctx, { page: G.guidePage }); break;
      case 'play': drawWorld(); break;
      case 'pause': drawWorld(); Art.drawPauseScreen(ctx, {}); break;
      case 'rating': drawWorld(); Art.drawRatingScreen(ctx, { level: G.level }); break;
      case 'end': Art.drawEndScreen(ctx, {}); break;
    }
  }

  // ------------------------------------------------------------------ 主迴圈
  function frame(now) {
    var dt = G.last ? (now - G.last) / 1000 : STEP;
    G.last = now;
    try { update(dt); render(); } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.focus();
  requestAnimationFrame(frame);
})();

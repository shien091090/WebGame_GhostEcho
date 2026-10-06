// GhostEcho art v3 - Canvas 2D 幾何繪製, 無外部資源
// 座標約定: 所有物件 state 的位置用「格座標」(x = 欄方向, h = 高度, 腳底中心), 由本檔換算像素
//   像素 x = x * 32;  像素 y = 80 + (18 - h) * 32   (畫面底 h=-2 → y=720, 畫面頂 h=18 → y=80)
(function () {
  'use strict';

  var W = 1280, H = 720, CELL = 32, TOP = 80;
  var FONT = '"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans CJK TC","Noto Sans TC",sans-serif';

  var C = {
    bg: '#10131d',
    bgDeep: '#0a0d15',
    grid: 'rgba(150,165,205,0.055)',
    hudBg: '#080a11',
    hudLine: '#262d42',
    terrain: '#3a4257',
    terrainTop: '#8792b0',
    terrainWall: '#5c6784',
    terrainGrid: 'rgba(0,0,0,0.2)',
    pit: '#04050a',
    danger: '#ff3b47',
    spikeOut: '#ff3b47',
    spikeOutDark: '#7d1019',
    spikePlate: '#4b536b',
    spikeSlot: '#1a1d28',
    spikeTip: '#a2434d',
    player: '#ffb43a',
    playerShade: '#9c5e0c',
    playerEye: '#1d1305',
    playerDead: '#8d7650',
    ghost: '#5fe3ff',
    ghostCap: '#f2fdff',
    ghostExpire: '#b4c4d2',
    ghostFade: '#7d8a99',
    hook: '#e45cff',
    goal: '#4ee07a',
    goalReached: '#d2ffe0',
    pole: '#c9d1e4',
    spawn: '#ffb43a',
    text: '#e8ecf5',
    textDim: '#8a93ad',
    panel: '#161b29',
    panelEdge: '#323b57',
    keyBg: '#232a3e',
    keyEdge: '#6b7699',
    ok: '#4ee07a',
    ng: '#ff3b47',
    overlay: 'rgba(5,7,12,0.76)'
  };

  // ---------- 基礎工具 ----------
  function X(x) { return x * CELL; }
  function Y(h) { return TOP + (18 - h) * CELL; }
  function F(size, bold) { return (bold ? 'bold ' : '') + size + 'px ' + FONT; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  function txt(ctx, s, x, y, size, color, align, bold) {
    ctx.font = F(size, bold);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  // 帶深色描邊的字(壓在任何底色上都讀得到)
  function txtO(ctx, s, x, y, size, color, align, bold) {
    ctx.font = F(size, bold);
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.22);
    ctx.strokeStyle = 'rgba(5,7,12,0.9)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }
  function textW(ctx, s, size, bold) { ctx.font = F(size, bold); return ctx.measureText(s).width; }

  // 按鍵帽: x 為左緣, y 為垂直中心; 回傳寬度
  function keyCap(ctx, label, x, y, size) {
    size = size || 18;
    ctx.save();
    var w = Math.max(textW(ctx, label, size, true) + size * 0.9, size * 1.7);
    var h = size * 1.6;
    rr(ctx, x, y - h / 2, w, h, size * 0.3);
    ctx.fillStyle = C.keyBg; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.keyEdge; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 3, y + h / 2 - 3, w - 6, 2);
    txt(ctx, label, x + w / 2, y, size, C.text, 'center', true);
    ctx.restore();
    return w;
  }
  function keyCapW(ctx, label, size) {
    size = size || 18;
    return Math.max(textW(ctx, label, size, true) + size * 0.9, size * 1.7);
  }
  // 一列「按鍵 + 說明」; 回傳總寬
  function keyRow(ctx, items, x, y, size, color, gap) {
    size = size || 18; gap = gap == null ? 28 : gap;
    var cx = x;
    for (var i = 0; i < items.length; i++) {
      var keys = items[i][0];
      for (var k = 0; k < keys.length; k++) { cx += keyCap(ctx, keys[k], cx, y, size) + 6; }
      cx += 4;
      txt(ctx, items[i][1], cx, y, size, color || C.text, 'left', false);
      cx += textW(ctx, items[i][1], size, false) + gap;
    }
    return cx - gap - x;
  }
  function keyRowW(ctx, items, size, gap) {
    size = size || 18; gap = gap == null ? 28 : gap;
    var w = 0;
    for (var i = 0; i < items.length; i++) {
      for (var k = 0; k < items[i][0].length; k++) w += keyCapW(ctx, items[i][0][k], size) + 6;
      w += 4 + textW(ctx, items[i][1], size, false) + gap;
    }
    return w - gap;
  }

  // ---------- 角色 / 幽靈共用剪影 ----------
  // cx, fy: 腳底中心像素; 身體 32 x 64(= 1 x 2 格, 與碰撞框同大)
  function figure(ctx, cx, fy, o) {
    ctx.save();
    ctx.translate(cx, fy);
    if (o.rot) { ctx.translate(0, -32); ctx.rotate(o.rot); ctx.translate(0, 32); }
    ctx.globalAlpha *= (o.alpha == null ? 1 : o.alpha);
    // 腳
    ctx.fillStyle = o.legFill || o.fill;
    if (o.legs === 'tuck') {
      rr(ctx, -12, -14, 9, 9, 3); ctx.fill();
      rr(ctx, 3, -14, 9, 9, 3); ctx.fill();
    } else {
      rr(ctx, -11, -12, 8, 12, 2); ctx.fill();
      rr(ctx, 3, -12, 8, 12, 2); ctx.fill();
    }
    // 身體
    rr(ctx, -16, -64, 32, 55, 9);
    ctx.fillStyle = o.fill; ctx.fill();
    if (o.stroke) {
      ctx.lineWidth = o.lineWidth || 2;
      ctx.strokeStyle = o.stroke;
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 眼睛
    var f = o.facing === -1 ? -1 : 1;
    var ex = 4 * f, ey = -48;
    ctx.fillStyle = o.eyeColor || C.playerEye;
    ctx.strokeStyle = o.eyeColor || C.playerEye;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    if (o.eyes === 'open') {
      ctx.fillRect(ex - 8, ey - 4, 5, 9);
      ctx.fillRect(ex + 3, ey - 4, 5, 9);
    } else if (o.eyes === 'closed') {
      ctx.beginPath();
      ctx.moveTo(ex - 9, ey + 1); ctx.lineTo(ex - 3, ey + 1);
      ctx.moveTo(ex + 3, ey + 1); ctx.lineTo(ex + 9, ey + 1);
      ctx.stroke();
    } else if (o.eyes === 'happy') {
      ctx.beginPath();
      ctx.arc(ex - 5.5, ey + 3, 3.5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.moveTo(ex + 9, ey + 3);
      ctx.arc(ex + 5.5, ey + 3, 3.5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else if (o.eyes === 'hollow') {
      ctx.beginPath();
      ctx.ellipse(ex - 5.5, ey, 3, 4.5, 0, 0, Math.PI * 2);
      ctx.ellipse(ex + 5.5, ey, 3, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function markOkNg(ctx, x, y, ok, r) {
    r = r || 22;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = ok ? C.ok : C.ng; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,7,12,0.85)'; ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (ok) {
      ctx.moveTo(x - r * 0.45, y + r * 0.02); ctx.lineTo(x - r * 0.1, y + r * 0.38); ctx.lineTo(x + r * 0.5, y - r * 0.35);
    } else {
      ctx.moveTo(x - r * 0.38, y - r * 0.38); ctx.lineTo(x + r * 0.38, y + r * 0.38);
      ctx.moveTo(x + r * 0.38, y - r * 0.38); ctx.lineTo(x - r * 0.38, y + r * 0.38);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 折線箭頭(螢幕座標); pts = [[x,y],...]
  function arrowPath(ctx, pts, color, width, dash) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = width + 3; ctx.strokeStyle = 'rgba(5,7,12,0.75)';
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
    ctx.setLineDash([]);
    var a = pts[pts.length - 1], b = pts[pts.length - 2];
    var ang = Math.atan2(a[1] - b[1], a[0] - b[0]), L = 6 + width * 3;
    ctx.beginPath();
    ctx.moveTo(a[0] + Math.cos(ang) * 2, a[1] + Math.sin(ang) * 2);
    ctx.lineTo(a[0] - Math.cos(ang - 0.45) * L, a[1] - Math.sin(ang - 0.45) * L);
    ctx.lineTo(a[0] - Math.cos(ang + 0.45) * L, a[1] - Math.sin(ang + 0.45) * L);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }
  function quadPts(x0, y0, cx, cy, x1, y1, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      pts.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
    }
    return pts;
  }

  // 角色序號晶片(HUD 與說明頁共用同一個長相)
  var CHIP_W = 156, CHIP_H = 48;
  function runnerChip(ctx, x, y, runner, scale) {
    scale = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    rr(ctx, 0, 0, CHIP_W, CHIP_H, 10);
    ctx.fillStyle = '#1b2134'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(C.player, 0.55); ctx.stroke();
    txt(ctx, '角色', 16, CHIP_H / 2 + 1, 20, C.textDim, 'left', false);
    txt(ctx, (runner || 1) + '/3', CHIP_W - 16, CHIP_H / 2 + 1, 30, C.player, 'right', true);
    ctx.restore();
  }

  var A = {};

  A.canvas = { width: W, height: H };
  A.palette = C;
  A.grid = { cell: CELL, top: TOP, toX: X, toY: Y };

  // ---------- 背景 ----------
  A.drawBackground = function (ctx) {
    ctx.save();
    var g = ctx.createLinearGradient(0, TOP, 0, H);
    g.addColorStop(0, C.bgDeep);
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 格線: 讓玩家能數格規劃路線, 壓在最低權重
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var c = 1; c < 40; c++) { ctx.moveTo(c * CELL + 0.5, TOP); ctx.lineTo(c * CELL + 0.5, H); }
    for (var r = 1; r < 20; r++) { ctx.moveTo(0, TOP + r * CELL + 0.5); ctx.lineTo(W, TOP + r * CELL + 0.5); }
    ctx.stroke();
    ctx.restore();
  };

  // ---------- 地形(地面 / 柱 / 平台 / 矮樁) ----------
  // state: { cols: 長度 40 的陣列, 每欄地表高度 h(數字, 可半格)或 null(坑欄) }
  A.drawTerrain = function (ctx, s) {
    var cols = (s && s.cols) || [];
    ctx.save();
    var i = 0;
    while (i < cols.length) {
      var h = cols[i];
      if (h == null) { i++; continue; }
      var j = i;
      while (j + 1 < cols.length && cols[j + 1] === h) j++;
      var x0 = X(i), x1 = X(j + 1), y0 = Y(h);
      ctx.fillStyle = C.terrain;
      ctx.fillRect(x0, y0, x1 - x0, H - y0);
      // 格紋(數格用)
      ctx.strokeStyle = C.terrainGrid; ctx.lineWidth = 1;
      ctx.beginPath();
      for (var k = i + 1; k <= j; k++) { ctx.moveTo(X(k) + 0.5, y0 + 4); ctx.lineTo(X(k) + 0.5, H); }
      for (var hh = Math.ceil(h - 1e-6) - 1; hh >= -2; hh--) {
        var yy = Y(hh);
        if (yy > y0 + 4) { ctx.moveTo(x0, yy + 0.5); ctx.lineTo(x1, yy + 0.5); }
      }
      ctx.stroke();
      // 外露的牆面
      var hl = i > 0 ? cols[i - 1] : 99, hr = j + 1 < cols.length ? cols[j + 1] : 99;
      ctx.fillStyle = C.terrainWall;
      if (hl == null || hl < h) { var yl = hl == null ? H : Y(hl); ctx.fillRect(x0, y0, 3, yl - y0); }
      if (hr == null || hr < h) { var yr = hr == null ? H : Y(hr); ctx.fillRect(x1 - 3, y0, 3, yr - y0); }
      // 地表亮邊 = 可站的面
      ctx.fillStyle = C.terrainTop;
      ctx.fillRect(x0, y0, x1 - x0, 4);
      i = j + 1;
    }
    ctx.restore();
  };

  // ---------- 坑 ----------
  // state: { cols: 同 drawTerrain } — 畫所有 null 欄
  A.drawPit = function (ctx, s) {
    var cols = (s && s.cols) || [];
    ctx.save();
    var i = 0;
    while (i < cols.length) {
      if (cols[i] != null) { i++; continue; }
      var j = i;
      while (j + 1 < cols.length && cols[j + 1] == null) j++;
      var hl = i > 0 ? cols[i - 1] : null, hr = j + 1 < cols.length ? cols[j + 1] : null;
      var edge = hl == null ? hr : hr == null ? hl : Math.min(hl, hr);
      if (edge == null) edge = 0;
      var x0 = X(i), x1 = X(j + 1), y0 = Y(edge);
      var g = ctx.createLinearGradient(0, y0, 0, H);
      g.addColorStop(0, 'rgba(4,5,10,0)');
      g.addColorStop(0.35, 'rgba(4,5,10,0.85)');
      g.addColorStop(1, C.pit);
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, x1 - x0, H - y0);
      // 坑底危險色: 掉下即死
      var g2 = ctx.createLinearGradient(0, H - 46, 0, H);
      g2.addColorStop(0, rgba(C.danger, 0));
      g2.addColorStop(1, rgba(C.danger, 0.55));
      ctx.fillStyle = g2;
      ctx.fillRect(x0, H - 46, x1 - x0, 46);
      ctx.fillStyle = C.danger;
      ctx.fillRect(x0, H - 3, x1 - x0, 3);
      i = j + 1;
    }
    ctx.restore();
  };

  // ---------- 尖刺陷阱 ----------
  // state: { col, h(該欄地表), out: true=伸出(致死) / false=收起(可站) }
  A.drawSpikeTrap = function (ctx, s) {
    if (!s) return;
    var x0 = X(s.col), y0 = Y(s.h);
    ctx.save();
    // 底座: 兩種狀態都畫, 讓「這裡有陷阱」常駐可見
    ctx.fillStyle = C.spikePlate;
    ctx.fillRect(x0, y0, CELL, 7);
    ctx.fillStyle = rgba(C.danger, 0.45);
    ctx.fillRect(x0, y0 + 5, CELL, 2);
    ctx.fillStyle = C.spikeSlot;
    for (var k = 0; k < 3; k++) ctx.fillRect(x0 + 4 + k * 10.67, y0 + 1, 4, 3);
    var tw = CELL / 3;
    if (s.out) {
      ctx.fillStyle = rgba(C.danger, 0.12);
      ctx.fillRect(x0, Y(s.h + 1), CELL, CELL);
      for (var n = 0; n < 3; n++) {
        var bx = x0 + n * tw;
        ctx.beginPath();
        ctx.moveTo(bx + 0.5, y0);
        ctx.lineTo(bx + tw / 2, Y(s.h + 1) + 2);
        ctx.lineTo(bx + tw - 0.5, y0);
        ctx.closePath();
        ctx.fillStyle = C.spikeOut; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = C.spikeOutDark; ctx.stroke();
        ctx.fillStyle = '#ffd3d6';
        ctx.fillRect(bx + tw / 2 - 1, Y(s.h + 1) + 4, 2, 6);
      }
    } else {
      // 收起: 只露出暗紅的矮刺尖(5px), 讀成「有陷阱、但現在是平的、可踩」
      for (var m = 0; m < 3; m++) {
        var sx = x0 + m * tw;
        ctx.beginPath();
        ctx.moveTo(sx + 1.5, y0);
        ctx.lineTo(sx + tw / 2, y0 - 5);
        ctx.lineTo(sx + tw - 1.5, y0);
        ctx.closePath();
        ctx.fillStyle = C.spikeTip; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(5,7,12,0.6)'; ctx.stroke();
      }
    }
    ctx.restore();
  };

  // ---------- 出生點 ----------
  // state: { x, h }
  A.drawSpawn = function (ctx, s) {
    if (!s) return;
    var cx = X(s.x), fy = Y(s.h);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - 24, fy);
    ctx.lineTo(cx - 24, fy - 60);
    ctx.arc(cx, fy - 60, 24, Math.PI, 0);
    ctx.lineTo(cx + 24, fy);
    ctx.fillStyle = rgba(C.spawn, 0.07); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.spawn, 0.45); ctx.stroke();
    ctx.fillStyle = rgba(C.spawn, 0.6);
    ctx.fillRect(cx - 26, fy - 3, 52, 3);
    ctx.restore();
  };

  // ---------- 終點旗 ----------
  // state: { col, h(該欄地表), reached: bool, t? }
  // 圖形佔 x ∈ [col, col+1), h ∈ [h, h+2](與角色同高; 第 4 關 C 地表 16 上方只剩 2 格; 建議與過關碰撞框一致)
  A.drawGoalFlag = function (ctx, s) {
    if (!s) return;
    var x0 = X(s.col), fy = Y(s.h), top = Y(s.h + 2) + 4, t = s.t || 0;
    var reached = !!s.reached;
    ctx.save();
    if (reached) {
      var g = ctx.createRadialGradient(x0 + 16, top + 30, 4, x0 + 16, top + 30, 70);
      g.addColorStop(0, rgba(C.goal, 0.55));
      g.addColorStop(1, rgba(C.goal, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x0 - 60, top - 50, 152, 160);
    }
    // 旗桿
    ctx.fillStyle = C.pole;
    ctx.fillRect(x0 + 5, top, 4, fy - top);
    ctx.beginPath(); ctx.arc(x0 + 7, top, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.terrainTop;
    ctx.fillRect(x0 + 1, fy - 4, 12, 4);
    // 旗面(在本欄寬度內)
    var wave = reached ? 0 : Math.sin(t * 3) * 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 9, top + 3);
    ctx.quadraticCurveTo(x0 + 20, top + 3 + wave, x0 + 31, top + 5);
    ctx.lineTo(x0 + 31, top + 25);
    ctx.quadraticCurveTo(x0 + 20, top + 23 + wave, x0 + 9, top + 25);
    ctx.closePath();
    ctx.fillStyle = reached ? C.goalReached : C.goal; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(5,7,12,0.7)'; ctx.stroke();
    if (reached) {
      ctx.strokeStyle = '#178a3c'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x0 + 14, top + 14); ctx.lineTo(x0 + 19, top + 19); ctx.lineTo(x0 + 27, top + 9);
      ctx.stroke();
    }
    ctx.restore();
  };

  // ---------- 角色 ----------
  // state: { x, h, status: 'idle'|'active'|'pulled'|'dead'|'goal', facing: 1|-1, air?: bool,
  //          anchor?: {x,h}(pulled 時的錨點, 用來傾斜身體), t?: 秒 }
  A.drawPlayer = function (ctx, s) {
    if (!s) return;
    var st = s.status || 'active', t = s.t || 0, f = s.facing === -1 ? -1 : 1;
    var cx = X(s.x), fy = Y(s.h);
    ctx.save();
    if (st === 'idle') {
      var a = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4));
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -t * 14;
      ctx.strokeStyle = rgba(C.player, a);
      ctx.lineWidth = 2;
      rr(ctx, cx - 22, fy - 71, 44, 75, 12);
      ctx.stroke();
      ctx.restore();
      figure(ctx, cx, fy, { fill: C.player, stroke: C.playerShade, eyes: 'closed', facing: f });
    } else if (st === 'dead') {
      // 倒地: 橫躺、褪色、叉眼
      ctx.translate(cx, fy);
      ctx.fillStyle = C.playerDead;
      rr(ctx, -30, -24, 52, 22, 8); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(5,7,12,0.7)'; ctx.stroke();
      rr(ctx, 22, -20, 10, 7, 2); ctx.fill();
      rr(ctx, 22, -11, 10, 7, 2); ctx.fill();
      ctx.strokeStyle = C.playerEye; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      var hx = -18, hy = -13;
      ctx.moveTo(hx - 3, hy - 7); ctx.lineTo(hx + 3, hy - 1);
      ctx.moveTo(hx + 3, hy - 7); ctx.lineTo(hx - 3, hy - 1);
      ctx.moveTo(hx - 3, hy + 1); ctx.lineTo(hx + 3, hy + 7);
      ctx.moveTo(hx + 3, hy + 1); ctx.lineTo(hx - 3, hy + 7);
      ctx.stroke();
    } else if (st === 'pulled') {
      var rot = 0;
      if (s.anchor) {
        var dx = s.anchor.x - s.x, dh = s.anchor.h - s.h;
        rot = Math.max(-0.5, Math.min(0.5, Math.atan2(dx, Math.max(0.01, dh))));
        // 速度線(拉動方向的反側)
        var len = Math.sqrt(dx * dx + dh * dh) || 1;
        var ux = dx / len, uy = -dh / len;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        for (var k = -1; k <= 1; k++) {
          var bx = cx - ux * 26 + (-uy) * k * 10, by = fy - 32 - uy * 26 + ux * k * 10;
          ctx.moveTo(bx, by); ctx.lineTo(bx - ux * 18, by - uy * 18);
        }
        ctx.stroke();
      }
      figure(ctx, cx, fy, { fill: C.player, stroke: C.hook, lineWidth: 3, eyes: 'open', facing: f, legs: 'tuck', rot: rot });
    } else if (st === 'goal') {
      var g = ctx.createRadialGradient(cx, fy - 32, 6, cx, fy - 32, 60);
      g.addColorStop(0, rgba(C.goal, 0.5));
      g.addColorStop(1, rgba(C.goal, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - 60, fy - 92, 120, 120);
      ctx.fillStyle = C.player;
      rr(ctx, cx - 22, fy - 76, 7, 16, 3); ctx.fill();
      rr(ctx, cx + 15, fy - 76, 7, 16, 3); ctx.fill();
      figure(ctx, cx, fy, { fill: C.player, stroke: C.playerShade, eyes: 'happy', facing: f });
    } else {
      figure(ctx, cx, fy, { fill: C.player, stroke: C.playerShade, eyes: 'open', facing: f, legs: s.air ? 'tuck' : 'stand' });
    }
    ctx.restore();
  };

  // ---------- 幽靈 ----------
  // state: { x, h, phase: 'play'|'fading'|'gap', grounded: bool(該幀為「站立」), hookable: bool,
  //          expiring: bool(錄影最後 1 秒), fade: 0~1(phase='fading' 時的淡出進度), facing, t? }
  A.drawGhost = function (ctx, s) {
    if (!s || s.phase === 'gap') return;
    var t = s.t || 0, cx = X(s.x), fy = Y(s.h), grounded = !!s.grounded;
    var f = s.facing === -1 ? -1 : 1;
    ctx.save();
    if (s.phase === 'fading') {
      var k = 1 - clamp01(s.fade || 0);
      figure(ctx, cx, fy, {
        fill: rgba(C.ghostFade, 0.18), stroke: C.ghostFade, dash: [4, 4], alpha: 0.85 * k,
        eyes: 'hollow', eyeColor: 'rgba(10,16,24,0.6)', facing: f, legs: grounded ? 'stand' : 'tuck'
      });
      ctx.restore();
      return;
    }
    var expiring = !!s.expiring;
    var col = expiring ? C.ghostExpire : C.ghost;
    var flick = expiring ? (Math.sin(t * Math.PI * 2 * 4) > 0 ? 1 : 0.4) : 1;
    figure(ctx, cx, fy, {
      fill: rgba(col, 0.3), stroke: col, lineWidth: 2, alpha: flick,
      eyes: 'hollow', eyeColor: 'rgba(8,24,34,0.75)', facing: f, legs: grounded ? 'stand' : 'tuck'
    });
    if (grounded) {
      // 頭頂平台: 只有站立幀存在, 寬 1 格, 頂面 = 腳底 + 2 格
      var y = Y(s.h + 2);
      ctx.save();
      ctx.shadowColor = C.ghostCap; ctx.shadowBlur = 10;
      ctx.fillStyle = C.ghostCap;
      rr(ctx, cx - 16, y, 32, 6, 2); ctx.fill();
      ctx.restore();
    } else if (s.hookable) {
      // 可鉤: 鉤爪色四角框貼著身體外緣
      var L = 11, x0 = cx - 21, x1 = cx + 21, y0 = fy - 69, y1 = fy + 3;
      ctx.save();
      ctx.strokeStyle = C.hook; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.shadowColor = C.hook; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
      ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
      ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1);
      ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  // ---------- 鉤爪索 ----------
  // state: { x, h(角色腳底), ax, ah(錨點 = 角色腳底要到的位置), active?: bool(預設 true) }
  A.drawHookRope = function (ctx, s) {
    if (!s || s.active === false) return;
    var x0 = X(s.x), y0 = Y(s.h + 1.2), x1 = X(s.ax), y1 = Y(s.ah);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(5,7,12,0.75)';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = C.hook;
    ctx.shadowColor = C.hook; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    // 錨點爪
    var ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.translate(x1, y1);
    ctx.rotate(ang);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-2, 0); ctx.quadraticCurveTo(6, -2, 6, -9);
    ctx.moveTo(-2, 0); ctx.quadraticCurveTo(6, 2, 6, 9);
    ctx.moveTo(-2, 0); ctx.lineTo(9, 0);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(-2, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
  };

  // ---------- 待命提示 ----------
  // state: { visible: bool, x, h(出生點腳底) }
  A.drawStandbyHint = function (ctx, s) {
    if (!s || !s.visible) return;
    var label = '按移動或跳躍開始';
    ctx.save();
    var w = textW(ctx, label, 20, true) + 28, hgt = 38;
    var cx = X(s.x), y = Y(s.h + 2) - 30;
    var x = Math.max(8, Math.min(W - 8 - w, cx - w / 2));
    rr(ctx, x, y - hgt / 2, w, hgt, 10);
    ctx.fillStyle = 'rgba(8,10,17,0.88)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(C.player, 0.7); ctx.stroke();
    txt(ctx, label, x + w / 2, y + 1, 20, C.text, 'center', true);
    ctx.restore();
  };

  // ---------- 資訊列(關卡序號 + 角色序號 + 可用按鍵) ----------
  // state: { level: 1~4, runner: 1~3, hookEnabled: bool(第 3 關起) }
  var HUD_CHIP = { x: 150, y: 16 };
  A.drawHud = function (ctx, s) {
    s = s || {};
    ctx.save();
    ctx.fillStyle = C.hudBg;
    ctx.fillRect(0, 0, W, TOP);
    ctx.fillStyle = C.hudLine;
    ctx.fillRect(0, TOP - 2, W, 2);
    txt(ctx, '第 ' + (s.level || 1) + ' 關', 28, 41, 30, C.text, 'left', true);
    runnerChip(ctx, HUD_CHIP.x, HUD_CHIP.y, s.runner || 1, 1);
    var items = [];
    if (s.hookEnabled) items.push([['X'], '鉤爪']);
    items.push([['R'], '重錄這一名'], [['B'], '退回上一名'], [['H'], '說明'], [['Esc'], '暫停']);
    var w = keyRowW(ctx, items, 16, 22);
    keyRow(ctx, items, W - 28 - w, 41, 16, C.textDim, 22);
    ctx.restore();
  };

  // ---------- 標題畫面 ----------
  A.drawTitleScreen = function (ctx, s) {
    s = s || {};
    ctx.save();
    A.drawBackground(ctx);
    ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, W, TOP);
    // 標題: 兩層幽靈殘影 + 本體
    var ty = 230;
    ctx.font = F(120, true); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(C.ghost, 0.3); ctx.fillText('GhostEcho', W / 2 - 12, ty + 8);
    ctx.fillStyle = C.text; ctx.fillText('GhostEcho', W / 2, ty);
    // 地面小景: 角色站在幽靈頭頂
    var gy = 470;
    ctx.fillStyle = C.terrain; ctx.fillRect(360, gy, 560, 18);
    ctx.fillStyle = C.terrainTop; ctx.fillRect(360, gy, 560, 4);
    figure(ctx, 640, gy, { fill: rgba(C.ghost, 0.3), stroke: C.ghost, eyes: 'hollow', eyeColor: 'rgba(8,24,34,0.75)', facing: 1 });
    ctx.save(); ctx.shadowColor = C.ghostCap; ctx.shadowBlur = 10; ctx.fillStyle = C.ghostCap;
    rr(ctx, 624, gy - 64, 32, 6, 2); ctx.fill(); ctx.restore();
    figure(ctx, 640, gy - 64, { fill: C.player, stroke: C.playerShade, eyes: 'open', facing: 1 });
    // 按鍵
    var it1 = [[['Enter'], '開始']];
    var w1 = keyRowW(ctx, it1, 24);
    keyRow(ctx, it1, W / 2 - w1 / 2, 560, 24, C.text);
    var it2 = [[['1', '2', '3', '4'], '直接選關']];
    var w2 = keyRowW(ctx, it2, 20);
    keyRow(ctx, it2, W / 2 - w2 / 2, 625, 20, C.textDim);
    ctx.restore();
  };

  // ---------- 暫停畫面(疊在遊戲畫面上) ----------
  A.drawPauseScreen = function (ctx, s) {
    ctx.save();
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    var pw = 440, ph = 320, px = (W - pw) / 2, py = (H - ph) / 2;
    rr(ctx, px, py, pw, ph, 16);
    ctx.fillStyle = C.panel; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.panelEdge; ctx.stroke();
    txt(ctx, '暫停', W / 2, py + 62, 40, C.text, 'center', true);
    var rows = [[['Esc'], '繼續'], [['N'], '放棄本關'], [['H'], '說明']];
    for (var i = 0; i < rows.length; i++) keyRow(ctx, [rows[i]], px + 130, py + 140 + i * 56, 22, C.text);
    ctx.restore();
  };

  // ---------- 自評畫面 ----------
  // state: { level: 1~4 }
  A.drawRatingScreen = function (ctx, s) {
    s = s || {};
    ctx.save();
    ctx.fillStyle = C.overlay; ctx.fillRect(0, 0, W, H);
    var pw = 640, ph = 420, px = (W - pw) / 2, py = (H - ph) / 2;
    rr(ctx, px, py, pw, ph, 16);
    ctx.fillStyle = C.panel; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.panelEdge; ctx.stroke();
    txt(ctx, '第 ' + (s.level || 1) + ' 關 過關', W / 2, py + 58, 36, C.goal, 'center', true);
    txt(ctx, '這一關你是怎麼過的?', W / 2, py + 112, 24, C.text, 'center', false);
    var opts = ['碰運氣湊出來', '試了幾次才想通', '一開始就規劃好'];
    for (var i = 0; i < 3; i++) keyRow(ctx, [[[String(i + 1)], opts[i]]], px + 190, py + 175 + i * 58, 24, C.text);
    keyRow(ctx, [[['Enter'], '跳過']], px + 190, py + 360, 20, C.textDim);
    ctx.restore();
  };

  // ---------- 結束畫面 ----------
  A.drawEndScreen = function (ctx, s) {
    ctx.save();
    A.drawBackground(ctx);
    ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, W, TOP);
    txt(ctx, '4 關都走完了', W / 2, 270, 52, C.text, 'center', true);
    txt(ctx, '謝謝試玩', W / 2, 345, 28, C.textDim, 'center', false);
    var it = [[['Enter'], '回標題']];
    var w = keyRowW(ctx, it, 24);
    keyRow(ctx, it, W / 2 - w / 2, 480, 24, C.text);
    ctx.restore();
  };

  // ======================================================================
  // 說明頁
  // ======================================================================
  var GUIDE = [
    { title: '目標', text: '三人接力走到終點旗, 共 4 關' },
    { title: '移動', text: '← → 走, 空白鍵跳' },
    { title: '換人', text: '掉坑或踩到伸出的尖刺, 這人就結束' },
    { title: '幽靈', text: '上一人的動作會一直重播' },
    { title: '踩頭', text: '腳著地的幽靈可以踩' },
    { title: '鉤爪', text: '第 3 關起, X 勾住空中的幽靈' },
    { title: '重來', text: 'R 重來這人, B 退回上一人' },
    { title: '其他按鍵', text: 'Esc 暫停, H 看說明' }
  ];
  var GX = 80, GY = 168, GW = 1120, GH = 452;

  function flat(h, pits) {
    var c = [];
    for (var i = 0; i < 40; i++) c.push(h);
    if (pits) for (var k = 0; k < pits.length; k++) c[pits[k]] = null;
    return c;
  }
  // 把世界區域 [wx0,wx1] x [h0,h1] 等比放進 rect
  function makeView(rect, wx0, wx1, h0, h1) {
    var ww = (wx1 - wx0) * CELL, wh = (h1 - h0) * CELL;
    var s = Math.min(rect.w / ww, rect.h / wh);
    var ox = rect.x + (rect.w - ww * s) / 2, oy = rect.y + (rect.h - wh * s) / 2;
    return {
      s: s,
      rect: { x: ox, y: oy, w: ww * s, h: wh * s },
      px: function (x) { return ox + (X(x) - X(wx0)) * s; },
      py: function (h) { return oy + (Y(h) - Y(h1)) * s; },
      enter: function (ctx) {
        ctx.save();
        ctx.beginPath(); ctx.rect(ox, oy, ww * s, wh * s); ctx.clip();
        ctx.translate(ox, oy); ctx.scale(s, s); ctx.translate(-X(wx0), -Y(h1));
      },
      leave: function (ctx) { ctx.restore(); }
    };
  }
  function frame(ctx, r) {
    ctx.save();
    ctx.lineWidth = 2; ctx.strokeStyle = C.panelEdge;
    ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    ctx.restore();
  }
  function cells(n, gap, top, hgt) {
    var w = (GW - gap * (n - 1)) / n, out = [];
    for (var i = 0; i < n; i++) out.push({ x: GX + i * (w + gap), y: top == null ? GY : top, w: w, h: hgt == null ? GH : hgt });
    return out;
  }
  function scene(ctx, cols, fn) {
    A.drawBackground(ctx);
    A.drawPit(ctx, { cols: cols });
    A.drawTerrain(ctx, { cols: cols });
    fn();
  }
  // 跳躍弧線(規格的跳躍物理), 回傳螢幕點
  function jumpPts(v, x0, h0, dir, landH, xMax) {
    var pts = [];
    for (var tau = 0; tau < 2; tau += 0.02) {
      var x = x0 + 6 * tau * dir, h = h0 + 15.56 * tau - 17.3 * tau * tau;
      if (xMax != null && x * dir > xMax * dir) break;
      if (tau > 0.45 && h <= landH) { pts.push([v.px(x), v.py(landH)]); break; }
      pts.push([v.px(x), v.py(h)]);
    }
    return pts;
  }
  function circleMark(ctx, x, y, w, h) {
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 3; ctx.strokeStyle = C.text;
    ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function tag(ctx, s, x, y, color) { txtO(ctx, s, x, y, 16, color || C.text, 'center', true); }

  var guidePainters = [
    // 1 目標
    function (ctx) {
      var v = makeView({ x: GX, y: GY, w: GW, h: GH }, 0, 40, -2, 20.5);
      var cols = flat(0);
      v.enter(ctx);
      scene(ctx, cols, function () {
        A.drawSpawn(ctx, { x: 2.5, h: 0 });
        A.drawGoalFlag(ctx, { col: 36, h: 0, reached: false });
        A.drawPlayer(ctx, { x: 2.5, h: 0, status: 'active', facing: 1 });
        A.drawHud(ctx, { level: 1, runner: 1, hookEnabled: false });
      });
      v.leave(ctx);
      frame(ctx, v.rect);
      var s = v.s;
      circleMark(ctx, v.rect.x + (HUD_CHIP.x + CHIP_W / 2) * s, v.rect.y + (HUD_CHIP.y + CHIP_H / 2) * s, CHIP_W * s + 34, CHIP_H * s + 26);
    },
    // 2 移動
    function (ctx) {
      var v = makeView({ x: GX, y: GY, w: GW, h: GH }, 0, 20, -1.5, 6);
      var cols = flat(0, [9, 10]);
      v.enter(ctx);
      scene(ctx, cols, function () {
        A.drawPlayer(ctx, { x: 10.5, h: 3.4, status: 'active', facing: 1, air: true });
      });
      v.leave(ctx);
      frame(ctx, v.rect);
      // 左右走
      var ay = v.py(0.55);
      arrowPath(ctx, [[v.px(4.6), ay], [v.px(2.0), ay]], C.text, 4);
      arrowPath(ctx, [[v.px(4.9), ay], [v.px(7.5), ay]], C.text, 4);
      keyCap(ctx, '←', v.px(2.0) - 6, v.py(1.6), 22);
      keyCap(ctx, '→', v.px(7.5) - 34, v.py(1.6), 22);
      // 跳過小坑
      var pts = jumpPts(v, 8.2, 0.15, 1, 0.15);
      arrowPath(ctx, pts, C.text, 3, [8, 7]);
      keyCap(ctx, '空白鍵', v.px(5.3), v.py(3.4), 22);
    },
    // 3 換人
    function (ctx) {
      var cs = cells(3, 40);
      for (var i = 0; i < 3; i++) {
        var v = makeView(cs[i], 0, 8, -1.5, 5.5);
        var cols = flat(0);
        v.enter(ctx);
        (function (idx) {
          scene(ctx, cols, function () {
            if (idx === 0) {
              for (var c = 3; c <= 5; c++) A.drawSpikeTrap(ctx, { col: c, h: 0, out: false });
              A.drawPlayer(ctx, { x: 4.5, h: 0, status: 'active', facing: 1 });
            } else if (idx === 1) {
              for (var d = 3; d <= 5; d++) A.drawSpikeTrap(ctx, { col: d, h: 0, out: true });
              A.drawPlayer(ctx, { x: 4.4, h: 0, status: 'dead', facing: 1 });
            } else {
              A.drawSpawn(ctx, { x: 2.5, h: 0 });
              A.drawPlayer(ctx, { x: 2.5, h: 0, status: 'idle', facing: 1 });
            }
          });
        })(i);
        v.leave(ctx);
        frame(ctx, v.rect);
        if (i === 0) markOkNg(ctx, v.rect.x + v.rect.w - 34, v.rect.y + 34, true, 22);
        if (i === 1) {
          arrowPath(ctx, [[v.px(0.6), v.py(0.6)], [v.px(2.7), v.py(0.6)]], C.text, 3, [7, 6]);
          markOkNg(ctx, v.rect.x + v.rect.w - 34, v.rect.y + 34, false, 22);
          arrowPath(ctx, [[v.rect.x + v.rect.w + 8, v.rect.y + v.rect.h / 2], [v.rect.x + v.rect.w + 32, v.rect.y + v.rect.h / 2]], C.textDim, 3);
        }
        if (i === 2) runnerChip(ctx, v.rect.x + 14, v.rect.y + 14, 2, 0.85);
      }
    },
    // 4 幽靈
    function (ctx) {
      var v = makeView({ x: GX, y: GY, w: GW, h: GH }, 0, 24, -1.5, 6.5);
      var cols = flat(0);
      v.enter(ctx);
      scene(ctx, cols, function () {
        A.drawSpawn(ctx, { x: 2.5, h: 0 });
        A.drawGhost(ctx, { x: 10.2, h: 3.45, phase: 'play', grounded: false, facing: 1 });
        A.drawPlayer(ctx, { x: 2.5, h: 0, status: 'idle', facing: 1 });
      });
      v.leave(ctx);
      frame(ctx, v.rect);
      // 幽靈路線: 走 → 跳 → 走
      var gy = 0.25;
      var pts = [[v.px(3.6), v.py(gy)], [v.px(7.5), v.py(gy)]];
      pts = pts.concat(jumpPts(v, 7.5, gy, 1, gy));
      pts.push([v.px(15.6), v.py(gy)]);
      arrowPath(ctx, pts, C.ghost, 3, [9, 7]);
      // 接回起點 = 循環
      var loop = quadPts(v.px(16.4), v.py(0.9), v.px(10), v.py(9.6), v.px(3.4), v.py(2.9), 30);
      arrowPath(ctx, loop, C.ghost, 3, [9, 7]);
      runnerChip(ctx, v.rect.x + 14, v.rect.y + 14, 2, 0.85);
      // 角落小圖: 角色 3 只看到角色 2 的幽靈
      var ib = { x: v.rect.x + v.rect.w - 330, y: v.rect.y + 12, w: 318, h: 150 };
      rr(ctx, ib.x, ib.y, ib.w, ib.h, 10);
      ctx.fillStyle = 'rgba(14,18,28,0.95)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.panelEdge; ctx.stroke();
      runnerChip(ctx, ib.x + 12, ib.y + 12, 3, 0.7);
      var iv = makeView({ x: ib.x + 130, y: ib.y + 8, w: 180, h: 104 }, 0, 5, -0.4, 2.4);
      iv.enter(ctx);
      A.drawGhost(ctx, { x: 1.3, h: 0, phase: 'play', grounded: false, facing: 1 });
      A.drawGhost(ctx, { x: 3.8, h: 0, phase: 'fading', fade: 0.35, grounded: false, facing: 1 });
      iv.leave(ctx);
      tag(ctx, '角色 2', iv.px(1.3), ib.y + 128, C.ghost);
      tag(ctx, '角色 1', iv.px(3.8), ib.y + 128, C.textDim);
      markOkNg(ctx, iv.px(1.3) + 22, ib.y + 30, true, 12);
      markOkNg(ctx, iv.px(3.8) + 22, ib.y + 30, false, 12);
    },
    // 5 踩頭
    function (ctx) {
      var cs = cells(2, 30);
      for (var i = 0; i < 2; i++) {
        var v = makeView(cs[i], 0, 10, -1, 7);
        var cols = flat(0);
        v.enter(ctx);
        (function (idx) {
          scene(ctx, cols, function () {
            if (idx === 0) {
              A.drawGhost(ctx, { x: 4.0, h: 0, phase: 'play', grounded: true, facing: 1 });
              A.drawPlayer(ctx, { x: 4.0, h: 2, status: 'active', facing: 1 });
            } else {
              A.drawGhost(ctx, { x: 4.0, h: 1.7, phase: 'play', grounded: false, facing: 1 });
              A.drawPlayer(ctx, { x: 4.3, h: 2.9, status: 'active', facing: 1, air: true });
            }
          });
        })(i);
        v.leave(ctx);
        frame(ctx, v.rect);
        if (i === 0) {
          // 兩條高度線: 地上起跳 3.5 / 頭頂起跳 5.5
          ctx.save();
          ctx.setLineDash([10, 7]); ctx.lineWidth = 2.5;
          ctx.strokeStyle = rgba(C.text, 0.55);
          ctx.beginPath(); ctx.moveTo(v.rect.x, v.py(3.5)); ctx.lineTo(v.rect.x + v.rect.w, v.py(3.5)); ctx.stroke();
          ctx.strokeStyle = C.player;
          ctx.beginPath(); ctx.moveTo(v.rect.x, v.py(5.5)); ctx.lineTo(v.rect.x + v.rect.w, v.py(5.5)); ctx.stroke();
          ctx.restore();
          arrowPath(ctx, [[v.px(8.3), v.py(0.1)], [v.px(8.3), v.py(3.5)]], rgba(C.text, 0.8), 4);
          arrowPath(ctx, [[v.px(5.6), v.py(2.1)], [v.px(5.6), v.py(5.5)]], C.player, 4);
          txtO(ctx, '地上起跳', v.px(9.85), v.py(3.5) - 16, 18, C.text, 'right', true);
          txtO(ctx, '頭頂起跳', v.px(9.85), v.py(5.5) - 16, 18, C.player, 'right', true);
          markOkNg(ctx, v.rect.x + 34, v.rect.y + 34, true, 22);
        } else {
          arrowPath(ctx, quadPts(v.px(1.4), v.py(0.15), v.px(2.4), v.py(2.4), v.px(3.2), v.py(1.6), 16), C.ghost, 3, [7, 6]);
          arrowPath(ctx, [[v.px(6.0), v.py(3.4)], [v.px(6.0), v.py(0.4)]], C.text, 4);
          markOkNg(ctx, v.rect.x + 34, v.rect.y + 34, false, 22);
        }
      }
    },
    // 6 鉤爪
    function (ctx) {
      var cs = cells(2, 30);
      for (var i = 0; i < 2; i++) {
        var v = makeView(cs[i], 0, 12, -1, 10);
        var cols = flat(0);
        v.enter(ctx);
        (function (idx) {
          scene(ctx, cols, function () {
            if (idx === 0) {
              A.drawGhost(ctx, { x: 8.0, h: 4.0, phase: 'play', grounded: false, hookable: true, facing: 1 });
              A.drawHookRope(ctx, { x: 5.2, h: 2.8, ax: 8.0, ah: 6.0 });
              A.drawPlayer(ctx, { x: 5.2, h: 2.8, status: 'pulled', facing: 1, anchor: { x: 8.0, h: 6.0 } });
            } else {
              A.drawGhost(ctx, { x: 7.5, h: 0, phase: 'play', grounded: true, facing: -1 });
              A.drawPlayer(ctx, { x: 3.5, h: 0, status: 'active', facing: 1 });
            }
          });
        })(i);
        v.leave(ctx);
        frame(ctx, v.rect);
        if (i === 0) {
          arrowPath(ctx, [[v.px(2.6), v.py(0.15)], [v.px(4.2), v.py(1.65)]], C.text, 3, [7, 6]);
          keyCap(ctx, 'X', v.px(1.0), v.py(2.4), 22);
          arrowPath(ctx, jumpPts(v, 8.0, 6.0, 1, 7.5, 11.8), C.text, 3, [8, 7]);
          keyCap(ctx, '空白鍵', v.px(5.6), v.py(8.6), 20);
          markOkNg(ctx, v.rect.x + 34, v.rect.y + 34, true, 22);
        } else {
          keyCap(ctx, 'X', v.px(3.5) - 17, v.py(3.0), 22);
          markOkNg(ctx, v.rect.x + 34, v.rect.y + 34, false, 22);
        }
      }
    },
    // 7 重來
    function (ctx) {
      var cs = cells(2, 30);
      for (var i = 0; i < 2; i++) {
        var c = cs[i];
        // 上方: 資訊列角色序號的前後
        var chipS = 0.8, cy = c.y + 10;
        var mid = c.x + c.w / 2;
        runnerChip(ctx, mid - 60 - CHIP_W * chipS, cy, 3, chipS);
        arrowPath(ctx, [[mid - 44, cy + 19], [mid + 44, cy + 19]], C.text, 3);
        runnerChip(ctx, mid + 60, cy, i === 0 ? 3 : 2, chipS);
        keyCap(ctx, i === 0 ? 'R' : 'B', mid - 17, cy - 8, 22);
        var v = makeView({ x: c.x, y: c.y + 80, w: c.w, h: c.h - 80 }, 0, 14, -1, 5.5);
        var cols = flat(0);
        v.enter(ctx);
        (function (idx) {
          scene(ctx, cols, function () {
            A.drawSpawn(ctx, { x: 2.5, h: 0 });
            if (idx === 0) {
              A.drawGhost(ctx, { x: 7.0, h: 0, phase: 'play', grounded: true, facing: 1 });
              A.drawPlayer(ctx, { x: 11.2, h: 0, status: 'dead', facing: 1 });
            } else {
              A.drawGhost(ctx, { x: 11.0, h: 0, phase: 'fading', fade: 0.3, grounded: true, facing: 1 });
              A.drawGhost(ctx, { x: 6.5, h: 0, phase: 'play', grounded: true, facing: 1 });
            }
            A.drawPlayer(ctx, { x: 2.5, h: 0, status: 'idle', facing: 1 });
          });
        })(i);
        v.leave(ctx);
        frame(ctx, v.rect);
        if (i === 0) {
          arrowPath(ctx, quadPts(v.px(11.2), v.py(1.3), v.px(7.5), v.py(6.6), v.px(3.4), v.py(2.6), 24), C.player, 3, [8, 7]);
          tag(ctx, '角色 2', v.px(7.0), v.py(2.6), C.ghost);
        } else {
          tag(ctx, '角色 2', v.px(11.0), v.py(2.6), C.textDim);
          tag(ctx, '角色 1', v.px(6.5), v.py(2.6), C.ghost);
          markOkNg(ctx, v.px(11.0) + 26, v.py(1.8), false, 13);
          arrowPath(ctx, [[v.px(10.2), v.py(1.0)], [v.px(7.4), v.py(1.0)]], C.ghost, 3, [7, 6]);
        }
      }
    },
    // 8 其他按鍵
    function (ctx) {
      var ts = 0.27, tw = W * ts, th = H * ts, gap = 170;
      var x0 = GX + (GW - (tw * 2 + gap)) / 2;
      var rows = [['Esc', 'pause'], ['H', 'guide']];
      for (var i = 0; i < 2; i++) {
        var y = GY + 14 + i * (th + 36);
        for (var k = 0; k < 2; k++) {
          var x = x0 + k * (tw + gap);
          ctx.save();
          ctx.beginPath(); ctx.rect(x, y, tw, th); ctx.clip();
          ctx.translate(x, y); ctx.scale(ts, ts);
          if (k === 1 && rows[i][1] === 'guide') {
            A.drawGuidePage(ctx, { page: 1, total: GUIDE.length });
          } else {
            var cols = flat(0);
            A.drawBackground(ctx);
            A.drawTerrain(ctx, { cols: cols });
            A.drawSpawn(ctx, { x: 2.5, h: 0 });
            A.drawGoalFlag(ctx, { col: 36, h: 0, reached: false });
            A.drawGhost(ctx, { x: 14, h: 0, phase: 'play', grounded: true, facing: 1 });
            A.drawPlayer(ctx, { x: 9, h: 0, status: 'active', facing: 1 });
            A.drawHud(ctx, { level: 1, runner: 2, hookEnabled: false });
            if (k === 1) A.drawPauseScreen(ctx, {});
          }
          ctx.restore();
          frame(ctx, { x: x, y: y, w: tw, h: th });
        }
        var ax = x0 + tw + 20, bx = x0 + tw + gap - 20, my = y + th / 2;
        arrowPath(ctx, [[ax, my + 22], [bx, my + 22]], C.text, 4);
        var kw = keyCapW(ctx, rows[i][0], 24);
        keyCap(ctx, rows[i][0], (ax + bx) / 2 - kw / 2, my - 18, 24);
      }
    }
  ];

  // 說明畫面: state { page: 1~8, total?: 8 }
  A.guidePageCount = GUIDE.length;
  A.drawGuidePage = function (ctx, s) {
    s = s || {};
    var total = GUIDE.length;
    var p = Math.max(1, Math.min(total, s.page || 1));
    var g = GUIDE[p - 1];
    ctx.save();
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, W, H);
    txt(ctx, g.title, GX, 62, 40, C.text, 'left', true);
    txt(ctx, g.text, GX, 122, 26, C.text, 'left', false);
    rr(ctx, GX - 8, GY - 8, GW + 16, GH + 16, 12);
    ctx.fillStyle = C.panel; ctx.fill();
    ctx.save();
    guidePainters[p - 1](ctx);
    ctx.restore();
    var fy = 668;
    keyRow(ctx, [[['←', '→'], '翻頁'], [['Enter'], '關閉']], GX, fy, 20, C.textDim, 36);
    txt(ctx, p + ' / ' + total, GX + GW, fy, 24, C.text, 'right', true);
    ctx.restore();
  };

  window.Art = A;
})();

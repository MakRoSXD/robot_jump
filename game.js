// «До верхньої полиці» — стрибалка в стилі «Один на зміні»: той самий робот,
// таблетки й кольори, але замість ловити — скачемо поличками вгору.
// Один файл без залежностей: відкривається і з GitHub Pages, і просто з диска.
(function () {
  "use strict";

  // Номер версії: той самий має стояти у version.json і в ?v= біля game.js в index.html
  var VERSION = 5;

  // ---------- Світ ----------
  // Ширина світу стала, висота видимої частини залежить від екрана.
  // Вісь Y дивиться вниз: робот стартує на y = 0 і лізе у від'ємні значення.
  var W = 720;
  var VH = 1280;
  var G = 0.0022;          // px/мс²
  var VJ = 1.27;           // звичайний стрибок: висота VJ²/2G ≈ 367 px
  var VSPRING = 1.95;      // з пружини
  var VBOOST = 1.55;       // ривок на вітаміні, px/мс
  var BOOST_MS = 2300;
  var MAXVX = 0.62;
  var RS = 0.34;           // масштаб робота (намальований у «великих» одиницях)
  var FOOT = 22;           // на скільки центр робота може звисати з краю полички
  var PLAT_H = 24;
  var SCORE_PX = 30;       // скільки px висоти дає один бал
  var PILL_PTS = 5, FOE_PTS = 10;

  // Палітра — та сама, що в «Один на зміні» (брендбук АНЦ)
  var INK = "#1E2A31", SHELL = "#F3F8F9", SHELL_TOP = "#D2E6E2", SHELL_EDGE = "#DCEAEE";
  var METAL = "#9AA4A8", METAL_DARK = "#7C878C", METAL_LIGHT = "#B6BFC3";
  var VISOR_HI = "#3E9BD8", VISOR_LO = "#0A64AC", EYE = "#FFD92E", EYE_LINE = "#E09A1C";
  var YELLOW = "#FFE241", BLUE_DEEP = "#0070A4", BLUE_25 = "#BFE3F2";
  var FONT = "Montserrat, -apple-system, 'Segoe UI', system-ui, sans-serif";

  var cv = document.getElementById("c");
  var c = cv.getContext("2d");
  var dpr = 1, iw = 0, ih = 0, scale = 1, offX = 0, offY = 0, safeTop = 0, safeBottom = 0;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function hash(i, j) { var s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
  // найкоротша різниця по X з урахуванням того, що світ замкнений у кільце
  function wrapDx(d) { d = ((d % W) + W) % W; return d > W / 2 ? d - W : d; }

  // ---------- Збереження ----------
  function load(k, def) { try { var v = localStorage.getItem("polytsia." + k); return v == null ? def : v; } catch (e) { return def; } }
  function save(k, v) { try { localStorage.setItem("polytsia." + k, String(v)); } catch (e) { /* приватне вікно — граємо без рекорду */ } }
  // «best2»: у версії 2 бали рахуються інакше, старий рекорд із «best» не порівнянний
  var best = parseInt(load("best2", "0"), 10) || 0;
  var bestH = parseFloat(load("bestH", "0")) || 0;
  var muted = load("mute", "0") === "1";
  var useTilt = load("tilt", "0") === "1";

  // ---------- Звук ----------
  var AC = null, master = null;
  function audioInit() {
    if (AC) { if (AC.state === "suspended") AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain();
      master.gain.value = 0.22;
      master.connect(AC.destination);
    } catch (e) { AC = null; }
  }
  function tone(type, f0, f1, dur, vol, delay) {
    if (!AC || muted || mode !== "play") return;
    var t = AC.currentTime + (delay || 0);
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  var sfx = {
    jump: function () { tone("sine", 330, 560, 0.11, 0.5); },
    spring: function () { tone("triangle", 260, 1040, 0.24, 0.6); },
    pill: function () { tone("sine", 880, 880, 0.08, 0.4); tone("sine", 1320, 1320, 0.13, 0.4, 0.07); },
    boost: function () { tone("sawtooth", 180, 760, 0.5, 0.22); tone("sine", 520, 1560, 0.5, 0.3, 0.05); },
    stomp: function () { tone("square", 240, 90, 0.14, 0.28); },
    brk: function () { tone("triangle", 190, 70, 0.16, 0.4); },
    hit: function () { tone("sawtooth", 320, 70, 0.4, 0.3); },
    over: function () { tone("sine", 520, 130, 0.6, 0.45); }
  };

  // ---------- Стан ----------
  var mode = "menu";       // menu | play | pause | over
  var S = null;
  var keyL = false, keyR = false, pointers = {}, pointerDir = 0, tiltDir = 0;

  function reset() {
    S = {
      t: 0, camY: -VH * 0.78, minY: 0, bonus: 0, score: 0,
      genY: 0, row: 0, lastFragile: false, lastFoeRow: -9, lastVitRow: -30, prevX: null,
      robot: { x: W / 2, y: 0, py: 0, vx: 0, vy: 0, face: 1, faceT: 1, squashT: 0, boost: 0,
               dead: false, spin: 0, moodT: 0, track: 0, puff: 0 },
      plats: [{ type: "floor", x: W / 2, y: 0, w: W * 4, sx: null, broken: false }],
      items: [], foes: [], parts: [], pops: [], boxes: [], gplats: [], hintT: 4500, why: ""
    };
    genUpTo(S.camY - 420);
  }

  // ---------- Генерація рівня ----------
  // Кожен «ряд» має головну поличку не далі ніж 270 px від попередньої —
  // звичайного стрибка (367 px) завжди вистачає, і по горизонталі робот за цей
  // час долітає до будь-якої точки кільця. Запасних поличок майже нема.
  //
  // Ніщо ні з чим не перетинається. Усе поставлене лишає прямокутник у S.boxes,
  // причому рухомі речі займають увесь свій шлях: поличка й вірус їздять від
  // краю до краю, тож їхня смуга по висоті зайнята на всю ширину. Нове ставимо
  // лише у вільне місце; не влазить — пробуємо інший X, а тоді обходимось без
  // нього (запасна поличка, таблетка чи вірус просто не з'являється).
  // Головній поличці місце є завжди: усе з попереднього ряду лежить не вище ніж
  // 117 px над ним, а наступний ряд починається щонайменше за 118 px.
  function genUpTo(yTop) {
    while (S.genY > yTop) genRow();
  }
  function isFree(x0, x1, y0, y1, pad) {
    for (var i = 0; i < S.boxes.length; i++) {
      var b = S.boxes[i];
      if (x0 - pad < b.x1 && x1 + pad > b.x0 && y0 < b.y1 && y1 > b.y0) return false;
    }
    return true;
  }
  function occupy(x0, x1, y0, y1) { S.boxes.push({ x0: x0, x1: x1, y0: y0, y1: y1 }); }
  // Нерухомий вірус не може висіти над нерухомою поличкою: робот підстрибує сам,
  // тож приземлившись під вірусом, він за якусь мить влітає в нього головою й
  // ухилитися не встигає — поличка стає пасткою. Над поличкою (до 450 px угору:
  // зріст робота + шлях, за який ще можна відійти вбік) вірус стоїть не ближче
  // ніж 110 px від її краю: це край + 22 px смуги приземлення + пів робота + вірус.
  function virusClear(fx, fy) {
    for (var i = 0; i < S.gplats.length; i++) {
      var g = S.gplats[i], dy = g.y - fy;
      if (dy > 0 && dy < 450 && Math.abs(fx - g.x) < g.w / 2 + 110) return false;
    }
    return true;
  }

  function genRow() {
    var h = -S.genY, d = clamp(h / 40000, 0, 1), k, cand;
    var gap = S.row < 5 ? rnd(120, 160) : lerp(150, 215, d) + Math.random() * lerp(50, 55, d);
    S.genY -= gap; S.row++;
    var y = S.genY, w = lerp(130, 102, d);
    for (k = S.boxes.length - 1; k >= 0; k--) if (S.boxes[k].y0 > y + 700) S.boxes.splice(k, 1);
    for (k = S.gplats.length - 1; k >= 0; k--) if (S.gplats[k].y > y + 700) S.gplats.splice(k, 1);

    // ---- головна поличка ----
    var type = "n", r = Math.random();
    var pm = lerp(0.06, 0.36, d);
    var pf = (h > 1500 && !S.lastFragile) ? lerp(0.05, 0.2, d) : 0;
    if (r < pm) type = "m"; else if (r < pm + pf) type = "f";
    if (type === "m" && !isFree(6, W - 6, y - 2, y + 32, 0)) type = "n";
    S.lastFragile = type === "f";
    var x = rnd(w / 2 + 14, W - w / 2 - 14);
    if (type !== "m") {
      for (k = 0; k < 12 && !isFree(x - w / 2, x + w / 2, y - 36, y + 32, 12); k++) x = rnd(w / 2 + 14, W - w / 2 - 14);
    }
    var prevX = S.prevX;                 // головна поличка ряду нижче (null — рухома)
    S.prevX = type === "m" ? null : x;
    var p = mkPlat(type, x, y, w);
    if (type === "m") {
      p.vx = (Math.random() < 0.5 ? -1 : 1) * lerp(0.09, 0.2, d) * rnd(0.8, 1.2);
      occupy(6, W - 6, y - 2, y + 32);
    } else {
      occupy(x - w / 2, x + w / 2, y - 2, y + 32);
      S.gplats.push({ x: x, y: y, w: w });
      if (type === "n" && S.row > 6 && Math.random() < 0.075) {
        p.sx = rnd(-w / 2 + 30, w / 2 - 30);
        occupy(x + p.sx - 27, x + p.sx + 27, y - 36, y - 2);
      }
    }
    S.plats.push(p);

    // ---- друга поличка в тому ж ряду — зрідка, а з висотою майже ніколи ----
    if (Math.random() < lerp(0.18, 0.04, d)) {
      var y2 = y + rnd(-34, 34), x2 = null;
      for (k = 0; k < 8 && x2 == null; k++) {
        cand = rnd(w / 2 + 14, W - w / 2 - 14);
        if (isFree(cand - w / 2, cand + w / 2, y2 - 2, y2 + 32, 36)) x2 = cand;
      }
      if (x2 != null) {
        S.plats.push(mkPlat(h > 1500 && Math.random() < 0.35 ? "f" : "n", x2, y2, w));
        occupy(x2 - w / 2, x2 + w / 2, y2 - 2, y2 + 32);
        S.gplats.push({ x: x2, y: y2, w: w });
      }
    }

    // ---- таблетка: над поличкою, над пружиною або поруч із рухомою ----
    var px = null, py = 0;
    if (p.sx != null) { px = x + p.sx; py = y - 86; }
    else if (S.row > 2 && Math.random() < 0.1) {
      if (type === "m") { px = rnd(60, W - 60); py = y - rnd(64, 86); }
      else { px = x; py = y - 56; }
    }
    if (px != null && isFree(px - 30, px + 30, py - 30, py + 30, 6)) {
      S.items.push({ type: "pill", x: px, y: py, r: 25, ph: rnd(0, 6) });
      occupy(px - 30, px + 30, py - 30, py + 30);
    }

    // ---- вітамін — рідкісний ривок угору ----
    if (h > 2500 && S.row - S.lastVitRow > 28 && Math.random() < 0.06) {
      for (k = 0; k < 8; k++) {
        cand = rnd(70, W - 70);
        if (!isFree(cand - 42, cand + 42, y - 116, y - 32, 10)) continue;
        S.lastVitRow = S.row;
        S.items.push({ type: "vit", x: cand, y: y - 74, r: 30, ph: rnd(0, 6) });
        occupy(cand - 42, cand + 42, y - 116, y - 32);
        break;
      }
    }

    // ---- вірус ----
    // Рухомий — лише якщо вся його смуга вільна (нема пружини, таблетки, вищої
    // запасної полички): він їздить туди-сюди, його можна перечекати. Нерухомий —
    // лише там, де не висить над поличкою (virusClear), зате з дозволених місць
    // обирає найближче до дороги — середини між поличкою нижче й цією: стоїть не
    // десь у кутку, а там, де робот летітиме. Обійти можна завжди: над ним, з
    // іншого боку кільця або піднявшись у стовпі своєї полички — він вільний.
    // Нема де стати нерухомому — стає рухомим, а не влазить у смугу — вірусу нема.
    if (h > 1800 && S.row - S.lastFoeRow > 1 && Math.random() < lerp(0.3, 0.52, d)) {
      var fy = y - 62, fx = null, fvx = 0;
      var bandFree = isFree(11, W - 11, fy - 55, fy + 55, 0);
      if (!(bandFree && Math.random() < 0.6)) {
        var aim = (prevX != null && type !== "m") ? (prevX + x) / 2 : null, bestD = 1e9;
        for (k = 0; k < 16; k++) {
          cand = rnd(60, W - 60);
          if (!virusClear(cand, fy) || !isFree(cand - 47, cand + 47, fy - 55, fy + 55, 12)) continue;
          if (aim == null) { fx = cand; break; }
          if (Math.abs(cand - aim) < bestD) { bestD = Math.abs(cand - aim); fx = cand; }
        }
        if (fx != null) occupy(fx - 47, fx + 47, fy - 55, fy + 55);
      }
      if (fx == null && bandFree) {
        fx = rnd(60, W - 60);
        fvx = (Math.random() < 0.5 ? -1 : 1) * lerp(0.07, 0.12, d) * rnd(0.8, 1.3);
        occupy(11, W - 11, fy - 55, fy + 55);
      }
      if (fx != null) {
        S.lastFoeRow = S.row;
        S.foes.push({ x: fx, y: fy, r: 30, ph: rnd(0, 3000), dead: false, vy: 0, rot: 0, a: 1, vx: fvx });
      }
    }
  }
  function mkPlat(type, x, y, w) {
    return { type: type, x: x, y: y, w: w, vx: 0, sx: null, springT: 0, broken: false, rot: 0, vy: 0, a: 1 };
  }

  // ---------- Керування ----------
  function inputDir() {
    if (keyL !== keyR) return keyL ? -1 : 1;
    if (pointerDir) return pointerDir;
    if (useTilt) return tiltDir;
    return 0;
  }

  // ---------- Крок симуляції ----------
  function step(dt) {
    S.t += dt;
    if (mode !== "over") stepRobot(dt);
    stepPlats(dt);
    if (mode === "play") stepItems();
    stepFoes(dt);
    stepFx(dt);
    genUpTo(S.camY - 420);
    cull();
  }

  function stepRobot(dt) {
    var r = S.robot;
    var dir = (mode === "play" && !r.dead) ? inputDir() : 0;
    if (!r.dead) r.vx += (dir * MAXVX - r.vx) * Math.min(1, dt * 0.011);
    r.x += r.vx * dt;
    if (r.x < 0) r.x += W; else if (r.x >= W) r.x -= W;
    if (Math.abs(dir) > 0.15) r.faceT = dir > 0 ? 1 : -1;
    r.face += (r.faceT - r.face) * Math.min(1, dt * 0.014);
    r.track += r.vx * dt * 0.5 + dt * 0.02;

    r.py = r.y;
    if (r.boost > 0) {
      r.boost -= dt;
      r.vy = r.boost > 0 ? -VBOOST : -VJ;
      r.puff -= dt;
      if (r.puff <= 0) {
        r.puff = 34;
        S.parts.push({ x: r.x + rnd(-26, 26), y: r.y + rnd(0, 18), vx: rnd(-0.06, 0.06), vy: rnd(0.15, 0.4),
                       life: 420, max: 420, r: rnd(7, 14), col: Math.random() < 0.5 ? YELLOW : "#FFFFFF", g: 0 });
      }
    } else {
      r.vy = Math.min(r.vy + G * dt, 2.3);
    }
    r.y += r.vy * dt;

    if (r.dead) r.spin += dt * 0.012 * (r.vx >= 0 ? 1 : -1);
    else if (r.vy > 0) land();

    if (r.squashT > 0) r.squashT -= dt;
    if (r.moodT > 0) r.moodT -= dt;
    if (S.hintT > 0 && mode === "play") S.hintT -= dt;

    if (!r.dead && r.y < S.minY) S.minY = r.y;
    S.score = Math.floor(-S.minY / SCORE_PX) + S.bonus;

    var target = r.y - VH * 0.48;
    if (target < S.camY) S.camY += (target - S.camY) * Math.min(1, dt * 0.014);

    if (mode === "play" && r.y - 170 > S.camY + VH) gameOver(r.dead ? "virus" : "fall");
  }

  function land() {
    var r = S.robot, i, p, top;
    for (i = 0; i < S.plats.length; i++) {
      p = S.plats[i];
      if (p.broken) continue;
      if (mode === "menu" && p.type !== "floor") continue;   // у меню робот просто підстрибує на стійці
      if (p.sx != null) {
        top = p.y - 30;
        if (r.py <= top && r.y >= top && Math.abs(wrapDx(r.x - (p.x + p.sx))) < 46) {
          r.y = top; r.vy = -VSPRING; r.squashT = 170; p.springT = 260;
          sfx.spring();
          return;
        }
      }
      if (r.py <= p.y && r.y >= p.y && (p.type === "floor" || Math.abs(wrapDx(r.x - p.x)) < p.w / 2 + FOOT)) {
        r.y = p.y; r.vy = -VJ; r.squashT = 170;
        if (p.type === "f") {
          p.broken = true; p.vy = 0.1;
          for (var k = 0; k < 7; k++) {
            S.parts.push({ x: p.x + rnd(-p.w / 2, p.w / 2), y: p.y + 8, vx: rnd(-0.18, 0.18), vy: rnd(-0.3, 0.05),
                           life: 520, max: 520, r: rnd(3, 6), col: "#F1C29B", g: 1 });
          }
          sfx.brk();
        } else {
          sfx.jump();
        }
        return;
      }
    }
  }

  function stepPlats(dt) {
    for (var i = 0; i < S.plats.length; i++) {
      var p = S.plats[i];
      if (p.broken) {
        p.vy += G * dt; p.y += p.vy * dt; p.rot += dt * 0.0035; p.a -= dt / 300;   // зникає раніше, ніж долетить до полички нижче
      } else if (p.vx) {
        p.x += p.vx * dt;
        var lo = p.w / 2 + 8, hi = W - p.w / 2 - 8;
        if (p.x < lo) { p.x = lo; p.vx = Math.abs(p.vx); }
        if (p.x > hi) { p.x = hi; p.vx = -Math.abs(p.vx); }
      }
      if (p.springT > 0) p.springT -= dt;
    }
  }

  function stepItems() {
    var r = S.robot;
    if (r.dead) return;
    for (var i = S.items.length - 1; i >= 0; i--) {
      var it = S.items[i];
      var dx = wrapDx(r.x - it.x), dy = (r.y - 76) - it.y;
      if (Math.abs(dx) < 46 + it.r * 0.6 && Math.abs(dy) < 78 + it.r * 0.6) {
        S.items.splice(i, 1);
        if (it.type === "pill") {
          S.bonus += PILL_PTS; r.moodT = 420;
          pop("+" + PILL_PTS, it.x, it.y - 20, false);
          sfx.pill();
        } else {
          r.boost = BOOST_MS; r.moodT = BOOST_MS;
          pop("ВІТАМІН!", clamp(it.x, 110, W - 110), it.y - 30, true);
          sfx.boost();
        }
      }
    }
  }

  function stepFoes(dt) {
    var r = S.robot;
    for (var i = 0; i < S.foes.length; i++) {
      var f = S.foes[i];
      f.ph += dt;
      if (f.dead) { f.vy += G * dt; f.y += f.vy * dt; f.rot += dt * 0.01; f.a -= dt / 600; continue; }
      if (f.vx) {
        f.x += f.vx * dt;
        if (f.x < 60) { f.x = 60; f.vx = Math.abs(f.vx); }
        if (f.x > W - 60) { f.x = W - 60; f.vx = -Math.abs(f.vx); }
      }
      if (mode !== "play" || r.dead) continue;
      var fy = f.y + Math.sin(f.ph / 420) * 8;
      // Хітбокс: коло вірусу (тіло й половина шипів) проти прямокутника робота
      // (корпус із головою). Раніше обидва були помітно менші за малюнок.
      var dx = wrapDx(r.x - f.x), R = f.r * 1.25;
      var nx = clamp(-dx, -40, 40), ny = clamp(fy, r.y - 148, r.y - 4);
      var ex = -dx - nx, ey = fy - ny;
      if (ex * ex + ey * ey < R * R) {
        if (r.boost > 0) {
          f.dead = true; f.vy = -0.5; S.bonus += FOE_PTS;
          pop("+" + FOE_PTS, f.x, fy - 30, true); sfx.stomp();
        } else if (r.vy > 0 && r.py <= fy - 4) {
          f.dead = true; f.vy = 0.2; S.bonus += FOE_PTS;
          r.vy = -VJ; r.squashT = 170; r.moodT = 420;
          pop("+" + FOE_PTS, f.x, fy - 30, true); sfx.stomp();
        } else {
          r.dead = true; r.vy = -0.55; r.vx = dx >= 0 ? 0.22 : -0.22; r.boost = 0;
          sfx.hit();
        }
      }
    }
  }

  function stepFx(dt) {
    var i, p;
    for (i = S.parts.length - 1; i >= 0; i--) {
      p = S.parts[i];
      p.life -= dt;
      if (p.life <= 0) { S.parts.splice(i, 1); continue; }
      if (p.g) p.vy += G * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (i = S.pops.length - 1; i >= 0; i--) {
      S.pops[i].life -= dt;
      if (S.pops[i].life <= 0) S.pops.splice(i, 1);
    }
  }
  function pop(txt, x, y, big) { S.pops.push({ txt: txt, x: x, y: y, life: 800, max: 800, big: big }); }

  function cull() {
    var bottom = S.camY + VH + 140, i;
    for (i = S.plats.length - 1; i >= 0; i--) {
      var p = S.plats[i];
      if (p.type === "floor") { if (p.y > bottom + 400) S.plats.splice(i, 1); continue; }
      if (p.y > bottom || p.a <= 0) S.plats.splice(i, 1);
    }
    for (i = S.items.length - 1; i >= 0; i--) if (S.items[i].y > bottom) S.items.splice(i, 1);
    for (i = S.foes.length - 1; i >= 0; i--) if (S.foes[i].y > bottom || S.foes[i].a <= 0) S.foes.splice(i, 1);
  }

  // ---------- Малювання: дрібні помічники ----------
  function rrPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function rr(x, y, w, h, r) { c.beginPath(); rrPath(x, y, w, h, r); }
  function polyRound(pts, rads) {
    var n = pts.length;
    c.beginPath();
    c.moveTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
    for (var i = 1; i <= n; i++) {
      var p = pts[i % n], q = pts[(i + 1) % n];
      c.arcTo(p[0], p[1], q[0], q[1], rads[i % n]);
    }
    c.closePath();
  }
  function fs(fill, stroke, lw) {
    c.fillStyle = fill; c.fill();
    if (stroke) { c.lineWidth = lw || 5; c.strokeStyle = stroke; c.stroke(); }
  }
  function circle(x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
  function line(x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }

  // ---------- Малювання: тло ----------
  function drawBackdrop() {
    // хрести аптеки пливуть повільніше за полички — відчуття висоти
    var sp = 340, par = S.camY * 0.3;
    var j0 = Math.floor(par / sp) - 1, j1 = Math.ceil((par + VH) / sp) + 1;
    c.save();
    c.globalAlpha = 0.075;
    c.fillStyle = "#FFFFFF";
    for (var j = j0; j <= j1; j++) {
      for (var i = 0; i < 3; i++) {
        var s = 34 + 30 * hash(i, j);
        var x = i * sp + ((j & 1) ? sp / 2 : 0) - 40 + (hash(j, i) - 0.5) * 70;
        var y = j * sp - par;
        c.beginPath();
        rrPath(x - s * 0.31, y - s, s * 0.62, s * 2, s * 0.17);
        rrPath(x - s, y - s * 0.31, s * 2, s * 0.62, s * 0.17);
        c.fill();
      }
    }
    c.restore();
  }

  function drawMarks() {
    // позначки висоти через кожні 100 балів
    var top = S.camY, bottom = S.camY + VH, stepPx = 100 * SCORE_PX;
    c.save();
    c.textAlign = "left";
    c.font = "800 20px " + FONT;
    var k0 = Math.max(1, Math.floor(-bottom / stepPx)), k1 = Math.floor(-top / stepPx) + 1;
    for (var k = k0; k <= k1; k++) {
      var y = -k * stepPx;
      c.strokeStyle = "rgba(255,255,255,.2)"; c.lineWidth = 3; c.setLineDash([4, 14]); c.lineCap = "round";
      line(84, y, W - 16, y);
      c.fillStyle = "rgba(255,255,255,.4)";
      c.fillText(String(k * 100), 16, y + 7);
    }
    // лінія рекорду
    if (bestH > 400 && mode !== "menu") {
      var by = -bestH;
      if (by > top - 40 && by < bottom + 40) {
        c.strokeStyle = "rgba(255,226,65,.85)"; c.lineWidth = 4; c.setLineDash([14, 12]);
        line(16, by, W - 120, by);
        c.setLineDash([]);
        c.textAlign = "right";
        c.font = "800 18px " + FONT;
        c.fillStyle = YELLOW;
        c.fillText("рекорд", W - 16, by + 6);
      }
    }
    c.restore();
  }

  function drawFloor() {
    var bottom = S.camY + VH;
    if (bottom < 0) return;
    // стійка аптеки, з якої робот стартує
    c.fillStyle = BLUE_25;
    c.fillRect(0, 0, W, bottom + 10);
    c.fillStyle = "rgba(255,255,255,.6)";
    c.fillRect(0, 0, W, 8);
  }

  // ---------- Малювання: полички ----------
  function drawPlat(p) {
    if (p.type === "floor") return;
    var x = p.x, y = p.y, w = p.w, h = PLAT_H;
    if (p.type === "f") { drawPlaster(p); return; }
    var x0 = x - w / 2 + h / 2, x1 = x + w / 2 - h / 2, ym = y + h / 2;
    c.lineCap = "round";
    c.strokeStyle = "rgba(0,0,0,.10)"; c.lineWidth = h + 2;
    line(x0, ym + 7, x1, ym + 7);
    if (p.type === "m") {
      c.strokeStyle = YELLOW; c.lineWidth = h; line(x0, ym, x1, ym);
      c.strokeStyle = "#FFF1A0"; c.lineWidth = 11; line(x0, ym, x1, ym);
      // стрілочки — поличка їздить
      c.fillStyle = "#D2B21E";
      var dir = p.vx > 0 ? 1 : -1;
      for (var i = -1; i <= 1; i++) {
        var ax = x + i * 26;
        c.beginPath();
        c.moveTo(ax - dir * 5, ym - 5); c.lineTo(ax + dir * 5, ym); c.lineTo(ax - dir * 5, ym + 5);
        c.closePath(); c.fill();
      }
    } else {
      c.strokeStyle = "#FFFFFF"; c.lineWidth = h; line(x0, ym, x1, ym);
      c.strokeStyle = BLUE_25; c.lineWidth = 12; line(x0, ym, x1, ym);
    }
    if (p.sx != null) drawSpring(x + p.sx, y, p.springT);
  }

  function drawSpring(x, y, t) {
    var hC = 20 + (t > 0 ? 16 * Math.sin(Math.PI * t / 260) : 0);
    c.save();
    c.lineJoin = "round"; c.lineCap = "round";
    function coil() {
      c.beginPath();
      c.moveTo(x - 11, y);
      for (var i = 1; i <= 4; i++) c.lineTo(x + (i % 2 ? 11 : -11), y - hC * i / 4);
      c.stroke();
    }
    c.strokeStyle = INK; c.lineWidth = 9; coil();
    c.strokeStyle = METAL_LIGHT; c.lineWidth = 4; coil();
    rr(x - 25, y - hC - 11, 50, 12, 6);
    fs(YELLOW, INK, 3.5);
    c.restore();
  }

  function drawPlaster(p) {
    var w = p.w, h = 22;
    c.save();
    c.translate(p.x, p.y + h / 2);
    c.rotate(p.rot);
    c.globalAlpha = clamp(p.a, 0, 1);
    c.fillStyle = "rgba(0,0,0,.10)";
    rr(-w / 2, -h / 2 + 7, w, h, h / 2); c.fill();
    rr(-w / 2, -h / 2, w, h, h / 2);
    fs("#F1C29B", "#B9794C", 3);
    rr(-w * 0.17, -h / 2 + 3, w * 0.34, h - 6, 4);
    c.fillStyle = "#FBE4CE"; c.fill();
    c.fillStyle = "rgba(185,121,76,.6)";
    for (var s = -1; s <= 1; s += 2) {
      for (var i = 0; i < 3; i++) {
        for (var j = -1; j <= 1; j += 2) {
          circle(s * (w * 0.25 + i * 11), j * 4.5, 1.9); c.fill();
        }
      }
    }
    c.restore();
  }

  // ---------- Малювання: таблетка, вітамін, вірус ----------
  // Таблетка з личком — як у «Один на зміні»: товстий білий диск із борозенкою
  function drawPill(x, y, r, spin) {
    var lw = Math.max(1.5, r * 0.085), rf = r * 0.9, dx = r * 0.07, dy = r * 0.06;
    c.save();
    c.translate(x, y);
    c.lineJoin = "round";
    circle(-dx, dy, rf); fs("#A9B4B8", INK, lw);
    c.translate(dx, -dy);
    circle(0, 0, rf);
    var g = c.createLinearGradient(0, -rf, 0, rf);
    g.addColorStop(0.45, "#FFFFFF"); g.addColorStop(1, "#E4EBF0");
    c.fillStyle = g; c.fill();
    c.save();
    c.clip();
    c.rotate(spin);
    c.fillStyle = "#C3CDD3";
    c.fillRect(-rf, rf * 0.15, rf * 2, rf * 0.14);
    c.lineWidth = lw * 0.7; c.strokeStyle = INK;
    line(-rf, rf * 0.15, rf, rf * 0.15);
    var er = rf * 0.27;
    for (var s = -1; s <= 1; s += 2) {
      var ex = s * rf * 0.31, ey = -rf * 0.3;
      circle(ex, ey, er); c.fillStyle = INK; c.fill();
      c.fillStyle = "#FFFFFF";
      circle(ex - er * 0.2, ey - er * 0.24, er * 0.34); c.fill();
      circle(ex + er * 0.3, ey + er * 0.3, er * 0.14); c.fill();
    }
    c.beginPath(); c.arc(0, -rf * 0.1, rf * 0.08, Math.PI * 0.1, Math.PI * 0.9);
    c.lineWidth = lw * 0.7; c.lineCap = "round"; c.strokeStyle = INK; c.stroke();
    c.restore();
    circle(0, 0, rf); c.lineWidth = lw; c.strokeStyle = INK; c.stroke();
    c.restore();
  }

  function drawVit(x, y, ph) {
    c.save();
    c.translate(x, y + Math.sin(ph / 300) * 5);
    c.globalAlpha = 0.22 + 0.08 * Math.sin(ph / 180);
    circle(0, 0, 50); c.fillStyle = YELLOW; c.fill();
    c.globalAlpha = 1;
    // іскорки навколо
    c.fillStyle = "#FFFFFF";
    for (var i = 0; i < 3; i++) {
      var a = ph / 700 + i * 2.1, sx = Math.cos(a) * 48, sy = Math.sin(a) * 40, sr = 5 + 2 * Math.sin(ph / 160 + i);
      c.beginPath();
      c.moveTo(sx, sy - sr); c.quadraticCurveTo(sx, sy, sx + sr, sy); c.quadraticCurveTo(sx, sy, sx, sy + sr);
      c.quadraticCurveTo(sx, sy, sx - sr, sy); c.quadraticCurveTo(sx, sy, sx, sy - sr);
      c.fill();
    }
    c.rotate(-0.55);
    var L = 34, R = 17;
    rr(-L, -R, L * 2, R * 2, R); c.fillStyle = "#FFFFFF"; c.fill();
    c.save();
    c.clip();
    c.fillStyle = YELLOW; c.fillRect(-L - 2, -R - 2, L + 2, R * 2 + 4);
    c.fillStyle = "rgba(30,42,49,.10)"; c.fillRect(-L - 2, R * 0.3, L * 2 + 4, R);
    c.restore();
    rr(-L, -R, L * 2, R * 2, R); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
    c.lineWidth = 3; line(0, -R, 0, R);
    c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 4; c.lineCap = "round";
    line(-L + 14, -R + 8, -8, -R + 8);
    c.restore();
  }

  function drawFoe(f) {
    var y = f.y + (f.dead ? 0 : Math.sin(f.ph / 420) * 8), R = f.r;
    c.save();
    c.translate(f.x, y);
    c.globalAlpha = clamp(f.a, 0, 1);
    if (f.dead) { c.rotate(f.rot); c.scale(1.15, 0.7); }
    c.save();
    c.rotate(f.ph / 1400);
    c.lineCap = "round";
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
      c.strokeStyle = INK; c.lineWidth = 8;
      line(ca * R * 0.8, sa * R * 0.8, ca * R * 1.3, sa * R * 1.3);
      circle(ca * R * 1.36, sa * R * 1.36, 6.5); fs("#FF6B5A", INK, 3.5);
    }
    c.restore();
    circle(0, 0, R);
    var g = c.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, "#FF8876"); g.addColorStop(1, "#EE4F3D");
    fs(g, INK, 4);
    c.fillStyle = "rgba(158,36,22,.35)";
    circle(-R * 0.45, R * 0.45, 5); c.fill();
    circle(R * 0.5, R * 0.3, 3.5); c.fill();
    circle(R * 0.1, -R * 0.62, 3); c.fill();
    // сердите личко
    for (var s = -1; s <= 1; s += 2) {
      circle(s * 11, -3, 8); fs("#FFFFFF", INK, 2.5);
      circle(s * 10, -2, 3.6); c.fillStyle = INK; c.fill();
      c.strokeStyle = INK; c.lineWidth = 4;
      line(s * 19, -15, s * 5, -9);
    }
    c.beginPath(); c.arc(0, 18, 8, Math.PI * 1.15, Math.PI * 1.85);
    c.lineWidth = 3.5; c.strokeStyle = INK; c.stroke();
    c.restore();
  }

  // ---------- Малювання: робот ----------
  // Той самий робот із брендбуку, що й у «Один на зміні»: гусеничний клин,
  // білий корпус із синім екраном, шия й голова з візором. Тут він без руки
  // й пакета — зате пружинить і нахиляється в бік руху.
  function visorPath(k) {
    c.beginPath();
    c.moveTo(-104 * k, 8 * k);
    c.bezierCurveTo(-104 * k, -26 * k, -74 * k, -46 * k, -38 * k, -42 * k);
    c.bezierCurveTo(-20 * k, -40 * k, -12 * k, -28 * k, -2 * k, -20 * k);
    c.bezierCurveTo(10 * k, -40 * k, 42 * k, -50 * k, 74 * k, -44 * k);
    c.bezierCurveTo(106 * k, -38 * k, 122 * k, -14 * k, 118 * k, 8 * k);
    c.bezierCurveTo(114 * k, 30 * k, 86 * k, 40 * k, 44 * k, 40 * k);
    c.lineTo(-44 * k, 40 * k);
    c.bezierCurveTo(-82 * k, 40 * k, -104 * k, 30 * k, -104 * k, 8 * k);
    c.closePath();
  }
  function drawEye(x, w, h) {
    rr(x - w / 2, -h / 2, w, h, w / 2);
    c.save(); c.clip();
    c.fillStyle = EYE; c.fillRect(x - w, -h, w * 2, h * 2);
    c.strokeStyle = EYE_LINE; c.lineWidth = 3;
    for (var i = -2; i <= 2; i++) line(x - w, i * 9, x + w, i * 9);
    c.restore();
    rr(x - w / 2, -h / 2, w, h, w / 2);
    c.lineWidth = 5; c.strokeStyle = INK; c.stroke();
  }

  function drawRobot(x, y) {
    var r = S.robot, LW = 8;
    c.save();
    c.translate(x, y);
    if (r.dead) { c.translate(0, -72); c.rotate(r.spin); c.translate(0, 72); }
    else c.rotate(clamp(r.vx / MAXVX, -1, 1) * 0.13);
    var sq = r.squashT > 0 ? -0.2 * Math.sin(Math.PI * clamp(r.squashT / 170, 0, 1)) : clamp(-r.vy * 0.05, -0.04, 0.07);
    c.scale(RS * (1 - sq * 0.6), RS * (1 + sq));
    c.lineJoin = "round"; c.lineCap = "round";
    // голова відстає від корпусу: на зльоті втискається, у падінні — витягується
    var bob = r.dead ? 0 : clamp(-r.vy * 12, -16, 16);

    // полум'я ривка — під гусеницями
    if (r.boost > 0) {
      var fl = 150 + 40 * Math.sin(S.t / 38) + 20 * Math.sin(S.t / 17);
      c.beginPath();
      c.moveTo(-96, -6); c.quadraticCurveTo(-60, fl * 0.6, 0, fl); c.quadraticCurveTo(60, fl * 0.6, 96, -6);
      c.closePath(); fs(YELLOW, INK, LW);
      c.beginPath();
      c.moveTo(-48, -6); c.quadraticCurveTo(-28, fl * 0.35, 0, fl * 0.58); c.quadraticCurveTo(28, fl * 0.35, 48, -6);
      c.closePath(); c.fillStyle = "#FFFFFF"; c.fill();
    }

    // ---- гусеничний хід ----
    function trackPath() { polyRound([[-90, -126], [90, -126], [180, 0], [-180, 0]], [16, 16, 44, 44]); }
    trackPath(); fs(METAL, INK, LW);
    c.save();
    trackPath(); c.clip();
    var off = ((r.track % 44) + 44) % 44;
    for (var i = -8; i <= 8; i++) {
      var bx = i * 44 + off;
      c.beginPath();
      c.moveTo(bx - 34, 10); c.lineTo(bx + 34, -136); c.lineTo(bx + 56, -136); c.lineTo(bx - 12, 10);
      c.closePath();
      c.fillStyle = i % 2 ? METAL_LIGHT : METAL_DARK; c.fill();
      c.strokeStyle = "rgba(30,42,49,.5)"; c.lineWidth = 4; c.stroke();
    }
    c.fillStyle = "#6A777D"; c.fillRect(-190, -22, 380, 22);
    c.strokeStyle = "rgba(30,42,49,.65)"; c.lineWidth = 4;
    line(-190, -22, 190, -22);
    c.restore();
    trackPath(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();

    polyRound([[-66, -116], [66, -116], [104, -56], [-104, -56]], [14, 14, 16, 16]);
    fs(SHELL, INK, 6);
    [-136, 136].forEach(function (wx) {
      circle(wx, -40, 16); fs(SHELL_EDGE, INK, 6);
    });

    // ---- корпус ----
    c.save();
    c.translate(0, bob * 0.4);
    rr(-132, -278, 264, 182, 38); fs(SHELL, INK, LW);
    rr(-116, -270, 232, 44, 22); c.fillStyle = SHELL_TOP; c.fill();
    // синій екран у два тони
    c.save();
    c.translate(-72, -186);
    c.beginPath(); c.moveTo(-28, -42); c.lineTo(26, -50); c.lineTo(26, 44); c.lineTo(-28, 48); c.closePath();
    fs("#0B6DB4", INK, 6);
    c.beginPath(); c.moveTo(-28, -42); c.lineTo(26, -50); c.lineTo(26, -2); c.lineTo(-28, 4); c.closePath();
    c.fillStyle = "#1B86CE"; c.fill();
    c.restore();
    // решітка
    rr(2, -232, 50, 96, 24); fs(SHELL_EDGE, INK, 6);
    c.strokeStyle = "rgba(30,42,49,.55)"; c.lineWidth = 5;
    for (var q = 0; q < 5; q++) line(14, -212 + q * 16, 40, -212 + q * 16);
    // три лампи; на вітаміні блимають усі
    var lamps = [[EYE, -214], [EYE, -178], ["#2196D6", -142]];
    for (var l = 0; l < 3; l++) {
      var lit = r.boost > 0 && Math.floor(S.t / 90) % 3 === l;
      circle(92, lamps[l][1], 15); fs(lit ? "#FFFFFF" : lamps[l][0], INK, 5);
    }
    c.restore();

    // ---- шия ----
    c.save();
    c.translate(0, bob * 0.7);
    c.beginPath(); c.ellipse(0, -284, 38, 12, 0, 0, Math.PI * 2); fs(SHELL_EDGE, INK, 6);
    rr(-16, -380, 32, 100, 13); fs(SHELL, INK, 6);
    c.restore();

    // ---- голова ----
    c.save();
    c.translate(0, -400 + bob);
    // розворот «через ребро»: голова на мить стискається й віддзеркалюється
    var dir = r.face < 0 ? -1 : 1;
    c.scale(dir * Math.max(0.12, Math.abs(r.face)), 1);
    c.rotate(clamp(r.vy * 0.07, -0.1, 0.12));
    c.beginPath();
    c.moveTo(-158, 10);
    c.bezierCurveTo(-148, -16, -108, -32, -58, -32);
    c.lineTo(-10, -32); c.lineTo(-10, 30); c.lineTo(-62, 30);
    c.bezierCurveTo(-110, 30, -148, 26, -158, 10);
    c.closePath(); fs(SHELL_EDGE, INK, LW);
    visorPath(1.1); fs(SHELL, INK, LW);
    visorPath(1);
    var g = c.createLinearGradient(-90, -40, 110, 38);
    g.addColorStop(0, VISOR_HI); g.addColorStop(1, VISOR_LO);
    fs(g, INK, 6);
    c.save();
    visorPath(1); c.clip();
    c.globalAlpha = 0.18; c.fillStyle = "#FFFFFF";
    c.beginPath(); c.ellipse(-20, -26, 78, 16, -0.12, 0, Math.PI * 2); c.fill();
    c.restore();
    // очі: радіє — мружиться, боїться — круглі
    c.translate(10, clamp(r.vy * 5, -6, 6));
    if (r.dead || (r.vy > 1.55 && r.boost <= 0)) {
      drawEye(-24, 26, 28); drawEye(52, 26, 28);
    } else if (r.moodT > 0) {
      [-24, 52].forEach(function (ex) {
        c.beginPath(); c.moveTo(ex - 17, 4); c.quadraticCurveTo(ex, -22, ex + 17, 4);
        c.lineWidth = 9; c.strokeStyle = EYE; c.stroke();
      });
    } else {
      var hE = (S.t % 4200) < 130 ? 9 : 42;
      drawEye(-24, 30, hE); drawEye(52, 30, hE);
    }
    c.restore();

    c.restore();
  }

  // ---------- Малювання: написи ----------
  function drawFx() {
    var i, p, a;
    for (i = 0; i < S.parts.length; i++) {
      p = S.parts[i]; a = clamp(p.life / p.max, 0, 1);
      c.globalAlpha = a;
      circle(p.x, p.y, p.r * (0.5 + 0.5 * a)); c.fillStyle = p.col; c.fill();
    }
    c.globalAlpha = 1;
    for (i = 0; i < S.pops.length; i++) {
      p = S.pops[i]; a = clamp(p.life / p.max, 0, 1);
      c.save();
      c.globalAlpha = a;
      c.textAlign = "center";
      c.font = "800 " + (p.big ? 36 : 30) + "px " + FONT;
      c.fillStyle = p.big ? YELLOW : "#FFFFFF";
      c.lineWidth = 6; c.strokeStyle = "rgba(0,60,90,.5)"; c.lineJoin = "round";
      var y = p.y - (1 - a) * 44;
      c.strokeText(p.txt, p.x, y); c.fillText(p.txt, p.x, y);
      c.restore();
    }
  }

  function drawHud() {
    var r = S.robot;
    var w = 244, h = 124, x = W / 2 - w / 2, y = 16 + safeTop;
    c.save();
    c.fillStyle = "rgba(0,0,0,.12)";
    rr(x + 3, y + 6, w, h, 20); c.fill();
    rr(x, y, w, h, 20);
    fs(BLUE_DEEP, r.boost > 0 ? YELLOW : "#FFFFFF", 5);
    rr(x + 11, y + 11, w - 22, h - 22, 12);
    c.fillStyle = "rgba(0,37,56,.26)"; c.fill();
    c.textAlign = "center";
    c.fillStyle = "rgba(255,255,255,.62)";
    c.font = "800 15px " + FONT;
    c.fillText("Р А Х У Н О К", W / 2, y + 37);
    c.fillStyle = YELLOW;
    c.font = "800 48px " + FONT;
    c.fillText(String(S.score), W / 2, y + 82);
    c.fillStyle = "rgba(255,255,255,.6)";
    c.font = "700 16px " + FONT;
    c.fillText("рекорд " + Math.max(best, S.score), W / 2, y + 104);
    if (r.boost > 0) {
      c.fillStyle = "rgba(0,37,56,.35)";
      rr(x + 10, y + h + 10, w - 20, 9, 4.5); c.fill();
      c.fillStyle = YELLOW;
      rr(x + 10, y + h + 10, Math.max(9, (w - 20) * r.boost / BOOST_MS), 9, 4.5); c.fill();
    }
    c.restore();

    // підказка на перші секунди
    if (S.hintT > 0 && mode === "play") {
      var a = clamp(S.hintT / 600, 0, 1);
      c.save();
      c.globalAlpha = a;
      c.textAlign = "center";
      c.font = "800 26px " + FONT;
      // пишемо на стійці: коли робот піде вгору, підказка поїде вниз разом із нею
      c.fillStyle = BLUE_DEEP;
      var txt = isDesktop ? "← →  або  A / D" : (useTilt ? "нахиляй телефон" : "тримай кнопки внизу");
      var hy = -S.camY + 96;
      if (hy < VH + 30) c.fillText(txt, W / 2, hy);
      c.restore();
    }
    drawPads();
  }

  // Кнопки «ліворуч» і «праворуч» у нижніх кутах. Працює вся половина екрана,
  // кнопки лише показують, куди тиснути, і світяться, поки робот їде в той бік.
  var PAD_R = 72;
  function drawPads() {
    if (mode !== "play" && mode !== "pause") return;
    var dir = (mode === "play" && !S.robot.dead) ? inputDir() : 0;
    var y = VH - 26 - PAD_R - safeBottom;
    for (var i = 0; i < 2; i++) {
      var s = i ? 1 : -1, x = i ? W - 26 - PAD_R : 26 + PAD_R, on = dir * s > 0.15;
      c.save();
      c.globalAlpha = on ? 1 : 0.8;
      c.fillStyle = "rgba(0,0,0,.14)";
      circle(x + 2, y + (on ? 3 : 7), PAD_R); c.fill();
      if (on) c.translate(0, 3);
      circle(x, y, PAD_R);
      fs(on ? YELLOW : BLUE_DEEP, "#FFFFFF", 6);
      c.beginPath();
      c.moveTo(x + s * 26, y); c.lineTo(x - s * 16, y - 28); c.lineTo(x - s * 16, y + 28);
      c.closePath();
      c.lineJoin = "round"; c.lineWidth = 10;
      c.fillStyle = c.strokeStyle = on ? BLUE_DEEP : YELLOW;
      c.fill(); c.stroke();
      c.restore();
    }
  }

  function render() {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = c.createLinearGradient(0, 0, 0, ih);
    g.addColorStop(0, "#0082BE"); g.addColorStop(0.6, "#008ECC"); g.addColorStop(1, "#00A2E2");
    c.fillStyle = g;
    c.fillRect(0, 0, iw, ih);

    c.save();
    c.translate(offX, offY);
    c.scale(scale, scale);
    c.beginPath(); c.rect(0, 0, W, VH); c.clip();
    drawBackdrop();

    c.save();
    c.translate(0, -S.camY);
    drawMarks();
    drawFloor();
    var i;
    for (i = 0; i < S.plats.length; i++) drawPlat(S.plats[i]);
    for (i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (it.type === "pill") drawPill(it.x, it.y + Math.sin((S.t + it.ph * 500) / 320) * 4, it.r, Math.sin((S.t + it.ph * 400) / 600) * 0.25);
      else drawVit(it.x, it.y, S.t + it.ph * 300);
    }
    for (i = 0; i < S.foes.length; i++) drawFoe(S.foes[i]);
    var r = S.robot;
    if (mode !== "over" || r.y - 170 < S.camY + VH) {
      drawRobot(r.x, r.y);
      // світ замкнений по горизонталі — біля краю робота видно з обох боків
      if (r.x < 90) drawRobot(r.x + W, r.y);
      else if (r.x > W - 90) drawRobot(r.x - W, r.y);
    }
    drawFx();
    c.restore();

    if (mode !== "menu") drawHud();
    c.restore();

    // на широкому екрані — приглушені поля обабіч ігрової колонки
    if (offX > 1) {
      c.fillStyle = "rgba(0,52,80,.38)";
      c.fillRect(0, 0, offX, ih); c.fillRect(iw - offX, 0, offX, ih);
      c.fillStyle = "rgba(255,255,255,.28)";
      c.fillRect(offX - 3, 0, 3, ih); c.fillRect(iw - offX, 0, 3, ih);
    }
    if (offY > 1) {
      c.fillStyle = "rgba(0,52,80,.38)";
      c.fillRect(0, 0, iw, offY); c.fillRect(0, ih - offY, iw, offY);
    }
  }

  // ---------- Екрани ----------
  var $ = function (id) { return document.getElementById(id); };
  var isDesktop = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  if (isDesktop) document.body.classList.add("desktop");
  var hasTilt = !isDesktop && typeof window.DeviceOrientationEvent !== "undefined";

  function show(id, on) { $(id).hidden = !on; }
  function syncUi() {
    var s = "Звук: " + (muted ? "вимкнено" : "увімкнено");
    $("soundBtn").textContent = s; $("soundBtn2").textContent = s;
    $("tiltBtn").hidden = !hasTilt;
    $("tiltBtn").textContent = "Керування: " + (useTilt ? "нахил" : "дотик");
    $("touchHint").textContent = useTilt ? "Нахиляй телефон ліворуч або праворуч" : "Тримай кнопку ліворуч або праворуч унизу екрана";
    $("bestStart").hidden = best <= 0;
    $("bestStart").querySelector("b").textContent = String(best);
  }

  function startGame() {
    audioInit();
    reset();
    mode = "play";
    show("start", false); show("over", false); show("pause", false); show("pauseBtn", true);
  }
  function toMenu() {
    reset();
    mode = "menu";
    show("over", false); show("pause", false); show("pauseBtn", false); show("start", true);
    syncUi();
    checkUpdate();
  }
  function pauseGame() {
    if (mode !== "play") return;
    mode = "pause";
    show("pause", true); show("pauseBtn", false);
  }
  function resumeGame() {
    if (mode !== "pause") return;
    mode = "play";
    show("pause", false); show("pauseBtn", true);
  }
  var SUBS = {
    fall: ["Робот не втримався на поличці.", "Повз поличку — буває й таке.", "Гравітація сьогодні перемогла."],
    virus: ["Вірус таки дістав. На нього — тільки згори!", "З вірусом зустрілися не тим боком.", "Наступного разу — стрибком йому на маківку."]
  };
  function gameOver(why) {
    sfx.over();
    mode = "over";
    var sc = S.score, isNew = sc > best && sc > 0;
    if (isNew) { best = sc; save("best2", best); }
    if (-S.minY > bestH) { bestH = -S.minY; save("bestH", Math.round(bestH)); }
    var list = SUBS[why] || SUBS.fall;
    $("overSub").textContent = list[Math.floor(Math.random() * list.length)];
    $("overScore").textContent = String(sc);
    $("overBest").textContent = String(best);
    $("newBest").hidden = !isNew;
    show("pauseBtn", false);
    setTimeout(function () { if (mode === "over") { show("over", true); $("againBtn").focus(); } }, 380);
    checkUpdate();
  }

  function setMuted(m) { muted = m; save("mute", m ? "1" : "0"); syncUi(); }
  function toggleTilt() {
    if (!useTilt) {
      // iOS показує запит на доступ до датчиків лише у відповідь на дотик
      var D = window.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === "function") {
        D.requestPermission().then(function (res) {
          useTilt = res === "granted"; save("tilt", useTilt ? "1" : "0"); syncUi();
        }).catch(function () { useTilt = false; syncUi(); });
        return;
      }
      useTilt = true;
    } else {
      useTilt = false; tiltDir = 0;
    }
    save("tilt", useTilt ? "1" : "0");
    syncUi();
  }

  $("playBtn").addEventListener("click", startGame);
  $("againBtn").addEventListener("click", startGame);
  $("resumeBtn").addEventListener("click", resumeGame);
  $("menuBtn").addEventListener("click", toMenu);
  $("pauseBtn").addEventListener("click", pauseGame);
  $("soundBtn").addEventListener("click", function () { setMuted(!muted); });
  $("soundBtn2").addEventListener("click", function () { setMuted(!muted); });
  $("tiltBtn").addEventListener("click", toggleTilt);

  // ---------- Клавіатура, дотик, нахил ----------
  window.addEventListener("keydown", function (e) {
    var k = e.code;
    if (k === "ArrowLeft" || k === "KeyA") { keyL = true; e.preventDefault(); }
    else if (k === "ArrowRight" || k === "KeyD") { keyR = true; e.preventDefault(); }
    else if (k === "KeyP" || k === "Escape") { if (mode === "play") pauseGame(); else if (mode === "pause") resumeGame(); }
    else if (k === "KeyM") setMuted(!muted);
    else if ((k === "Enter" || k === "Space") && !e.repeat) {
      if (e.target && e.target.tagName === "BUTTON") return;   // кнопка у фокусі спрацює сама
      if (mode === "menu" || mode === "over") { if (mode === "over" && $("over").hidden) return; startGame(); }
      else if (mode === "pause") resumeGame();
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", function (e) {
    var k = e.code;
    if (k === "ArrowLeft" || k === "KeyA") keyL = false;
    else if (k === "ArrowRight" || k === "KeyD") keyR = false;
  });
  window.addEventListener("blur", function () { keyL = keyR = false; pointers = {}; pointerDir = 0; });

  function pointerSide(e) { return e.clientX < window.innerWidth / 2 ? -1 : 1; }
  cv.addEventListener("pointerdown", function (e) {
    audioInit();
    pointers[e.pointerId] = pointerSide(e); pointerDir = pointers[e.pointerId];
    e.preventDefault();
  });
  cv.addEventListener("pointermove", function (e) {
    if (pointers[e.pointerId] == null) return;
    pointers[e.pointerId] = pointerSide(e); pointerDir = pointers[e.pointerId];
  });
  function pointerEnd(e) {
    delete pointers[e.pointerId];
    var ids = Object.keys(pointers);
    pointerDir = ids.length ? pointers[ids[ids.length - 1]] : 0;
  }
  cv.addEventListener("pointerup", pointerEnd);
  cv.addEventListener("pointercancel", pointerEnd);
  cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  window.addEventListener("deviceorientation", function (e) {
    if (!useTilt || e.gamma == null) return;
    var ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    var v = ang === 90 ? e.beta : (ang === 270 || ang === -90) ? -e.beta : ang === 180 ? -e.gamma : e.gamma;
    tiltDir = Math.abs(v) < 1.5 ? 0 : clamp(v / 18, -1, 1);
  });

  document.addEventListener("visibilitychange", function () { if (document.hidden) pauseGame(); });

  // ---------- Розмір ----------
  function resize() {
    iw = window.innerWidth; ih = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.max(1, Math.round(iw * dpr)); cv.height = Math.max(1, Math.round(ih * dpr));
    // висота видимої частини — від «майже квадрата» до високого телефона
    VH = clamp(W * ih / Math.max(1, iw), 1040, 1600);
    scale = Math.min(iw / W, ih / VH);
    offX = (iw - W * scale) / 2; offY = (ih - VH * scale) / 2;
    safeTop = Math.max(0, $("probe").getBoundingClientRect().top - offY) / scale;
    safeBottom = Math.max(0, ih - $("probeB").getBoundingClientRect().top - offY) / scale;
    document.documentElement.style.setProperty("--col-side", Math.max(0, offX) + "px");
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

  // ---------- Цикл ----------
  var last = 0;
  function frame(ts) {
    var dt = Math.min(48, Math.max(0, ts - last)); last = ts;
    if (mode !== "pause" && dt > 0) {
      var n = Math.ceil(dt / 8), h = dt / n;
      for (var i = 0; i < n; i++) step(h);
    }
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Самооновлення ----------
  // GitHub Pages дозволяє браузеру 10 хв тримати сторінку в кеші, а телефон ще й
  // повертає вкладку з пам'яті взагалі без запиту — і показує стару гру. Тому гра
  // сама питає маленький version.json повз кеш і, якщо на сайті новіша версія,
  // перезавантажується за адресою з ?v=N: це новий ключ кешу, тож і сторінка,
  // і скрипт беруться свіжі. Посеред партії не смикаємо — лише в меню й після кінця.
  var lastCheck = 0;
  function checkUpdate() {
    if (location.protocol === "file:" || !window.fetch) return;
    if (mode === "play" || mode === "pause") return;
    var now = Date.now();
    if (now - lastCheck < 20000) return;
    lastCheck = now;
    fetch("version.json?t=" + now, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !(j.v > VERSION) || mode === "play" || mode === "pause") return;
        var u = new URL(location.href);
        if (u.searchParams.get("v") === String(j.v)) return;   // уже пробували — по колу не ходимо
        u.searchParams.set("v", j.v);
        location.replace(u.toString());
      })
      .catch(function () { /* нема мережі — граємо в те, що є */ });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) checkUpdate(); });
  window.addEventListener("pageshow", checkUpdate);

  $("ver").textContent = "версія " + VERSION;
  resize();
  reset();
  syncUi();
  checkUpdate();
  requestAnimationFrame(frame);

  // Гачок для перевірки зі стенду: прогнати симуляцію без малювання
  window.__polytsia = {
    get S() { return S; },
    get mode() { return mode; },
    get view() { return { W: W, VH: VH, scale: scale, offX: offX, offY: offY }; },
    start: startGame,
    keys: function (l, r) { keyL = !!l; keyR = !!r; },
    sim: function (ms, ai) {
      for (var t = 0; t < ms && mode === "play"; t += 8) { if (ai) ai(S); step(8); }
      return S.score;
    }
  };
})();

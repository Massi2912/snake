/* ==========================================================
   Snake – Spiellogik
   Aufbau: 1. Konstanten  2. Zustand  3. Logik  4. Rendering
           5. Input       6. Game Loop
   ========================================================== */
'use strict';

/* ---------- 1. Konstanten ---------- */
const COLS = 20;                 // Felder horizontal
const ROWS = 20;                 // Felder vertikal
const CELL = 30;                 // Logische Einheiten pro Feld (Spielfeld = 600 × 600 Einheiten)
const BASE = COLS * CELL;        // Logische Kantenlänge des Spielfelds
const MAX_CANVAS_PX = 1800;      // Obergrenze für die echte Canvas-Auflösung (Performance)
const PREVIEW_SCALE = 3;         // Auflösungsfaktor der Skin-Vorschauen
const START_LENGTH = 3;          // Start-Segmente
const START_TICK_MS = 140;       // Zeit pro Spielschritt am Anfang
const MIN_TICK_MS = 70;          // Schnellste Geschwindigkeit
const TICK_STEP_MS = 8;          // Beschleunigung pro Stufe
const FOOD_PER_LEVEL = 5;        // Alle 5 Futter wird es schneller
const POINTS_FOOD = 10;
const POINTS_BONUS = 50;
const BONUS_CHANCE = 0.15;       // Chance auf Bonus-Futter nach normalem Futter
const BONUS_LIFETIME_MS = 5000;  // Bonus-Futter verschwindet nach 5 Sekunden
const MAX_INPUT_QUEUE = 3;       // Größe des Input-Buffers
const STORAGE_KEY = 'snake-highscore';
const SKIN_KEY = 'snake-skin';

const DIRS = {
  up:    { x: 0,  y: -1 },
  down:  { x: 0,  y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1,  y: 0 }
};

const COLORS = {
  bg: '#0e1422',
  gridLine: 'rgba(130, 150, 210, 0.06)',
  checker: 'rgba(255, 255, 255, 0.018)',
  food: '#ff4d79',
  bonus: '#ffd24a'
};

// Skins (Kleiderschrank). body(t, i, time): Körperfarbe, t = 0 (Kopf) … 1 (Schwanz),
// i = Segmentindex. head(time): Kopffarbe.
// Optional: glow (Leuchtfarbe), eyes [Augapfel, Pupille], pixel (eckig, schrittweise Bewegung)
const SKINS = [
  { id: 'neon', name: 'Neonviper',
    body: (t) => `hsl(${166 + 100 * t}, 92%, ${62 - 12 * t}%)`,
    head: () => 'hsl(166, 95%, 66%)' },
  { id: 'lava', name: 'Vulkanzunge',
    body: (t) => `hsl(${48 - 48 * t}, 100%, ${58 - 18 * t}%)`,
    head: () => 'hsl(50, 100%, 62%)' },
  { id: 'eis', name: 'Frostbiss',
    body: (t) => `hsl(${190 + 35 * t}, 90%, ${84 - 26 * t}%)`,
    head: () => 'hsl(185, 100%, 93%)',
    eyes: ['#12385a', '#ffffff'] },
  { id: 'regenbogen', name: 'Prisma',
    body: (t, i, time) => `hsl(${(time / 8 + i * 24) % 360}, 95%, 60%)`,
    head: (time) => `hsl(${(time / 8) % 360}, 95%, 66%)` },
  { id: 'geist', name: 'Phantom',
    body: (t) => `rgba(215, 225, 255, ${0.9 - 0.65 * t})`,
    head: () => 'rgba(240, 245, 255, 0.95)',
    glow: 'rgba(190, 205, 255, 0.9)',
    eyes: ['#1a2038', '#ffffff'] },
  { id: 'zuckerstange', name: 'Zuckerschock',
    body: (t, i) => (i % 2 ? '#ff4d79' : '#fff5f8'),
    head: () => '#ff4d79',
    glow: 'rgba(255, 120, 160, 0.8)' },
  { id: 'retro', name: 'Pixelwurm',
    body: (t, i) => (i % 2 ? '#7fa30f' : '#9bbc0f'),
    head: () => '#d5f04a',
    eyes: ['#0f380f', '#d5f04a'],
    pixel: true },
  { id: 'abendrot', name: 'Abendglut',
    body: (t) => `hsl(${(335 + 85 * t) % 360}, 95%, ${64 - 6 * t}%)`,
    head: () => 'hsl(335, 95%, 68%)' }
];

/* ---------- DOM-Referenzen ---------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highEl = document.getElementById('highscore');
const finalScoreEl = document.getElementById('final-score');
const newRecordEl = document.getElementById('new-record');
const overlays = {
  start: document.getElementById('overlay-start'),
  pause: document.getElementById('overlay-pause'),
  over: document.getElementById('overlay-over')
};

// Skalierung: Das Spiel rechnet in 600 × 600 logischen Einheiten. Die echte
// Canvas-Auflösung passt sich der Anzeigegrösse an (view.k = Pixel pro Einheit).
const view = { k: 1 };
const ctxScale = new WeakMap();   // Pixel pro Einheit je Zeichenfläche (für Schatten/Glow)
function scaleOf(c) { return ctxScale.get(c) || 1; }
ctxScale.set(ctx, 1);

/* ---------- 2. Zustand ---------- */
const state = {
  mode: 'start',        // 'start' | 'running' | 'paused' | 'over'
  snake: [],            // Segmente, Index 0 = Kopf
  prev: [],             // Positionen vor dem letzten Schritt (für flüssige Bewegung)
  dir: DIRS.right,      // Aktuelle Bewegungsrichtung
  queue: [],            // Input-Buffer (wartende Richtungswechsel)
  food: null,           // {x, y}
  bonus: null,          // {x, y, left} – left = Restzeit in ms
  score: 0,
  high: loadHighscore(),
  skin: loadSkin(),     // ID des gewählten Skins
  eaten: 0,             // Anzahl gefressenes Futter (normal + Bonus)
  tickMs: START_TICK_MS,
  acc: 0                // Zeit-Akkumulator für festen Zeitschritt
};

/* ---------- 3. Logik ---------- */
function loadHighscore() {
  try { return parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0; }
  catch (e) { return 0; }
}

function saveHighscore(value) {
  try { localStorage.setItem(STORAGE_KEY, String(value)); }
  catch (e) { /* localStorage nicht verfügbar – ignorieren */ }
}

function loadSkin() {
  try {
    const id = localStorage.getItem(SKIN_KEY);
    if (SKINS.some((sk) => sk.id === id)) return id;
  } catch (e) { /* ignorieren */ }
  return SKINS[0].id;
}

function saveSkin(id) {
  try { localStorage.setItem(SKIN_KEY, id); }
  catch (e) { /* ignorieren */ }
}

function currentSkin() {
  return SKINS.find((sk) => sk.id === state.skin) || SKINS[0];
}

function resetGame() {
  const midY = Math.floor(ROWS / 2);
  const midX = Math.floor(COLS / 2);
  state.snake = [];
  for (let i = 0; i < START_LENGTH; i++) state.snake.push({ x: midX - i, y: midY });
  state.prev = state.snake.map(s => ({ x: s.x, y: s.y }));
  state.dir = DIRS.right;
  state.queue = [];
  state.bonus = null;
  state.score = 0;
  state.eaten = 0;
  state.tickMs = START_TICK_MS;
  state.acc = 0;
  state.food = randomFreeCell();
  updateHud();
}

// Liefert ein zufälliges Feld, das weder Schlange noch Futter belegt
function randomFreeCell() {
  const free = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const occupied = state.snake.some(s => s.x === x && s.y === y)
        || (state.food && state.food.x === x && state.food.y === y)
        || (state.bonus && state.bonus.x === x && state.bonus.y === y);
      if (!occupied) free.push({ x, y });
    }
  }
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

function isOpposite(a, b) {
  return a.x === -b.x && a.y === -b.y;
}

// Ein Spielschritt (wird mit festem Zeitschritt aufgerufen)
function step() {
  // Nächste gepufferte Richtung übernehmen
  if (state.queue.length) state.dir = state.queue.shift();

  const head = state.snake[0];
  const next = { x: head.x + state.dir.x, y: head.y + state.dir.y };

  // Kollision mit der Wand
  if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) return gameOver();

  const eatsFood = state.food && next.x === state.food.x && next.y === state.food.y;
  const eatsBonus = state.bonus && next.x === state.bonus.x && next.y === state.bonus.y;
  const grows = eatsFood || eatsBonus;

  // Kollision mit dem eigenen Körper (der Schwanz zählt nicht, wenn er nachrückt)
  const body = grows ? state.snake : state.snake.slice(0, -1);
  if (body.some(s => s.x === next.x && s.y === next.y)) return gameOver();

  state.prev = state.snake.map(s => ({ x: s.x, y: s.y }));
  state.snake.unshift(next);
  if (!grows) state.snake.pop();

  if (eatsFood) {
    state.score += POINTS_FOOD;
    onEat();
    state.food = randomFreeCell();
    // Selten: Bonus-Futter erscheinen lassen
    if (!state.bonus && Math.random() < BONUS_CHANCE) {
      const cell = randomFreeCell();
      if (cell) state.bonus = { x: cell.x, y: cell.y, left: BONUS_LIFETIME_MS };
    }
  } else if (eatsBonus) {
    state.score += POINTS_BONUS;
    state.bonus = null;
    onEat();
  }

  // Bonus-Futter läuft ab
  if (state.bonus) {
    state.bonus.left -= state.tickMs;
    if (state.bonus.left <= 0) state.bonus = null;
  }

  updateHud();
}

// Zählt Futter und erhöht alle 5 Stück die Geschwindigkeit
function onEat() {
  state.eaten++;
  if (state.eaten % FOOD_PER_LEVEL === 0) {
    state.tickMs = Math.max(MIN_TICK_MS, state.tickMs - TICK_STEP_MS);
  }
}

function gameOver() {
  state.mode = 'over';
  const isRecord = state.score > state.high;
  if (isRecord) {
    state.high = state.score;
    saveHighscore(state.high);
  }
  finalScoreEl.textContent = state.score;
  newRecordEl.classList.toggle('hidden', !isRecord);
  updateHud();
  showOverlay('over');
}

function startGame() {
  resetGame();
  state.mode = 'running';
  showOverlay(null);
}

function togglePause() {
  if (state.mode === 'running') {
    state.mode = 'paused';
    showOverlay('pause');
  } else if (state.mode === 'paused') {
    state.mode = 'running';
    showOverlay(null);
  }
}

function updateHud() {
  scoreEl.textContent = state.score;
  highEl.textContent = Math.max(state.high, state.score);
}

function showOverlay(name) {
  for (const key in overlays) overlays[key].classList.toggle('hidden', key !== name);
}

/* ---------- 4. Rendering ---------- */
// Statisches Spielfeld (Schachbrett, Raster, Vignette) wird vorgerendert –
// in der echten Auflösung (k = Pixel pro Einheit), damit es auf grossen
// Bildschirmen scharf bleibt.
function buildBoardLayer(k) {
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(BASE * k));
  layer.height = layer.width;
  const c = layer.getContext('2d');
  c.scale(layer.width / BASE, layer.height / BASE);
  const w = BASE, h = BASE;
  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, w, h);
  c.fillStyle = COLORS.checker;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if ((x + y) % 2 === 0) c.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
  c.strokeStyle = COLORS.gridLine;
  c.lineWidth = 1;
  c.beginPath();
  for (let i = 1; i < COLS; i++) { c.moveTo(i * CELL + 0.5, 0); c.lineTo(i * CELL + 0.5, h); }
  for (let j = 1; j < ROWS; j++) { c.moveTo(0, j * CELL + 0.5); c.lineTo(w, j * CELL + 0.5); }
  c.stroke();
  const vignette = c.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.75);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  c.fillStyle = vignette;
  c.fillRect(0, 0, w, h);
  return layer;
}

let boardLayer = buildBoardLayer(1);

// Passt die echte Canvas-Auflösung an die Anzeigegrösse an (inkl. Retina/Zoom).
// Gezeichnet wird weiter in 600 × 600 Einheiten, der Transform skaliert alles.
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = window.devicePixelRatio || 1;
  const px = Math.min(Math.round(rect.width * dpr), MAX_CANVAS_PX);
  if (px < 1 || (canvas.width === px && canvas.height === px)) return;
  canvas.width = px;
  canvas.height = px;
  view.k = px / BASE;
  ctx.setTransform(view.k, 0, 0, view.k, 0, 0);
  ctxScale.set(ctx, view.k);
  boardLayer = buildBoardLayer(view.k);
}

if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(canvas);
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function render(time) {
  ctx.drawImage(boardLayer, 0, 0, BASE, BASE);
  if (state.food) drawFood(state.food, time);
  if (state.bonus) drawBonus(state.bonus, time);
  drawSnake(time);
}

// Futter: leuchtende Kugel mit Glanzpunkt und sanftem Puls
function drawFood(cell, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time / 300);
  const cx = (cell.x + 0.5) * CELL;
  const cy = (cell.y + 0.5) * CELL;
  const r = CELL * (0.3 + 0.06 * pulse);
  ctx.save();
  ctx.shadowColor = COLORS.food;
  ctx.shadowBlur = (12 + 14 * pulse) * view.k;
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ff9db5');
  g.addColorStop(1, COLORS.food);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.4, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

// Bonus-Futter: goldener Diamant mit Ring, der die Restzeit anzeigt
function drawBonus(bonus, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time / 140);
  const cx = (bonus.x + 0.5) * CELL;
  const cy = (bonus.y + 0.5) * CELL;
  const r = CELL * (0.26 + 0.05 * pulse);
  const fraction = Math.max(0, bonus.left / BONUS_LIFETIME_MS);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = COLORS.bonus;
  ctx.shadowBlur = (14 + 12 * pulse) * view.k;
  ctx.rotate(Math.PI / 4);
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#fff2b0');
  g.addColorStop(1, COLORS.bonus);
  ctx.fillStyle = g;
  roundRect(-r, -r, r * 2, r * 2, 4);
  ctx.fill();
  ctx.rotate(-Math.PI / 4);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = COLORS.bonus;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, CELL * 0.47, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
  ctx.stroke();
  ctx.restore();
}

// Positionen zwischen zwei Spielschritten interpolieren → flüssige Bewegung
function snakePoints() {
  const moving = state.mode === 'running' || state.mode === 'paused';
  const a = moving ? Math.min(state.acc / state.tickMs, 1) : 1;
  const last = state.prev.length - 1;
  return state.snake.map((s, i) => {
    const p = state.prev[Math.min(i, last)] || s;
    return { x: p.x + (s.x - p.x) * a, y: p.y + (s.y - p.y) * a };
  });
}

// Schlange im gewählten Skin zeichnen
function drawSnake(time) {
  const skin = currentSkin();
  // Pixel-Skins bewegen sich schrittweise, alle anderen flüssig interpoliert
  const cells = skin.pixel ? state.snake : snakePoints();
  const pts = cells.map((p) => ({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL }));
  paintSnake(ctx, pts, CELL, state.dir, skin, time);
}

// Zeichnet eine Schlange aus Mittelpunkten in Einheiten (pts[0] = Kopf).
// Wird auch für die Vorschau im Kleiderschrank verwendet.
function paintSnake(c, pts, size, dir, skin, time) {
  const n = pts.length;
  const k = scaleOf(c);   // Schatten-Unschärfe ist unabhängig vom Transform, daher mitskalieren
  c.save();
  if (skin.pixel) {
    const s = size * 0.9;
    for (let i = n - 1; i >= 0; i--) {
      c.fillStyle = i === 0 ? skin.head(time) : skin.body(i / (n - 1), i, time);
      c.fillRect(pts[i].x - s / 2, pts[i].y - s / 2, s, s);
    }
  } else {
    // Zusammenhängender, verjüngter Körper
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (let i = n - 2; i >= 0; i--) {
      const t = (i + 0.5) / (n - 1);
      const color = skin.body(t, i, time);
      c.shadowColor = skin.glow || color;
      c.shadowBlur = size * 0.4 * k;
      c.strokeStyle = color;
      c.lineWidth = size * (0.8 - 0.28 * t);
      c.beginPath();
      c.moveTo(pts[i + 1].x, pts[i + 1].y);
      c.lineTo(pts[i].x, pts[i].y);
      c.stroke();
    }
    // Kopf
    const headColor = skin.head(time);
    c.shadowColor = skin.glow || headColor;
    c.shadowBlur = size * 0.65 * k;
    c.fillStyle = headColor;
    c.beginPath();
    c.arc(pts[0].x, pts[0].y, size * 0.43, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  paintEyes(c, pts[0], size, dir, skin);
}

// Augen schauen in Blickrichtung
function paintEyes(c, head, size, dir, skin) {
  const [white, pupil] = skin.eyes || ['#ffffff', '#080b14'];
  const perp = { x: -dir.y, y: dir.x };
  for (const side of [-1, 1]) {
    const ex = head.x + dir.x * size * 0.14 + perp.x * size * 0.2 * side;
    const ey = head.y + dir.y * size * 0.14 + perp.y * size * 0.2 * side;
    c.fillStyle = white;
    c.beginPath();
    c.arc(ex, ey, size * 0.12, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = pupil;
    c.beginPath();
    c.arc(ex + dir.x * size * 0.05, ey + dir.y * size * 0.05, size * 0.06, 0, Math.PI * 2);
    c.fill();
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- Kleiderschrank (Skins) ---------- */
const PREVIEW_W = 120;   // Logische Grösse einer Vorschau
const PREVIEW_H = 44;
const previews = [];     // Vorschau-Zeichenflächen: { c, skin }

// Baut den Kleiderschrank in alle Container mit data-wardrobe (Start- und Pause-Menü)
function buildWardrobe() {
  document.querySelectorAll('[data-wardrobe]').forEach((box) => {
    SKINS.forEach((skin) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'skin';
      btn.dataset.skin = skin.id;
      const cv = document.createElement('canvas');
      // Höhere Auflösung, damit die Vorschau auf grossen Bildschirmen scharf bleibt
      cv.width = PREVIEW_W * PREVIEW_SCALE;
      cv.height = PREVIEW_H * PREVIEW_SCALE;
      const pc = cv.getContext('2d');
      pc.scale(PREVIEW_SCALE, PREVIEW_SCALE);
      ctxScale.set(pc, PREVIEW_SCALE);
      const label = document.createElement('span');
      label.textContent = skin.name;
      btn.append(cv, label);
      box.appendChild(btn);
      previews.push({ c: pc, skin });
    });
  });
  markSelectedSkin();
}

function markSelectedSkin() {
  document.querySelectorAll('.skin').forEach((btn) => {
    const active = btn.dataset.skin === state.skin;
    btn.classList.toggle('selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// Vorschau: kleine Schlange im jeweiligen Skin
function drawPreviews(time) {
  for (const { c, skin } of previews) {
    c.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
    const pts = [];
    for (let i = 0; i < 6; i++) pts.push({ x: 100 - i * 17, y: 22 });
    paintSnake(c, pts, 18, DIRS.right, skin, time);
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.skin');
  if (!btn) return;
  state.skin = btn.dataset.skin;
  saveSkin(state.skin);
  markSelectedSkin();
  btn.blur();
});

/* ---------- 5. Input ---------- */
// Richtungswechsel in den Buffer legen; geprüft wird gegen die zuletzt
// gepufferte Richtung, damit keine Umkehr um 180° möglich ist.
function queueDirection(name) {
  if (state.mode !== 'running') return;
  const dir = DIRS[name];
  const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
  if (dir === last || isOpposite(dir, last)) return;
  if (state.queue.length < MAX_INPUT_QUEUE) state.queue.push(dir);
}

const KEY_DIRS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right'
};

document.addEventListener('keydown', (e) => {
  if (KEY_DIRS[e.key]) {
    e.preventDefault();
    queueDirection(KEY_DIRS[e.key]);
  } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    if (!e.repeat) togglePause();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (state.mode === 'start' || state.mode === 'over') startGame();
  }
});

// Buttons (Overlays und Touch-Steuerung)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'start' || action === 'restart') startGame();
  else if (action === 'resume' || action === 'pause') togglePause();
  btn.blur();
});

document.querySelectorAll('[data-dir]').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    queueDirection(btn.dataset.dir);
  });
});

/* ---------- 6. Game Loop ---------- */
// Fester Zeitschritt: Logik läuft unabhängig von der Bildwiederholrate,
// gerendert wird bei jedem Frame.
let lastTime = 0;

function frame(time) {
  const delta = Math.min(time - lastTime, 250);   // Begrenzung nach Tab-Wechsel
  lastTime = time;

  if (state.mode === 'running') {
    state.acc += delta;
    while (state.acc >= state.tickMs && state.mode === 'running') {
      state.acc -= state.tickMs;
      step();
    }
  }

  render(time);
  // Vorschauen nur zeichnen, solange Start- oder Pause-Menü offen sind
  if (state.mode === 'start' || state.mode === 'paused') drawPreviews(time);
  requestAnimationFrame(frame);
}

// Initialisierung
buildWardrobe();
resetGame();
showOverlay('start');
requestAnimationFrame((t) => { lastTime = t; frame(t); });
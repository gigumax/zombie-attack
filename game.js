'use strict';

// ─── Config ───
const CONFIG = {
  W: 900,
  H: 600,
  worldW: 4000,
  worldH: 3000,
  cubeSize: 38,
  foodSize: 32,
  playerSpeed: 4,
  aiSpeed: 3.2,
  maxFood: 30,
  aiCount: 8,
  trailSpacing: 4,
  maxTrail: 80,
};

const COLORS = {
  2: '#3498db', 4: '#2ecc71', 8: '#f1c40f', 16: '#e67e22',
  32: '#e74c3c', 64: '#9b59b6', 128: '#1abc9c', 256: '#fd79a8',
  512: '#fdcb6e', 1024: '#00cec9', 2048: '#a29bfe', 4096: '#dfe6e9',
  8192: '#ff7675', 16384: '#55efc4',
};

function getColor(v) { return COLORS[v] || '#dfe6e9'; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(min, max) { return Math.random() * (max - min) + min; }
function getSize(value) { return CONFIG.cubeSize + Math.log2(value) * 5; }
function getFoodSize(value) { return CONFIG.foodSize + Math.log2(value) * 3; }

const AI_NAMES = [
  'Blitz', 'Nova', 'Zephyr', 'Echo', 'Vortex', 'Rex', 'Pixel', 'Titan',
  'Shade', 'Flux', 'Onyx', 'Surge', 'Drift', 'Crush', 'Volt', 'Razor',
];

const ITEM_TYPES = {
  speed:  { icon: '⚡',  color: '#f1c40f', name: 'Speed Boost', desc: '2x speed for 5s' },
  shield: { icon: '🛡️', color: '#3498db', name: 'Shield',      desc: 'Invincible for 5s' },
  magnet: { icon: '🧲', color: '#e74c3c', name: 'Magnet',      desc: 'Pull food for 5s' },
  bomb:   { icon: '💣', color: '#e67e22', name: 'Bomb',        desc: 'Destroy nearby AI' },
  freeze: { icon: '❄️', color: '#1abc9c', name: 'Freeze',      desc: 'Freeze all AI for 4s' },
};
const ITEM_KEYS = Object.keys(ITEM_TYPES);
const INV_SIZE = 5;

// ─── Particle ───
class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    this.vx = (Math.random() - 0.5) * 7;
    this.vy = (Math.random() - 0.5) * 7;
    this.life = 1;
    this.color = color;
    this.size = 3 + Math.random() * 5;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    this.vx *= 0.9; this.vy *= 0.9;
    this.life -= 0.035;
  }
}

// ─── Game ───
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CONFIG.W * dpr;
    canvas.height = CONFIG.H * dpr;
    canvas.style.width = CONFIG.W + 'px';
    canvas.style.height = CONFIG.H + 'px';
    this.ctx.scale(dpr, dpr);

    this.keys = {};
    this.running = false;
    this.bestValue = 2;
    this._rafId = null;
    this.camX = 0;
    this.camY = 0;
    this.inventory = new Array(INV_SIZE).fill(null);
    this.items = [];
    this.effects = {};
    this.itemTimer = 0;

    window.addEventListener('keydown', e => {
      this.keys[e.key.toLowerCase()] = true;
      if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= INV_SIZE) this.useItem(n - 1);
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
  }

  start() {
    this.player = {
      x: CONFIG.worldW / 2, y: CONFIG.worldH / 2,
      value: 2, trail: [],
      radius: getSize(2) / 2,
      pulse: 0, dx: 0, dy: 0,
    };
    this.ais = [];
    this.foods = [];
    this.particles = [];
    this.gameOver = false;
    this.frameCount = 0;
    this.foodTimer = 0;
    this.aiTimer = 0;
    this.inventory = new Array(INV_SIZE).fill(null);
    this.items = [];
    this.effects = {};
    this.itemTimer = 0;

    for (let i = 0; i < CONFIG.aiCount; i++) this.spawnAI();
    for (let i = 0; i < CONFIG.maxFood; i++) this.spawnFood();

    this.updateCamera();
    this.running = true;
    this.updateHUD();
    this.updateInventoryUI();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.loop();
  }

  // ─── Spawning ───
  spawnFood() {
    const r = Math.random();
    let value;
    if (r < 0.40) value = 2;
    else if (r < 0.70) value = 4;
    else if (r < 0.85) value = 8;
    else if (r < 0.95) value = 16;
    else value = 32;
    const pos = this.findFreePos(40, 60);
    this.foods.push({ x: pos.x, y: pos.y, value, radius: getFoodSize(value) / 2 });
  }

  spawnAI() {
    const value = Math.random() < 0.65 ? 2 : 4;
    const pos = this.findFreePos(50, 250);
    this.ais.push({
      x: pos.x, y: pos.y, value, trail: [],
      radius: getSize(value) / 2,
      pulse: 0, wanderT: 0, wdx: 0, wdy: 0,
      name: AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)],
    });
  }

  findFreePos(minDistFromEntities, minDistFromPlayer) {
    for (let attempts = 0; attempts < 20; attempts++) {
      const x = rand(40, CONFIG.worldW - 40);
      const y = rand(40, CONFIG.worldH - 40);
      if (this.player && dist({ x, y }, this.player) < minDistFromPlayer) continue;
      let ok = true;
      for (const ai of this.ais) { if (dist({ x, y }, ai) < minDistFromEntities) { ok = false; break; } }
      if (!ok) continue;
      for (const f of this.foods) { if (dist({ x, y }, f) < minDistFromEntities) { ok = false; break; } }
      if (ok) return { x, y };
    }
    return { x: rand(40, CONFIG.worldW - 40), y: rand(40, CONFIG.worldH - 40) };
  }

  // ─── Inventory ───
  spawnItem() {
    const type = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)];
    const pos = this.findFreePos(60, 100);
    this.items.push({ x: pos.x, y: pos.y, type, radius: 18, bob: 0 });
  }

  addItemToInventory(type) {
    for (let i = 0; i < INV_SIZE; i++) {
      if (this.inventory[i] === null) {
        this.inventory[i] = type;
        this.updateInventoryUI();
        return true;
      }
    }
    return false;
  }

  useItem(slot) {
    if (!this.running || this.gameOver) return;
    const type = this.inventory[slot];
    if (!type) return;
    this.applyEffect(type);
    this.inventory[slot] = null;
    this.updateInventoryUI();
  }

  applyEffect(type) {
    const info = ITEM_TYPES[type];
    if (type === 'speed') {
      this.effects.speed = 300; // ~5 seconds at 60fps
    } else if (type === 'shield') {
      this.effects.shield = 300;
    } else if (type === 'magnet') {
      this.effects.magnet = 300;
    } else if (type === 'freeze') {
      this.effects.freeze = 240; // ~4 seconds
    } else if (type === 'bomb') {
      this.detonateBomb();
    }
    this.updateInventoryUI();
  }

  detonateBomb() {
    const p = this.player;
    const radius = 250;
    for (let i = this.ais.length - 1; i >= 0; i--) {
      const ai = this.ais[i];
      if (dist(p, ai) <= radius) {
        this.createParticles(ai.x, ai.y, getColor(ai.value), 20);
        for (const seg of ai.trail) this.createParticles(seg.x, seg.y, getColor(seg.value), 6);
        this.ais.splice(i, 1);
      }
    }
    this.createParticles(p.x, p.y, '#e67e22', 30);
  }

  updateEffects() {
    for (const key of Object.keys(this.effects)) {
      this.effects[key]--;
      if (this.effects[key] <= 0) {
        delete this.effects[key];
        this.updateInventoryUI();
      }
    }

    // Magnet: pull food toward player
    if (this.effects.magnet) {
      const p = this.player;
      for (const f of this.foods) {
        const d = dist(p, f);
        if (d < 500 && d > 1) {
          const pull = 5;
          f.x += (p.x - f.x) / d * pull;
          f.y += (p.y - f.y) / d * pull;
        }
      }
    }
  }

  updateInventoryUI() {
    const slots = document.querySelectorAll('.inv-slot');
    for (let i = 0; i < INV_SIZE; i++) {
      const slot = slots[i];
      const type = this.inventory[i];
      const icon = slot.querySelector('.inv-icon');
      const count = slot.querySelector('.inv-count');
      if (type) {
        const info = ITEM_TYPES[type];
        slot.classList.add('has-item');
        icon.textContent = info.icon;
        icon.style.color = info.color;
        count.textContent = '';
      } else {
        slot.classList.remove('has-item');
        icon.textContent = '';
        count.textContent = '';
      }
      if (type && this.effects[type]) {
        slot.classList.add('active-effect');
      } else {
        slot.classList.remove('active-effect');
      }
    }

    // Status text
    const status = document.getElementById('inv-status');
    const active = Object.keys(this.effects).filter(k => k !== 'bomb');
    if (active.length > 0) {
      status.textContent = active.map(k => `${ITEM_TYPES[k].name} (${Math.ceil(this.effects[k] / 60)}s)`).join(' · ');
    } else {
      status.textContent = '';
    }
  }

  // ─── Update ───
  update() {
    this.frameCount++;
    this.updatePlayer();
    this.updateCamera();
    if (!this.effects.freeze) {
      for (const ai of this.ais) this.updateAI(ai);
    }
    this.updateTrail(this.player);
    for (const ai of this.ais) this.updateTrail(ai);
    this.updateEffects();
    this.checkCollisions();
    this.particles = this.particles.filter(p => { p.update(); return p.life > 0; });

    // Food spawn with cooldown
    this.foodTimer++;
    if (this.foodTimer >= 40) {
      this.foodTimer = 0;
      if (this.foods.length < CONFIG.maxFood) this.spawnFood();
    }

    // AI respawn with cooldown
    this.aiTimer++;
    if (this.aiTimer >= 90) {
      this.aiTimer = 0;
      if (this.ais.length < CONFIG.aiCount) this.spawnAI();
    }

    // Item spawn with cooldown
    this.itemTimer++;
    if (this.itemTimer >= 300) { // ~5 seconds
      this.itemTimer = 0;
      if (this.items.length < 4) this.spawnItem();
    }

    this.updateHUD();
  }

  updateCamera() {
    this.camX = clamp(this.player.x - CONFIG.W / 2, 0, CONFIG.worldW - CONFIG.W);
    this.camY = clamp(this.player.y - CONFIG.H / 2, 0, CONFIG.worldH - CONFIG.H);
  }

  updatePlayer() {
    const p = this.player;
    let dx = 0, dy = 0;
    if (this.keys['w'] || this.keys['arrowup']) dy -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) dy += 1;
    if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) dx += 1;
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    const spd = this.effects.speed ? CONFIG.playerSpeed * 2 : CONFIG.playerSpeed;
    p.dx = dx * spd;
    p.dy = dy * spd;
    p.x = clamp(p.x + p.dx, p.radius, CONFIG.worldW - p.radius);
    p.y = clamp(p.y + p.dy, p.radius, CONFIG.worldH - p.radius);
    if (p.pulse > 0) p.pulse *= 0.88;
  }

  updateAI(ai) {
    // Find the biggest food we can eat within range
    let target = null, targetScore = -1;
    for (const f of this.foods) {
      if (f.value > ai.value) continue;
      const d = dist(ai, f);
      if (d > 600) continue;
      const score = f.value * 100 - d; // prefer bigger value, closer
      if (score > targetScore) { targetScore = score; target = f; }
    }

    // Find the biggest prey (player or AI) we can eat within range
    let prey = null, preyScore = -1;
    if (this.player.value < ai.value) {
      const d = dist(ai, this.player);
      if (d < 500) {
        const score = this.player.value * 100 - d;
        if (score > preyScore) { preyScore = score; prey = this.player; }
      }
    }
    for (const other of this.ais) {
      if (other === ai) continue;
      if (other.value < ai.value) {
        const d = dist(ai, other);
        if (d < 500) {
          const score = other.value * 100 - d;
          if (score > preyScore) { preyScore = score; prey = other; }
        }
      }
    }

    // Danger: flee from bigger cubes
    let danger = null, dangerD = Infinity;
    if (this.player.value > ai.value) {
      const d = dist(ai, this.player);
      if (d < 140 && d < dangerD) { danger = this.player; dangerD = d; }
    }
    for (const other of this.ais) {
      if (other === ai) continue;
      if (other.value > ai.value) {
        const d = dist(ai, other);
        if (d < 140 && d < dangerD) { danger = other; dangerD = d; }
      }
    }

    let mx = 0, my = 0;
    if (danger) {
      mx = ai.x - danger.x;
      my = ai.y - danger.y;
    } else if (prey) {
      mx = prey.x - ai.x;
      my = prey.y - ai.y;
    } else if (target) {
      mx = target.x - ai.x;
      my = target.y - ai.y;
    } else {
      ai.wanderT--;
      if (ai.wanderT <= 0) {
        ai.wanderT = 40 + Math.floor(Math.random() * 60);
        const ang = Math.random() * Math.PI * 2;
        ai.wdx = Math.cos(ang);
        ai.wdy = Math.sin(ang);
      }
      mx = ai.wdx; my = ai.wdy;
    }

    const len = Math.hypot(mx, my);
    if (len > 0) {
      mx = (mx / len) * CONFIG.aiSpeed;
      my = (my / len) * CONFIG.aiSpeed;
    }
    ai.x = clamp(ai.x + mx, ai.radius, CONFIG.worldW - ai.radius);
    ai.y = clamp(ai.y + my, ai.radius, CONFIG.worldH - ai.radius);
    if (ai.pulse > 0) ai.pulse *= 0.88;
  }

  updateTrail(cube) {
    const tr = cube.trail;
    for (let i = 0; i < tr.length; i++) {
      const leader = i === 0 ? cube : tr[i - 1];
      const seg = tr[i];
      const dx = leader.x - seg.x;
      const dy = leader.y - seg.y;
      const d = Math.hypot(dx, dy);
      const leaderSize = leader === cube ? getSize(cube.value) : getSize(leader.value);
      const segSize = getSize(seg.value);
      const spacing = (leaderSize + segSize) / 2 + CONFIG.trailSpacing;
      if (d > spacing) {
        const move = d - spacing;
        seg.x += (dx / d) * move;
        seg.y += (dy / d) * move;
      }
      if (seg.pulse > 0) seg.pulse *= 0.88;
      if (seg.slide < 1) seg.slide = Math.min(1, seg.slide + 0.08);
    }
  }

  // ─── Consume / Merge helpers ───
  consume(cube, value, x, y) {
    if (value === cube.value) {
      cube.value *= 2;
      cube.pulse = 1;
      cube.radius = getSize(cube.value) / 2;
      if (cube === this.player) this.bestValue = Math.max(this.bestValue, cube.value);
      this.mergeTrailBack(cube);
    } else {
      this.addToTrail(cube, value, x, y);
    }
  }

  addToTrail(cube, value, x, y) {
    if (cube.trail.length >= CONFIG.maxTrail) return;
    const t = cube.trail;
    const seg = { x, y, value, pulse: 0, radius: getSize(value) / 2, slide: 0 };

    // Insert in sorted order: largest near head (index 0), smallest at back (last)
    let insertIdx = t.length;
    for (let i = 0; i < t.length; i++) {
      if (value > t[i].value) { insertIdx = i; break; }
    }
    t.splice(insertIdx, 0, seg);

    // Merge adjacent equals from the back, then check if front merges into head
    this.mergeTrailBack(cube);
  }

  mergeTrailBack(cube) {
    const t = cube.trail;
    let changed = true;
    while (changed) {
      changed = false;
      // Sort descending: largest near head (index 0)
      t.sort((a, b) => b.value - a.value);
      // If front segment matches head value, merge into head FIRST
      if (t.length > 0 && t[0].value === cube.value) {
        cube.value *= 2;
        cube.pulse = 1;
        cube.radius = getSize(cube.value) / 2;
        if (cube === this.player) this.bestValue = Math.max(this.bestValue, cube.value);
        t.shift();
        changed = true;
        continue;
      }
      // Merge adjacent equals from the back
      for (let i = t.length - 1; i >= 1; i--) {
        if (t[i].value === t[i - 1].value) {
          t[i - 1].value *= 2;
          t[i - 1].pulse = 1;
          t[i - 1].slide = 0;
          t[i - 1].radius = getSize(t[i - 1].value) / 2;
          t.splice(i, 1);
          changed = true;
        }
      }
    }
  }

  // ─── Collisions ───
  overlap(a, b) {
    return Math.abs(a.x - b.x) < (a.radius + b.radius) * 0.65 &&
           Math.abs(a.y - b.y) < (a.radius + b.radius) * 0.65;
  }

  resolveCollision(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) { a.x += 2; return; }
    const push = ((a.radius + b.radius) * 0.65 - d) / 2;
    a.x += (dx / d) * push; a.y += (dy / d) * push;
    b.x -= (dx / d) * push; b.y -= (dy / d) * push;
    a.x = clamp(a.x, a.radius, CONFIG.worldW - a.radius);
    a.y = clamp(a.y, a.radius, CONFIG.worldH - a.radius);
    b.x = clamp(b.x, b.radius, CONFIG.worldW - b.radius);
    b.y = clamp(b.y, b.radius, CONFIG.worldH - b.radius);
  }

  resolveStatic(moving, stat) {
    const dx = moving.x - stat.x, dy = moving.y - stat.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) { moving.x += 2; return; }
    const push = (moving.radius + stat.radius) * 0.65 - d;
    moving.x += (dx / d) * push;
    moving.y += (dy / d) * push;
    moving.x = clamp(moving.x, moving.radius, CONFIG.worldW - moving.radius);
    moving.y = clamp(moving.y, moving.radius, CONFIG.worldH - moving.radius);
  }

  createParticles(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) this.particles.push(new Particle(x, y, color));
  }

  checkCollisions() {
    const p = this.player;
    const all = [p, ...this.ais];

    // Head vs Tail (any head can eat any other cube's trail)
    for (let i = 0; i < all.length; i++) {
      const head = all[i];
      for (let j = 0; j < all.length; j++) {
        if (i === j) continue;
        const other = all[j];
        for (let k = other.trail.length - 1; k >= 0; k--) {
          const seg = other.trail[k];
          if (!this.overlap(head, seg)) continue;
          if (seg.value === head.value) {
            this.consume(head, seg.value, seg.x, seg.y);
            this.createParticles(seg.x, seg.y, getColor(seg.value));
            other.trail.splice(k, 1);
          } else if (seg.value < head.value) {
            this.consume(head, seg.value, seg.x, seg.y);
            this.createParticles(seg.x, seg.y, getColor(seg.value), 6);
            other.trail.splice(k, 1);
          } else {
            this.resolveStatic(head, seg);
          }
        }
      }
    }

    // Player vs AI head
    for (let i = this.ais.length - 1; i >= 0; i--) {
      const ai = this.ais[i];
      if (!this.overlap(p, ai)) continue;
      if (p.value === ai.value) {
        this.resolveCollision(p, ai);
      } else if (p.value > ai.value) {
        this.consume(p, ai.value, ai.x, ai.y);
        for (const seg of ai.trail) this.consume(p, seg.value, seg.x, seg.y);
        this.createParticles(ai.x, ai.y, getColor(ai.value), 20);
        this.ais.splice(i, 1);
      } else {
        if (this.effects.shield) {
          this.resolveCollision(p, ai);
        } else {
          this.endGame('An AI ate you!');
          return;
        }
      }
    }

    // AI vs AI head
    for (let i = 0; i < this.ais.length; i++) {
      for (let j = i + 1; j < this.ais.length; j++) {
        const a = this.ais[i], b = this.ais[j];
        if (!this.overlap(a, b)) continue;
        if (a.value === b.value) {
          this.resolveCollision(a, b);
        } else if (a.value > b.value) {
          this.consume(a, b.value, b.x, b.y);
          for (const seg of b.trail) this.consume(a, seg.value, seg.x, seg.y);
          this.createParticles(b.x, b.y, getColor(b.value), 16);
          this.ais.splice(j, 1); j--;
        } else {
          this.consume(b, a.value, a.x, a.y);
          for (const seg of a.trail) this.consume(b, seg.value, seg.x, seg.y);
          this.createParticles(a.x, a.y, getColor(a.value), 16);
          this.ais.splice(i, 1); i--;
          break;
        }
      }
    }

    // Player vs Food
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      if (!this.overlap(p, f)) continue;
      if (f.value <= p.value) {
        this.consume(p, f.value, f.x, f.y);
        this.createParticles(f.x, f.y, getColor(f.value), f.value === p.value ? 16 : 8);
        this.foods.splice(i, 1);
      } else {
        this.resolveStatic(p, f);
      }
    }

    // AI vs Food
    for (const ai of this.ais) {
      for (let j = this.foods.length - 1; j >= 0; j--) {
        const f = this.foods[j];
        if (!this.overlap(ai, f)) continue;
        if (f.value <= ai.value) {
          this.consume(ai, f.value, f.x, f.y);
          this.foods.splice(j, 1);
        } else {
          this.resolveStatic(ai, f);
        }
      }
    }

    // Player vs Items (pickups)
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!this.overlap(p, it)) continue;
      if (this.addItemToInventory(it.type)) {
        this.createParticles(it.x, it.y, ITEM_TYPES[it.type].color, 12);
        this.items.splice(i, 1);
      }
    }

    // Re-merge trails after all collision modifications
    this.mergeTrailBack(this.player);
    for (const ai of this.ais) this.mergeTrailBack(ai);
  }

  endGame(msg) {
    this.gameOver = true;
    this.running = false;
    document.getElementById('final-text').textContent = msg;
    document.getElementById('final-score').textContent = `You reached: ${this.player.value}`;
    document.getElementById('game-over-screen').classList.remove('hidden');
  }

  // ─── Render ───
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CONFIG.W, CONFIG.H);
    this.renderGrid();

    for (const f of this.foods) {
      this.renderCube(f.x, f.y, getFoodSize(f.value), f.value, { alpha: 0.85 });
    }

    // Render item pickups
    for (const it of this.items) {
      it.bob += 0.05;
      const bobY = Math.sin(it.bob) * 4;
      const info = ITEM_TYPES[it.type];
      const dx = it.x - this.camX;
      const dy = it.y - this.camY + bobY;
      ctx.save();
      ctx.shadowColor = info.color;
      ctx.shadowBlur = 15;
      ctx.fillStyle = info.color;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.arc(dx, dy, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.icon, dx, dy);
      ctx.restore();
    }

    for (const ai of this.ais) this.renderTrail(ai, false);
    this.renderTrail(this.player, true);

    for (const ai of this.ais) {
      const s = getSize(ai.value) * (1 + ai.pulse * 0.25);
      this.renderCube(ai.x, ai.y, s, ai.value, { border: '#ff6b6b', glow: true });
      // Render name above AI
      ctx.save();
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 107, 107, 0.85)';
      ctx.fillText(ai.name, ai.x - this.camX, ai.y - this.camY - s / 2 - 10);
      ctx.restore();
    }

    const ps = getSize(this.player.value) * (1 + this.player.pulse * 0.25);
    this.renderCube(this.player.x, this.player.y, ps, this.player.value, { border: '#fff', glow: true, glowColor: getColor(this.player.value) });

    // Shield ring
    if (this.effects.shield) {
      const dx = this.player.x - this.camX;
      const dy = this.player.y - this.camY;
      ctx.save();
      ctx.strokeStyle = 'rgba(52, 152, 219, 0.6)';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#3498db';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(dx, dy, ps / 2 + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Freeze indicator on AI cubes
    if (this.effects.freeze) {
      for (const ai of this.ais) {
        const dx = ai.x - this.camX;
        const dy = ai.y - this.camY;
        const s = getSize(ai.value);
        ctx.save();
        ctx.strokeStyle = 'rgba(26, 188, 156, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(dx, dy, s / 2 + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.fillRect((p.x - p.size / 2) - this.camX, (p.y - p.size / 2) - this.camY, p.size, p.size);
      ctx.restore();
    }
  }

  renderGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const step = 40;
    const startX = Math.floor(this.camX / step) * step;
    const endX = startX + CONFIG.W + step;
    const startY = Math.floor(this.camY / step) * step;
    const endY = startY + CONFIG.H + step;
    for (let x = startX; x <= endX; x += step) {
      const sx = x - this.camX;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, CONFIG.H); ctx.stroke();
    }
    for (let y = startY; y <= endY; y += step) {
      const sy = y - this.camY;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(CONFIG.W, sy); ctx.stroke();
    }
  }

  renderTrail(cube, isPlayer) {
    for (let i = 0; i < cube.trail.length; i++) {
      const seg = cube.trail[i];
      const slide = seg.slide !== undefined ? seg.slide : 1;
      const fade = (1 - (i / Math.max(cube.trail.length, 10)) * 0.4) * slide;
      const size = getSize(seg.value) * (1 + (seg.pulse || 0) * 0.25) * slide;
      this.renderCube(seg.x, seg.y, size, seg.value, {
        alpha: fade * 0.9,
        border: isPlayer ? 'rgba(255,255,255,0.3)' : 'rgba(255,107,107,0.3)',
      });
    }
  }

  renderCube(x, y, size, value, opts = {}) {
    const ctx = this.ctx;
    const color = getColor(value);
    const half = size / 2;
    const r = Math.min(8, size * 0.2);
    const dx = x - this.camX;
    const dy = y - this.camY;

    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;

    if (opts.glow) {
      ctx.shadowColor = opts.glowColor || color;
      ctx.shadowBlur = 18;
    }

    ctx.fillStyle = color;
    this.roundRect(dx - half, dy - half, size, size, r);
    ctx.fill();

    ctx.shadowBlur = 0;

    if (opts.border) {
      ctx.strokeStyle = opts.border;
      ctx.lineWidth = 2.5;
      this.roundRect(dx - half, dy - half, size, size, r);
      ctx.stroke();
    }

    ctx.globalAlpha = (opts.alpha != null ? opts.alpha : 1) * 0.15;
    ctx.fillStyle = '#fff';
    this.roundRect(dx - half + 3, dy - half + 3, size - 6, size * 0.3, r * 0.5);
    ctx.fill();
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;

    ctx.fillStyle = '#fff';
    let fs = size * 0.42;
    const txt = String(value);
    if (txt.length > 2) fs *= 0.75;
    if (txt.length > 3) fs *= 0.8;
    if (txt.length > 4) fs *= 0.8;
    ctx.font = `800 ${fs}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, dx, dy + 1);

    ctx.restore();
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ─── HUD ───
  updateHUD() {
    document.getElementById('hud-value').textContent = this.player.value;
    document.getElementById('hud-trail').textContent = this.player.trail.length;
    document.getElementById('hud-best').textContent = this.bestValue;
    this.updateLeaderboard();
  }

  updateLeaderboard() {
    const entries = [
      { name: 'You', value: this.player.value, color: getColor(this.player.value), isPlayer: true, dead: this.gameOver },
    ];
    for (const ai of this.ais) {
      entries.push({ name: ai.name, value: ai.value, color: getColor(ai.value), isPlayer: false, dead: false });
    }
    entries.sort((a, b) => b.value - a.value);
    const list = document.getElementById('lb-list');
    list.innerHTML = entries.map(e =>
      `<li class="${e.isPlayer ? 'you' : ''} ${e.dead ? 'dead' : ''}">` +
      `<span class="lb-name"><span class="lb-dot" style="background:${e.color}"></span>${e.name}</span>` +
      `<span class="lb-value">${e.value}</span>` +
      `</li>`
    ).join('');
  }

  // ─── Loop ───
  loop() {
    if (!this.running) return;
    this.update();
    this.render();
    this._rafId = requestAnimationFrame(() => this.loop());
  }
}

// ─── Init ───
const game = new Game(document.getElementById('game-canvas'));

document.getElementById('start-btn').addEventListener('click', () => {
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('leaderboard').style.display = 'block';
  game.start();
});

document.getElementById('restart-btn').addEventListener('click', () => {
  document.getElementById('game-over-screen').classList.add('hidden');
  document.getElementById('leaderboard').style.display = 'block';
  game.start();
});

'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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
  aiCount: 6,
  trailSpacing: 4,
  maxTrail: 80,
  port: 3000,
};

const COLORS = {
  2: '#3498db', 4: '#2ecc71', 8: '#f1c40f', 16: '#e67e22',
  32: '#e74c3c', 64: '#9b59b6', 128: '#1abc9c', 256: '#fd79a8',
  512: '#fdcb6e', 1024: '#00cec9', 2048: '#a29bfe', 4096: '#dfe6e9',
  8192: '#ff7675', 16384: '#55efc4',
};

const ITEM_TYPES = {
  speed:  { icon: '⚡',  color: '#f1c40f', name: 'Speed Boost', desc: '2x speed for 5s' },
  shield: { icon: '🛡️', color: '#3498db', name: 'Shield',      desc: 'Invincible for 5s' },
  magnet: { icon: '🧲', color: '#e74c3c', name: 'Magnet',      desc: 'Pull food for 5s' },
  bomb:   { icon: '💣', color: '#e67e22', name: 'Bomb',        desc: 'Destroy nearby AI' },
  freeze: { icon: '❄️', color: '#1abc9c', name: 'Freeze',      desc: 'Freeze all AI for 4s' },
};
const ITEM_KEYS = Object.keys(ITEM_TYPES);
const INV_SIZE = 5;

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

class GameServer {
  constructor() {
    this.players = new Map(); // socket.id -> { id, x, y, value, trail, radius, pulse, dx, dy, keys, inventory, effects, name, color, alive, bestValue }
    this.ais = [];
    this.foods = [];
    this.particles = [];
    this.items = [];
    this.running = true;
    this.frameCount = 0;
    this.foodTimer = 0;
    this.aiTimer = 0;
    this.itemTimer = 0;

    for (let i = 0; i < CONFIG.maxFood; i++) this.spawnFood();
    this.started = false;
  }

  start() {
    this.running = true;
    this.started = true;
    this.loop();
  }

  addPlayer(socket) {
    const id = socket.id;
    const pos = this.findFreePos(60, 250);
    const p = {
      id,
      x: pos.x, y: pos.y,
      value: 2, trail: [],
      radius: getSize(2) / 2,
      pulse: 0, dx: 0, dy: 0,
      keys: {},
      inventory: new Array(INV_SIZE).fill(null),
      effects: {},
      name: 'Player ' + (this.players.size + 1),
      bestValue: 2,
      alive: true,
      color: id === this.firstPlayer ? '#fff' : '#6bcf6b',
    };
    this.players.set(id, p);
    if (this.players.size === 1) this.firstPlayer = id;
    if (this.players.size >= 2 && !this.started) this.start();
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  setKeys(id, keys) {
    const p = this.players.get(id);
    if (p) p.keys = keys;
  }

  useItem(id, slot) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const type = p.inventory[slot];
    if (!type) return;
    this.applyEffect(p, type);
    p.inventory[slot] = null;
  }

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

  spawnItem() {
    const type = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)];
    const pos = this.findFreePos(60, 100);
    this.items.push({ x: pos.x, y: pos.y, type, radius: 18, bob: 0 });
  }

  findFreePos(minDistFromEntities, minDistFromPlayer) {
    const allEntities = [...this.ais, ...this.players.values()];
    for (let attempts = 0; attempts < 20; attempts++) {
      const x = rand(40, CONFIG.worldW - 40);
      const y = rand(40, CONFIG.worldH - 40);
      let ok = true;
      if (this.players.size > 0) {
        let closeToPlayer = false;
        for (const p of this.players.values()) {
          if (dist({ x, y }, p) < minDistFromPlayer) { closeToPlayer = true; break; }
        }
        if (closeToPlayer) continue;
      }
      for (const e of allEntities) { if (dist({ x, y }, e) < minDistFromEntities) { ok = false; break; } }
      if (!ok) continue;
      for (const f of this.foods) { if (dist({ x, y }, f) < minDistFromEntities) { ok = false; break; } }
      if (ok) return { x, y };
    }
    return { x: rand(40, CONFIG.worldW - 40), y: rand(40, CONFIG.worldH - 40) };
  }

  addItemToInventory(p, type) {
    for (let i = 0; i < INV_SIZE; i++) {
      if (p.inventory[i] === null) { p.inventory[i] = type; return true; }
    }
    return false;
  }

  applyEffect(p, type) {
    if (type === 'speed') p.effects.speed = 300;
    else if (type === 'shield') p.effects.shield = 300;
    else if (type === 'magnet') p.effects.magnet = 300;
    else if (type === 'freeze') p.effects.freeze = 240;
    else if (type === 'bomb') this.detonateBomb(p);
  }

  detonateBomb(p) {
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
    for (const p of this.players.values()) {
      for (const key of Object.keys(p.effects)) {
        p.effects[key]--;
        if (p.effects[key] <= 0) delete p.effects[key];
      }
    }
    // Magnet: pull food toward all players
    for (const p of this.players.values()) {
      if (!p.effects.magnet) continue;
      for (const f of this.foods) {
        const d = dist(p, f);
        if (d < 500 && d > 1) { f.x += (p.x - f.x) / d * 5; f.y += (p.y - f.y) / d * 5; }
      }
    }
  }

  update() {
    this.frameCount++;
    for (const p of this.players.values()) this.updateHuman(p);
    if (!this.effectsFreeze()) {
      for (const ai of this.ais) this.updateAI(ai);
    }
    for (const p of this.players.values()) this.updateTrail(p);
    for (const ai of this.ais) this.updateTrail(ai);
    this.updateEffects();
    this.checkCollisions();
    this.particles = this.particles.filter(p => { p.update(); return p.life > 0; });

    this.foodTimer++;
    if (this.foodTimer >= 40) { this.foodTimer = 0; if (this.foods.length < CONFIG.maxFood) this.spawnFood(); }

    this.aiTimer++;
    if (this.aiTimer >= 90) { this.aiTimer = 0; if (this.ais.length < CONFIG.aiCount) this.spawnAI(); }

    this.itemTimer++;
    if (this.itemTimer >= 300) { this.itemTimer = 0; if (this.items.length < 4) this.spawnItem(); }
  }

  effectsFreeze() {
    for (const p of this.players.values()) if (p.effects.freeze) return true;
    return false;
  }

  updateHuman(p) {
    if (!p.alive) return;
    let dx = 0, dy = 0;
    if (p.keys['w'] || p.keys['arrowup']) dy -= 1;
    if (p.keys['s'] || p.keys['arrowdown']) dy += 1;
    if (p.keys['a'] || p.keys['arrowleft']) dx -= 1;
    if (p.keys['d'] || p.keys['arrowright']) dx += 1;
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    const spd = p.effects.speed ? CONFIG.playerSpeed * 2 : CONFIG.playerSpeed;
    p.dx = dx * spd;
    p.dy = dy * spd;
    p.x = clamp(p.x + p.dx, p.radius, CONFIG.worldW - p.radius);
    p.y = clamp(p.y + p.dy, p.radius, CONFIG.worldH - p.radius);
    if (p.pulse > 0) p.pulse *= 0.88;
  }

  updateAI(ai) {
    let target = null, targetScore = -1;
    for (const f of this.foods) {
      if (f.value > ai.value) continue;
      const d = dist(ai, f);
      if (d > 600) continue;
      const score = f.value * 100 - d;
      if (score > targetScore) { targetScore = score; target = f; }
    }
    let prey = null, preyScore = -1;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.value < ai.value) {
        const d = dist(ai, p);
        if (d < 500) { const score = p.value * 100 - d; if (score > preyScore) { preyScore = score; prey = p; } }
      }
    }
    for (const other of this.ais) {
      if (other === ai) continue;
      if (other.value < ai.value) {
        const d = dist(ai, other);
        if (d < 500) { const score = other.value * 100 - d; if (score > preyScore) { preyScore = score; prey = other; } }
      }
    }
    let danger = null, dangerD = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.value > ai.value) {
        const d = dist(ai, p);
        if (d < 140 && d < dangerD) { danger = p; dangerD = d; }
      }
    }
    for (const other of this.ais) {
      if (other === ai) continue;
      if (other.value > ai.value) {
        const d = dist(ai, other);
        if (d < 140 && d < dangerD) { danger = other; dangerD = d; }
      }
    }
    let mx = 0, my = 0;
    if (danger) { mx = ai.x - danger.x; my = ai.y - danger.y; }
    else if (prey) { mx = prey.x - ai.x; my = prey.y - ai.y; }
    else if (target) { mx = target.x - ai.x; my = target.y - ai.y; }
    else {
      ai.wanderT--;
      if (ai.wanderT <= 0) {
        ai.wanderT = 40 + Math.floor(Math.random() * 60);
        const ang = Math.random() * Math.PI * 2;
        ai.wdx = Math.cos(ang); ai.wdy = Math.sin(ang);
      }
      mx = ai.wdx; my = ai.wdy;
    }
    const len = Math.hypot(mx, my);
    if (len > 0) { mx = (mx / len) * CONFIG.aiSpeed; my = (my / len) * CONFIG.aiSpeed; }
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
      if (d > spacing) { const move = d - spacing; seg.x += (dx / d) * move; seg.y += (dy / d) * move; }
      if (seg.pulse > 0) seg.pulse *= 0.88;
      if (seg.slide < 1) seg.slide = Math.min(1, seg.slide + 0.08);
    }
  }

  consume(cube, value, x, y) {
    if (value === cube.value) {
      cube.value *= 2;
      cube.pulse = 1;
      cube.radius = getSize(cube.value) / 2;
      if ('bestValue' in cube) cube.bestValue = Math.max(cube.bestValue, cube.value);
      this.mergeTrailBack(cube);
    } else {
      this.addToTrail(cube, value, x, y);
    }
  }

  addToTrail(cube, value, x, y) {
    if (cube.trail.length >= CONFIG.maxTrail) return;
    const t = cube.trail;
    const seg = { x, y, value, pulse: 0, radius: getSize(value) / 2, slide: 0 };
    let insertIdx = t.length;
    for (let i = 0; i < t.length; i++) { if (value > t[i].value) { insertIdx = i; break; } }
    t.splice(insertIdx, 0, seg);
    this.mergeTrailBack(cube);
  }

  mergeTrailBack(cube) {
    const t = cube.trail;
    let changed = true;
    while (changed) {
      changed = false;
      t.sort((a, b) => b.value - a.value);
      if (t.length > 0 && t[0].value === cube.value) {
        cube.value *= 2; cube.pulse = 1; cube.radius = getSize(cube.value) / 2;
        if ('bestValue' in cube) cube.bestValue = Math.max(cube.bestValue, cube.value);
        t.shift(); changed = true; continue;
      }
      for (let i = t.length - 1; i >= 1; i--) {
        if (t[i].value === t[i - 1].value) {
          t[i - 1].value *= 2; t[i - 1].pulse = 1; t[i - 1].slide = 0; t[i - 1].radius = getSize(t[i - 1].value) / 2;
          t.splice(i, 1); changed = true;
        }
      }
    }
  }

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
    const allPlayers = [...this.players.values()].filter(p => p.alive);
    const all = [...allPlayers, ...this.ais];

    // Head vs Tail
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
          } else { this.resolveStatic(head, seg); }
        }
      }
    }

    // Player vs Player
    const pa = allPlayers;
    for (let i = 0; i < pa.length; i++) {
      for (let j = i + 1; j < pa.length; j++) {
        const a = pa[i], b = pa[j];
        if (!this.overlap(a, b)) continue;
        if (a.value === b.value) { this.resolveCollision(a, b); }
        else if (a.value > b.value) { this.eatPlayer(a, b); }
        else { this.eatPlayer(b, a); }
      }
    }

    // Player vs AI head
    for (const p of allPlayers) {
      for (let i = this.ais.length - 1; i >= 0; i--) {
        const ai = this.ais[i];
        if (!this.overlap(p, ai)) continue;
        if (p.value === ai.value) { this.resolveCollision(p, ai); }
        else if (p.value > ai.value) {
          this.consume(p, ai.value, ai.x, ai.y);
          for (const seg of ai.trail) this.consume(p, seg.value, seg.x, seg.y);
          this.createParticles(ai.x, ai.y, getColor(ai.value), 20);
          this.ais.splice(i, 1);
        } else {
          if (p.effects.shield) { this.resolveCollision(p, ai); }
          else { this.killPlayer(p); return; }
        }
      }
    }

    // AI vs AI head
    for (let i = 0; i < this.ais.length; i++) {
      for (let j = i + 1; j < this.ais.length; j++) {
        const a = this.ais[i], b = this.ais[j];
        if (!this.overlap(a, b)) continue;
        if (a.value === b.value) { this.resolveCollision(a, b); }
        else if (a.value > b.value) {
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

    // All heads vs Food
    for (const head of all) {
      for (let i = this.foods.length - 1; i >= 0; i--) {
        const f = this.foods[i];
        if (!this.overlap(head, f)) continue;
        if (f.value <= head.value) {
          this.consume(head, f.value, f.x, f.y);
          this.createParticles(f.x, f.y, getColor(f.value), f.value === head.value ? 16 : 8);
          this.foods.splice(i, 1);
        } else { this.resolveStatic(head, f); }
      }
    }

    // Player vs Items
    for (const p of allPlayers) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        if (!this.overlap(p, it)) continue;
        if (this.addItemToInventory(p, it.type)) {
          this.createParticles(it.x, it.y, ITEM_TYPES[it.type].color, 12);
          this.items.splice(i, 1);
        }
      }
    }

    // Re-merge trails
    for (const p of allPlayers) this.mergeTrailBack(p);
    for (const ai of this.ais) this.mergeTrailBack(ai);
  }

  eatPlayer(predator, prey) {
    this.consume(predator, prey.value, prey.x, prey.y);
    for (const seg of prey.trail) this.consume(predator, seg.value, seg.x, seg.y);
    this.createParticles(prey.x, prey.y, getColor(prey.value), 30);
    this.killPlayer(prey);
  }

  killPlayer(p) {
    p.alive = false;
  }

  getState() {
    const players = [];
    for (const [id, p] of this.players) {
      players.push({
        id, x: p.x, y: p.y, value: p.value, radius: p.radius,
        trail: p.trail.map(s => ({ x: s.x, y: s.y, value: s.value, radius: s.radius, pulse: s.pulse, slide: s.slide })),
        pulse: p.pulse, name: p.name, alive: p.alive, color: p.color,
        inventory: p.inventory, effects: p.effects, bestValue: p.bestValue,
      });
    }
    return {
      players,
      ais: this.ais.map(a => ({ x: a.x, y: a.y, value: a.value, radius: a.radius, trail: a.trail, pulse: a.pulse, name: a.name })),
      foods: this.foods,
      items: this.items,
      particles: this.particles,
      gameOver: [...this.players.values()].every(p => !p.alive) && this.players.size >= 1,
    };
  }

  loop() {
    if (!this.running) return;
    this.update();
    io.emit('state', this.getState());
    setTimeout(() => this.loop(), 1000 / 20); // 20 TPS
  }
}

// ─── HTTP / Socket.IO setup ───
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'multiplayer.html'));
});

const game = new GameServer();

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  const p = game.addPlayer(socket);

  socket.emit('joined', { id: socket.id, name: p.name });

  socket.on('input', (keys) => {
    game.setKeys(socket.id, keys);
  });

  socket.on('useItem', (slot) => {
    game.useItem(socket.id, slot);
  });

  socket.on('start', () => {
    if (game.players.size >= 1 && !game.started) game.start();
  });

  socket.on('restart', () => {
    // full reset not implemented for MVP
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    game.removePlayer(socket.id);
  });
});

server.listen(CONFIG.port, () => {
  console.log(`Server running at http://localhost:${CONFIG.port}`);
});

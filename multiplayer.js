'use strict';

// ─── Client-side online Cube Eat renderer ───

const CONFIG = {
  W: 900,
  H: 600,
  worldW: 4000,
  worldH: 3000,
  cubeSize: 38,
  foodSize: 32,
  trailSpacing: 4,
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
const INV_SIZE = 5;

function getColor(v) { return COLORS[v] || '#dfe6e9'; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function getSize(value) { return CONFIG.cubeSize + Math.log2(value) * 5; }
function getFoodSize(value) { return CONFIG.foodSize + Math.log2(value) * 3; }

class Client {
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
    this.myId = null;
    this.myName = null;
    this.state = null;
    this.running = false;
    this.gameOver = false;
    this._rafId = null;
    this.camX = 0;
    this.camY = 0;
    this.bestValue = 2;

    this.socket = io({ transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      console.log('Connected to server');
    });

    this.socket.on('joined', (data) => {
      this.myId = data.id;
      this.myName = data.name;
      document.getElementById('start-screen').classList.add('hidden');
      document.getElementById('waiting-screen').classList.remove('hidden');
    });

    this.socket.on('state', (state) => {
      this.state = state;
      if (state.players.length > 0 && !this.running) {
        this.running = true;
        document.getElementById('waiting-screen').classList.add('hidden');
        this.loop();
      }
    });

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= INV_SIZE) this.socket.emit('useItem', n - 1);
      this.socket.emit('input', this.keys);
    });

    window.addEventListener('keyup', e => {
      this.keys[e.key.toLowerCase()] = false;
      this.socket.emit('input', this.keys);
    });
  }

  start() {
    this.socket.emit('start');
    document.getElementById('start-screen').classList.add('hidden');
  }

  updateCamera() {
    if (!this.state || !this.myId) return;
    const me = this.state.players.find(p => p.id === this.myId);
    if (!me) return;
    this.camX = clamp(me.x - CONFIG.W / 2, 0, CONFIG.worldW - CONFIG.W);
    this.camY = clamp(me.y - CONFIG.H / 2, 0, CONFIG.worldH - CONFIG.H);
  }

  loop() {
    if (!this.running) return;
    this.updateCamera();
    this.render();
    this.updateHUD();
    this._rafId = requestAnimationFrame(() => this.loop());
  }

  updateHUD() {
    if (!this.state || !this.myId) return;
    const me = this.state.players.find(p => p.id === this.myId);
    if (!me) return;
    this.bestValue = Math.max(this.bestValue, me.value);
    document.getElementById('hud-value').textContent = me.value;
    document.getElementById('hud-trail').textContent = me.trail.length;
    document.getElementById('hud-best').textContent = this.bestValue;
    this.updateInventoryUI(me);
    this.updateLeaderboard(me);

    if (me.alive === false && !this.gameOver) {
      this.gameOver = true;
      this.running = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      document.getElementById('final-score').textContent = `You reached: ${me.value}`;
      document.getElementById('game-over-screen').classList.remove('hidden');
    }
  }

  updateInventoryUI(me) {
    const slots = document.querySelectorAll('.inv-slot');
    for (let i = 0; i < INV_SIZE; i++) {
      const slot = slots[i];
      const type = me.inventory[i];
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
      if (type && me.effects[type]) {
        slot.classList.add('active-effect');
      } else {
        slot.classList.remove('active-effect');
      }
    }
    const status = document.getElementById('inv-status');
    const active = Object.keys(me.effects).filter(k => k !== 'bomb');
    if (active.length > 0) {
      status.textContent = active.map(k => `${ITEM_TYPES[k].name} (${Math.ceil(me.effects[k] / 60)}s)`).join(' · ');
    } else {
      status.textContent = '';
    }
  }

  updateLeaderboard(me) {
    const entries = [
      { name: 'You', value: me.value, color: getColor(me.value), isPlayer: true, dead: !me.alive },
    ];
    for (const p of this.state.players) {
      if (p.id === this.myId) continue;
      entries.push({ name: p.name || 'Player', value: p.value, color: '#6bcf6b', isPlayer: false, dead: !p.alive });
    }
    for (const ai of this.state.ais) {
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

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CONFIG.W, CONFIG.H);
    this.renderGrid();
    if (!this.state) return;

    for (const f of this.state.foods) {
      this.renderCube(f.x, f.y, getFoodSize(f.value), f.value, { alpha: 0.85 });
    }

    for (const it of this.state.items) {
      const info = ITEM_TYPES[it.type];
      const dx = it.x - this.camX;
      const dy = it.y - this.camY;
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

    for (const ai of this.state.ais) {
      this.renderTrail(ai, false);
    }
    for (const p of this.state.players) {
      if (p.alive === false) continue;
      this.renderTrail(p, p.id === this.myId);
    }

    for (const ai of this.state.ais) {
      const s = getSize(ai.value) * (1 + (ai.pulse || 0) * 0.25);
      this.renderCube(ai.x, ai.y, s, ai.value, { border: '#ff6b6b', glow: true });
      ctx.save();
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 107, 107, 0.85)';
      ctx.fillText(ai.name, ai.x - this.camX, ai.y - this.camY - s / 2 - 10);
      ctx.restore();
    }

    for (const p of this.state.players) {
      if (p.alive === false) continue;
      const isMe = p.id === this.myId;
      const s = getSize(p.value) * (1 + (p.pulse || 0) * 0.25);
      this.renderCube(p.x, p.y, s, p.value, {
        border: isMe ? '#fff' : '#6bcf6b',
        glow: true,
        glowColor: getColor(p.value),
      });
      ctx.save();
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isMe ? 'rgba(255,255,255,0.9)' : 'rgba(107,207,107,0.9)';
      ctx.fillText(p.name, p.x - this.camX, p.y - this.camY - s / 2 - 10);
      ctx.restore();

      if (isMe && p.effects && p.effects.shield) {
        const dx = p.x - this.camX;
        const dy = p.y - this.camY;
        ctx.save();
        ctx.strokeStyle = 'rgba(52, 152, 219, 0.6)';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#3498db';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(dx, dy, s / 2 + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const p of this.state.particles) {
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
    if (!cube.trail) return;
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
}

const client = new Client(document.getElementById('game-canvas'));

document.getElementById('start-btn').addEventListener('click', () => {
  client.start();
});

document.getElementById('restart-btn').addEventListener('click', () => {
  location.reload();
});

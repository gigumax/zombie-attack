'use strict';

// ─── Config ───
const CONFIG = {
  W: 900,
  H: 600,
  surfaceY: 120,
  rootSpeed: 2.5,
  rootRadius: 4,
  rockCount: 45,
  waterCount: 22,
  rockSize: 16,
  waterSize: 14,
};

// ─── Utility ───
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Game ───
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = CONFIG.W;
    canvas.height = CONFIG.H;
    this.keys = {};
    this.running = false;
    this.gameOver = false;

    window.addEventListener('keydown', e => { this.keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });

    document.getElementById('start-btn').addEventListener('click', () => {
      document.getElementById('start-screen').classList.add('hidden');
      this.start();
    });
    document.getElementById('restart-btn').addEventListener('click', () => {
      document.getElementById('game-over-screen').classList.add('hidden');
      this.start();
    });
  }

  start() {
    this.water = 0;
    this.frameCount = 0;
    this.gameOver = false;
    this.rocks = [];
    this.waters = [];
    this.rootPath = [];
    this.particles = [];
    this.grassBlades = [];
    this.soilDots = [];
    this.clouds = [];

    // Seed position (visible on surface)
    this.seed = {
      x: CONFIG.W / 2,
      y: CONFIG.surfaceY - 4,
      pulse: 0,
    };

    // Root tip starts just below the seed
    this.root = {
      x: this.seed.x,
      y: CONFIG.surfaceY + 10,
      dx: 0, dy: 0,
      angle: Math.PI / 2,
    };

    // Generate grass blades
    for (let i = 0; i < 60; i++) {
      this.grassBlades.push({
        x: rand(0, CONFIG.W),
        h: rand(4, 12),
        lean: rand(-0.3, 0.3),
      });
    }

    // Generate soil texture dots
    for (let i = 0; i < 150; i++) {
      this.soilDots.push({
        x: rand(0, CONFIG.W),
        y: rand(CONFIG.surfaceY + 5, CONFIG.H),
        r: rand(1, 3),
        shade: rand(0.05, 0.2),
      });
    }

    // Generate clouds
    for (let i = 0; i < 5; i++) {
      this.clouds.push({
        x: rand(0, CONFIG.W),
        y: rand(10, 60),
        w: rand(40, 80),
        h: rand(12, 20),
        speed: rand(0.05, 0.15),
      });
    }

    // Generate rocks — irregular shapes
    for (let i = 0; i < CONFIG.rockCount; i++) {
      const r = rand(CONFIG.rockSize * 0.6, CONFIG.rockSize * 1.4);
      const points = [];
      const nPoints = randInt(5, 8);
      for (let j = 0; j < nPoints; j++) {
        const angle = (j / nPoints) * Math.PI * 2;
        const rad = r * rand(0.7, 1.1);
        points.push({ x: Math.cos(angle) * rad, y: Math.sin(angle) * rad });
      }
      this.rocks.push({
        x: rand(30, CONFIG.W - 30),
        y: rand(CONFIG.surfaceY + 40, CONFIG.H - 20),
        r,
        points,
        shade: rand(0.3, 0.7),
      });
    }

    // Generate water pockets
    for (let i = 0; i < CONFIG.waterCount; i++) {
      const depth = rand(CONFIG.surfaceY + 30, CONFIG.H - 20);
      const value = Math.floor((depth - CONFIG.surfaceY) / 80) + 1;
      this.waters.push({
        x: rand(30, CONFIG.W - 30),
        y: depth,
        r: CONFIG.waterSize,
        value,
        pulse: rand(0, Math.PI * 2),
        bubbles: Array.from({ length: 3 }, () => ({
          x: rand(-6, 6), y: rand(-6, 6),
          r: rand(1.5, 3), speed: rand(0.3, 0.8),
        })),
      });
    }

    this.rootPath.push({ x: this.root.x, y: this.root.y });
    this.updateHUD();
    this.running = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.loop();
  }

  // ─── Update ───
  update() {
    if (!this.running || this.gameOver) return;
    this.frameCount++;
    this.updateRoot();
    this.updateParticles();
    this.updateClouds();
    this.checkCollisions();
    this.updateHUD();
  }

  updateRoot() {
    const r = this.root;
    let dx = 0, dy = 0;
    if (this.keys['w'] || this.keys['arrowup']) dy -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) dy += 1;
    if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) dx += 1;
    if (r.y <= CONFIG.surfaceY + 5 && dy < 0) dy = 0;

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx = (dx / len) * CONFIG.rootSpeed;
      dy = (dy / len) * CONFIG.rootSpeed;

      const newX = r.x + dx;
      const newY = r.y + dy;
      let blocked = false;
      for (const rock of this.rocks) {
        if (dist({ x: newX, y: newY }, rock) < rock.r + CONFIG.rootRadius) { blocked = true; break; }
      }
      if (newX < CONFIG.rootRadius || newX > CONFIG.W - CONFIG.rootRadius) blocked = true;
      if (newY < CONFIG.surfaceY + 5 || newY > CONFIG.H - CONFIG.rootRadius) blocked = true;

      if (!blocked) {
        r.x = newX;
        r.y = newY;
        r.angle = Math.atan2(dy, dx);
        const last = this.rootPath[this.rootPath.length - 1];
        if (dist(r, last) > 3) this.rootPath.push({ x: r.x, y: r.y });
      }
    }
  }

  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life -= 0.02;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  updateClouds() {
    for (const c of this.clouds) {
      c.x += c.speed;
      if (c.x - c.w > CONFIG.W) c.x = -c.w;
    }
  }

  checkCollisions() {
    const r = this.root;
    for (let i = this.waters.length - 1; i >= 0; i--) {
      const w = this.waters[i];
      if (dist(r, w) < w.r + CONFIG.rootRadius) {
        this.water += w.value;
        this.createParticles(w.x, w.y, '#3498db', 14);
        this.waters.splice(i, 1);
        const depth = rand(CONFIG.surfaceY + 30, CONFIG.H - 20);
        const value = Math.floor((depth - CONFIG.surfaceY) / 80) + 1;
        this.waters.push({
          x: rand(30, CONFIG.W - 30), y: depth, r: CONFIG.waterSize, value,
          pulse: rand(0, Math.PI * 2),
          bubbles: Array.from({ length: 3 }, () => ({
            x: rand(-6, 6), y: rand(-6, 6), r: rand(1.5, 3), speed: rand(0.3, 0.8),
          })),
        });
      }
    }
  }

  createParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4 - 2,
        life: 1, color,
        size: 2 + Math.random() * 4,
      });
    }
  }

  // ─── Render ───
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CONFIG.W, CONFIG.H);
    this.renderSky();
    this.renderTree();
    this.renderSoil();
    this.renderRocks();
    this.renderWaters();
    this.renderRootPath();
    this.renderSeed();
    this.renderRootTip();
    this.renderParticles();
    this.renderControls();
  }

  renderSky() {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, CONFIG.surfaceY);
    grad.addColorStop(0, '#0c1445');
    grad.addColorStop(0.5, '#1a1a3e');
    grad.addColorStop(1, '#0f1a2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CONFIG.W, CONFIG.surfaceY);

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 89 + 31) % CONFIG.W;
      const y = (i * 53 + 11) % CONFIG.surfaceY;
      const size = (i % 3 === 0) ? 2 : 1;
      ctx.fillRect(x, y, size, size);
    }

    // Clouds
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (const c of this.clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.w, c.h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderTree() {
    const ctx = this.ctx;
    const baseX = this.seed.x;
    const baseY = CONFIG.surfaceY;
    const height = Math.min(this.water * 2, CONFIG.surfaceY - 15);

    if (height < 8) return;

    // Shadow at base
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(baseX, baseY - 2, 20 + height * 0.1, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Trunk with slight curve
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = Math.max(5, height * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    const midY = baseY - height * 0.5;
    const lean = Math.sin(height * 0.02) * 8;
    ctx.quadraticCurveTo(baseX + lean * 0.5, midY, baseX + lean, baseY - height);
    ctx.stroke();

    // Bark texture lines
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 3;
      ctx.beginPath();
      ctx.moveTo(baseX + off, baseY - 5);
      ctx.quadraticCurveTo(baseX + off + lean * 0.4, midY, baseX + off + lean * 0.8, baseY - height + 5);
      ctx.stroke();
    }

    // Branches
    const branchCount = Math.max(1, Math.floor(height / 22));
    for (let i = 0; i < branchCount; i++) {
      const frac = (i + 1) / (branchCount + 1);
      const y = baseY - height * frac;
      const side = i % 2 === 0 ? 1 : -1;
      const bLen = 12 + height * frac * 0.18;
      const angle = 0.3 + frac * 0.3;

      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = Math.max(2, height * 0.04 * (1 - frac * 0.5));
      ctx.beginPath();
      ctx.moveTo(baseX + lean * frac * 0.5, y);
      ctx.quadraticCurveTo(
        baseX + side * bLen * 0.6, y - bLen * angle * 0.5,
        baseX + side * bLen, y - bLen * angle
      );
      ctx.stroke();

      // Leaves cluster at branch end
      const leafX = baseX + side * bLen;
      const leafY = y - bLen * angle;
      const leafR = 8 + height * frac * 0.06;
      ctx.fillStyle = `rgba(39, 174, 96, ${0.7 + frac * 0.2})`;
      ctx.beginPath();
      ctx.arc(leafX, leafY, leafR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(46, 204, 113, ${0.5 + frac * 0.2})`;
      ctx.beginPath();
      ctx.arc(leafX - leafR * 0.3, leafY - leafR * 0.3, leafR * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Canopy
    if (height > 15) {
      const canopyR = 10 + height * 0.08;
      ctx.fillStyle = 'rgba(39, 174, 96, 0.85)';
      ctx.beginPath();
      ctx.arc(baseX + lean, baseY - height, canopyR, 0, Math.PI * 2);
      ctx.fill();
      // Highlight
      ctx.fillStyle = 'rgba(46, 204, 113, 0.4)';
      ctx.beginPath();
      ctx.arc(baseX + lean - canopyR * 0.25, baseY - height - canopyR * 0.25, canopyR * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderSoil() {
    const ctx = this.ctx;

    // Soil gradient — darker with depth
    const grad = ctx.createLinearGradient(0, CONFIG.surfaceY, 0, CONFIG.H);
    grad.addColorStop(0, '#4a3728');
    grad.addColorStop(0.15, '#3d2b1f');
    grad.addColorStop(0.5, '#2d1f15');
    grad.addColorStop(1, '#1a110a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, CONFIG.surfaceY, CONFIG.W, CONFIG.H - CONFIG.surfaceY);

    // Soil dots (texture)
    for (const d of this.soilDots) {
      ctx.fillStyle = `rgba(0,0,0,${d.shade})`;
      ctx.fillRect(d.x, d.y, d.r, d.r);
    }

    // Light dots (minerals)
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 67 + 23) % CONFIG.W;
      const y = CONFIG.surfaceY + ((i * 41 + 17) % (CONFIG.H - CONFIG.surfaceY));
      ctx.fillRect(x, y, 1, 1);
    }

    // Surface grass
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(0, CONFIG.surfaceY - 3, CONFIG.W, 4);
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(0, CONFIG.surfaceY - 2, CONFIG.W, 2);

    // Grass blades
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 1.5;
    for (const g of this.grassBlades) {
      const sway = Math.sin(this.frameCount * 0.02 + g.x * 0.01) * 1.5;
      ctx.beginPath();
      ctx.moveTo(g.x, CONFIG.surfaceY - 3);
      ctx.quadraticCurveTo(g.x + g.lean * 3 + sway, CONFIG.surfaceY - g.h * 0.6, g.x + g.lean * 5 + sway * 1.5, CONFIG.surfaceY - g.h);
      ctx.stroke();
    }
  }

  renderRocks() {
    const ctx = this.ctx;
    for (const rock of this.rocks) {
      // Rock body
      ctx.fillStyle = `hsl(230, 10%, ${25 + rock.shade * 20}%)`;
      ctx.beginPath();
      rock.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(rock.x + p.x, rock.y + p.y);
        else ctx.lineTo(rock.x + p.x, rock.y + p.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `hsl(230, 10%, ${15 + rock.shade * 15}%)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.arc(rock.x - rock.r * 0.3, rock.y - rock.r * 0.3, rock.r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      // Crack lines
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rock.x - rock.r * 0.4, rock.y + rock.r * 0.1);
      ctx.lineTo(rock.x + rock.r * 0.3, rock.y - rock.r * 0.2);
      ctx.stroke();
    }
  }

  renderWaters() {
    const ctx = this.ctx;
    for (const w of this.waters) {
      w.pulse += 0.04;
      const pulse = Math.sin(w.pulse);
      const size = w.r + pulse * 1.5;

      // Outer glow
      ctx.save();
      ctx.shadowColor = '#3498db';
      ctx.shadowBlur = 15 + pulse * 5;
      ctx.fillStyle = 'rgba(52, 152, 219, 0.5)';
      ctx.beginPath();
      ctx.arc(w.x, w.y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Water body
      ctx.fillStyle = 'rgba(52, 152, 219, 0.7)';
      ctx.beginPath();
      ctx.arc(w.x, w.y, size * 0.8, 0, Math.PI * 2);
      ctx.fill();

      // Inner bright
      ctx.fillStyle = 'rgba(135, 206, 250, 0.5)';
      ctx.beginPath();
      ctx.arc(w.x, w.y, size * 0.45, 0, Math.PI * 2);
      ctx.fill();

      // Bubbles
      for (const b of w.bubbles) {
        b.y -= b.speed * 0.02;
        if (b.y < -8) b.y = rand(4, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(w.x + b.x, w.y + b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Value
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '700 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(w.value, w.x, w.y + size + 8);
    }
  }

  renderRootPath() {
    const ctx = this.ctx;
    if (this.rootPath.length < 2) return;

    // Outer root (thick, dark)
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = CONFIG.rootRadius * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.rootPath[0].x, this.rootPath[0].y);
    for (let i = 1; i < this.rootPath.length; i++) {
      ctx.lineTo(this.rootPath[i].x, this.rootPath[i].y);
    }
    ctx.stroke();

    // Inner root (lighter, organic)
    ctx.strokeStyle = '#8d6e63';
    ctx.lineWidth = CONFIG.rootRadius * 1.2;
    ctx.beginPath();
    ctx.moveTo(this.rootPath[0].x, this.rootPath[0].y);
    for (let i = 1; i < this.rootPath.length; i++) {
      ctx.lineTo(this.rootPath[i].x, this.rootPath[i].y);
    }
    ctx.stroke();

    // Root hairs (small branches)
    ctx.strokeStyle = 'rgba(141, 110, 99, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 5; i < this.rootPath.length - 2; i += 8) {
      const p = this.rootPath[i];
      const angle = (i * 0.7) % (Math.PI * 2);
      const len = 4 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(angle) * len, p.y + Math.sin(angle) * len);
      ctx.stroke();
    }
  }

  renderSeed() {
    const ctx = this.ctx;
    const s = this.seed;
    s.pulse += 0.03;

    // Only show seed if tree hasn't grown much
    if (this.water > 5) return;

    const glow = Math.sin(s.pulse) * 0.5 + 0.5;

    // Seed glow
    ctx.save();
    ctx.shadowColor = '#f39c12';
    ctx.shadowBlur = 8 + glow * 6;
    ctx.fillStyle = `rgba(243, 156, 18, ${0.8 + glow * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Seed body
    ctx.fillStyle = '#e67e22';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, 5, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Seed crack line
    ctx.strokeStyle = '#d35400';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 7);
    ctx.lineTo(s.x, s.y + 5);
    ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Your seed', s.x, s.y - 16);
  }

  renderRootTip() {
    const ctx = this.ctx;
    const r = this.root;

    // Organic root tip — tapered with direction
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.angle + Math.PI / 2);

    // Glow
    ctx.shadowColor = '#f39c12';
    ctx.shadowBlur = 10;

    // Tip shape (like a root cap)
    ctx.fillStyle = '#f39c12';
    ctx.beginPath();
    ctx.moveTo(0, -CONFIG.rootRadius * 1.5);
    ctx.quadraticCurveTo(CONFIG.rootRadius, -CONFIG.rootRadius * 0.5, CONFIG.rootRadius * 0.8, CONFIG.rootRadius);
    ctx.quadraticCurveTo(0, CONFIG.rootRadius * 1.3, -CONFIG.rootRadius * 0.8, CONFIG.rootRadius);
    ctx.quadraticCurveTo(-CONFIG.rootRadius, -CONFIG.rootRadius * 0.5, 0, -CONFIG.rootRadius * 1.5);
    ctx.fill();
    ctx.restore();

    // Core highlight
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(r.x, r.y - CONFIG.rootRadius * 0.3, CONFIG.rootRadius * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  renderParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  renderControls() {
    const ctx = this.ctx;
    if (this.water > 0 && this.frameCount > 300) return; // fade after 5 seconds

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'center';

    if (this.water === 0) {
      ctx.fillText('Use WASD or arrow keys to grow your root', CONFIG.W / 2, CONFIG.H - 20);
      ctx.fillText('Find water pockets underground to grow your tree', CONFIG.W / 2, CONFIG.H - 40);
    }
    ctx.restore();
  }

  // ─── HUD ───
  updateHUD() {
    document.getElementById('hud-water').textContent = this.water;
    const depth = Math.max(0, Math.floor((this.root.y - CONFIG.surfaceY) / 10));
    document.getElementById('hud-depth').textContent = depth + 'm';
    const height = Math.floor(this.water * 2 / 10);
    document.getElementById('hud-height').textContent = height + 'm';
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


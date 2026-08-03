'use strict';

const CONFIG = {
  roomSize: 36,
  wallHeight: 14,
  playerSpeed: 8,
  sprintSpeed: 12,
  playerHeight: 1.7,
  playerWidth: 0.4,
  gravity: 28,
  jumpSpeed: 12,
  lavaMaxHeight: 8,
  lavaDamage: 25,            // per second (slower death)
  playerHealth: 100,
  aiCount: 4,
  aiSpeed: 5,
  aiJumpChance: 0.02,
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

class LavaGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a1a1a);
    this.scene.fog = new THREE.Fog(0x2a1a1a, 35, 90);

    this.camera = new THREE.PerspectiveCamera(100, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.rotation.order = 'YXZ';

    this.keys = {};
    this.yaw = 0;
    this.pitch = 0;
    this.running = false;
    this.gameOver = false;
    this.clock = new THREE.Clock();

    this.setupLights();
    this.setupRoom();
    this.setupInput();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.getElementById('restart-btn').addEventListener('click', () => {
      document.getElementById('game-over-screen').classList.add('hidden');
      this.start();
    });

    // Auto-start — no button press needed
    document.getElementById('start-screen').classList.add('hidden');
    this.start();
    this.animate();
  }

  setupLights() {
    this.ambient = new THREE.AmbientLight(0xff8844, 0.3);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffaa66, 0.6);
    this.sun.position.set(10, 20, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -20;
    this.sun.shadow.camera.right = 20;
    this.sun.shadow.camera.top = 20;
    this.sun.shadow.camera.bottom = -20;
    this.scene.add(this.sun);
    // Lava glow light
    this.lavaLight = new THREE.PointLight(0xff4400, 0, 30);
    this.lavaLight.position.set(0, 0, 0);
    this.scene.add(this.lavaLight);
  }

  setupRoom() {
    const half = CONFIG.roomSize / 2;

    // Floor (will be covered by lava)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(CONFIG.roomSize, CONFIG.roomSize),
      new THREE.MeshLambertMaterial({ color: 0x3a2a2a })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Walls
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x5a4a4a });
    const wallGeo = new THREE.PlaneGeometry(CONFIG.roomSize, CONFIG.wallHeight);
    const walls = [
      { pos: [0, CONFIG.wallHeight/2, -half], rot: [0, 0, 0] },
      { pos: [0, CONFIG.wallHeight/2, half], rot: [0, Math.PI, 0] },
      { pos: [-half, CONFIG.wallHeight/2, 0], rot: [0, Math.PI/2, 0] },
      { pos: [half, CONFIG.wallHeight/2, 0], rot: [0, -Math.PI/2, 0] },
    ];
    for (const w of walls) {
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(...w.pos);
      wall.rotation.set(...w.rot);
      wall.receiveShadow = true;
      this.scene.add(wall);
    }

    // Lava plane (starts below floor, rises over time)
    const lavaGeo = new THREE.PlaneGeometry(CONFIG.roomSize, CONFIG.roomSize);
    this.lavaMat = new THREE.MeshBasicMaterial({
      color: 0xff3300,
      transparent: true,
      opacity: 0.85,
    });
    this.lava = new THREE.Mesh(lavaGeo, this.lavaMat);
    this.lava.rotation.x = -Math.PI / 2;
    this.lava.position.y = -1;
    this.scene.add(this.lava);

    // Lava bubbles (particle effect)
    this.lavaBubbles = [];
    for (let i = 0; i < 30; i++) {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(0.15 + Math.random() * 0.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.6 })
      );
      bubble.position.set(
        (Math.random() - 0.5) * CONFIG.roomSize,
        -1,
        (Math.random() - 0.5) * CONFIG.roomSize
      );
      bubble.userData = { vy: 0.5 + Math.random(), life: Math.random() * 3 };
      this.scene.add(bubble);
      this.lavaBubbles.push(bubble);
    }

    // Furniture — platforms to jump on
    this.platforms = [];
    this.furniture = [];
    this.generateFurniture();

    // AI bots — must be after furniture is generated
    this.ais = [];
    this.spawnAIs();
  }

  generateFurniture() {
    const half = CONFIG.roomSize / 2;

    // Couch (long, low)
    this.addPlatform(0, 0, -8, 4, 0.8, 1.5, 0x8B4513, 'couch');
    // Coffee table (square, medium height)
    this.addPlatform(0, 0, -3, 2, 1.2, 2, 0x6d4c41, 'table');
    // Dining table (big, taller)
    this.addPlatform(-7, 0, 2, 3, 1.5, 3, 0x8B4513, 'dining');
    // Chair 1
    this.addPlatform(-4, 0, 5, 0.8, 1.0, 0.8, 0x6d4c41, 'chair1');
    // Chair 2
    this.addPlatform(-10, 0, 5, 0.8, 1.0, 0.8, 0x6d4c41, 'chair2');
    // Bookshelf (tall, thin)
    this.addPlatform(6, 0, -6, 1.5, 2.5, 0.8, 0x5d4037, 'shelf');
    // Bed (wide, low)
    this.addPlatform(8, 0, 2, 3, 0.7, 4, 0x4a6fa5, 'bed');
    // TV stand
    this.addPlatform(6, 0, 8, 2, 1.0, 1.5, 0x37474f, 'tv');
    // Fridge (tall)
    this.addPlatform(-10, 0, -6, 1.5, 2.0, 1.5, 0xe0e0e0, 'fridge');
    // Stool
    this.addPlatform(3, 0, 6, 0.6, 0.6, 0.6, 0x8d6e63, 'stool');
    // Side table
    this.addPlatform(-3, 0, -8, 1.2, 0.9, 1.2, 0x6d4c41, 'side');
    // Cabinet (tall)
    this.addPlatform(11, 0, -3, 1.5, 2.2, 1.0, 0x4e342e, 'cabinet');
    // Small rug platform (very low)
    this.addPlatform(0, 0, 8, 2.5, 0.15, 2.5, 0x7e57c2, 'rug');
    // Counter
    this.addPlatform(-12, 0, 0, 2, 1.3, 1.5, 0x9e9e9e, 'counter');
    // Toy box
    this.addPlatform(12, 0, 6, 1.2, 0.8, 1.2, 0xf44336, 'toybox');
  }

  addPlatform(x, y, z, w, h, d, color, name) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { name, topY: y + h, w, h, d };
    this.scene.add(mesh);
    this.platforms.push(mesh);
    this.furniture.push({ mesh, x, z, w, h, d, topY: y + h });
  }

  spawnAIs() {
    const colors = [0x42a5f5, 0x66bb6a, 0xab47bc, 0xffca28, 0xef5350];
    const names = ['Blue', 'Green', 'Purple', 'Yellow', 'Red'];
    for (let i = 0; i < CONFIG.aiCount; i++) {
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: colors[i] });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.4), bodyMat);
      body.position.y = 0.6; body.castShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), bodyMat);
      head.position.y = 1.5; head.castShadow = true; g.add(head);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), eyeMat);
      e1.position.set(-0.12, 1.55, 0.25); g.add(e1);
      const e2 = e1.clone(); e2.position.x = 0.12; g.add(e2);
      // Pick a random furniture to start on
      const f = this.furniture[Math.floor(Math.random() * this.furniture.length)];
      g.position.set(f.x + (Math.random()-0.5)*f.w*0.5, f.topY, f.z + (Math.random()-0.5)*f.d*0.5);
      this.scene.add(g);
      this.ais.push({
        mesh: g, name: names[i], color: colors[i],
        x: g.position.x, y: g.position.y, z: g.position.z,
        velY: 0, onGround: true, alive: true,
        targetX: g.position.x, targetZ: g.position.z,
        retargetTimer: 0, hitFlash: 0,
      });
    }
  }

  updateAIs(dt) {
    for (const ai of this.ais) {
      if (!ai.alive) continue;
      // Retarget periodically
      ai.retargetTimer -= dt;
      if (ai.retargetTimer <= 0) {
        ai.retargetTimer = 1 + Math.random() * 2;
        // Pick a furniture piece that's above current lava level
        const safe = this.furniture.filter(f => f.topY > this.lavaY + 0.5);
        if (safe.length > 0) {
 const f = safe[Math.floor(Math.random() * safe.length)];
          ai.targetX = f.x + (Math.random()-0.5)*f.w*0.6;
          ai.targetZ = f.z + (Math.random()-0.5)*f.d*0.6;
        }
      }

      // Move toward target
      const dx = ai.targetX - ai.x, dz = ai.targetZ - ai.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        ai.x += (dx / d) * CONFIG.aiSpeed * dt;
        ai.z += (dz / d) * CONFIG.aiSpeed * dt;
        ai.mesh.rotation.y = Math.atan2(dx, dz);
      }

      // Jump if lava is close or randomly
      const platTop = this.getPlatformTop(ai.x, ai.z);
      const onPlat = platTop !== -Infinity && Math.abs(ai.y - platTop) < 0.15;
      const onFloor = ai.y <= 0.01;
      if ((onFloor && this.lavaY > -0.2) || (onPlat && Math.random() < CONFIG.aiJumpChance && this.lavaY > platTop - 1.5)) {
        // Jump toward higher platform
        const higher = this.furniture.filter(f => f.topY > ai.y + 0.3);
        if (higher.length > 0) {
          const f = higher[Math.floor(Math.random() * higher.length)];
          ai.targetX = f.x + (Math.random()-0.5)*f.w*0.6;
          ai.targetZ = f.z + (Math.random()-0.5)*f.d*0.6;
        }
        ai.velY = CONFIG.jumpSpeed;
        ai.onGround = false;
      }

      // Gravity
      ai.velY -= CONFIG.gravity * dt;
      ai.y += ai.velY * dt;
      const aiPlatTop = this.getPlatformTop(ai.x, ai.z);
      if (ai.velY <= 0) {
        if (aiPlatTop !== -Infinity && ai.y <= aiPlatTop + 0.05 && ai.y > aiPlatTop - 0.5) {
          ai.y = aiPlatTop; ai.velY = 0; ai.onGround = true;
        } else if (ai.y <= 0) {
          ai.y = 0; ai.velY = 0; ai.onGround = true;
        } else {
          ai.onGround = false;
        }
      } else {
        ai.onGround = false;
      }

      // Lava damage
      if (ai.y < this.lavaY + 0.3) {
        ai.hitFlash = 1;
        // AI dies in lava after a bit
        if (ai.y < this.lavaY) {
          ai.alive = false;
          this.scene.remove(ai.mesh);
          this.showMessage(`${ai.name} burned!`);
        }
      }
      if (ai.hitFlash > 0) {
        ai.hitFlash -= dt * 3;
        ai.mesh.traverse(c => { if (c.material && c.material.emissive) c.material.emissive.setRGB(ai.hitFlash, 0, 0); });
      }

      // Clamp to room
      const half = CONFIG.roomSize / 2 - 0.5;
      ai.x = clamp(ai.x, -half, half);
      ai.z = clamp(ai.z, -half, half);
      ai.mesh.position.set(ai.x, ai.y, ai.z);
    }
  }

  setupInput() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this.keys[e.key.toLowerCase()] = false;
    });
  }

  start() {
    this.gameOver = false;
    this.health = CONFIG.playerHealth;
    this.velY = 0;
    this.onGround = false;
    this.surviveTime = 0;
    this.lavaY = 0;
    this.lavaLevel = 0;
    this.player = { x: 0, y: 0.8, z: -3 };
    this.yaw = 0;

    // Create player mesh if not exists
    if (!this.playerMesh) {
      this.playerMesh = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff9800 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.4), bodyMat);
      body.position.y = 0.6; body.castShadow = true; this.playerMesh.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), bodyMat);
      head.position.y = 1.5; head.castShadow = true; this.playerMesh.add(head);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), eyeMat);
      e1.position.set(-0.12, 1.55, 0.25); this.playerMesh.add(e1);
      const e2 = e1.clone(); e2.position.x = 0.12; this.playerMesh.add(e2);
      this.scene.add(this.playerMesh);
    }

    document.getElementById('hud').style.display = 'flex';
    document.getElementById('danger-overlay').classList.remove('danger');

    // Reset AIs
    for (const ai of this.ais) this.scene.remove(ai.mesh);
    this.ais = [];
    this.spawnAIs();

    this.running = true;
    this.clock.start();
  }

  // ─── Collision ───
  getPlatformTop(x, z) {
    let highest = -Infinity;
    for (const f of this.furniture) {
      const halfW = f.w / 2, halfD = f.d / 2;
      if (x >= f.x - halfW && x <= f.x + halfW &&
          z >= f.z - halfD && z <= f.z + halfD) {
        if (f.topY > highest) highest = f.topY;
      }
    }
    return highest;
  }

  isOnPlatform(x, y, z) {
    // Check if player is standing on top of a platform
    const top = this.getPlatformTop(x, z);
    if (top === -Infinity) return false;
    return Math.abs(y - top) < 0.15;
  }

  checkWallCollision(x, z) {
    const half = CONFIG.roomSize / 2 - CONFIG.playerWidth;
    return {
      x: clamp(x, -half, half),
      z: clamp(z, -half, half),
    };
  }

  // ─── Update ───
  update(dt) {
    this.surviveTime += dt;

    // Rise lava — slower start, ramps up gradually
    const t = this.surviveTime;
    this.lavaLevel = Math.min(1, (t < 10 ? t * 0.02 : 0.2 + (t - 10) * 0.013));
    this.lavaY = this.lavaLevel * CONFIG.lavaMaxHeight;
    this.lava.position.y = this.lavaY;
    this.lavaLight.position.y = this.lavaY + 1;
    this.lavaLight.intensity = 1 + this.lavaLevel * 3;

    // Update lava bubbles
    for (const b of this.lavaBubbles) {
      b.userData.life += dt;
      b.position.y = this.lavaY + Math.sin(b.userData.life * 2) * 0.3 + 0.2;
      b.position.x += Math.sin(b.userData.life * 1.5) * dt * 0.5;
      b.position.z += Math.cos(b.userData.life * 1.3) * dt * 0.5;
      b.material.opacity = 0.4 + Math.sin(b.userData.life * 3) * 0.3;
    }

    // Movement — WASD for strafing, arrow keys for turning + forward/back
    let mx = 0, mz = 0;
    if (this.keys['w']) mz -= 1;
    if (this.keys['s']) mz += 1;
    if (this.keys['a']) mx -= 1;
    if (this.keys['d']) mx += 1;
    // Arrow keys: up = forward, down = backward, left/right = rotate
    if (this.keys['arrowup']) mz -= 1;
    if (this.keys['arrowdown']) mz += 1;
    if (this.keys['arrowleft']) this.yaw += 2.5 * dt;
    if (this.keys['arrowright']) this.yaw -= 2.5 * dt;
    const sprinting = this.keys['shift'];
    const speed = sprinting ? CONFIG.sprintSpeed : CONFIG.playerSpeed;
    if (mx || mz) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = -sin * (-mz) + cos * mx;
      const wz = -cos * (-mz) - sin * mx;
      this.player.x += wx * speed * dt;
      this.player.z += wz * speed * dt;
    }

    // Wall collision
    const clamped = this.checkWallCollision(this.player.x, this.player.z);
    this.player.x = clamped.x;
    this.player.z = clamped.z;

    // Jump / gravity
    if (this.keys[' '] && this.onGround) {
      this.velY = CONFIG.jumpSpeed;
      this.onGround = false;
    }
    this.velY -= CONFIG.gravity * dt;
    this.player.y += this.velY * dt;

    // Check platform landing
    const platTop = this.getPlatformTop(this.player.x, this.player.z);
    if (this.velY <= 0) {
      if (platTop !== -Infinity && this.player.y <= platTop + 0.05 && this.player.y > platTop - 0.5) {
        this.player.y = platTop;
        this.velY = 0;
        this.onGround = true;
      } else if (this.player.y <= 0) {
        // On floor
        this.player.y = 0;
        this.velY = 0;
        this.onGround = true;
      } else {
        this.onGround = false;
      }
    } else {
      this.onGround = false;
    }

    // Update AIs
    this.updateAIs(dt);

    // Lava damage
    if (this.player.y < this.lavaY + 0.3) {
      this.health -= CONFIG.lavaDamage * dt;
      document.getElementById('danger-overlay').classList.add('danger');
    } else {
      document.getElementById('danger-overlay').classList.remove('danger');
    }

    // Update player mesh
    this.playerMesh.position.set(this.player.x, this.player.y, this.player.z);
    this.playerMesh.rotation.y = this.yaw;

    // Third-person camera — behind and above player
    const camDist = 8;
 const camHeight = 6;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Camera sits behind player (opposite of forward direction)
    const camX = this.player.x + sin * camDist;
    const camZ = this.player.z + cos * camDist;
    const camY = this.player.y + camHeight;
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.player.x, this.player.y + 1, this.player.z);

    // HUD
    document.getElementById('timer').textContent = this.surviveTime.toFixed(1) + 's';
    document.getElementById('lava-level').textContent = Math.floor(this.lavaLevel * 100) + '%';
    document.getElementById('ai-count').textContent = this.ais.filter(a => a.alive).length;

    if (this.health <= 0) this.endGame();
  }

  endGame() {
    this.gameOver = true;
    this.running = false;
    document.getElementById('final-score').textContent = `Survived ${this.surviveTime.toFixed(1)}s`;
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('hud').style.display = 'none';
    document.getElementById('danger-overlay').classList.remove('danger');
  }

  showMessage(msg) {
    const el = document.getElementById('message');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (!this.running) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.gameOver) this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

new LavaGame();

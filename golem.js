'use strict';

// ─── Config ───
const CONFIG = {
  worldSize: 120,
  golemSpeed: 7,
  zombieSpeed: 2.2,
  zombieHealth: 2,
  golemHealth: 100,
  golemDamage: 1,
  punchRange: 4.5,
  punchCooldown: 0.45,
  houseCount: 5,
  villagerCount: 6,
};

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 50, 140);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);

    this.keys = {};
    this.mouseDown = false;
    this.yaw = 0;
    this.pitch = -0.3;
    this.running = false;
    this.gameOver = false;
    this.clock = new THREE.Clock();

    this.setupLights();
    this.setupWorld();
    this.setupInput();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.getElementById('start-btn').addEventListener('click', () => {
      document.getElementById('start-screen').classList.add('hidden');
      this.start();
      this.canvas.requestPointerLock();
    });
    document.getElementById('restart-btn').addEventListener('click', () => {
      document.getElementById('game-over-screen').classList.add('hidden');
      this.start();
      this.canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.running && !this.gameOver) {
        // keep running; user can click to re-lock
      }
    });
    this.canvas.addEventListener('click', () => {
      if (this.running && !this.gameOver && !document.pointerLockElement) {
        this.canvas.requestPointerLock();
      }
    });
  }

  setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.0);
    sun.position.set(40, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    this.scene.add(sun);
  }

  setupWorld() {
    // Ground — grass with slight color variation via vertex colors
    const groundGeo = new THREE.PlaneGeometry(CONFIG.worldSize, CONFIG.worldSize, 32, 32);
    groundGeo.rotateX(-Math.PI / 2);
    const colors = [];
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const g = 0.45 + Math.random() * 0.12;
      colors.push(0.22, g, 0.15);
    }
    groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Scattered trees around the edges
    this.trees = [];
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 35 + Math.random() * 20;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      this.scene.add(this.makeTree(x, z));
    }

    // Village houses arranged in a rough circle
    this.houses = [];
    for (let i = 0; i < CONFIG.houseCount; i++) {
      const angle = (i / CONFIG.houseCount) * Math.PI * 2 + 0.4;
      const r = 10 + Math.random() * 6;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const house = this.makeHouse(x, z);
      house.rotation.y = angle + Math.PI / 2;
      this.scene.add(house);
      this.houses.push(house);
    }
  }

  makeTree(x, z) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 4, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x6d4c41 })
    );
    trunk.position.y = 2;
    trunk.castShadow = true;
    g.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 3.4, 3.4),
      new THREE.MeshLambertMaterial({ color: 0x2e7d32 })
    );
    leaves.position.y = 5.2;
    leaves.castShadow = true;
    g.add(leaves);
    const leaves2 = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.6, 2.2),
      new THREE.MeshLambertMaterial({ color: 0x388e3c })
    );
    leaves2.position.y = 7;
    leaves2.castShadow = true;
    g.add(leaves2);
    g.position.set(x, 0, z);
    return g;
  }

  makeHouse(x, z) {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(5, 3, 4.5),
      new THREE.MeshLambertMaterial({ color: 0xd7ccc8 })
    );
    walls.position.y = 1.5;
    walls.castShadow = true;
    walls.receiveShadow = true;
    g.add(walls);

    // Roof — pyramid-ish with a rotated box
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(4, 2.2, 4),
      new THREE.MeshLambertMaterial({ color: 0x8d4a2b })
    );
    roof.position.y = 4.1;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);

    // Door
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 0.15),
      new THREE.MeshLambertMaterial({ color: 0x5d4037 })
    );
    door.position.set(0, 1, 2.3);
    g.add(door);

    // Windows
    const winMat = new THREE.MeshLambertMaterial({ color: 0x90caf9 });
    const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.15), winMat);
    win1.position.set(-1.4, 1.8, 2.3);
    g.add(win1);
    const win2 = win1.clone();
    win2.position.set(1.4, 1.8, 2.3);
    g.add(win2);

    g.position.set(x, 0, z);
    return g;
  }

  // ─── Character builders ───
  makeGolem() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xcfd8dc });
    const vine = new THREE.MeshLambertMaterial({ color: 0x66bb6a });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 1), mat);
    body.position.y = 2.4;
    body.castShadow = true;
    g.add(body);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    head.position.y = 4;
    head.castShadow = true;
    g.add(head);

    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5252 });
    const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.05), eyeMat);
    e1.position.set(-0.2, 4.05, 0.51);
    g.add(e1);
    const e2 = e1.clone();
    e2.position.x = 0.2;
    g.add(e2);

    // Nose — big iron golem nose sticking out
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, 0.4),
      new THREE.MeshLambertMaterial({ color: 0xb0bec5 })
    );
    nose.position.set(0, 3.85, 0.55);
    nose.castShadow = true;
    g.add(nose);

    // Arms (pivot groups so we can swing)
    this.armL = new THREE.Group();
    this.armL.position.set(-1.2, 3.3, 0);
    const armMeshL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, 0.6), mat);
    armMeshL.position.y = -1.2;
    armMeshL.castShadow = true;
    this.armL.add(armMeshL);
    g.add(this.armL);

    this.armR = new THREE.Group();
    this.armR.position.set(1.2, 3.3, 0);
    const armMeshR = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, 0.6), mat);
    armMeshR.position.y = -1.2;
    armMeshR.castShadow = true;
    this.armR.add(armMeshR);
    g.add(this.armR);

    // Legs
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.7), mat);
    legL.position.set(-0.45, 0.7, 0);
    legL.castShadow = true;
    g.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.45;
    g.add(legR);

    // Vine markings
    const v1 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 1.02), vine);
    v1.position.set(-0.5, 2.6, 0);
    g.add(v1);
    const v2 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.8, 1.02), vine);
    v2.position.set(0.6, 2.2, 0);
    g.add(v2);

    return g;
  }

  makeVillager() {
    const g = new THREE.Group();
    const robe = new THREE.MeshLambertMaterial({ color: [0x8d6e63, 0x795548, 0xa1887f][Math.floor(Math.random() * 3)] });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.6), robe);
    body.position.y = 1.3;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.7),
      new THREE.MeshLambertMaterial({ color: 0xd7a37a })
    );
    head.position.y = 2.4;
    head.castShadow = true;
    g.add(head);
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.3, 0.25),
      new THREE.MeshLambertMaterial({ color: 0xc98d63 })
    );
    nose.position.set(0, 2.35, 0.45);
    g.add(nose);
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.5, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x4e342e })
    );
    legs.position.y = 0.25;
    g.add(legs);
    return g;
  }

  makeZombie() {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0x558b2f });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.5), skin);
    body.position.y = 1.4;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), skin);
    head.position.y = 2.4;
    head.castShadow = true;
    g.add(head);
    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.05), eyeMat);
    e1.position.set(-0.15, 2.45, 0.36);
    g.add(e1);
    const e2 = e1.clone();
    e2.position.x = 0.15;
    g.add(e2);
    // Arms forward
    const armMat = skin;
    const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1), armMat);
    a1.position.set(-0.6, 1.9, 0.5);
    g.add(a1);
    const a2 = a1.clone();
    a2.position.x = 0.6;
    g.add(a2);
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.9, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x37474f })
    );
    legs.position.y = 0.45;
    g.add(legs);
    return g;
  }

  // ─── Input ───
  setupInput() {
    window.addEventListener('keydown', e => { this.keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    document.addEventListener('mousemove', e => {
      if (!document.pointerLockElement) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.2, Math.min(0.3, this.pitch - e.movementY * 0.0022));
    });
    document.addEventListener('mousedown', e => {
      if (e.button === 0 && document.pointerLockElement && this.running && !this.gameOver) {
        this.tryPunch();
      }
    });
    // Shift to attack
    window.addEventListener('keydown', e => {
      if (e.key === 'Shift' && this.running && !this.gameOver) {
        this.tryPunch();
      }
    });
  }

  // ─── Game flow ───
  start() {
    // Clean up previous run
    if (this.golem) this.scene.remove(this.golem);
    for (const z of this.zombies || []) this.scene.remove(z.mesh);
    for (const v of this.villagers || []) this.scene.remove(v.mesh);

    this.gameOver = false;
    this.kills = 0;
    this.wave = 0;
    this.waveCooldown = 2;
    this.zombies = [];
    this.villagers = [];
    this.health = CONFIG.golemHealth;
    this.punchTimer = 0;
    this.punchAnim = 0;
    this.velY = 0;
    this.grounded = true;
    this.hurtFlash = 0;

    // Golem (hidden in FPV, used for position/collision)
    this.golem = this.makeGolem();
    this.golem.position.set(0, 0, 0);
    this.golem.visible = false;
    this.scene.add(this.golem);

    // FPV viewmodel arms — attached to camera so they stay in view
    if (this.fpvArms) this.camera.remove(this.fpvArms);
    this.fpvArms = new THREE.Group();
    const armMat = new THREE.MeshLambertMaterial({ color: 0xcfd8dc });
    // Right arm (visible when punching)
    this.fpvArmR = new THREE.Group();
    const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), armMat);
    armRMesh.position.set(0, -0.9, 0);
    this.fpvArmR.add(armRMesh);
    this.fpvArmR.position.set(0.5, -0.8, -1.2);
    this.fpvArmR.rotation.x = -0.3;
    this.fpvArms.add(this.fpvArmR);
    // Left arm (subtle)
    this.fpvArmL = new THREE.Group();
    const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), armMat);
    armLMesh.position.set(0, -0.9, 0);
    this.fpvArmL.add(armLMesh);
    this.fpvArmL.position.set(-0.5, -0.7, -1.0);
    this.fpvArmL.rotation.x = -0.2;
    this.fpvArms.add(this.fpvArmL);
    this.camera.add(this.fpvArms);
    this.scene.add(this.camera);

    // Villagers near village center
    for (let i = 0; i < CONFIG.villagerCount; i++) {
      const mesh = this.makeVillager();
      const angle = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 10;
      mesh.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      this.scene.add(mesh);
      this.villagers.push({
        mesh,
        wanderT: 0, wdx: 0, wdz: 0,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }

    document.getElementById('hud').style.display = 'flex';
    document.getElementById('health-bar').style.display = 'block';
    document.getElementById('crosshair').style.display = 'block';
    this.updateHUD();
    this.running = true;
    this.clock.start();
    this.loop();
  }

  spawnWave() {
    this.wave++;
    const count = 3 + this.wave * 2;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 50 + Math.random() * 10;
      const mesh = this.makeZombie();
      mesh.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      this.scene.add(mesh);
      this.zombies.push({
        mesh,
        health: CONFIG.zombieHealth + Math.floor(this.wave / 3),
        bobPhase: Math.random() * Math.PI * 2,
        attackCooldown: 0,
      });
    }
    this.updateHUD();
  }

  tryPunch() {
    if (this.punchTimer > 0) return;
    this.punchTimer = CONFIG.punchCooldown;
    this.punchAnim = 1;

    // Hit zombies in front within range
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      const toZ = new THREE.Vector3().subVectors(z.mesh.position, this.golem.position);
      toZ.y = 0;
      const d = toZ.length();
      if (d > CONFIG.punchRange) continue;
      toZ.normalize();
      if (toZ.dot(forward) < 0.5) continue; // ~60° cone
      z.health -= CONFIG.golemDamage;
      z.hitFlash = 1;
      // knockback
      z.mesh.position.addScaledVector(toZ, 1.6);
      if (z.health <= 0) {
        this.kills++;
        this.scene.remove(z.mesh);
        this.zombies.splice(i, 1);
      }
    }
    this.updateHUD();
  }

  update(dt) {
    // Punch timers
    if (this.punchTimer > 0) this.punchTimer -= dt;
    if (this.punchAnim > 0) {
      this.punchAnim = Math.max(0, this.punchAnim - dt * 4);
      const swing = Math.sin(this.punchAnim * Math.PI);
      if (this.fpvArmR) this.fpvArmR.rotation.x = -0.3 - swing * 1.4;
      if (this.fpvArmL) this.fpvArmL.rotation.x = -0.2 - swing * 0.5;
    } else {
      if (this.fpvArmR) this.fpvArmR.rotation.x += (-0.3 - this.fpvArmR.rotation.x) * 0.2;
      if (this.fpvArmL) this.fpvArmL.rotation.x += (-0.2 - this.fpvArmL.rotation.x) * 0.2;
    }

    if (this.hurtFlash > 0) this.hurtFlash -= dt;

    // Movement relative to yaw — WASD + arrow keys
    let mx = 0, mz = 0;
    if (this.keys['w'] || this.keys['arrowup']) mz -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) mz += 1;
    if (this.keys['a'] || this.keys['arrowleft']) mx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) mx += 1;
    if (mx || mz) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = mx * cos - mz * sin;
      const wz = mx * sin + mz * cos;
      this.golem.position.x += wx * CONFIG.golemSpeed * dt;
      this.golem.position.z += wz * CONFIG.golemSpeed * dt;
      // Face movement direction
      const targetRot = Math.atan2(wx, wz);
      let dr = targetRot - this.golem.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      this.golem.rotation.y += dr * 10 * dt;
    }

    // Jump / gravity
    if (this.keys[' '] && this.grounded) {
      this.velY = 8;
      this.grounded = false;
    }
    this.velY -= 22 * dt;
    this.golem.position.y += this.velY * dt;
    if (this.golem.position.y <= 0) {
      this.golem.position.y = 0;
      this.velY = 0;
      this.grounded = true;
    }

    // Clamp to world
    const half = CONFIG.worldSize / 2 - 2;
    this.golem.position.x = Math.max(-half, Math.min(half, this.golem.position.x));
    this.golem.position.z = Math.max(-half, Math.min(half, this.golem.position.z));

    // Wave spawning
    if (this.zombies.length === 0) {
      this.waveCooldown -= dt;
      if (this.waveCooldown <= 0) {
        this.spawnWave();
        this.waveCooldown = 5;
      }
    }

    // Zombies chase nearest villager or golem
    for (const z of this.zombies) {
      let target = null, bestD = Infinity;
      for (const v of this.villagers) {
        const d = z.mesh.position.distanceTo(v.mesh.position);
        if (d < bestD) { bestD = d; target = v.mesh; }
      }
      const dg = z.mesh.position.distanceTo(this.golem.position);
      if (dg < bestD && dg < 15) { bestD = dg; target = this.golem; }
      if (!target) target = this.golem;

      const dir = new THREE.Vector3().subVectors(target.position, z.mesh.position);
      dir.y = 0;
      const d = dir.length();
      if (d > 1.4) {
        dir.normalize();
        const speed = CONFIG.zombieSpeed + this.wave * 0.15;
        z.mesh.position.addScaledVector(dir, speed * dt);
        z.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        z.bobPhase += dt * 6;
        z.mesh.position.y = Math.abs(Math.sin(z.bobPhase)) * 0.08;
      } else {
        // Attack
        z.attackCooldown -= dt;
        if (z.attackCooldown <= 0) {
          z.attackCooldown = 1;
          if (target === this.golem) {
            this.health -= 8 + this.wave;
            this.hurtFlash = 0.3;
            if (this.health <= 0) { this.endGame('You were overwhelmed by zombies'); return; }
          } else {
            // Kill villager
            const idx = this.villagers.findIndex(v => v.mesh === target);
            if (idx >= 0) {
              this.scene.remove(this.villagers[idx].mesh);
              this.villagers.splice(idx, 1);
              if (this.villagers.length === 0) { this.endGame('All villagers were slain'); return; }
            }
          }
          this.updateHUD();
        }
      }

      // Hit flash
      if (z.hitFlash > 0) {
        z.hitFlash -= dt * 3;
        z.mesh.traverse(c => {
          if (c.material && c.material.emissive) c.material.emissive.setRGB(z.hitFlash, z.hitFlash * 0.3, z.hitFlash * 0.3);
        });
      }
    }

    // Villagers wander and flee nearby zombies
    for (const v of this.villagers) {
      let flee = null, fd = Infinity;
      for (const z of this.zombies) {
        const d = v.mesh.position.distanceTo(z.mesh.position);
        if (d < 8 && d < fd) { fd = d; flee = z; }
      }
      let dx = 0, dz = 0;
      if (flee) {
        const dir = new THREE.Vector3().subVectors(v.mesh.position, flee.mesh.position).normalize();
        dx = dir.x; dz = dir.z;
      } else {
        v.wanderT -= dt;
        if (v.wanderT <= 0) {
          v.wanderT = 2 + Math.random() * 3;
          const a = Math.random() * Math.PI * 2;
          v.wdx = Math.cos(a); v.wdz = Math.sin(a);
        }
        dx = v.wdx; dz = v.wdz;
      }
      const speed = flee ? 3.5 : 1.2;
      v.mesh.position.x += dx * speed * dt;
      v.mesh.position.z += dz * speed * dt;
      // Keep villagers near village
      const vd = Math.hypot(v.mesh.position.x, v.mesh.position.z);
      if (vd > 20) {
        v.mesh.position.x *= 20 / vd;
        v.mesh.position.z *= 20 / vd;
      }
      v.bobPhase += dt * (flee ? 10 : 5);
      v.mesh.position.y = Math.abs(Math.sin(v.bobPhase)) * 0.06;
      v.mesh.rotation.y = Math.atan2(dx, dz);
    }

    // Camera: first person at golem head height
    const headX = this.golem.position.x;
    const headY = this.golem.position.y + 4.2;
    const headZ = this.golem.position.z;
    this.camera.position.set(headX, headY, headZ);
    // Look direction from yaw and pitch
    const lookX = headX - Math.sin(this.yaw) * Math.cos(this.pitch);
    const lookY = headY + Math.sin(this.pitch);
    const lookZ = headZ - Math.cos(this.yaw) * Math.cos(this.pitch);
    this.camera.lookAt(lookX, lookY, lookZ);

    // Hide golem body in FPV
    this.golem.visible = false;

    // Health bar
    document.getElementById('health-fill').style.width = Math.max(0, this.health) + '%';
    document.getElementById('health-fill').style.background = this.hurtFlash > 0 ? '#fff' : 'linear-gradient(90deg,#e74c3c,#2ecc71)';
  }

  updateHUD() {
    document.getElementById('hud-wave').textContent = Math.max(1, this.wave);
    document.getElementById('hud-zombies').textContent = this.zombies.length;
    document.getElementById('hud-villagers').textContent = this.villagers.length;
    document.getElementById('hud-kills').textContent = this.kills;
  }

  endGame(msg) {
    this.gameOver = true;
    this.running = false;
    document.exitPointerLock();
    document.getElementById('final-text').textContent = msg;
    document.getElementById('final-score').textContent = `Survived ${this.wave} wave${this.wave === 1 ? '' : 's'} · ${this.kills} kills`;
    document.getElementById('game-over-screen').classList.remove('hidden');
  }

  loop() {
    if (!this.running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.gameOver) this.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.loop());
  }
}

new Game();

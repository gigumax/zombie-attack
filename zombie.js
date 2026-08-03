// ============================================================
//  ZOMBIE SHOOTER 3D — Minecraft-style zombies, FPS, wave-based
// ============================================================

const CONFIG = {
  worldSize: 60,
  playerSpeed: 8,
  playerSprintSpeed: 13,
  playerJump: 9,
  gravity: 25,
  playerHeight: 1.7,
  playerRadius: 0.4,
  maxHealth: 100,
  bulletRange: 100,
  zombieHealth: 100,
  zombieSpeed: 2.5,
  zombieDamage: 15,
  zombieAttackRange: 1.8,
  zombieAttackCooldown: 1.0,
  waveBaseCount: 5,
  waveSpeedIncrease: 0.3,
  waveCountIncrease: 3,
  waveBreakTime: 5,
  goldPickupRadius: 1.5,
  maxGoldPickups: 8,
  goldSpawnInterval: 8,
};

// Gun definitions — player can buy/switch between these
const GUNS = {
  knife: {
    name: 'Knife', magSize: Infinity, reloadTime: 0, fireRate: 0.3,
    damage: 60, pellets: 1, spread: 0, price: 0,
    color: 0xaaaaaa, barrelLen: 0.3,
    melee: true,
  },
  pistol: {
    name: 'Pistol', magSize: 12, reloadTime: 1.2, fireRate: 0.25,
    damage: 34, pellets: 1, spread: 0.01, price: 0,
    color: 0x2a2a2a, barrelLen: 0.5,
  },
  smg: {
    name: 'SMG', magSize: 100, reloadTime: 1.8, fireRate: 0.08,
    damage: 25, pellets: 1, spread: 0.03, price: 150,
    color: 0x1a3a1a, barrelLen: 0.6,
  },
  shotgun: {
    name: 'Shotgun', magSize: 6, reloadTime: 2.5, fireRate: 0.6,
    damage: 20, pellets: 8, spread: 0.12, price: 250,
    color: 0x5a3a1a, barrelLen: 0.7,
  },
  rifle: {
    name: 'Rifle', magSize: 500, reloadTime: 1.0, fireRate: 0.06,
    damage: 55, pellets: 1, spread: 0.005, price: 400,
    color: 0x2a2a4a, barrelLen: 0.8,
  },
};

// Upgrade definitions
const UPGRADES = {
  damage:  { name: 'Damage +10',  price: 100, maxLevel: 5 },
  fireRate:{ name: 'Fire Rate +20%', price: 80, maxLevel: 5 },
  magSize: { name: 'Mag Size +5',  price: 60, maxLevel: 5 },
  health:  { name: 'Max Health +25', price: 120, maxLevel: 5 },
};

// ============================================================
//  Zombie Shooter Game
// ============================================================
class ZombieGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 30, 80);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

    this.running = false;
    this.gameOver = false;
    this.clock = new THREE.Clock();
    this.pointerLocked = false;

    this.health = CONFIG.maxHealth;
    this.score = 0;
    this.wave = 1;
    this.kills = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireTimer = 0;

    // Gold & shop
    this.gold = 0;
    this.goldPickups = [];
    this.goldSpawnTimer = 0;
    this.shopOpen = false;

    // Gun system
    this.currentGun = 'pistol';
    this.ownedGuns = { pistol: true };
    this.ammo = GUNS.pistol.magSize;
    this.reserveAmmo = GUNS.pistol.magSize * 3;

    // Upgrades (levels 0-5)
    this.upgrades = { damage: 0, fireRate: 0, magSize: 0, health: 0 };

    this.zombies = [];
    this.bullets = [];
    this.particles = [];
    this.waveActive = false;
    this.waveBreakTimer = 0;
    this.zombiesToSpawn = 0;
    this.spawnTimer = 0;

    this.keys = {};
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = new THREE.Vector3();
    this.onGround = true;
    this.playerPos = new THREE.Vector3(0, CONFIG.playerHeight, 0);

    this.gun = null;
    this.gunRecoil = 0;

    this.setupLights();
    this.setupWorld();
    this.setupGun();
    this.setupInput();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.getElementById('start-btn').addEventListener('click', () => {
      document.getElementById('start-screen').classList.add('hidden');
      this.start();
    });
    document.getElementById('restart-btn').addEventListener('click', () => {
      document.getElementById('game-over-screen').classList.add('hidden');
      this.start();
    });
    document.getElementById('escaped-restart-btn').addEventListener('click', () => {
      document.getElementById('escaped-screen').classList.add('hidden');
      this.start();
    });

    this.animate();
  }

  // ─── Lights ───
  setupLights() {
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);

    const moon = new THREE.DirectionalLight(0x8888ff, 0.5);
    moon.position.set(20, 40, 20);
    moon.castShadow = true;
    moon.shadow.mapSize.width = 2048;
    moon.shadow.mapSize.height = 2048;
    moon.shadow.camera.left = -50;
    moon.shadow.camera.right = 50;
    moon.shadow.camera.top = 50;
    moon.shadow.camera.bottom = -50;
    moon.shadow.camera.far = 100;
    this.scene.add(moon);

    // Player flashlight
    this.flashlight = new THREE.SpotLight(0xffeeaa, 1.5, 40, Math.PI / 5, 0.4, 1);
    this.flashlight.castShadow = false;
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlight.target);
  }

  // ─── World ───
  setupWorld() {
    // Ground — grass-like
    const groundGeo = new THREE.PlaneGeometry(CONFIG.worldSize * 2, CONFIG.worldSize * 2);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3a5f3a });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Grid pattern on ground for visual reference
    const grid = new THREE.GridHelper(CONFIG.worldSize * 2, 40, 0x2a4a2a, 0x2a4a2a);
    grid.position.y = 0.01;
    this.scene.add(grid);

    // Perimeter walls
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x4a4a5a });
    const wallH = 6;
    const half = CONFIG.worldSize;
    const wallGeo = new THREE.BoxGeometry(half * 2, wallH, 1);
    for (let i = 0; i < 4; i++) {
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      if (i === 0) { wall.position.set(0, wallH / 2, -half); }
      else if (i === 1) { wall.position.set(0, wallH / 2, half); }
      else if (i === 2) { wall.rotation.y = Math.PI / 2; wall.position.set(-half, wallH / 2, 0); }
      else { wall.rotation.y = Math.PI / 2; wall.position.set(half, wallH / 2, 0); }
      this.scene.add(wall);
    }

    // Scatter some blocky trees and crates as cover/decoration
    this.obstacles = [];
    const treePositions = [
      [-15, -10], [12, -8], [-5, 15], [8, 12], [-20, 5],
      [18, 18], [-12, -20], [5, -15], [22, -5], [-25, -3],
    ];
    for (const [x, z] of treePositions) {
      this.createTree(x, z);
    }
    // Some crates
    const cratePositions = [
      [-3, -5], [6, 3], [-8, 8], [10, -12], [15, 6],
    ];
    for (const [x, z] of cratePositions) {
      this.createCrate(x, z);
    }
  }

  createTree(x, z) {
    const group = new THREE.Group();
    // Trunk
    const trunk = new THREE.Mesh(
      new THREE.BoxGeometry(1, 4, 1),
      new THREE.MeshLambertMaterial({ color: 0x5a3a2a })
    );
    trunk.position.y = 2;
    trunk.castShadow = true;
    group.add(trunk);
    // Leaves — blocky layers
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2a6a2a });
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), leafMat);
    l1.position.y = 5; l1.castShadow = true; group.add(l1);
    const l2 = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), leafMat);
    l2.position.y = 7; l2.castShadow = true; group.add(l2);
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.obstacles.push({ x, z, w: 1, d: 1 });
  }

  createCrate(x, z) {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.5, 1.5),
      new THREE.MeshLambertMaterial({ color: 0x8B6914 })
    );
    crate.position.set(x, 0.75, z);
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.scene.add(crate);
    this.obstacles.push({ x, z, w: 1.5, d: 1.5 });
  }

  // ─── Gun / weapon (first-person view) ───
  setupGun() {
    this.gun = new THREE.Group();
    // Gun body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.2, 0.8),
      new THREE.MeshLambertMaterial({ color: 0x2a2a2a })
    );
    body.position.set(0, 0, 0);
    this.gun.add(body);
    // Barrel
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
    );
    barrel.position.set(0, 0.04, -0.6);
    this.gun.add(barrel);
    // Magazine
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.3, 0.15),
      new THREE.MeshLambertMaterial({ color: 0x333333 })
    );
    mag.position.set(0, -0.2, 0.1);
    this.gun.add(mag);
    // Muzzle flash
    this.muzzleFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    this.muzzleFlash.position.set(0, 0.04, -0.9);
    this.gun.add(this.muzzleFlash);

    // Store gun parts for showing/hiding
    this.gunParts = { body, barrel, mag };
    this.gunParts.body.visible = true;
    this.gunParts.barrel.visible = true;
    this.gunParts.mag.visible = true;

    // Knife mesh — handle and blade
    this.knife = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.15, 0.45),
      new THREE.MeshLambertMaterial({ color: 0x3a2a1a })
    );
    handle.position.set(0, 0, 0.2);
    this.knife.add(handle);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.9),
      new THREE.MeshLambertMaterial({ color: 0xcccccc, metalness: 0.3 })
    );
    blade.position.set(0, 0.02, -0.5);
    this.knife.add(blade);
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.06, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x888888 })
    );
    guard.position.set(0, 0.02, 0.0);
    this.knife.add(guard);
    this.knife.visible = false;
    this.gun.add(this.knife);

    this.gun.position.set(0.35, -0.3, -0.5);
    this.camera.add(this.gun);
    this.scene.add(this.camera);
  }

  // ─── Gun stats (with upgrades) ───
  getGunStat(stat) {
    const gun = GUNS[this.currentGun];
    const lvl = this.upgrades;
    switch (stat) {
      case 'damage':    return gun.damage + lvl.damage * 10;
      case 'fireRate':  return gun.fireRate * Math.pow(0.8, lvl.fireRate);
      case 'magSize':   return gun.magSize + lvl.magSize * 5;
      case 'reloadTime':return gun.reloadTime;
      case 'pellets':   return gun.pellets;
      case 'spread':    return gun.spread;
      case 'maxHealth': return CONFIG.maxHealth + lvl.health * 25;
      default:          return gun[stat];
    }
  }

  switchGun(gunName) {
    if (this.escapeMode) return; // only knife allowed
    if (!this.ownedGuns[gunName]) return;
    this.currentGun = gunName;
    const gun = GUNS[gunName];
    if (gun.melee || gun.infinite) {
      this.ammo = Infinity;
      this.reserveAmmo = Infinity;
    } else {
      this.ammo = this.getGunStat('magSize');
      this.reserveAmmo = this.getGunStat('magSize') * 3;
    }
    this.reloading = false;
    // Show/hide knife vs gun parts
    const isKnife = gun.melee;
    this.gunParts.body.visible = !isKnife;
    this.gunParts.barrel.visible = !isKnife;
    this.gunParts.mag.visible = !isKnife;
    this.knife.visible = isKnife;
    this.muzzleFlash.visible = !isKnife;
    this.updateHUD();
  }

  // ─── Gold pickups ───
  spawnGoldPickup(x, z, value) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshLambertMaterial({ color: 0xffdd00, emissive: 0x886600, emissiveIntensity: 0.5 })
    );
    mesh.position.set(x, 0.5, z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.goldPickups.push({ mesh, value, x, z, bobPhase: Math.random() * Math.PI * 2 });
  }

  spawnRandomGold() {
    if (this.goldPickups.length >= CONFIG.maxGoldPickups) return;
    const half = CONFIG.worldSize - 5;
    const x = (Math.random() - 0.5) * half * 2;
    const z = (Math.random() - 0.5) * half * 2;
    const value = 5 + Math.floor(Math.random() * 15);
    this.spawnGoldPickup(x, z, value);
  }

  updateGoldPickups(dt) {
    for (let i = this.goldPickups.length - 1; i >= 0; i--) {
      const g = this.goldPickups[i];
      // Bob animation
      g.bobPhase += dt * 3;
      g.mesh.position.y = 0.5 + Math.sin(g.bobPhase) * 0.15;
      g.mesh.rotation.y += dt * 2;

      // Check player proximity
      const dx = this.playerPos.x - g.x;
      const dz = this.playerPos.z - g.z;
      if (Math.hypot(dx, dz) < CONFIG.goldPickupRadius) {
        this.gold += g.value;
        this.scene.remove(g.mesh);
        this.goldPickups.splice(i, 1);
        this.updateHUD();
      }
    }

    // Spawn gold periodically
    this.goldSpawnTimer -= dt;
    if (this.goldSpawnTimer <= 0) {
      this.spawnRandomGold();
      this.goldSpawnTimer = CONFIG.goldSpawnInterval;
    }
  }

  // ─── Shop ───
  toggleShop() {
    this.shopOpen = !this.shopOpen;
    if (this.shopOpen) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.renderShop();
      document.getElementById('shop-overlay').classList.remove('hidden');
    } else {
      document.getElementById('shop-overlay').classList.add('hidden');
      this.canvas.requestPointerLock();
    }
  }

  renderShop() {
    const el = document.getElementById('shop-content');
    let html = `<div style="color:#ffdd00;font-size:24px;font-weight:900;margin-bottom:12px;">GOLD: ${this.gold}</div>`;

    // Guns section
    html += '<div style="color:#aaa;font-size:14px;font-weight:700;margin-bottom:6px;">WEAPONS</div>';
    for (const [key, gun] of Object.entries(GUNS)) {
      const owned = this.ownedGuns[key];
      const equipped = this.currentGun === key;
      if (equipped) {
        html += `<div class="shop-item equipped"><span>${gun.name}</span><span>EQUIPPED</span></div>`;
      } else if (owned) {
        html += `<div class="shop-item owned" onclick="game.switchGun('${key}')"><span>${gun.name}</span><span>Click to equip</span></div>`;
      } else {
        const canBuy = this.gold >= gun.price;
        html += `<div class="shop-item ${canBuy ? '' : 'disabled'}" onclick="${canBuy ? `game.buyGun('${key}')` : ''}"><span>${gun.name}</span><span>${gun.price}g</span></div>`;
      }
    }

    // Upgrades section
    html += '<div style="color:#aaa;font-size:14px;font-weight:700;margin:12px 0 6px;">UPGRADES</div>';
    for (const [key, up] of Object.entries(UPGRADES)) {
      const lvl = this.upgrades[key];
      const maxed = lvl >= up.maxLevel;
      const price = up.price * (lvl + 1);
      const canBuy = !maxed && this.gold >= price;
      html += `<div class="shop-item ${maxed ? 'maxed' : (canBuy ? '' : 'disabled')}" onclick="${canBuy ? `game.buyUpgrade('${key}')` : ''}">
        <span>${up.name} <span style="color:#666;">Lv.${lvl}/${up.maxLevel}</span></span>
        <span>${maxed ? 'MAX' : price + 'g'}</span>
      </div>`;
    }

    html += `<div style="margin-top:16px;font-size:12px;color:#666;">Press <kbd>B</kbd> to close shop</div>`;
    el.innerHTML = html;
  }

  buyGun(gunName) {
    const gun = GUNS[gunName];
    if (this.ownedGuns[gunName] || this.gold < gun.price) return;
    this.gold -= gun.price;
    this.ownedGuns[gunName] = true;
    this.switchGun(gunName);
    this.saveProgress();
    this.renderShop();
  }

  buyUpgrade(key) {
    const up = UPGRADES[key];
    const lvl = this.upgrades[key];
    if (lvl >= up.maxLevel) return;
    const price = up.price * (lvl + 1);
    if (this.gold < price) return;
    this.gold -= price;
    this.upgrades[key]++;
    if (key === 'health') this.health += 25;
    if (key === 'magSize') this.ammo = this.getGunStat('magSize');
    this.saveProgress();
    this.updateHUD();
    this.renderShop();
  }

  // ─── Input ───
  setupInput() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === 'r' && this.running && !this.gameOver && !this.shopOpen) this.startReload();
      if (e.code === 'KeyB' && this.running && !this.gameOver) { this.toggleShop(); e.preventDefault(); }
      if (e.code === 'KeyG' && this.running && !this.gameOver) { this.autoFire = !this.autoFire; }
      if (e.code === 'Digit2' && this.running && !this.gameOver && !this.shopOpen) { this.switchGun('knife'); }
      if (e.code === 'Digit1' && this.running && !this.gameOver && !this.shopOpen) { this.switchGun('pistol'); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.tryEscapeInteract();
      if (k === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });

    // Mouse look + shoot
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = (document.pointerLockElement === this.canvas);
    });

    document.addEventListener('mousemove', e => {
      if (!this.pointerLocked || !this.running || this.gameOver) return;
      this.yaw -= e.movementX * 0.002;
      this.pitch -= e.movementY * 0.002;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });

    document.addEventListener('mousedown', e => {
      if (!this.pointerLocked || !this.running || this.gameOver) return;
      if (e.button === 0) this.shoot();
    });
  }

  // ─── Bullet tracers ───
  spawnTracer(origin, endPoint) {
    const dir = new THREE.Vector3().subVectors(endPoint, origin);
    const len = dir.length();
    if (len < 0.1) return;
    const geo = new THREE.CylinderGeometry(0.02, 0.02, len, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffee44, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    // Orient cylinder along direction
    mesh.position.copy(origin).add(endPoint).multiplyScalar(0.5);
    mesh.lookAt(endPoint);
    mesh.rotateX(Math.PI / 2);
    this.scene.add(mesh);
    this.bullets.push({ mesh, life: 0.08 });
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.bullets.splice(i, 1);
        continue;
      }
      b.mesh.material.opacity = (b.life / 0.08) * 0.8;
    }
  }

  // ─── Shooting ───
  shoot() {
    if (this.reloading) return;
    if (this.shopOpen) return;
    if (this.fireTimer > 0) return;

    const gun = GUNS[this.currentGun];

    // Melee attack (knife)
    if (gun.melee) {
      this.fireTimer = this.getGunStat('fireRate');
      this.gunRecoil = 0.12;
      this.updateHUD();

      const damage = this.getGunStat('damage');
      const meleeRange = 3.0;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

      let closestHit = null;
      let closestDist = meleeRange;

      for (const zombie of this.zombies) {
        if (zombie.dead) continue;
        const box = new THREE.Box3().setFromObject(zombie.mesh);
        const intersection = raycaster.ray.intersectBox(box, new THREE.Vector3());
        if (intersection) {
          const dist = this.camera.position.distanceTo(intersection);
          if (dist < closestDist) {
            closestDist = dist;
            closestHit = { zombie, point: intersection };
          }
        }
      }

      if (closestHit) {
        closestHit.zombie.health -= damage;
        this.spawnImpactParticles(closestHit.point, 0x6a0a0a, 8);
        if (closestHit.zombie.health <= 0) {
          this.killZombie(closestHit.zombie);
        }
      }
      return;
    }

    // Ranged attack (guns)
    if (!gun.infinite && this.ammo <= 0) { this.startReload(); return; }

    if (!gun.infinite) this.ammo--;
    this.fireTimer = this.getGunStat('fireRate');
    this.gunRecoil = 0.08;
    this.muzzleFlash.material.opacity = 1;
    this.updateHUD();

    const damage = this.getGunStat('damage');
    const pellets = this.getGunStat('pellets');
    const spread = this.getGunStat('spread');

    // Fire multiple pellets (shotgun)
    for (let p = 0; p < pellets; p++) {
      // Raycast from camera center with spread
      const spreadX = (Math.random() - 0.5) * spread;
      const spreadY = (Math.random() - 0.5) * spread;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(spreadX, spreadY), this.camera);

      // Check zombie hits
      let closestHit = null;
      let closestDist = CONFIG.bulletRange;

      for (const zombie of this.zombies) {
        if (zombie.dead) continue;
        const box = new THREE.Box3().setFromObject(zombie.mesh);
        const intersection = raycaster.ray.intersectBox(box, new THREE.Vector3());
        if (intersection) {
          const dist = this.camera.position.distanceTo(intersection);
          if (dist < closestDist) {
            closestDist = dist;
            closestHit = { zombie, point: intersection, dist };
          }
        }
      }

      // Check environment hit
      const envDist = this.checkEnvironmentHit(raycaster);
      if (envDist !== null && envDist < closestDist) {
        closestHit = null;
        closestDist = envDist;
        this.spawnImpactParticles(raycaster.ray.at(envDist, new THREE.Vector3()), 0x888888);
      }

      // Spawn visible tracer from gun muzzle to hit point (or max range)
      const muzzlePos = new THREE.Vector3();
      this.gun.getWorldPosition(muzzlePos);
      const endPoint = raycaster.ray.at(Math.min(closestDist, CONFIG.bulletRange), new THREE.Vector3());
      this.spawnTracer(muzzlePos, endPoint);

      if (closestHit) {
        closestHit.zombie.health -= damage;
        this.spawnImpactParticles(closestHit.point, 0x6a0a0a);
        if (closestHit.zombie.health <= 0) {
          this.killZombie(closestHit.zombie);
        }
      }
    }

    this.playGunshot();
  }

  checkEnvironmentHit(raycaster) {
    // Ground plane at y=0
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();
    const groundHit = raycaster.ray.intersectPlane(groundPlane, hitPoint);
    let groundDist = null;
    if (groundHit) {
      groundDist = this.camera.position.distanceTo(hitPoint);
      if (groundDist > CONFIG.bulletRange) groundDist = null;
    }

    // Walls — simple distance checks
    const half = CONFIG.worldSize;
    let wallDist = null;
    const origin = raycaster.ray.origin;
    const dir = raycaster.ray.direction;

    // Check each wall plane
    const wallPlanes = [
      new THREE.Plane(new THREE.Vector3(0, 0, 1), half),   // north z=half
      new THREE.Plane(new THREE.Vector3(0, 0, -1), half),  // south z=-half
      new THREE.Plane(new THREE.Vector3(1, 0, 0), half),   // east x=half
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), half),  // west x=-half
    ];
    for (const p of wallPlanes) {
      const pt = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(p, pt)) {
        const d = origin.distanceTo(pt);
        if (d > 0 && d < CONFIG.bulletRange) {
          if (wallDist === null || d < wallDist) wallDist = d;
        }
      }
    }

    let result = null;
    if (groundDist !== null) result = groundDist;
    if (wallDist !== null && (result === null || wallDist < result)) result = wallDist;
    return result;
  }

  playGunshot() {
    if (!this.audioCtx) {
      try { this.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return; }
    }
    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  startReload() {
    const gun = GUNS[this.currentGun];
    if (gun.infinite || gun.melee) return;
    if (this.reloading) return;
    if (this.ammo >= this.getGunStat('magSize')) return;
    this.reloading = true;
    this.reloadTimer = this.getGunStat('reloadTime');
    this.updateHUD();
  }

  finishReload() {
    this.ammo = this.getGunStat('magSize');
    this.reloading = false;
    this.updateHUD();
  }

  // ─── Zombies ───
  createZombieMesh(isBoss = false) {
    const group = new THREE.Group();

    if (isBoss) {
      // Giant mutant hunched Minecraft zombie (from image)
      const skinMat = new THREE.MeshLambertMaterial({ color: 0x5a8a4a });
      const shirtMat = new THREE.MeshLambertMaterial({ color: 0x2a9a9a });
      const pantsMat = new THREE.MeshLambertMaterial({ color: 0x4a2a8a });

      // Hunched forward torso — much wider/taller
      const torso = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.9), shirtMat);
      torso.position.set(0, 2.0, 0.2);
      torso.rotation.x = 0.25;
      torso.castShadow = true;
      group.add(torso);

      // Head pushed forward and down
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), skinMat);
      head.position.set(0, 2.9, 0.75);
      head.rotation.x = 0.15;
      head.castShadow = true;
      group.add(head);

      // Black eyes
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.08), eyeMat);
      eyeL.position.set(-0.18, 3.0, 1.14);
      group.add(eyeL);
      const eyeR = eyeL.clone();
      eyeR.position.x = 0.18;
      group.add(eyeR);

      // Huge shoulders
      const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.9), shirtMat);
      shoulderL.position.set(-0.9, 2.4, 0.1);
      shoulderL.rotation.x = 0.25;
      group.add(shoulderL);
      const shoulderR = shoulderL.clone();
      shoulderR.position.x = 0.9;
      group.add(shoulderR);

      // Thick arms hanging down
      const armGeo = new THREE.BoxGeometry(0.55, 2.0, 0.55);
      const armL = new THREE.Mesh(armGeo, skinMat);
      armL.position.set(-1.15, 1.4, 0.05);
      armL.castShadow = true;
      group.add(armL);
      const armR = new THREE.Mesh(armGeo, skinMat);
      armR.position.set(1.15, 1.4, 0.05);
      armR.castShadow = true;
      group.add(armR);

      // Chunky legs
      const legGeo = new THREE.BoxGeometry(0.45, 1.3, 0.55);
      const legL = new THREE.Mesh(legGeo, pantsMat);
      legL.position.set(-0.4, 0.65, 0);
      legL.castShadow = true;
      group.add(legL);
      const legR = new THREE.Mesh(legGeo, pantsMat);
      legR.position.set(0.4, 0.65, 0);
      legR.castShadow = true;
      group.add(legR);

      // Scale the whole group up to giant size
      group.scale.set(2.2, 2.2, 2.2);

      group.userData = { armL, armR, legL, legR, head, torso, shoulderL, shoulderR };
      return group;
    }

    // Normal zombie
    const scale = 1.0;
    const skinMat = new THREE.MeshLambertMaterial({ color: 0x4a7a4a });
    const shirtMat = new THREE.MeshLambertMaterial({ color: 0x3a6aad });
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2a2a5a });

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, 0.5 * scale, 0.5 * scale), skinMat);
    head.position.y = 1.8 * scale;
    head.castShadow = true;
    group.add(head);

    // Eyes — black
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.12 * scale, 0.12 * scale, 0.05 * scale), eyeMat);
    eyeL.position.set(-0.12 * scale, 1.85 * scale, 0.26 * scale);
    group.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.12 * scale;
    group.add(eyeR);

    // Body (torso)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, 0.75 * scale, 0.3 * scale), shirtMat);
    torso.position.y = 1.15 * scale;
    torso.castShadow = true;
    group.add(torso);

    // Arms — outstretched like Minecraft zombie
    const armGeo = new THREE.BoxGeometry(0.25 * scale, 0.5 * scale, 0.25 * scale);
    const armL = new THREE.Mesh(armGeo, skinMat);
    armL.position.set(-0.38 * scale, 1.3 * scale, 0.3 * scale);
    armL.rotation.x = -Math.PI / 2;
    armL.castShadow = true;
    group.add(armL);
    const armR = new THREE.Mesh(armGeo, skinMat);
    armR.position.set(0.38 * scale, 1.3 * scale, 0.3 * scale);
    armR.rotation.x = -Math.PI / 2;
    armR.castShadow = true;
    group.add(armR);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.22 * scale, 0.75 * scale, 0.22 * scale);
    const legL = new THREE.Mesh(legGeo, pantsMat);
    legL.position.set(-0.13 * scale, 0.375 * scale, 0);
    legL.castShadow = true;
    group.add(legL);
    const legR = new THREE.Mesh(legGeo, pantsMat);
    legR.position.set(0.13 * scale, 0.375 * scale, 0);
    legR.castShadow = true;
    group.add(legR);

    // Store refs for animation
    group.userData = { armL, armR, legL, legR, head };
    return group;
  }

  createBuffZombieMesh() {
    const group = new THREE.Group();
    const scale = 1.4;
    // Dark red buff zombie
    const skinMat = new THREE.MeshLambertMaterial({ color: 0x8a2a2a });
    const shirtMat = new THREE.MeshLambertMaterial({ color: 0x4a1a1a });
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2a0a0a });

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55 * scale, 0.55 * scale, 0.55 * scale), skinMat);
    head.position.y = 1.8 * scale;
    head.castShadow = true;
    group.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.13 * scale, 0.13 * scale, 0.06 * scale), eyeMat);
    eyeL.position.set(-0.13 * scale, 1.85 * scale, 0.29 * scale);
    group.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.13 * scale;
    group.add(eyeR);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.65 * scale, 0.85 * scale, 0.4 * scale), shirtMat);
    torso.position.y = 1.15 * scale;
    torso.castShadow = true;
    group.add(torso);

    const armGeo = new THREE.BoxGeometry(0.35 * scale, 0.65 * scale, 0.35 * scale);
    const armL = new THREE.Mesh(armGeo, skinMat);
    armL.position.set(-0.45 * scale, 1.35 * scale, 0.35 * scale);
    armL.rotation.x = -Math.PI / 2;
    armL.castShadow = true;
    group.add(armL);
    const armR = new THREE.Mesh(armGeo, skinMat);
    armR.position.set(0.45 * scale, 1.35 * scale, 0.35 * scale);
    armR.rotation.x = -Math.PI / 2;
    armR.castShadow = true;
    group.add(armR);

    const legGeo = new THREE.BoxGeometry(0.28 * scale, 0.85 * scale, 0.28 * scale);
    const legL = new THREE.Mesh(legGeo, pantsMat);
    legL.position.set(-0.15 * scale, 0.425 * scale, 0);
    legL.castShadow = true;
    group.add(legL);
    const legR = new THREE.Mesh(legGeo, pantsMat);
    legR.position.set(0.15 * scale, 0.425 * scale, 0);
    legR.castShadow = true;
    group.add(legR);

    group.userData = { armL, armR, legL, legR, head };
    return group;
  }

  createSkeletonMesh() {
    const group = new THREE.Group();
    const scale = 1.05;
    // White bony skeleton
    const boneMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });

    // Skull
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45 * scale, 0.45 * scale, 0.45 * scale), boneMat);
    head.position.y = 1.8 * scale;
    head.castShadow = true;
    group.add(head);

    // Red eye sockets
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1 * scale, 0.1 * scale, 0.05 * scale), eyeMat);
    eyeL.position.set(-0.1 * scale, 1.82 * scale, 0.24 * scale);
    group.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.1 * scale;
    group.add(eyeR);

    // Ribcage torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.35 * scale, 0.75 * scale, 0.25 * scale), darkMat);
    torso.position.y = 1.15 * scale;
    torso.castShadow = true;
    group.add(torso);

    // Thin bones
    const armGeo = new THREE.BoxGeometry(0.12 * scale, 0.75 * scale, 0.12 * scale);
    const armL = new THREE.Mesh(armGeo, boneMat);
    armL.position.set(-0.32 * scale, 1.3 * scale, 0.3 * scale);
    armL.rotation.x = -Math.PI / 2;
    armL.castShadow = true;
    group.add(armL);
    const armR = new THREE.Mesh(armGeo, boneMat);
    armR.position.set(0.32 * scale, 1.3 * scale, 0.3 * scale);
    armR.rotation.x = -Math.PI / 2;
    armR.castShadow = true;
    group.add(armR);

    const legGeo = new THREE.BoxGeometry(0.12 * scale, 0.85 * scale, 0.12 * scale);
    const legL = new THREE.Mesh(legGeo, boneMat);
    legL.position.set(-0.12 * scale, 0.425 * scale, 0);
    legL.castShadow = true;
    group.add(legL);
    const legR = new THREE.Mesh(legGeo, boneMat);
    legR.position.set(0.12 * scale, 0.425 * scale, 0);
    legR.castShadow = true;
    group.add(legR);

    group.userData = { armL, armR, legL, legR, head };
    return group;
  }

  spawnZombie() {
    // Pick zombie type based on wave
    let type = 'normal';
    const r = Math.random();
    if (this.wave >= 4 && r < 0.15) {
      type = 'skeleton';
    } else if (this.wave >= 3 && r < 0.35) {
      type = 'buff';
    }

    let mesh;
    if (type === 'skeleton') mesh = this.createSkeletonMesh();
    else if (type === 'buff') mesh = this.createBuffZombieMesh();
    else mesh = this.createZombieMesh();

    // Spawn at random edge of map
    const angle = Math.random() * Math.PI * 2;
    const dist = CONFIG.worldSize - 5;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);

    const speed = CONFIG.zombieSpeed + (this.wave - 1) * CONFIG.waveSpeedIncrease;
    let health = CONFIG.zombieHealth;
    let damage = CONFIG.zombieDamage;
    let attackRange = CONFIG.zombieAttackRange;

    if (type === 'buff') {
      health *= 3;
      damage *= 2;
      attackRange *= 1.3;
    } else if (type === 'skeleton') {
      health *= 0.6;
      damage *= 1.2;
      attackRange *= 1.2;
    }

    this.zombies.push({
      mesh,
      type,
      health,
      maxHealth: health,
      speed: type === 'skeleton' ? speed * 1.6 : type === 'buff' ? speed * 0.75 : speed,
      damage,
      attackRange,
      attackTimer: 0,
      dead: false,
      walkPhase: Math.random() * Math.PI * 2,
      legL: mesh.userData.legL,
      legR: mesh.userData.legR,
      armL: mesh.userData.armL,
      armR: mesh.userData.armR,
    });
  }

  spawnBoss() {
    const mesh = this.createZombieMesh(true);
    // Spawn at random edge of map
    const angle = Math.random() * Math.PI * 2;
    const dist = CONFIG.worldSize - 5;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);

    const speed = CONFIG.zombieSpeed * 0.7 + (this.wave - 1) * CONFIG.waveSpeedIncrease * 0.5;
    const health = 800 + (this.wave - 6) * 200;
    this.zombies.push({
      mesh,
      type: 'boss',
      health,
      maxHealth: health,
      speed,
      damage: CONFIG.zombieDamage * 3,
      attackRange: CONFIG.zombieAttackRange * 2,
      attackTimer: 0,
      dead: false,
      walkPhase: Math.random() * Math.PI * 2,
      legL: mesh.userData.legL,
      legR: mesh.userData.legR,
      armL: mesh.userData.armL,
      armR: mesh.userData.armR,
      isBoss: true,
    });

    const el = document.getElementById('wave-announce');
    el.textContent = 'BOSS HAS APPEARED!';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  killZombie(zombie) {
    zombie.dead = true;
    this.scene.remove(zombie.mesh);

    let score = 10 * this.wave;
    let goldDrop = 5 + Math.floor(Math.random() * 10) + this.wave;
    let particleColor = 0x4a7a4a;
    let particleCount = 15;

    if (zombie.isBoss) {
      score = 200 * this.wave;
      goldDrop = 100 + this.wave * 20;
      particleColor = 0x6a0a0a;
      particleCount = 40;
    } else if (zombie.type === 'guard') {
      score = 50 * this.wave;
      goldDrop = 50 + this.wave * 10;
      particleColor = 0x8a2a2a;
      particleCount = 28;
    } else if (zombie.type === 'buff') {
      score = 25 * this.wave;
      goldDrop = 20 + this.wave * 5;
      particleColor = 0x8a2a2a;
      particleCount = 24;
    } else if (zombie.type === 'skeleton') {
      score = 15 * this.wave;
      goldDrop = 10 + this.wave * 3;
      particleColor = 0xdddddd;
      particleCount = 18;
    }

    this.score += score;
    this.kills++;
    this.updateHUD();
    this.addKillFeed(zombie.type || 'normal');

    // Spawn death particles
    const pos = zombie.mesh.position.clone();
    pos.y = 1;
    if (zombie.hasKey) this.dropKey(pos);
    this.spawnImpactParticles(pos, particleColor, particleCount);

    // Drop gold
    this.spawnGoldPickup(pos.x, pos.z, goldDrop);

    // Remove from array
    const idx = this.zombies.indexOf(zombie);
    if (idx >= 0) this.zombies.splice(idx, 1);

    // Check wave complete or escape win
    if (this.escapeMode) {
      this.checkEscapeWin();
    } else if (this.zombies.length === 0 && this.zombiesToSpawn === 0) {
      this.endWave();
    }
  }

  addKillFeed(type = 'normal') {
    const feed = document.getElementById('kill-feed');
    const msg = document.createElement('div');
    msg.className = 'kill-msg';
    if (type === 'boss') {
      msg.style.color = '#ff3333';
      msg.style.fontSize = '18px';
      msg.textContent = `BOSS ELIMINATED! +${200 * this.wave}`;
    } else if (type === 'guard') {
      msg.style.color = '#ff6b6b';
      msg.textContent = `GUARD ELIMINATED! +${50 * this.wave}`;
    } else if (type === 'buff') {
      msg.style.color = '#ff6b6b';
      msg.textContent = `BUFF ZOMBIE ELIMINATED! +${25 * this.wave}`;
    } else if (type === 'skeleton') {
      msg.style.color = '#dddddd';
      msg.textContent = `SKELETON ELIMINATED! +${15 * this.wave}`;
    } else {
      msg.textContent = `+${10 * this.wave} Zombie eliminated!`;
    }
    feed.appendChild(msg);
    setTimeout(() => msg.remove(), 2000);
  }

  // ─── Particles ───
  spawnImpactParticles(pos, color, count = 6) {
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.06),
        new THREE.MeshBasicMaterial({ color })
      );
      p.position.copy(pos);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4
      );
      this.scene.add(p);
      this.particles.push({ mesh: p, vel, life: 0.6 });
    }
  }

  // ─── Waves ───
  startWave() {
    this.zombiesToSpawn = CONFIG.waveBaseCount + (this.wave - 1) * CONFIG.waveCountIncrease;
    this.waveActive = true;
    this.spawnTimer = 0;
    this.bossSpawned = false;
    this.announceWave();

    // Boss appears starting at wave 5
    if (this.wave >= 5) {
      this.bossPending = true;
    }
  }

  announceWave() {
    const el = document.getElementById('wave-announce');
    el.textContent = this.bossPending ? `WAVE ${this.wave} — BOSS INCOMING!` : `WAVE ${this.wave}`;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
  }

  endWave() {
    this.waveActive = false;
    this.waveBreakTimer = CONFIG.waveBreakTime;
    this.bossPending = false;
    this.bossSpawned = false;
    const clearedWave = this.wave;
    this.wave++;  // increment for next wave
    // Bonus health, ammo, and gold for surviving
    this.health = Math.min(this.getGunStat('maxHealth'), this.health + 25);
    this.reserveAmmo += this.getGunStat('magSize') * 2;
    this.gold += 30 + clearedWave * 10;
    this.updateHUD();
    const el = document.getElementById('wave-announce');
    el.textContent = `WAVE ${clearedWave} CLEARED! +25 HP`;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ─── Game Flow ───
  saveProgress() {
    const data = {
      gold: this.gold,
      ownedGuns: this.ownedGuns,
      currentGun: this.currentGun,
      upgrades: this.upgrades,
    };
    try { localStorage.setItem('zombieShooter_save', JSON.stringify(data)); } catch (e) {}
  }

  loadProgress() {
    try {
      const raw = localStorage.getItem('zombieShooter_save');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  start() {
    this.gameOver = false;
    this.escapeMode = false;
    this.escapeStep = null;
    this.hasKey = false;
    this.clearPrisonCell();
    document.getElementById('escape-overlay').classList.add('hidden');
    document.getElementById('escaped-screen').classList.add('hidden');
    this.health = CONFIG.maxHealth;
    this.score = 0;
    this.wave = 1;
    this.kills = 0;
    this.reloading = false;
    this.fireTimer = 0;
    this.gunRecoil = 0;
    this.autoFire = false;

    // Load saved progress
    const save = this.loadProgress();
    this.shopOpen = false;
    document.getElementById('shop-overlay').classList.add('hidden');

    if (save) {
      this.gold = save.gold || 0;
      this.ownedGuns = save.ownedGuns || { knife: true, pistol: true };
      this.ownedGuns.knife = true; // knife is always owned
      this.currentGun = save.currentGun || 'pistol';
      this.upgrades = save.upgrades || { damage: 0, fireRate: 0, magSize: 0, health: 0 };
      // Apply health upgrade to starting health
      this.health = this.getGunStat('maxHealth');
    } else {
      this.gold = 0;
      this.ownedGuns = { knife: true, pistol: true };
      this.currentGun = 'pistol';
      this.upgrades = { damage: 0, fireRate: 0, magSize: 0, health: 0 };
    }

    // Set gun mesh to current gun
    this.switchGun(this.currentGun);

    // Clear zombies
    for (const z of this.zombies) this.scene.remove(z.mesh);
    this.zombies = [];
    // Clear particles
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles = [];
    // Clear bullets
    for (const b of this.bullets) this.scene.remove(b.mesh);
    this.bullets = [];
    // Clear gold pickups
    for (const g of this.goldPickups) this.scene.remove(g.mesh);
    this.goldPickups = [];
    this.goldSpawnTimer = 3;

    this.playerPos.set(0, CONFIG.playerHeight, 0);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;

    this.waveActive = false;
    this.waveBreakTimer = 3;  // 3 second break before first wave
    this.zombiesToSpawn = 0;
    this.spawnTimer = 0;
    this.bossPending = false;
    this.bossSpawned = false;

    // Show HUD
    document.getElementById('hud').style.display = 'flex';
    document.getElementById('crosshair').style.display = 'block';
    document.getElementById('health-bar-wrap').style.display = 'block';
    document.getElementById('final-score').textContent = '';
    this.updateHUD();

    // Lock pointer
    this.canvas.requestPointerLock();
    this.running = true;
  }

  endGame() {
    this.gameOver = true;
    this.running = false;
    this.shopOpen = false;
    document.getElementById('shop-overlay').classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();

    // If we died during the escape, put original weapons back
    if (this.escapeMode) {
      this.ownedGuns = this.preEscapeOwned || this.ownedGuns;
      this.currentGun = this.preEscapeGun || this.currentGun;
      this.clearPrisonCell();
      document.getElementById('escape-overlay').classList.add('hidden');
      document.getElementById('final-text').textContent = 'You failed to escape...';
      this.escapeMode = false;
    } else {
      document.getElementById('final-text').textContent = 'The zombies got you... but your gold and weapons are saved!';
    }

    this.saveProgress();
    document.getElementById('final-score').textContent = `${this.kills} zombies killed · Wave ${this.wave} · Score ${this.score} · ${this.gold} gold`;
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('hud').style.display = 'none';
    document.getElementById('crosshair').style.display = 'none';
    document.getElementById('health-bar-wrap').style.display = 'none';
  }

  // ─── Escape ───
  startEscape() {
    this.escapeMode = true;
    this.escapeStep = 'guard';
    this.hasKey = false;
    this.gameOver = false;
    this.running = true;
    this.shopOpen = false;
    this.autoFire = false;
    this.reloading = false;
    this.fireTimer = 0;
    this.gunRecoil = 0;
    this.muzzleFlash.material.opacity = 0;

    // Remember original gear, then take all guns except knife
    this.preEscapeGun = this.currentGun;
    this.preEscapeOwned = { ...this.ownedGuns };
    this.ownedGuns = { knife: true };
    this.currentGun = 'knife';
    this.ammo = Infinity;
    this.reserveAmmo = Infinity;
    this.health = this.getGunStat('maxHealth');

    // Clear world
    for (const z of this.zombies) this.scene.remove(z.mesh);
    this.zombies = [];
    for (const b of this.bullets) this.scene.remove(b.mesh);
    this.bullets = [];
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles = [];
    for (const g of this.goldPickups) this.scene.remove(g.mesh);
    this.goldPickups = [];

    // Hide game over, show story
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('shop-overlay').classList.add('hidden');
    document.getElementById('escape-overlay').textContent =
      'The boss knocked you out... Your eyes open in a dark prison cell. They took your guns, but forgot your knife. A zombie guard holds the key.';
    document.getElementById('escape-overlay').classList.remove('hidden');
    document.getElementById('hud').style.display = 'flex';
    document.getElementById('crosshair').style.display = 'block';
    document.getElementById('health-bar-wrap').style.display = 'block';

    // Build prison and place player
    this.buildPrisonCell();
    this.playerPos.set(0, CONFIG.playerHeight, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.camera.position.set(0, CONFIG.playerHeight, 0);
    this.camera.rotation.set(0, 0, 0);

    // Spawn guard with key
    this.spawnGuard();

    this.switchGun('knife');
    this.updateHUD();
  }

  buildPrisonCell() {
    this.prisonObjects = [];
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });

    // Floor
    const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 12), floorMat);
    floor.position.set(0, -0.1, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.prisonObjects.push(floor);

    // Back wall
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 0.5), wallMat);
    backWall.position.set(0, 2.5, -6);
    backWall.castShadow = true;
    this.scene.add(backWall);
    this.prisonObjects.push(backWall);

    // Left wall
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 12), wallMat);
    leftWall.position.set(-6, 2.5, 0);
    leftWall.castShadow = true;
    this.scene.add(leftWall);
    this.prisonObjects.push(leftWall);

    // Right wall
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 12), wallMat);
    rightWall.position.set(6, 2.5, 0);
    rightWall.castShadow = true;
    this.scene.add(rightWall);
    this.prisonObjects.push(rightWall);

    // Front wall with gap for door
    const frontWallL = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 0.5), wallMat);
    frontWallL.position.set(-4, 2.5, 6);
    frontWallL.castShadow = true;
    this.scene.add(frontWallL);
    this.prisonObjects.push(frontWallL);

    const frontWallR = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 0.5), wallMat);
    frontWallR.position.set(4, 2.5, 6);
    frontWallR.castShadow = true;
    this.scene.add(frontWallR);
    this.prisonObjects.push(frontWallR);

    // Door
    this.door = new THREE.Mesh(new THREE.BoxGeometry(4, 4.5, 0.3), doorMat);
    this.door.position.set(0, 2.25, 6);
    this.door.castShadow = true;
    this.scene.add(this.door);
    this.prisonObjects.push(this.door);
  }

  clearPrisonCell() {
    if (this.prisonObjects) {
      for (const obj of this.prisonObjects) this.scene.remove(obj);
      this.prisonObjects = [];
    }
    if (this.keyObj) {
      this.scene.remove(this.keyObj);
      this.keyObj = null;
    }
    this.door = null;
  }

  spawnGuard() {
    const mesh = this.createBuffZombieMesh();
    mesh.position.set(0, 0, 4);
    mesh.rotation.y = Math.PI;
    this.scene.add(mesh);
    this.zombies.push({
      mesh,
      type: 'guard',
      health: 300,
      maxHealth: 300,
      speed: CONFIG.zombieSpeed * 0.6,
      damage: CONFIG.zombieDamage,
      attackRange: CONFIG.zombieAttackRange,
      attackTimer: 0,
      dead: false,
      walkPhase: Math.random() * Math.PI * 2,
      legL: mesh.userData.legL,
      legR: mesh.userData.legR,
      armL: mesh.userData.armL,
      armR: mesh.userData.armR,
      hasKey: true,
    });
  }

  dropKey(pos) {
    this.keyObj = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.15, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xffdd00 })
    );
    this.keyObj.position.copy(pos);
    this.keyObj.position.y = 0.5;
    this.scene.add(this.keyObj);
    document.getElementById('escape-overlay').textContent =
      'Guard killed! The key dropped. Get close and press Shift to pick it up.';
  }

  tryEscapeInteract() {
    if (!this.escapeMode) return;
    if (this.escapeStep === 'guard' && this.keyObj) this.pickUpKey();
    else if (this.escapeStep === 'key' && this.hasKey) this.unlockCell();
  }

  pickUpKey() {
    if (!this.keyObj || this.escapeStep !== 'guard') return;
    if (this.playerPos.distanceTo(this.keyObj.position) > 2.5) return;
    this.scene.remove(this.keyObj);
    this.keyObj = null;
    this.hasKey = true;
    this.escapeStep = 'key';
    document.getElementById('escape-overlay').textContent =
      'You got the key. Press Shift near the cell door to unlock it.';
  }

  unlockCell() {
    if (!this.hasKey || this.escapeStep !== 'key' || !this.door) return;
    if (this.playerPos.distanceTo(this.door.position) > 3.5) return;
    // Slide the door open
    this.door.position.x = 3.8;
    this.door.position.y = 0.2;
    this.door.rotation.y = -Math.PI / 2;
    this.escapeStep = 'fight';
    this.hasKey = false;
    document.getElementById('escape-overlay').textContent =
      'ALERT! The cell is open. 5 zombies are coming in!';
    for (let i = 0; i < 5; i++) this.spawnEscapeZombie();
  }

  spawnEscapeZombie() {
    const mesh = this.createZombieMesh();
    const x = -4 + Math.random() * 8;
    const z = 7 + Math.random() * 3;
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const speed = CONFIG.zombieSpeed * 0.8;
    this.zombies.push({
      mesh,
      type: 'normal',
      health: CONFIG.zombieHealth,
      speed,
      damage: CONFIG.zombieDamage,
      attackRange: CONFIG.zombieAttackRange,
      attackTimer: 0,
      dead: false,
      walkPhase: Math.random() * Math.PI * 2,
      legL: mesh.userData.legL,
      legR: mesh.userData.legR,
      armL: mesh.userData.armL,
      armR: mesh.userData.armR,
    });
  }

  checkEscapeWin() {
    if (this.escapeStep !== 'fight') return;
    if (this.zombies.length === 0) this.endEscape();
  }

  endEscape() {
    this.running = false;
    this.gameOver = true;
    this.escapeStep = 'won';
    this.clearPrisonCell();
    this.ownedGuns = this.preEscapeOwned;
    this.currentGun = this.preEscapeGun;
    this.gold += 500;
    this.score += 1000;
    document.getElementById('escape-overlay').classList.add('hidden');
    document.getElementById('escaped-score').textContent =
      `${this.kills} zombies killed · Wave ${this.wave} · Score ${this.score} · ${this.gold} gold`;
    document.getElementById('escaped-screen').classList.remove('hidden');
    document.getElementById('hud').style.display = 'none';
    document.getElementById('crosshair').style.display = 'none';
    document.getElementById('health-bar-wrap').style.display = 'none';
    this.saveProgress();
  }

  // ─── Update ───
  update(dt) {
    if (!this.running || this.gameOver) return;

    // Fire rate timer
    if (this.fireTimer > 0) this.fireTimer -= dt;
    if (this.gunRecoil > 0) this.gunRecoil = Math.max(0, this.gunRecoil - dt * 0.5);
    if (this.muzzleFlash.material.opacity > 0) this.muzzleFlash.material.opacity = Math.max(0, this.muzzleFlash.material.opacity - dt * 8);

    // Reload
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    }

    // Auto-fire
    if (this.autoFire && this.pointerLocked && !this.shopOpen && !this.reloading) {
      this.shoot();
    }

    // Gold pickups always update (even in shop)
    this.updateGoldPickups(dt);

    // Pause game logic when shop is open
    if (this.shopOpen) {
      this.updateCamera();
      this.updateHUD();
      return;
    }

    // Wave management
    if (!this.escapeMode) {
      if (!this.waveActive) {
        this.waveBreakTimer -= dt;
        if (this.waveBreakTimer <= 0) this.startWave();
      } else {
        // Spawn zombies gradually
        if (this.zombiesToSpawn > 0) {
          this.spawnTimer -= dt;
          if (this.spawnTimer <= 0) {
            this.spawnZombie();
            this.zombiesToSpawn--;
            this.spawnTimer = 1.5 + Math.random() * 1.5;
          }
        } else if (this.bossPending && !this.bossSpawned) {
          // All regular zombies spawned — now spawn boss
          this.bossSpawned = true;
          this.bossPending = false;
          this.spawnBoss();
        }
      }
    } else {
      this.checkEscapeWin();
    }

    this.updateCamera();
    this.updatePlayer(dt);
    this.updateZombies(dt);
    this.updateBullets(dt);
    this.updateParticles(dt);
    this.updateHUD();
  }

  updatePlayer(dt) {
    const speed = (this.keys['shift'] ? CONFIG.playerSprintSpeed : CONFIG.playerSpeed);
    let mx = 0, mz = 0;
    if (this.keys['w']) mz -= 1;
    if (this.keys['s']) mz += 1;
    if (this.keys['a']) mx -= 1;
    if (this.keys['d']) mx += 1;

    // Normalize diagonal movement
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    // Use camera's actual facing direction (projected to horizontal plane)
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 0.0001) {
      // Looking straight up/down — fallback to yaw
      camDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    }
    camDir.normalize();

    // Right vector = forward × up (right-handed)
    const right = new THREE.Vector3();
    right.crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();

    // W (mz=-1) = forward, D (mx=+1) = right
    this.velocity.x = (camDir.x * (-mz) + right.x * mx) * speed;
    this.velocity.z = (camDir.z * (-mz) + right.z * mx) * speed;

    // Jump / gravity
    if (this.keys[' '] && this.onGround) {
      this.velocity.y = CONFIG.playerJump;
      this.onGround = false;
    }
    this.velocity.y -= CONFIG.gravity * dt;

    // Apply movement with collision
    const newX = this.playerPos.x + this.velocity.x * dt;
    const newZ = this.playerPos.z + this.velocity.z * dt;
    const newY = this.playerPos.y + this.velocity.y * dt;

    // Wall collision
    const half = CONFIG.worldSize - 1;
    this.playerPos.x = Math.max(-half, Math.min(half, newX));
    this.playerPos.z = Math.max(-half, Math.min(half, newZ));

    // Escape mode cell bounds
    if (this.escapeMode) {
      this.playerPos.x = Math.max(-5, Math.min(5, this.playerPos.x));
      this.playerPos.z = Math.max(-5, Math.min(5, this.playerPos.z));
    }

    // Obstacle collision
    for (const obs of this.obstacles) {
      const dx = this.playerPos.x - obs.x;
      const dz = this.playerPos.z - obs.z;
      const minDist = obs.w / 2 + CONFIG.playerRadius;
      if (Math.abs(dx) < minDist && Math.abs(dz) < minDist) {
        if (Math.abs(dx) > Math.abs(dz)) {
          this.playerPos.x = obs.x + Math.sign(dx) * minDist;
        } else {
          this.playerPos.z = obs.z + Math.sign(dz) * minDist;
        }
      }
    }

    // Ground collision
    if (newY <= CONFIG.playerHeight) {
      this.playerPos.y = CONFIG.playerHeight;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.playerPos.y = newY;
    }
  }

  updateZombies(dt) {
    for (const zombie of this.zombies) {
      if (zombie.dead) continue;

      // Move toward player
      const dx = this.playerPos.x - zombie.mesh.position.x;
      const dz = this.playerPos.z - zombie.mesh.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.01) {
        const dirX = dx / dist;
        const dirZ = dz / dist;
        zombie.mesh.position.x += dirX * zombie.speed * dt;
        zombie.mesh.position.z += dirZ * zombie.speed * dt;

        // Face the player
        zombie.mesh.rotation.y = Math.atan2(dirX, dirZ);

        // Walk animation — swing legs and arms
        zombie.walkPhase += dt * zombie.speed * 2;
        const swing = Math.sin(zombie.walkPhase) * 0.3;
        zombie.legL.rotation.x = swing;
        zombie.legR.rotation.x = -swing;
      }

      // Attack player
      zombie.attackTimer -= dt;
      const attackRange = zombie.attackRange || CONFIG.zombieAttackRange;
      if (dist < attackRange && zombie.attackTimer <= 0) {
        zombie.attackTimer = CONFIG.zombieAttackCooldown;
        // Lunge animation
        zombie.armL.rotation.x = -Math.PI / 2 + 0.3;
        zombie.armR.rotation.x = -Math.PI / 2 - 0.3;
        setTimeout(() => {
          if (!zombie.dead) {
            zombie.armL.rotation.x = -Math.PI / 2;
            zombie.armR.rotation.x = -Math.PI / 2;
          }
        }, 200);

        if (zombie.isBoss) {
          // Boss knocks you out — no matter what, you wake up in a cell
          this.startEscape();
          return;
        } else {
          this.takeDamage(zombie.damage || CONFIG.zombieDamage);
        }
      }
    }
  }

  takeDamage(amount) {
    this.health -= amount;
    // Damage flash
    const overlay = document.getElementById('damage-overlay');
    overlay.classList.add('hit');
    setTimeout(() => overlay.classList.remove('hit'), 150);
    this.updateHUD();
    if (this.health <= 0) {
      this.health = 0;
      this.endGame();
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= CONFIG.gravity * dt * 0.5;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.y += p.vel.y * dt;
      p.mesh.position.z += p.vel.z * dt;
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vel.y = 0;
        p.vel.x *= 0.5;
        p.vel.z *= 0.5;
      }
    }
  }

  updateCamera() {
    this.camera.position.copy(this.playerPos);
    // Apply yaw and pitch
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Gun recoil offset
    this.gun.position.z = -0.5 + this.gunRecoil;
    this.gun.position.y = -0.3 - this.gunRecoil * 0.3;

    // Flashlight follows camera
    this.flashlight.position.copy(this.camera.position);
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(this.camera.rotation);
    this.flashlight.target.position.copy(this.camera.position).add(dir.multiplyScalar(20));
  }

  updateHUD() {
    document.getElementById('health-val').textContent = Math.ceil(this.health);
    document.getElementById('score-val').textContent = this.score;
    document.getElementById('wave-val').textContent = this.wave;
    document.getElementById('gold-val').textContent = this.gold;
    const gunName = GUNS[this.currentGun].name;
    const autoTag = this.autoFire ? ' [AUTO]' : '';
    if (this.reloading) {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — RELOADING...`;
    } else if (this.ammo === Infinity) {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — ∞`;
    } else {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — ${this.ammo}/∞`;
    }
    // Health bar
    const maxHP = this.getGunStat('maxHealth');
    const pct = (this.health / maxHP) * 100;
    document.getElementById('health-bar').style.width = pct + '%';
  }

  // ─── Main Loop ───
  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

// Start the game
window.addEventListener('load', () => {
  window.game = new ZombieGame();
});

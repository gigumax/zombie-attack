// ============================================================
//  ZOMBIE SHOOTER 3D — Multiplayer Client
// ============================================================

const CONFIG = {
  worldSize: 60, playerHeight: 1.7, playerRadius: 0.4, maxHealth: 100,
  bulletRange: 100, zombieHealth: 100, zombieSpeed: 2.5,
};

const GUNS = {
  knife:  { name:'Knife', magSize:Infinity, reloadTime:0, fireRate:0.3, damage:60, pellets:1, spread:0, price:0, melee:true },
  pistol: { name:'Pistol', magSize:12, reloadTime:1.2, fireRate:0.25, damage:34, pellets:1, spread:0.01, price:0 },
  smg:    { name:'SMG', magSize:100, reloadTime:1.8, fireRate:0.08, damage:25, pellets:1, spread:0.03, price:150 },
  shotgun:{ name:'Shotgun', magSize:6, reloadTime:2.5, fireRate:0.6, damage:20, pellets:8, spread:0.12, price:250 },
  rifle:  { name:'Rifle', magSize:500, reloadTime:1.0, fireRate:0.06, damage:55, pellets:1, spread:0.005, price:400 },
};

const UPGRADES = {
  damage:  { name:'Damage +10', price:100, maxLevel:5 },
  fireRate:{ name:'Fire Rate +20%', price:80, maxLevel:5 },
  magSize: { name:'Mag Size +5', price:60, maxLevel:5 },
  health:  { name:'Max Health +25', price:120, maxLevel:5 },
};

class ZombieMultiplayerClient {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 30, 80);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

    this.clock = new THREE.Clock();
    this.pointerLocked = false;

    // Local state
    this.myId = null;
    this.myName = '';
    this.socket = null;
    this.connected = false;
    this.playing = false;

    // Input
    this.keys = {};
    this.yaw = 0;
    this.pitch = 0;

    // Rendered objects (tracked for updates)
    this.zombieMeshes = {};   // id -> mesh
    this.goldMeshes = {};     // id -> mesh
    this.otherPlayerMeshes = {}; // id -> mesh
    this.bullets = [];
    this.particles = [];

    // Local player state (from server)
    this.myPlayer = null;
    this.serverState = null;
    this.playerMeta = { upgrades: {}, ownedGuns: { knife: true, pistol: true }, maxHealth: 100 };

    // Interpolation: store previous positions for smooth movement
    this.prevPositions = { zombies: {}, players: {}, gold: {} };
    this.targetPositions = { zombies: {}, players: {}, gold: {} };
    this.interpAlpha = 0;

    // Cached vectors to avoid GC
    this._tmpVec1 = new THREE.Vector3();
    this._tmpVec2 = new THREE.Vector3();

    // Input throttling
    this._lastInputSend = 0;
    this._inputDirty = false;

    // Shop re-render throttle
    this._lastShopRender = 0;
    this._lastShopGold = -1;

    // Gun view model
    this.gun = null;
    this.gunParts = {};
    this.knifeMesh = null;
    this.muzzleFlash = null;
    this.gunRecoil = 0;

    this.setupLights();
    this.setupWorld();
    this.setupGun();
    this.setupInput();
    this.setupConnectScreen();
    this.setupShopClicks();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.animate();
  }

  // ─── Connection ───
  setupConnectScreen() {
    // Auto-fill server address based on current page URL
    const autoAddr = window.location.origin;
    document.getElementById('server-addr').value = autoAddr;
    document.getElementById('connect-btn').addEventListener('click', () => {
      const addr = document.getElementById('server-addr').value.trim() || autoAddr;
      this.connect(addr);
    });
  }

  connect(addr) {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }

    this.socket = io(addr, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.connected = true;
      document.getElementById('connect-screen').classList.add('hidden');
      document.getElementById('start-screen').classList.remove('hidden');
    });

    this.socket.on('connect_error', () => {
      const box = document.querySelector('#connect-screen .box');
      box.innerHTML = '<h2 style="color:#e74c3c;">CONNECTION FAILED</h2><p>Make sure the server is running.<br>Open Terminal and run:<br><kbd>node zombie-server.js</kbd></p><button id="retry-btn" class="btn">RETRY</button>';
      document.getElementById('retry-btn').addEventListener('click', () => location.reload());
    });

    this.socket.on('connected', (data) => {
      this.myId = data.id;
      this.myName = data.name;
    });

    this.socket.on('playerMeta', (meta) => {
      this.playerMeta = meta;
    });

    this.socket.on('state', (state) => {
      // Store previous positions for interpolation
      if (this.serverState) {
        for (const z of (this.serverState.zombies || [])) {
          this.prevPositions.zombies[z.id] = { x: z.x, z: z.z, r: z.r };
        }
        for (const p of (this.serverState.players || [])) {
          this.prevPositions.players[p.id] = { x: p.x, y: p.y, z: p.z };
        }
      }
      this.serverState = state;
      this.myPlayer = state.players.find(p => p.id === this.myId);
      this.interpAlpha = 0;
      this.updateScene(state, this._lastDt || 0.016);
      this.updateHUD();
    });

    this.socket.on('killFeed', (feed) => {
      this.renderKillFeed(feed);
    });

    this.socket.on('waveAnnounce', (text) => {
      const el = document.getElementById('wave-announce');
      el.textContent = text;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 2500);
    });

    this.socket.on('escapeStart', (data) => {
      document.getElementById('escape-overlay').textContent = data.text;
      document.getElementById('escape-overlay').classList.remove('hidden');
      document.getElementById('start-screen').classList.add('hidden');
      document.getElementById('game-over-screen').classList.add('hidden');
      this.buildPrisonCell();
    });

    this.socket.on('escapeUpdate', (text) => {
      document.getElementById('escape-overlay').textContent = text;
    });

    this.socket.on('escapeWin', () => {
      document.getElementById('escape-overlay').classList.add('hidden');
      this.clearPrisonCell();
      if (this.myPlayer) {
        document.getElementById('escaped-score').textContent =
          `${this.myPlayer.k} kills · Wave ${this.serverState ? this.serverState.wave : 1} · Score ${this.myPlayer.s} · ${this.myPlayer.g} gold`;
      }
      document.getElementById('escaped-screen').classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
    });

    this.socket.on('gameOver', (data) => {
      if (this.myPlayer) {
        document.getElementById('final-score').textContent =
          `${this.myPlayer.k} kills · Wave ${data.wave} · Score ${data.score}`;
      }
      this.clearPrisonCell();
      document.getElementById('game-over-screen').classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
    });

    this.socket.on('playerList', (list) => {
      this.renderPlayerList(list);
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
    });
  }

  // ─── Lights ───
  setupLights() {
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);

    const moon = new THREE.DirectionalLight(0x8888ff, 0.5);
    moon.position.set(20, 40, 20);
    moon.castShadow = true;
    moon.shadow.mapSize.width = 1024;
    moon.shadow.mapSize.height = 1024;
    moon.shadow.camera.left = -50;
    moon.shadow.camera.right = 50;
    moon.shadow.camera.top = 50;
    moon.shadow.camera.bottom = -50;
    moon.shadow.camera.far = 100;
    this.scene.add(moon);

    this.flashlight = new THREE.SpotLight(0xffeeaa, 1.5, 40, Math.PI / 5, 0.4, 1);
    this.flashlight.castShadow = false;
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlight.target);
  }

  // ─── World ───
  setupWorld() {
    const groundGeo = new THREE.PlaneGeometry(CONFIG.worldSize * 2, CONFIG.worldSize * 2);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3a5f3a });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(CONFIG.worldSize * 2, 40, 0x2a4a2a, 0x2a4a2a);
    grid.position.y = 0.01;
    this.scene.add(grid);

    const wallMat = new THREE.MeshLambertMaterial({ color: 0x4a4a5a });
    const wallH = 6;
    const half = CONFIG.worldSize;
    const wallGeo = new THREE.BoxGeometry(half * 2, wallH, 1);
    for (let i = 0; i < 4; i++) {
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.castShadow = true; wall.receiveShadow = true;
      if (i === 0) wall.position.set(0, wallH/2, -half);
      else if (i === 1) wall.position.set(0, wallH/2, half);
      else if (i === 2) { wall.rotation.y = Math.PI/2; wall.position.set(-half, wallH/2, 0); }
      else { wall.rotation.y = Math.PI/2; wall.position.set(half, wallH/2, 0); }
      this.scene.add(wall);
    }

    // Trees
    const treePositions = [
      [-15,-10],[12,-8],[-5,15],[8,12],[-20,5],
      [18,18],[-12,-20],[5,-15],[22,-5],[-25,-3],
    ];
    for (const [x,z] of treePositions) this.createTree(x, z);

    // Crates
    const cratePositions = [[-3,-5],[6,3],[-8,8],[10,-12],[15,6]];
    for (const [x,z] of cratePositions) this.createCrate(x, z);
  }

  createTree(x, z) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1,4,1), new THREE.MeshLambertMaterial({color:0x5a3a2a}));
    trunk.position.y = 2; trunk.castShadow = true; group.add(trunk);
    const leafMat = new THREE.MeshLambertMaterial({color:0x2a6a2a});
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(3,2,3), leafMat);
    l1.position.y = 5; l1.castShadow = true; group.add(l1);
    const l2 = new THREE.Mesh(new THREE.BoxGeometry(2,2,2), leafMat);
    l2.position.y = 7; l2.castShadow = true; group.add(l2);
    group.position.set(x, 0, z);
    this.scene.add(group);
  }

  createCrate(x, z) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5), new THREE.MeshLambertMaterial({color:0x8B6914}));
    crate.position.set(x, 0.75, z);
    crate.castShadow = true; crate.receiveShadow = true;
    this.scene.add(crate);
  }

  // ─── Gun view model ───
  setupGun() {
    this.gun = new THREE.Group();
    // Use MeshBasicMaterial so gun is always visible regardless of lighting
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.25,0.9), new THREE.MeshBasicMaterial({color:0x2a2a2a}));
    this.gun.add(body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,0.6), new THREE.MeshBasicMaterial({color:0x1a1a1a}));
    barrel.position.set(0, 0.05, -0.7); this.gun.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.35,0.18), new THREE.MeshBasicMaterial({color:0x333333}));
    mag.position.set(0, -0.25, 0.15); this.gun.add(mag);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.06,0.04), new THREE.MeshBasicMaterial({color:0x555555}));
    sight.position.set(0, 0.15, -0.1); this.gun.add(sight);
    this.muzzleFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    this.muzzleFlash.position.set(0, 0.05, -1.05);
    this.gun.add(this.muzzleFlash);

    this.gunParts = { body, barrel, mag };
    this.gunParts.body.visible = true;
    this.gunParts.barrel.visible = true;
    this.gunParts.mag.visible = true;

    // Knife
    this.knifeMesh = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.18,0.5), new THREE.MeshBasicMaterial({color:0x3a2a1a}));
    handle.position.set(0, 0, 0.25); this.knifeMesh.add(handle);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.08,1.0), new THREE.MeshBasicMaterial({color:0xcccccc}));
    blade.position.set(0, 0.03, -0.55); this.knifeMesh.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.25,0.08,0.1), new THREE.MeshBasicMaterial({color:0x888888}));
    guard.position.set(0, 0.03, 0); this.knifeMesh.add(guard);
    this.knifeMesh.visible = false;
    this.gun.add(this.knifeMesh);

    // Katana
    this.katanaMesh = new THREE.Group();
    const katHandle = new THREE.Mesh(new THREE.BoxGeometry(0.12,0.16,0.55), new THREE.MeshBasicMaterial({color:0x1a1a1a}));
    katHandle.position.set(0, 0, 0.3); this.katanaMesh.add(katHandle);
    const katGuard = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.1,0.12), new THREE.MeshBasicMaterial({color:0x8a7a3a}));
    katGuard.position.set(0, 0.03, 0.02); this.katanaMesh.add(katGuard);
    const katBlade = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.12,1.8), new THREE.MeshBasicMaterial({color:0xe8e8e8}));
    katBlade.position.set(0, 0.06, -0.9); this.katanaMesh.add(katBlade);
    const katTip = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.12,0.2), new THREE.MeshBasicMaterial({color:0xc8c8c8}));
    katTip.position.set(0, 0.06, -1.85); this.katanaMesh.add(katTip);
    this.katanaMesh.visible = false;
    this.gun.add(this.katanaMesh);

    this.gun.position.set(0.4, -0.35, -0.6);
    this.camera.add(this.gun);
    this.scene.add(this.camera);
  }

  updateGunVisual() {
    if (!this.myPlayer) return;
    const gunName = this.myPlayer.gun;
    const gun = GUNS[gunName];
    const isMelee = gun && gun.melee;
    const isKatana = gunName === 'katana';
    this.gunParts.body.visible = !isMelee;
    this.gunParts.barrel.visible = !isMelee;
    this.gunParts.mag.visible = !isMelee;
    this.knifeMesh.visible = isMelee && !isKatana;
    this.katanaMesh.visible = isMelee && isKatana;
    this.muzzleFlash.visible = !isMelee;
  }

  // ─── Input ───
  setupInput() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (!this.connected) return;
      if (k === 'r' && this.playing) this.socket.emit('reload');
      if (e.code === 'KeyB' && this.playing) { this.socket.emit('toggleShop'); e.preventDefault(); }
      if (e.code === 'KeyG' && this.playing) this.socket.emit('toggleAutoFire');
      if (e.code === 'Digit2' && this.playing) this.socket.emit('switchGun', 'knife');
      if (e.code === 'Digit3' && this.playing) this.socket.emit('switchGun', 'katana');
      if (e.code === 'Digit4' && this.playing) this.socket.emit('switchGun', 'smg');
      if (e.code === 'Digit5' && this.playing) this.socket.emit('switchGun', 'shotgun');
      if (e.code === 'Digit6' && this.playing) this.socket.emit('switchGun', 'rifle');
      if (e.code === 'Digit1' && this.playing) this.socket.emit('switchGun', 'pistol');
      if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && this.playing) this.socket.emit('escapeInteract');
      if (k === ' ') e.preventDefault();
      this.sendInput();
    });

    window.addEventListener('keyup', e => {
      this.keys[e.key.toLowerCase()] = false;
      this.sendInput();
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = (document.pointerLockElement === this.canvas);
    });

    document.addEventListener('mousemove', e => {
      if (!this.pointerLocked || !this.playing) return;
      this.yaw -= e.movementX * 0.002;
      this.pitch -= e.movementY * 0.002;
      this.pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, this.pitch));
      this.sendInput();
    });

    document.addEventListener('mousedown', e => {
      if (!this.pointerLocked || !this.playing) return;
      if (e.button === 0) this.socket.emit('shoot');
    });

    document.getElementById('start-btn').addEventListener('click', () => {
      document.getElementById('start-screen').classList.add('hidden');
      this.playing = true;
      document.getElementById('hud').style.display = 'flex';
      document.getElementById('crosshair').style.display = 'block';
      document.getElementById('health-bar-wrap').style.display = 'block';
      document.getElementById('player-list').style.display = 'block';
      this.canvas.requestPointerLock();
    });

    document.getElementById('respawn-btn').addEventListener('click', () => {
      document.getElementById('game-over-screen').classList.add('hidden');
      this.socket.emit('respawn');
      this.canvas.requestPointerLock();
    });

    document.getElementById('escaped-restart-btn').addEventListener('click', () => {
      document.getElementById('escaped-screen').classList.add('hidden');
      this.canvas.requestPointerLock();
    });
  }

  sendInput() {
    if (!this.socket || !this.connected) return;
    this._inputDirty = true;
  }

  flushInput() {
    if (!this._inputDirty) return;
    const now = performance.now();
    if (now - this._lastInputSend < 50) return; // max 20/sec
    this._lastInputSend = now;
    this._inputDirty = false;
    this.socket.emit('input', { keys: this.keys, yaw: this.yaw, pitch: this.pitch });
  }

  // ─── Zombie mesh creation (same as single-player) ───
  createZombieMesh(isBoss = false, revivePhase = 0) {
    const group = new THREE.Group();
    if (isBoss) {
      // Creepier colors with each revival phase — progressively darker and more demonic
      const phase = revivePhase || 0;
      const skinColors = [0x4a6a3a, 0x2a4a1a, 0x1a2a0a, 0x0a0a05];
      const shirtColors = [0x1a4a4a, 0x0a2a2a, 0x050a0a, 0x000000];
      const pantsColors = [0x2a1a4a, 0x1a0a2a, 0x0a050a, 0x000000];
      const eyeColors = [0x660000, 0xff0000, 0xff3300, 0xffff00];
      const hornColors = [0x3a2a1a, 0x2a1a0a, 0x1a0a05, 0x000000];
      const skinMat = new THREE.MeshLambertMaterial({color: skinColors[phase], emissive: phase >= 2 ? eyeColors[phase] : 0x000000, emissiveIntensity: phase >= 2 ? 0.05 : 0});
      const shirtMat = new THREE.MeshLambertMaterial({color: shirtColors[phase]});
      const pantsMat = new THREE.MeshLambertMaterial({color: pantsColors[phase]});
      const eyeMat = new THREE.MeshBasicMaterial({color: eyeColors[phase]});
      const hornMat = new THREE.MeshLambertMaterial({color: hornColors[phase]});
      const torso = new THREE.Mesh(new THREE.BoxGeometry(1.6,1.2,0.9), shirtMat);
      torso.position.set(0,2.0,0.2); torso.rotation.x = 0.25; torso.castShadow = true; group.add(torso);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8), skinMat);
      head.position.set(0,2.9,0.75); head.rotation.x = 0.15; head.castShadow = true; group.add(head);
      // Glowing eyes — bigger and more menacing with phase
      const eyeSize = 0.18 + phase * 0.04;
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(eyeSize, eyeSize, 0.08), eyeMat);
      eyeL.position.set(-0.18,3.0,1.14); group.add(eyeL);
      const eyeR = eyeL.clone(); eyeR.position.x = 0.18; group.add(eyeR);
      // Fangs for phase 1+
      if (phase >= 1) {
        const fangMat = new THREE.MeshBasicMaterial({color: 0xffffff});
        const fangL = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 4), fangMat);
        fangL.position.set(-0.15, 2.7, 1.1); fangL.rotation.x = Math.PI; group.add(fangL);
        const fangR = fangL.clone(); fangR.position.x = 0.15; group.add(fangR);
      }
      const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.7,0.9), shirtMat);
      shoulderL.position.set(-0.9,2.4,0.1); shoulderL.rotation.x = 0.25; group.add(shoulderL);
      const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.9; group.add(shoulderR);
      // Shoulder spikes for phase 2+
      if (phase >= 2) {
        const sl = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 4), hornMat);
        sl.position.set(-0.9, 2.9, 0.1); group.add(sl);
        const sr = sl.clone(); sr.position.x = 0.9; group.add(sr);
      }
      const armGeo = new THREE.BoxGeometry(0.55,2.0,0.55);
      const armL = new THREE.Mesh(armGeo, skinMat); armL.position.set(-1.15,1.4,0.05); armL.castShadow = true; group.add(armL);
      const armR = new THREE.Mesh(armGeo, skinMat); armR.position.set(1.15,1.4,0.05); armR.castShadow = true; group.add(armR);
      // Claws for phase 1+
      if (phase >= 1) {
        const clawMat = new THREE.MeshLambertMaterial({color: 0x1a1a1a});
        for (const ax of [-1.15, 1.15]) {
          for (let c = -1; c <= 1; c++) {
            const claw = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 4), clawMat);
            claw.position.set(ax + c * 0.15, 0.35, 0.1); claw.rotation.x = Math.PI; group.add(claw);
          }
        }
      }
      const legGeo = new THREE.BoxGeometry(0.45,1.3,0.55);
      const legL = new THREE.Mesh(legGeo, pantsMat); legL.position.set(-0.4,0.65,0); legL.castShadow = true; group.add(legL);
      const legR = new THREE.Mesh(legGeo, pantsMat); legR.position.set(0.4,0.65,0); legR.castShadow = true; group.add(legR);
      // Horns — bigger and more with each phase
      const hornSize = 0.3 + phase * 0.15;
      const hornLen = 0.4 + phase * 0.2;
      const hornL = new THREE.Mesh(new THREE.ConeGeometry(hornSize, hornLen, 4), hornMat);
      hornL.position.set(-0.3, 3.4, 0.6); hornL.rotation.x = -0.3; group.add(hornL);
      const hornR = new THREE.Mesh(new THREE.ConeGeometry(hornSize, hornLen, 4), hornMat);
      hornR.position.set(0.3, 3.4, 0.6); hornR.rotation.x = -0.3; group.add(hornR);
      // Side horns for phase 2+
      if (phase >= 2) {
        const shL = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 4), hornMat);
        shL.position.set(-0.5, 3.2, 0.5); shL.rotation.z = 0.5; group.add(shL);
        const shR = shL.clone(); shR.position.x = 0.5; shR.rotation.z = -0.5; group.add(shR);
      }
      // Back spikes for phase 2+
      if (phase >= 2) {
        for (let i = 0; i < 5; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1 + phase * 0.03, 0.5 + phase * 0.1, 4), hornMat);
          spike.position.set(0, 1.4 + i * 0.45, -0.5); group.add(spike);
        }
      }
      // Glowing red core in chest for phase 3
      if (phase >= 3) {
        const coreMat = new THREE.MeshBasicMaterial({color: 0xff0000, transparent: true, opacity: 0.9});
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), coreMat);
        core.position.set(0, 2.0, 0.5); group.add(core);
        group.userData.core = core;
      }
      // Blood drip dots for phase 1+
      if (phase >= 1) {
        const bloodMat = new THREE.MeshBasicMaterial({color: 0x990000});
        for (let i = 0; i < 3 + phase * 2; i++) {
          const drip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 4), bloodMat);
          drip.position.set((Math.random() - 0.5) * 1.4, 1.5 + Math.random() * 0.8, 0.4 + Math.random() * 0.3);
          group.add(drip);
        }
      }
      const bossScale = 2.2 + phase * 0.4;
      group.scale.set(bossScale, bossScale, bossScale);
      group.userData = { armL, armR, legL, legR, head, torso, revivePhase: phase };
      return group;
    }
    const skinMat = new THREE.MeshLambertMaterial({color:0x4a7a4a});
    const shirtMat = new THREE.MeshLambertMaterial({color:0x3a6aad});
    const pantsMat = new THREE.MeshLambertMaterial({color:0x2a2a5a});
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5), skinMat);
    head.position.y = 1.8; head.castShadow = true; group.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({color:0x000000});
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.12,0.12,0.05), eyeMat);
    eyeL.position.set(-0.12,1.85,0.26); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.12; group.add(eyeR);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.75,0.3), shirtMat);
    torso.position.y = 1.15; torso.castShadow = true; group.add(torso);
    const armGeo = new THREE.BoxGeometry(0.25,0.5,0.25);
    const armL = new THREE.Mesh(armGeo, skinMat); armL.position.set(-0.38,1.3,0.3); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, skinMat); armR.position.set(0.38,1.3,0.3); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    const legGeo = new THREE.BoxGeometry(0.22,0.75,0.22);
    const legL = new THREE.Mesh(legGeo, pantsMat); legL.position.set(-0.13,0.375,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, pantsMat); legR.position.set(0.13,0.375,0); legR.castShadow = true; group.add(legR);
    group.userData = { armL, armR, legL, legR, head };
    return group;
  }

  createBuffZombieMesh() {
    const group = new THREE.Group();
    const scale = 1.4;
    const skinMat = new THREE.MeshLambertMaterial({color:0x8a2a2a});
    const shirtMat = new THREE.MeshLambertMaterial({color:0x4a1a1a});
    const pantsMat = new THREE.MeshLambertMaterial({color:0x2a0a0a});
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55*scale,0.55*scale,0.55*scale), skinMat);
    head.position.y = 1.8*scale; head.castShadow = true; group.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({color:0xff0000});
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.13*scale,0.13*scale,0.06*scale), eyeMat);
    eyeL.position.set(-0.13*scale,1.85*scale,0.29*scale); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.13*scale; group.add(eyeR);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.65*scale,0.85*scale,0.4*scale), shirtMat);
    torso.position.y = 1.15*scale; torso.castShadow = true; group.add(torso);
    const armGeo = new THREE.BoxGeometry(0.35*scale,0.65*scale,0.35*scale);
    const armL = new THREE.Mesh(armGeo, skinMat); armL.position.set(-0.45*scale,1.35*scale,0.35*scale); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, skinMat); armR.position.set(0.45*scale,1.35*scale,0.35*scale); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    const legGeo = new THREE.BoxGeometry(0.28*scale,0.85*scale,0.28*scale);
    const legL = new THREE.Mesh(legGeo, pantsMat); legL.position.set(-0.15*scale,0.425*scale,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, pantsMat); legR.position.set(0.15*scale,0.425*scale,0); legR.castShadow = true; group.add(legR);
    group.userData = { armL, armR, legL, legR, head };
    return group;
  }

  createSkeletonMesh() {
    const group = new THREE.Group();
    const scale = 1.05;
    const boneMat = new THREE.MeshLambertMaterial({color:0xdddddd});
    const darkMat = new THREE.MeshLambertMaterial({color:0x2a2a2a});
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45*scale,0.45*scale,0.45*scale), boneMat);
    head.position.y = 1.8*scale; head.castShadow = true; group.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({color:0xff0000});
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1*scale,0.1*scale,0.05*scale), eyeMat);
    eyeL.position.set(-0.1*scale,1.82*scale,0.24*scale); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.1*scale; group.add(eyeR);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.35*scale,0.75*scale,0.25*scale), darkMat);
    torso.position.y = 1.15*scale; torso.castShadow = true; group.add(torso);
    const armGeo = new THREE.BoxGeometry(0.12*scale,0.75*scale,0.12*scale);
    const armL = new THREE.Mesh(armGeo, boneMat); armL.position.set(-0.32*scale,1.3*scale,0.3*scale); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, boneMat); armR.position.set(0.32*scale,1.3*scale,0.3*scale); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    const legGeo = new THREE.BoxGeometry(0.12*scale,0.85*scale,0.12*scale);
    const legL = new THREE.Mesh(legGeo, boneMat); legL.position.set(-0.12*scale,0.425*scale,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, boneMat); legR.position.set(0.12*scale,0.425*scale,0); legR.castShadow = true; group.add(legR);
    group.userData = { armL, armR, legL, legR, head };
    return group;
  }

  createGuardMesh() {
    return this.createBuffZombieMesh();
  }

  createCreepyZombieMesh() {
    const group = new THREE.Group();
    const scale = 1.15;
    // Creepy zombie — pitch black skin, glowing white eyes, long limbs
    const skinMat = new THREE.MeshLambertMaterial({color:0x0a0a0a, emissive:0x000033, emissiveIntensity:0.3});
    const darkMat = new THREE.MeshLambertMaterial({color:0x050505});
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5*scale,0.6*scale,0.5*scale), skinMat);
    head.position.y = 1.9*scale; head.castShadow = true; head.rotation.x = 0.15; group.add(head);
    // Glowing white eyes
    const eyeMat = new THREE.MeshBasicMaterial({color:0xffffff});
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.14*scale,0.14*scale,0.06*scale), eyeMat);
    eyeL.position.set(-0.12*scale,1.95*scale,0.27*scale); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.12*scale; group.add(eyeR);
    // Glowing eye glow halos
    const glowMat = new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.3});
    const glowL = new THREE.Mesh(new THREE.SphereGeometry(0.1*scale, 6, 6), glowMat);
    glowL.position.set(-0.12*scale,1.95*scale,0.28*scale); group.add(glowL);
    const glowR = glowL.clone(); glowR.position.x = 0.12*scale; group.add(glowR);
    // Jagged fangs
    const fangMat = new THREE.MeshBasicMaterial({color:0xcccccc});
    for (let i = -2; i <= 2; i++) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.03*scale, 0.1*scale, 3), fangMat);
      fang.position.set(i * 0.06*scale, 1.65*scale, 0.25*scale); fang.rotation.x = Math.PI; group.add(fang);
    }
    // Hunched torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.45*scale,0.8*scale,0.3*scale), darkMat);
    torso.position.y = 1.2*scale; torso.rotation.x = 0.12; torso.castShadow = true; group.add(torso);
    // Long thin arms reaching forward
    const armGeo = new THREE.BoxGeometry(0.18*scale,0.7*scale,0.18*scale);
    const armL = new THREE.Mesh(armGeo, skinMat); armL.position.set(-0.35*scale,1.35*scale,0.4*scale); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, skinMat); armR.position.set(0.35*scale,1.35*scale,0.4*scale); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    // Claws on hands
    const clawMat = new THREE.MeshBasicMaterial({color:0x222222});
    for (const armX of [-0.35, 0.35]) {
      for (let c = -1; c <= 1; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03*scale, 0.15*scale, 3), clawMat);
        claw.position.set(armX*scale + c*0.05*scale, 1.35*scale, 0.75*scale);
        claw.rotation.x = -Math.PI/2;
        group.add(claw);
      }
    }
    const legGeo = new THREE.BoxGeometry(0.2*scale,0.8*scale,0.2*scale);
    const legL = new THREE.Mesh(legGeo, skinMat); legL.position.set(-0.13*scale,0.4*scale,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, skinMat); legR.position.set(0.13*scale,0.4*scale,0); legR.castShadow = true; group.add(legR);
    // Blood drips
    const bloodMat = new THREE.MeshBasicMaterial({color:0x440000});
    for (let i = 0; i < 5; i++) {
      const drip = new THREE.Mesh(new THREE.SphereGeometry(0.035*scale, 4, 4), bloodMat);
      drip.position.set((Math.random()-0.5)*0.4*scale, 0.9*scale + Math.random()*0.4*scale, 0.18*scale);
      group.add(drip);
    }
    // Spikes on back
    const spikeMat = new THREE.MeshBasicMaterial({color:0x1a1a1a});
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05*scale, 0.25*scale, 4), spikeMat);
      spike.position.set(0, 1.5*scale - i*0.2*scale, -0.2*scale);
      spike.rotation.x = -0.3;
      group.add(spike);
    }
    group.userData = { armL, armR, legL, legR, head };
    return group;
  }

  createZombieMeshByType(type, isBoss, revivePhase = 0) {
    if (isBoss) return this.createZombieMesh(true, revivePhase);
    if (type === 'buff') return this.createBuffZombieMesh();
    if (type === 'skeleton') return this.createSkeletonMesh();
    if (type === 'guard') return this.createGuardMesh();
    if (type === 'creepy') return this.createCreepyZombieMesh();
    return this.createZombieMesh();
  }

  // ─── Scene sync ───
  // Map short type char to full type name
  static TYPE_MAP = { n: 'normal', b: 'buff', s: 'skeleton', g: 'guard', c: 'creepy' };

  updateScene(state, dt) {
    const TYPE_MAP = ZombieMultiplayerClient.TYPE_MAP;
    const now = performance.now();

    // Update zombies
    const seenZombieIds = new Set();
    for (const z of state.zombies) {
      seenZombieIds.add(z.id);
      let mesh = this.zombieMeshes[z.id];
      // Recreate boss mesh if revive phase changed
      if (mesh && z.boss && mesh.userData.revivePhase !== (z.rv || 0)) {
        this.scene.remove(mesh);
        mesh = null;
      }
      if (!mesh) {
        mesh = this.createZombieMeshByType(TYPE_MAP[z.t] || 'normal', z.boss, z.rv || 0);
        this.scene.add(mesh);
        this.zombieMeshes[z.id] = mesh;
      }
      // Interpolate position (skip for dying zombies — they stay put)
      if (!z.dy) {
        const prev = this.prevPositions.zombies[z.id];
        if (prev) {
          const t = Math.min(this.interpAlpha, 1);
          mesh.position.x = prev.x + (z.x - prev.x) * t;
          mesh.position.z = prev.z + (z.z - prev.z) * t;
          mesh.rotation.y = prev.r + ((z.r || 0) - prev.r) * t;
        } else {
          mesh.position.set(z.x, 0, z.z);
          mesh.rotation.y = z.r || 0;
        }
      }
      // Walk animation — legs, arms, head bob, torso sway
      const ud = mesh.userData;
      const swing = Math.sin(z.wp);
      // Handle limb loss — hide limbs and spawn exploding detached limb
      if (z.la && ud.armL && ud.armL.visible) {
        ud.armL.visible = false;
        this.spawnLimbExplosion(z.x, 1.3, z.z, ud.armL, z.r || 0);
      }
      if (z.ra && ud.armR && ud.armR.visible) {
        ud.armR.visible = false;
        this.spawnLimbExplosion(z.x, 1.3, z.z, ud.armR, z.r || 0);
      }
      if (z.ll && ud.legL && ud.legL.visible) {
        ud.legL.visible = false;
        this.spawnLimbExplosion(z.x, 0.4, z.z, ud.legL, z.r || 0);
      }
      if (z.rl && ud.legR && ud.legR.visible) {
        ud.legR.visible = false;
        this.spawnLimbExplosion(z.x, 0.4, z.z, ud.legR, z.r || 0);
      }
      // Boss special attack effects
      if (z.slm) {
        this.spawnSlamEffect(z.x, z.z);
      }
      if (z.rng) {
        this.spawnRangedEffect(z.x, 3.0, z.z, z.r || 0);
      }
      if (z.crk) {
        this.spawnCrackEffect(z.x, z.z, z.cdx, z.cdz, z.clen);
      }
      // Boss reviving — pulse red and shake
      if (z.rvv) {
        const t = performance.now() / 1000;
        const pulse = Math.sin(t * 10) * 0.5 + 0.5;
        mesh.position.y = Math.sin(t * 15) * 0.1; // shake
        mesh.rotation.z = Math.sin(t * 20) * 0.05;
        // Flash all materials red
        mesh.traverse(child => {
          if (child.material && child.material.color) {
            child.material.emissive = new THREE.Color(pulse, 0, 0);
            child.material.emissiveIntensity = pulse;
          }
        });
      } else if (z.boss) {
        // Reset emissive when not reviving
        mesh.traverse(child => {
          if (child.material && child.material.emissive) {
            child.material.emissiveIntensity = 0;
          }
        });
      }
      if (z.dy) {
        // Dying zombie — fall immediately
        if (!ud.fallTimer) ud.fallTimer = 0;
        ud.fallTimer += dt;
        const fallProgress = Math.min(ud.fallTimer / 0.3, 1); // fall over 0.3 seconds
        mesh.rotation.x = fallProgress * (Math.PI / 2);
        mesh.position.y = -fallProgress * 0.3;
        // Stop walk animation — limbs go limp
        if (ud.legL && ud.legR) {
          ud.legL.rotation.x = 0;
          ud.legR.rotation.x = 0;
        }
        if (ud.armL && ud.armR) {
          ud.armL.rotation.x = 0;
          ud.armR.rotation.x = 0;
        }
      } else {
        if (ud.legL && ud.legR) {
          ud.legL.rotation.x = swing * 0.4;
          ud.legR.rotation.x = -swing * 0.4;
        }
        if (ud.armL && ud.armR) {
          // Arms reach forward and sway
          const baseArm = -Math.PI / 2; // forward reach
          ud.armL.rotation.x = baseArm + swing * 0.15;
          ud.armR.rotation.x = baseArm - swing * 0.15;
        }
        if (ud.head) {
          ud.head.position.y = (ud.head.userData.baseY || ud.head.position.y);
          if (!ud.head.userData.baseY) ud.head.userData.baseY = ud.head.position.y;
          ud.head.position.y = ud.head.userData.baseY + Math.abs(swing) * 0.03;
          ud.head.rotation.z = swing * 0.05;
        }
        if (ud.torso) {
          ud.torso.rotation.z = swing * 0.03;
        }
        // Whole body bob up/down
        mesh.position.y = Math.abs(swing) * 0.05;
      }
    }
    // Remove dead zombies
    for (const id of Object.keys(this.zombieMeshes)) {
      if (!seenZombieIds.has(parseInt(id))) {
        this.scene.remove(this.zombieMeshes[id]);
        delete this.zombieMeshes[id];
        delete this.prevPositions.zombies[id];
      }
    }

    // Update gold pickups — state.gold is now [id, x, z] arrays
    const seenGoldIds = new Set();
    const goldArr = state.gold || [];
    for (const g of goldArr) {
      const gid = g[0], gx = g[1], gz = g[2];
      seenGoldIds.add(gid);
      let mesh = this.goldMeshes[gid];
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.3, 0.3),
          new THREE.MeshLambertMaterial({ color: 0xffdd00, emissive: 0x886600, emissiveIntensity: 0.5 })
        );
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.goldMeshes[gid] = mesh;
      }
      mesh.position.set(gx, 0.5 + Math.sin(now / 300 + gid) * 0.15, gz);
      mesh.rotation.y += 0.02;
    }
    for (const id of Object.keys(this.goldMeshes)) {
      if (!seenGoldIds.has(parseInt(id))) {
        this.scene.remove(this.goldMeshes[id]);
        delete this.goldMeshes[id];
      }
    }

    // Update other players
    const seenPlayerIds = new Set();
    for (const p of state.players) {
      if (p.id === this.myId) continue;
      seenPlayerIds.add(p.id);
      let mesh = this.otherPlayerMeshes[p.id];
      if (!mesh) {
        mesh = this.createPlayerMesh();
        this.scene.add(mesh);
        this.otherPlayerMeshes[p.id] = mesh;
      }
      // Interpolate position — mesh origin is at feet (y=0), server sends camera height (y=1.7)
      const prev = this.prevPositions.players[p.id];
      if (prev) {
        const t = Math.min(this.interpAlpha, 1);
        mesh.position.x = prev.x + (p.x - prev.x) * t;
        mesh.position.z = prev.z + (p.z - prev.z) * t;
        mesh.position.y = 0; // always at ground level
      } else {
        mesh.position.set(p.x, 0, p.z);
      }
      mesh.rotation.y = p.yaw + Math.PI;
      mesh.visible = !p.dead;
      // Walk animation for other players — detect movement by comparing positions
      const ud = mesh.userData;
      const prevPos = this.prevPositions.players[p.id];
      const moving = prevPos && (Math.abs(p.x - prevPos.x) > 0.01 || Math.abs(p.z - prevPos.z) > 0.01);
      if (!ud.walkPhase) ud.walkPhase = 0;
      if (moving) ud.walkPhase += dt * 8;
      if (ud.legL && ud.legR) {
        const s = Math.sin(ud.walkPhase);
        ud.legL.rotation.x = s * 0.3;
        ud.legR.rotation.x = -s * 0.3;
      }
      if (ud.armL && ud.armR) {
        const s = Math.sin(ud.walkPhase);
        ud.armL.rotation.x = -s * 0.2;
        ud.armR.rotation.x = s * 0.2;
      }
      // Name tag
      if (mesh.userData.nameTag) {
        mesh.userData.nameTag.position.set(0, 2.5, 0);
        mesh.userData.nameTag.lookAt(this.camera.position);
      }
    }
    for (const id of Object.keys(this.otherPlayerMeshes)) {
      if (!seenPlayerIds.has(id)) {
        this.scene.remove(this.otherPlayerMeshes[id]);
        delete this.otherPlayerMeshes[id];
        delete this.prevPositions.players[id];
      }
    }

    // Render tracers from all players
    for (const p of state.players) {
      if (p.tr && p.tr.length > 0) {
        for (const t of p.tr) {
          this.spawnTracer(t.x1, t.y1, t.z1, t.x2, t.y2, t.z2, t.gun);
          if (t.hit) this.spawnImpactHole(t.x2, t.y2, t.z2, t.zid);
        }
      }
    }

    // Escape mode: update door and key visuals
    if (state.escapeMode) {
      // Door open/close
      if (this.doorMesh) {
        if (state.doorOpen) {
          this.doorMesh.position.x = 3.8;
          this.doorMesh.position.y = 0.2;
          this.doorMesh.rotation.y = -Math.PI / 2;
        } else {
          this.doorMesh.position.set(0, 2.25, 6);
          this.doorMesh.rotation.y = 0;
        }
      }
      // Key on ground
      if (state.keyDropped && state.keyPos && !this.keyMesh) {
        const keyMat = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
        this.keyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.6), keyMat);
        this.keyMesh.position.set(state.keyPos.x, 0.5, state.keyPos.z);
        this.scene.add(this.keyMesh);
      } else if ((!state.keyDropped || !state.keyPos) && this.keyMesh) {
        this.scene.remove(this.keyMesh);
        this.keyMesh.geometry.dispose();
        this.keyMesh.material.dispose();
        this.keyMesh = null;
      } else if (this.keyMesh && state.keyPos) {
        this.keyMesh.position.set(state.keyPos.x, 0.5, state.keyPos.z);
        this.keyMesh.rotation.y += dt * 2;
      }
    }

    // Update camera to my player
    if (this.myPlayer) {
      this.camera.position.set(this.myPlayer.x, this.myPlayer.y, this.myPlayer.z);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;

      // Gun recoil
      this.gun.position.z = -0.5 + (this.myPlayer.gr || 0);
      this.gun.position.y = -0.3 - (this.myPlayer.gr || 0) * 0.3;

      // Muzzle flash
      this.muzzleFlash.material.opacity = this.myPlayer.mf || 0;

      this.updateGunVisual();

      // Flashlight — use cached vectors
      this.flashlight.position.copy(this.camera.position);
      this._tmpVec1.set(0, 0, -1).applyEuler(this.camera.rotation);
      this.flashlight.target.position.copy(this.camera.position).add(this._tmpVec1.multiplyScalar(20));

      // Shop rendering — side panel, game keeps running
      if (this.myPlayer.shop) {
        const shopEl = document.getElementById('shop-overlay');
        shopEl.classList.remove('hidden');
        if (this.myPlayer.g !== this._lastShopGold || now - this._lastShopRender > 500) {
          this.renderShop();
          this._lastShopGold = this.myPlayer.g;
          this._lastShopRender = now;
        }
      } else {
        document.getElementById('shop-overlay').classList.add('hidden');
      }
    }
  }

  createPlayerMesh() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3498db });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xf5c89a });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.4), bodyMat);
    body.position.y = 1.15; body.castShadow = true; group.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
    head.position.y = 1.85; head.castShadow = true; group.add(head);
    const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
    const armL = new THREE.Mesh(armGeo, bodyMat); armL.position.set(-0.4, 1.15, 0); armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, bodyMat); armR.position.set(0.4, 1.15, 0); armR.castShadow = true; group.add(armR);
    const legGeo = new THREE.BoxGeometry(0.22, 0.75, 0.22);
    const legL = new THREE.Mesh(legGeo, new THREE.MeshLambertMaterial({color:0x2a2a4a})); legL.position.set(-0.15, 0.375, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, new THREE.MeshLambertMaterial({color:0x2a2a4a})); legR.position.set(0.15, 0.375, 0); legR.castShadow = true; group.add(legR);

    // Name tag (simple sprite)
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#3498db';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('P2', 128, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    sprite.scale.set(1.5, 0.4, 1);
    sprite.position.set(0, 2.5, 0);
    group.add(sprite);
    group.userData = { nameTag: sprite, armL, armR, legL, legR, head, walkPhase: 0 };

    return group;
  }

  // ─── Tracers ───
  static GUN_TRACER = {
    pistol:  { color: 0xffee44, radius: 0.03, life: 0.08 },
    smg:     { color: 0xffdd33, radius: 0.025, life: 0.06 },
    shotgun: { color: 0xff9933, radius: 0.05, life: 0.1 },
    rifle:   { color: 0x66ffff, radius: 0.02, life: 0.07 },
    knife:   { color: 0xffffff, radius: 0.08, life: 0.12 },
  };

  spawnTracer(x1, y1, z1, x2, y2, z2, gunName) {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (len < 0.1) return;
    const cfg = ZombieMultiplayerClient.GUN_TRACER[gunName] || ZombieMultiplayerClient.GUN_TRACER.pistol;
    const geo = new THREE.CylinderGeometry(cfg.radius, cfg.radius, len, 6);
    const mat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x1+x2)/2, (y1+y2)/2, (z1+z2)/2);
    mesh.lookAt(x2, y2, z2);
    mesh.rotateX(Math.PI / 2);
    this.scene.add(mesh);
    this.bullets.push({ mesh, life: cfg.life, maxLife: cfg.life });
  }

  spawnLimbExplosion(x, y, z, originalMesh, yaw) {
    // Clone the limb mesh for the falling body part
    const clone = new THREE.Mesh(
      originalMesh.geometry.clone(),
      originalMesh.material.clone()
    );
    const offsetX = originalMesh.position.x;
    const offsetY = originalMesh.position.y;
    const offsetZ = originalMesh.position.z;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const wx = x + offsetX * cosY - offsetZ * sinY;
    const wz = z + offsetX * sinY + offsetZ * cosY;
    clone.position.set(wx, offsetY, wz);
    clone.rotation.copy(originalMesh.rotation);
    clone.rotation.y += yaw;
    clone.castShadow = true;
    clone.material.transparent = true;
    this.scene.add(clone);
    this.bullets.push({
      mesh: clone, life: 3.0, maxLife: 3.0, isLimb: true,
      vx: (Math.random() - 0.5) * 6,
      vy: 4 + Math.random() * 3,
      vz: (Math.random() - 0.5) * 6,
      rotVel: (Math.random() - 0.5) * 8,
    });
    // Explosion particles — red blood/gore burst
    for (let i = 0; i < 12; i++) {
      const pMat = new THREE.MeshBasicMaterial({ color: 0xcc0000, transparent: true, opacity: 1 });
      const pSize = 0.05 + Math.random() * 0.08;
      const particle = new THREE.Mesh(new THREE.SphereGeometry(pSize, 4, 4), pMat);
      particle.position.set(wx, offsetY, wz);
      this.scene.add(particle);
      this.bullets.push({
        mesh: particle, life: 0.5 + Math.random() * 0.3, maxLife: 0.8, isParticle: true,
        vx: (Math.random() - 0.5) * 8,
        vy: 2 + Math.random() * 5,
        vz: (Math.random() - 0.5) * 8,
      });
    }
    // Flash sphere — quick expanding red glow
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.8 });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), flashMat);
    flash.position.set(wx, offsetY, wz);
    this.scene.add(flash);
    this.bullets.push({ mesh: flash, life: 0.2, maxLife: 0.2, isFlash: true });
  }

  spawnSlamEffect(x, z) {
    // Expanding shockwave ring on ground
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.8, 16), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    this.scene.add(ring);
    this.bullets.push({ mesh: ring, life: 0.6, maxLife: 0.6, isShockwave: true });
  }

  spawnCrackEffect(x, z, dx, dz, length) {
    const len = length || 30;
    // Main crack line — dark jagged line on ground
    const crackMat = new THREE.MeshBasicMaterial({ color: 0x1a0a00, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(2.0, len), crackMat);
    crack.rotation.x = -Math.PI / 2;
    // Position at midpoint of crack
    crack.position.set(x + dx * len / 2, 0.03, z + dz * len / 2);
    // Rotate to align with direction
    crack.rotation.z = Math.atan2(dx, dz);
    this.scene.add(crack);
    this.bullets.push({ mesh: crack, life: 3.0, maxLife: 3.0, isCrack: true });
    // Glowing edges — orange/red glow along the crack
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.0, len), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x + dx * len / 2, 0.02, z + dz * len / 2);
    glow.rotation.z = Math.atan2(dx, dz);
    this.scene.add(glow);
    this.bullets.push({ mesh: glow, life: 1.0, maxLife: 1.0, isCrackGlow: true });
    // Debris particles along the crack
    for (let i = 0; i < 15; i++) {
      const t = (i + 1) / 16 * len;
      const px = x + dx * t + (Math.random() - 0.5) * 1.5;
      const pz = z + dz * t + (Math.random() - 0.5) * 1.5;
      const pMat = new THREE.MeshBasicMaterial({ color: 0x3a1a00, transparent: true, opacity: 1 });
      const pSize = 0.1 + Math.random() * 0.15;
      const particle = new THREE.Mesh(new THREE.BoxGeometry(pSize, pSize, pSize), pMat);
      particle.position.set(px, 0.5 + Math.random() * 1.5, pz);
      this.scene.add(particle);
      this.bullets.push({
        mesh: particle, life: 0.8 + Math.random() * 0.4, maxLife: 1.2, isParticle: true,
        vx: (Math.random() - 0.5) * 4,
        vy: 3 + Math.random() * 4,
        vz: (Math.random() - 0.5) * 4,
      });
    }
  }

  spawnRangedEffect(x, y, z, yaw) {
    const projMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 1 });
    const proj = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), projMat);
    proj.position.set(x, y, z);
    this.scene.add(proj);
    this.bullets.push({ mesh: proj, life: 0.4, maxLife: 0.4, isProjectile: true });
  }

  buildPrisonCell() {
    this.clearPrisonCell();
    this.prisonObjects = [];
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 12), floorMat);
    floor.position.set(0, -0.1, 0); floor.receiveShadow = true;
    this.scene.add(floor); this.prisonObjects.push(floor);

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 0.5), wallMat);
    backWall.position.set(0, 2.5, -6); backWall.castShadow = true;
    this.scene.add(backWall); this.prisonObjects.push(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 12), wallMat);
    leftWall.position.set(-6, 2.5, 0); leftWall.castShadow = true;
    this.scene.add(leftWall); this.prisonObjects.push(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 12), wallMat);
    rightWall.position.set(6, 2.5, 0); rightWall.castShadow = true;
    this.scene.add(rightWall); this.prisonObjects.push(rightWall);

    const frontWallL = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 0.5), wallMat);
    frontWallL.position.set(-4, 2.5, 6); frontWallL.castShadow = true;
    this.scene.add(frontWallL); this.prisonObjects.push(frontWallL);

    const frontWallR = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 0.5), wallMat);
    frontWallR.position.set(4, 2.5, 6); frontWallR.castShadow = true;
    this.scene.add(frontWallR); this.prisonObjects.push(frontWallR);

    this.doorMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4.5, 0.3), doorMat);
    this.doorMesh.position.set(0, 2.25, 6); this.doorMesh.castShadow = true;
    this.scene.add(this.doorMesh); this.prisonObjects.push(this.doorMesh);
  }

  clearPrisonCell() {
    if (this.prisonObjects) {
      for (const obj of this.prisonObjects) {
        this.scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
      }
      this.prisonObjects = null;
    }
    if (this.keyMesh) {
      this.scene.remove(this.keyMesh);
      this.keyMesh.geometry.dispose();
      this.keyMesh.material.dispose();
      this.keyMesh = null;
    }
    this.doorMesh = null;
  }

  spawnImpactHole(x, y, z, zid) {
    // Limit total holes to prevent lag
    const holeCount = this.bullets.filter(b => b.isHole).length;
    if (holeCount >= 30) {
      // Remove oldest hole
      for (let i = 0; i < this.bullets.length; i++) {
        if (this.bullets[i].isHole) {
          const b = this.bullets[i];
          if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
          b.mesh.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
          this.bullets.splice(i, 1);
          break;
        }
      }
    }
    // Red impact decal — a small red sphere + flat ring
    const group = new THREE.Group();
    // Red hole sphere
    const holeMat = new THREE.MeshBasicMaterial({ color: 0xcc0000, transparent: true, opacity: 1 });
    holeMat.userData.baseOpacity = 1;
    const hole = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), holeMat);
    group.add(hole);
    // Red splatter ring
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xaa0000, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    ringMat.userData.baseOpacity = 0.7;
    const ring = new THREE.Mesh(new THREE.CircleGeometry(0.2, 8), ringMat);
    // If near ground, lay flat; otherwise face outward
    if (y < 0.3) {
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
    } else {
      ring.lookAt(this.camera.position);
    }
    group.add(ring);

    // If zid is valid, attach to zombie mesh so hole follows the zombie
    if (zid !== undefined && zid >= 0 && this.zombieMeshes[zid]) {
      const zMesh = this.zombieMeshes[zid];
      // Convert world position to local position relative to zombie mesh
      const localPos = new THREE.Vector3(x, y, z);
      zMesh.worldToLocal(localPos);
      group.position.copy(localPos);
      zMesh.add(group);
    } else {
      group.position.set(x, Math.max(y, 0.01), z);
      this.scene.add(group);
    }
    this.bullets.push({ mesh: group, life: 2.0, maxLife: 2.0, isHole: true });
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        // Remove from whatever parent it's attached to (scene or zombie mesh)
        if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
        if (b.isHole) {
          // Dispose group children
          b.mesh.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
        } else {
          b.mesh.geometry.dispose();
          b.mesh.material.dispose();
        }
        this.bullets.splice(i, 1);
        continue;
      }
      if (b.isLimb) {
        // Physics: gravity, rotation, ground collision
        b.vy -= 15 * dt;
        b.mesh.position.x += b.vx * dt;
        b.mesh.position.y += b.vy * dt;
        b.mesh.position.z += b.vz * dt;
        b.mesh.rotation.x += b.rotVel * dt;
        b.mesh.rotation.z += b.rotVel * dt;
        if (b.mesh.position.y < 0.1) {
          b.mesh.position.y = 0.1;
          b.vy = -b.vy * 0.3;
          b.vx *= 0.5; b.vz *= 0.5;
          b.rotVel *= 0.3;
        }
        const fadeRatio = Math.min(b.life / 1.0, 1);
        b.mesh.material.opacity = fadeRatio;
      } else if (b.isParticle) {
        // Blood particles — gravity, fade fast
        b.vy -= 20 * dt;
        b.mesh.position.x += b.vx * dt;
        b.mesh.position.y += b.vy * dt;
        b.mesh.position.z += b.vz * dt;
        if (b.mesh.position.y < 0.02) { b.mesh.position.y = 0.02; b.vy = 0; b.vx *= 0.3; b.vz *= 0.3; }
        b.mesh.material.opacity = b.life / b.maxLife;
      } else if (b.isFlash) {
        // Quick expanding flash
        const p = 1 - b.life / b.maxLife;
        b.mesh.scale.setScalar(1 + p * 4);
        b.mesh.material.opacity = (1 - p) * 0.8;
      } else if (b.isShockwave) {
        // Expanding shockwave ring
        const p = 1 - b.life / b.maxLife;
        b.mesh.scale.setScalar(1 + p * 8);
        b.mesh.material.opacity = (1 - p) * 0.8;
      } else if (b.isProjectile) {
        // Glowing projectile fades
        b.mesh.material.opacity = b.life / b.maxLife;
        b.mesh.scale.setScalar(1 + (1 - b.life / b.maxLife) * 2);
      } else if (b.isCrack) {
        // Crack stays then fades in last 1 second
        const fadeRatio = Math.min(b.life / 1.0, 1);
        b.mesh.material.opacity = fadeRatio * 0.9;
      } else if (b.isCrackGlow) {
        // Glow fades faster
        b.mesh.material.opacity = (b.life / b.maxLife) * 0.7;
      } else if (b.isHole) {
        // Fade out holes gradually in last 1 second
        const fadeRatio = Math.min(b.life / 1.0, 1);
        b.mesh.children.forEach(c => { c.material.opacity = (c.material.userData.baseOpacity || 1) * fadeRatio; });
      } else {
        b.mesh.material.opacity = (b.life / b.maxLife) * 0.9;
      }
    }
  }

  // ─── HUD ───
  updateHUD() {
    if (!this.myPlayer) return;
    const p = this.myPlayer;
    document.getElementById('health-val').textContent = p.h;
    document.getElementById('score-val').textContent = p.s;
    document.getElementById('wave-val').textContent = this.serverState ? this.serverState.wave : 1;
    document.getElementById('gold-val').textContent = p.g;
    const gunName = GUNS[p.gun] ? GUNS[p.gun].name : p.gun;
    const autoTag = p.af ? ' [AUTO]' : '';
    if (p.r) {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — RELOADING...`;
    } else if (p.ammo === Infinity || p.ammo === 'Infinity') {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — ∞`;
    } else {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — ${p.ammo}/∞`;
    }
    const maxHP = this.playerMeta.maxHealth || CONFIG.maxHealth;
    const pct = (p.h / maxHP) * 100;
    document.getElementById('health-bar').style.width = pct + '%';

    // Damage overlay
    if (p.h < (this._lastHealth || p.h)) {
      const overlay = document.getElementById('damage-overlay');
      overlay.classList.add('hit');
      setTimeout(() => overlay.classList.remove('hit'), 150);
    }
    this._lastHealth = p.h;
  }

  renderKillFeed(feed) {
    const el = document.getElementById('kill-feed');
    el.innerHTML = '';
    for (const item of feed) {
      const msg = document.createElement('div');
      msg.className = 'kill-msg';
      msg.textContent = item.msg;
      el.appendChild(msg);
      setTimeout(() => { if (msg.parentElement) msg.remove(); }, 2000);
    }
  }

  renderPlayerList(list) {
    const el = document.getElementById('player-list');
    let html = '<div class="pl-title">Players</div>';
    for (const p of list) {
      const isMe = p.id === this.myId;
      html += `<div class="pl-entry${isMe ? '' : ''}">${p.name}${isMe ? ' (You)' : ''}</div>`;
    }
    el.innerHTML = html;
  }

  // ─── Shop ───
  renderShop() {
    if (!this.myPlayer) return;
    const p = this.myPlayer;
    const meta = this.playerMeta;
    const el = document.getElementById('shop-content');
    const hotkeys = { pistol: '1', knife: '2', katana: '3', smg: '4', shotgun: '5', rifle: '6' };
    let html = `<div style="color:#ffdd00;font-size:18px;font-weight:900;margin-bottom:8px;">GOLD: ${p.g}</div>`;

    // Inventory section — owned weapons with hotkeys
    html += '<div style="color:#8bc;font-size:11px;font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px;">Inventory</div>';
    for (const [key, gun] of Object.entries(GUNS)) {
      const owned = meta.ownedGuns[key];
      if (!owned) continue;
      const equipped = p.gun === key;
      const hk = hotkeys[key] || '';
      if (equipped) {
        html += `<div class="shop-item equipped"><span>${gun.name} ${hk?`<span style="color:#666;font-size:10px;">[${hk}]</span>`:''}</span><span>EQUIPPED</span></div>`;
      } else {
        html += `<div class="shop-item owned" data-action="switchGun" data-key="${key}"><span>${gun.name} ${hk?`<span style="color:#666;font-size:10px;">[${hk}]</span>`:''}</span><span>Equip</span></div>`;
      }
    }

    // Buy section — weapons not yet owned
    html += '<div style="color:#aaa;font-size:11px;font-weight:700;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px;">Buy Weapons</div>';
    for (const [key, gun] of Object.entries(GUNS)) {
      const owned = meta.ownedGuns[key];
      if (owned) continue;
      const canBuy = p.g >= gun.price;
      const stats = gun.melee ? `DMG ${gun.damage} · RNG ${gun.meleeRange}` : `DMG ${gun.damage} · MAG ${gun.magSize}`;
      html += `<div class="shop-item ${canBuy?'':'disabled'}" ${canBuy?`data-action="buyGun" data-key="${key}"`:''}><span>${gun.name}<br><span style="font-size:10px;color:#666;">${stats}</span></span><span>${gun.price}g</span></div>`;
    }

    // Upgrades
    html += '<div style="color:#aaa;font-size:11px;font-weight:700;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px;">Upgrades</div>';
    for (const [key, up] of Object.entries(UPGRADES)) {
      const lvl = meta.upgrades[key] || 0;
      const maxed = lvl >= up.maxLevel;
      const price = up.price * (lvl + 1);
      const canBuy = !maxed && p.g >= price;
      html += `<div class="shop-item ${maxed?'maxed':(canBuy?'':'disabled')}" ${canBuy?`data-action="buyUpgrade" data-key="${key}"`:''}>
        <span>${up.name} <span style="color:#666;font-size:10px;">Lv.${lvl}/${up.maxLevel}</span></span>
        <span>${maxed?'MAX':price+'g'}</span>
      </div>`;
    }
    html += `<div style="margin-top:10px;font-size:10px;color:#555;">Press <kbd>B</kbd> to toggle shop</div>`;
    el.innerHTML = html;
  }

  setupShopClicks() {
    const el = document.getElementById('shop-content');
    el.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      const action = item.dataset.action;
      const key = item.dataset.key;
      if (action && key && this.socket) {
        this.socket.emit(action, key);
      }
    });
  }

  // ─── Main loop ───
  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._lastDt = dt;
    // Advance interpolation alpha (server ticks every 40ms)
    this.interpAlpha += dt / 0.04;
    // Flush throttled input
    this.flushInput();
    this.updateBullets(dt);
    // Gun bob animation — subtle sway based on time
    if (this.playing && this.myPlayer && !this.myPlayer.dead) {
      const t = performance.now() / 1000;
      const bobX = Math.sin(t * 2.5) * 0.008;
      const bobY = Math.abs(Math.sin(t * 2.5)) * 0.008;
      this.gun.position.x = 0.35 + bobX;
      // Keep z/y from recoil but add bob
      const recoil = this.myPlayer.gr || 0;
      this.gun.position.z = -0.5 + recoil;
      this.gun.position.y = -0.3 - recoil * 0.3 + bobY;
      // Muzzle flash scale pulse
      if (this.myPlayer.mf > 0) {
        const s = 1 + Math.sin(t * 30) * 0.2;
        this.muzzleFlash.scale.set(s, s, s);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('load', () => {
  window.client = new ZombieMultiplayerClient();
});

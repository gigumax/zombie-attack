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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

    this.socket.on('state', (state) => {
      this.serverState = state;
      this.myPlayer = state.players.find(p => p.id === this.myId);
      this.updateScene(state);
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
    });

    this.socket.on('escapeUpdate', (text) => {
      document.getElementById('escape-overlay').textContent = text;
    });

    this.socket.on('escapeWin', () => {
      document.getElementById('escape-overlay').classList.add('hidden');
      if (this.myPlayer) {
        document.getElementById('escaped-score').textContent =
          `${this.myPlayer.kills} kills · Wave ${this.myPlayer.wave} · Score ${this.myPlayer.score} · ${this.myPlayer.gold} gold`;
      }
      document.getElementById('escaped-screen').classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
    });

    this.socket.on('gameOver', (data) => {
      if (this.myPlayer) {
        document.getElementById('final-score').textContent =
          `${this.myPlayer.kills} kills · Wave ${data.wave} · Score ${data.score}`;
      }
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
    moon.shadow.mapSize.width = 2048;
    moon.shadow.mapSize.height = 2048;
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
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.15,0.2,0.8), new THREE.MeshLambertMaterial({color:0x2a2a2a}));
    this.gun.add(body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.08,0.5), new THREE.MeshLambertMaterial({color:0x1a1a1a}));
    barrel.position.set(0, 0.04, -0.6); this.gun.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.12,0.3,0.15), new THREE.MeshLambertMaterial({color:0x333333}));
    mag.position.set(0, -0.2, 0.1); this.gun.add(mag);
    this.muzzleFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    this.muzzleFlash.position.set(0, 0.04, -0.9);
    this.gun.add(this.muzzleFlash);

    this.gunParts = { body, barrel, mag };
    this.gunParts.body.visible = true;
    this.gunParts.barrel.visible = true;
    this.gunParts.mag.visible = true;

    // Knife
    this.knifeMesh = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12,0.15,0.45), new THREE.MeshLambertMaterial({color:0x3a2a1a}));
    handle.position.set(0, 0, 0.2); this.knifeMesh.add(handle);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,0.9), new THREE.MeshLambertMaterial({color:0xcccccc}));
    blade.position.set(0, 0.02, -0.5); this.knifeMesh.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.06,0.08), new THREE.MeshLambertMaterial({color:0x888888}));
    guard.position.set(0, 0.02, 0); this.knifeMesh.add(guard);
    this.knifeMesh.visible = false;
    this.gun.add(this.knifeMesh);

    this.gun.position.set(0.35, -0.3, -0.5);
    this.camera.add(this.gun);
    this.scene.add(this.camera);
  }

  updateGunVisual() {
    if (!this.myPlayer) return;
    const gunName = this.myPlayer.currentGun;
    const gun = GUNS[gunName];
    const isKnife = gun && gun.melee;
    this.gunParts.body.visible = !isKnife;
    this.gunParts.barrel.visible = !isKnife;
    this.gunParts.mag.visible = !isKnife;
    this.knifeMesh.visible = isKnife;
    this.muzzleFlash.visible = !isKnife;
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
    this.socket.emit('input', { keys: this.keys, yaw: this.yaw, pitch: this.pitch });
  }

  // ─── Zombie mesh creation (same as single-player) ───
  createZombieMesh(isBoss = false) {
    const group = new THREE.Group();
    if (isBoss) {
      const skinMat = new THREE.MeshLambertMaterial({color:0x5a8a4a});
      const shirtMat = new THREE.MeshLambertMaterial({color:0x2a9a9a});
      const pantsMat = new THREE.MeshLambertMaterial({color:0x4a2a8a});
      const torso = new THREE.Mesh(new THREE.BoxGeometry(1.6,1.2,0.9), shirtMat);
      torso.position.set(0,2.0,0.2); torso.rotation.x = 0.25; torso.castShadow = true; group.add(torso);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8), skinMat);
      head.position.set(0,2.9,0.75); head.rotation.x = 0.15; head.castShadow = true; group.add(head);
      const eyeMat = new THREE.MeshBasicMaterial({color:0x000000});
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.18,0.08), eyeMat);
      eyeL.position.set(-0.18,3.0,1.14); group.add(eyeL);
      const eyeR = eyeL.clone(); eyeR.position.x = 0.18; group.add(eyeR);
      const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.7,0.9), shirtMat);
      shoulderL.position.set(-0.9,2.4,0.1); shoulderL.rotation.x = 0.25; group.add(shoulderL);
      const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.9; group.add(shoulderR);
      const armGeo = new THREE.BoxGeometry(0.55,2.0,0.55);
      const armL = new THREE.Mesh(armGeo, skinMat); armL.position.set(-1.15,1.4,0.05); armL.castShadow = true; group.add(armL);
      const armR = new THREE.Mesh(armGeo, skinMat); armR.position.set(1.15,1.4,0.05); armR.castShadow = true; group.add(armR);
      const legGeo = new THREE.BoxGeometry(0.45,1.3,0.55);
      const legL = new THREE.Mesh(legGeo, pantsMat); legL.position.set(-0.4,0.65,0); legL.castShadow = true; group.add(legL);
      const legR = new THREE.Mesh(legGeo, pantsMat); legR.position.set(0.4,0.65,0); legR.castShadow = true; group.add(legR);
      group.scale.set(2.2,2.2,2.2);
      group.userData = { armL, armR, legL, legR, head, torso };
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

  createZombieMeshByType(type, isBoss) {
    if (isBoss) return this.createZombieMesh(true);
    if (type === 'buff') return this.createBuffZombieMesh();
    if (type === 'skeleton') return this.createSkeletonMesh();
    if (type === 'guard') return this.createGuardMesh();
    return this.createZombieMesh();
  }

  // ─── Scene sync ───
  updateScene(state) {
    // Update zombies
    const seenZombieIds = new Set();
    for (const z of state.zombies) {
      seenZombieIds.add(z.id);
      let mesh = this.zombieMeshes[z.id];
      if (!mesh) {
        mesh = this.createZombieMeshByType(z.type, z.isBoss);
        this.scene.add(mesh);
        this.zombieMeshes[z.id] = mesh;
      }
      mesh.position.set(z.x, 0, z.z);
      mesh.rotation.y = z.rot || 0;
      // Walk animation
      const legL = mesh.userData.legL, legR = mesh.userData.legR;
      if (legL && legR) {
        const swing = Math.sin(z.walkPhase) * 0.3;
        legL.rotation.x = swing;
        legR.rotation.x = -swing;
      }
      // Health bar above zombie
      if (z.health < z.maxHealth) {
        // Could add health bar — skip for now
      }
    }
    // Remove dead zombies
    for (const id of Object.keys(this.zombieMeshes)) {
      if (!seenZombieIds.has(parseInt(id))) {
        this.scene.remove(this.zombieMeshes[id]);
        delete this.zombieMeshes[id];
      }
    }

    // Update gold pickups
    const seenGoldIds = new Set();
    for (const g of state.goldPickups) {
      seenGoldIds.add(g.id);
      let mesh = this.goldMeshes[g.id];
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.3, 0.3),
          new THREE.MeshLambertMaterial({ color: 0xffdd00, emissive: 0x886600, emissiveIntensity: 0.5 })
        );
        mesh.position.set(g.x, 0.5, g.z);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.goldMeshes[g.id] = mesh;
      }
      mesh.position.set(g.x, 0.5 + Math.sin(Date.now() / 300 + g.id) * 0.15, g.z);
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
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = p.yaw + Math.PI;
      mesh.visible = !p.dead;
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
      }
    }

    // Render tracers from myPlayer
    if (this.myPlayer && this.myPlayer.shootTracers) {
      for (const t of this.myPlayer.shootTracers) {
        this.spawnTracer(
          new THREE.Vector3(t.x1, t.y1, t.z1),
          new THREE.Vector3(t.x2, t.y2, t.z2)
        );
      }
    }

    // Render tracers from other players
    for (const p of state.players) {
      if (p.id === this.myId) continue;
      if (p.shootTracers) {
        for (const t of p.shootTracers) {
          this.spawnTracer(
            new THREE.Vector3(t.x1, t.y1, t.z1),
            new THREE.Vector3(t.x2, t.y2, t.z2)
          );
        }
      }
    }

    // Update camera to my player
    if (this.myPlayer) {
      this.camera.position.set(this.myPlayer.x, this.myPlayer.y, this.myPlayer.z);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;

      // Gun recoil
      if (this.myPlayer.gunRecoil !== undefined) {
        this.gun.position.z = -0.5 + this.myPlayer.gunRecoil;
        this.gun.position.y = -0.3 - this.myPlayer.gunRecoil * 0.3;
      }

      // Muzzle flash
      if (this.myPlayer.muzzleFlash > 0) {
        this.muzzleFlash.material.opacity = this.myPlayer.muzzleFlash;
      } else {
        this.muzzleFlash.material.opacity = 0;
      }

      this.updateGunVisual();

      // Flashlight
      this.flashlight.position.copy(this.camera.position);
      const dir = new THREE.Vector3(0, 0, -1);
      dir.applyEuler(this.camera.rotation);
      this.flashlight.target.position.copy(this.camera.position).add(dir.multiplyScalar(20));

      // Shop rendering
      if (this.myPlayer.shopOpen) {
        this.renderShop();
        document.getElementById('shop-overlay').classList.remove('hidden');
        if (document.pointerLockElement) document.exitPointerLock();
      } else {
        document.getElementById('shop-overlay').classList.add('hidden');
        if (!document.pointerLockElement && this.playing && !this.myPlayer.dead) {
          this.canvas.requestPointerLock();
        }
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
    group.userData = { nameTag: sprite };

    return group;
  }

  // ─── Tracers ───
  spawnTracer(origin, endPoint) {
    const dir = new THREE.Vector3().subVectors(endPoint, origin);
    const len = dir.length();
    if (len < 0.1) return;
    const geo = new THREE.CylinderGeometry(0.02, 0.02, len, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffee44, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
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

  // ─── HUD ───
  updateHUD() {
    if (!this.myPlayer) return;
    const p = this.myPlayer;
    document.getElementById('health-val').textContent = Math.ceil(p.health);
    document.getElementById('score-val').textContent = p.score;
    document.getElementById('wave-val').textContent = p.wave;
    document.getElementById('gold-val').textContent = p.gold;
    const gunName = GUNS[p.currentGun] ? GUNS[p.currentGun].name : p.currentGun;
    const autoTag = p.autoFire ? ' [AUTO]' : '';
    if (p.reloading) {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — RELOADING...`;
    } else if (p.ammo === Infinity || p.ammo === 'Infinity') {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — ∞`;
    } else {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — ${p.ammo}/∞`;
    }
    const maxHP = p.maxHealth || CONFIG.maxHealth;
    const pct = (p.health / maxHP) * 100;
    document.getElementById('health-bar').style.width = pct + '%';

    // Damage overlay
    if (p.health < (this._lastHealth || p.health)) {
      const overlay = document.getElementById('damage-overlay');
      overlay.classList.add('hit');
      setTimeout(() => overlay.classList.remove('hit'), 150);
    }
    this._lastHealth = p.health;
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
    const el = document.getElementById('shop-content');
    let html = `<div style="color:#ffdd00;font-size:24px;font-weight:900;margin-bottom:12px;">GOLD: ${p.gold}</div>`;

    html += '<div style="color:#aaa;font-size:14px;font-weight:700;margin-bottom:6px;">WEAPONS</div>';
    for (const [key, gun] of Object.entries(GUNS)) {
      const owned = p.ownedGuns[key];
      const equipped = p.currentGun === key;
      if (equipped) {
        html += `<div class="shop-item equipped"><span>${gun.name}</span><span>EQUIPPED</span></div>`;
      } else if (owned) {
        html += `<div class="shop-item owned" onclick="client.socket.emit('switchGun','${key}')"><span>${gun.name}</span><span>Click to equip</span></div>`;
      } else {
        const canBuy = p.gold >= gun.price;
        html += `<div class="shop-item ${canBuy?'':'disabled'}" onclick="${canBuy?`client.socket.emit('buyGun','${key}')`:''}"><span>${gun.name}</span><span>${gun.price}g</span></div>`;
      }
    }

    html += '<div style="color:#aaa;font-size:14px;font-weight:700;margin:12px 0 6px;">UPGRADES</div>';
    for (const [key, up] of Object.entries(UPGRADES)) {
      const lvl = p.upgrades[key];
      const maxed = lvl >= up.maxLevel;
      const price = up.price * (lvl + 1);
      const canBuy = !maxed && p.gold >= price;
      html += `<div class="shop-item ${maxed?'maxed':(canBuy?'':'disabled')}" onclick="${canBuy?`client.socket.emit('buyUpgrade','${key}')`:''}">
        <span>${up.name} <span style="color:#666;">Lv.${lvl}/${up.maxLevel}</span></span>
        <span>${maxed?'MAX':price+'g'}</span>
      </div>`;
    }
    html += `<div style="margin-top:16px;font-size:12px;color:#666;">Press <kbd>B</kbd> to close shop</div>`;
    el.innerHTML = html;
  }

  // ─── Main loop ───
  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.updateBullets(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('load', () => {
  window.client = new ZombieMultiplayerClient();
});

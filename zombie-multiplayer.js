// ============================================================
//  ZOMBIE SHOOTER 3D — Multiplayer Client
// ============================================================

const CONFIG = {
  worldSize: 60, playerHeight: 1.7, playerRadius: 0.4, maxHealth: 100,
  bulletRange: 100, zombieHealth: 100, zombieSpeed: 2.5,
};

const GUNS = {
  knife:  { name:'Knife', magSize:Infinity, reloadTime:0, fireRate:0.3, damage:60, pellets:1, spread:0, price:0, melee:true },
  pistol: { name:'Pistol', magSize:20, reloadTime:1.2, fireRate:0.25, damage:34, pellets:1, spread:0.01, price:0 },
  smg:    { name:'SMG', magSize:100, reloadTime:1.8, fireRate:0.08, damage:25, pellets:1, spread:0.03, price:150 },
  shotgun:{ name:'Shotgun', magSize:6, reloadTime:2.5, fireRate:0.6, damage:20, pellets:8, spread:0.12, price:250 },
  rifle:  { name:'Rifle', magSize:500, reloadTime:1.0, fireRate:0.06, damage:55, pellets:1, spread:0.005, price:400 },
  katana: { name:'Katana', magSize:Infinity, reloadTime:0, fireRate:0.35, damage:120, pellets:1, spread:0, price:300, melee:true, meleeRange:5.0 },
  goldenKatana: { name:'Golden Katana', magSize:Infinity, reloadTime:0, fireRate:0.3, damage:300, pellets:1, spread:0, price:0, melee:true, meleeRange:5.5, chestOnly:true },
};

const UPGRADES = {
  damage:  { name:'Damage +10', price:100, maxLevel:5 },
  fireRate:{ name:'Fire Rate +20%', price:80, maxLevel:5 },
  magSize: { name:'Mag Size +5', price:60, maxLevel:5 },
  health:  { name:'Max Health +25', price:120, maxLevel:5 },
};

const ITEMS = {
  grenade:  { name:'Grenade',    price:50,  maxStack:5 },
  rocket:   { name:'Rocket',     price:100, maxStack:3 },
  medkit:   { name:'Medkit',     price:75,  maxStack:3 },
  airstrike:{ name:'Airstrike',  price:200, maxStack:1 },
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
    this.kidFriendly = false;
    this.playerEmoji = '😀';
    this.playerFaceDataURL = null;
    this.cameraShake = 0;
    this.thirdPerson = false;
    this._seenEff = new Set();

    // Input
    this.keys = {};
    this.yaw = 0;
    this.pitch = 0;

    // Rendered objects (tracked for updates)
    this.zombieMeshes = {};   // id -> mesh
    this.goldMeshes = {};     // id -> mesh
    this.chestMeshes = {};    // id -> mesh
    this.weaponMeshes = {};   // id -> mesh (escape weapon pickups)
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
    try { this.setupWorldMap(); } catch(e) { console.error('setupWorldMap error:', e); }

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
      // Update skeleton world lock
      const skelLock = document.getElementById('skeleton-lock');
      if (skelLock) {
        skelLock.style.display = state.skeletonUnlocked ? 'none' : 'flex';
      }
      // Update creepy world lock
      const creepyLock = document.getElementById('creepy-lock');
      if (creepyLock) {
        creepyLock.style.display = state.creepyUnlocked ? 'none' : 'flex';
      }
      // PvP indicator — shows when YOU have opted into PvP
      const pvpEl = document.getElementById('pvp-indicator');
      if (pvpEl) pvpEl.style.display = (this.myPlayer && this.myPlayer.pvp) ? 'block' : 'none';
      // Day/night cycle — update scene background and fog
      if (state.tod !== undefined && this.currentWorld !== 'creepy' && this.currentWorld !== 'skeleton') {
        const tod = state.tod;
        // Interpolate sky color: dawn(0) -> day(0.25) -> dusk(0.5) -> night(0.75) -> dawn(1)
        let skyColor, fogColor, fogNear, fogFar;
        if (tod < 0.15 || tod > 0.85) {
          // Dawn — warm orange
          skyColor = 0x2a1a0a; fogColor = 0x2a1a0a; fogNear = 25; fogFar = 70;
        } else if (tod < 0.35) {
          // Day — dark blue (default)
          skyColor = 0x1a1a2e; fogColor = 0x1a1a2e; fogNear = 30; fogFar = 80;
        } else if (tod < 0.6) {
          // Dusk — dark purple
          skyColor = 0x1a0a1a; fogColor = 0x1a0a1a; fogNear = 22; fogFar = 60;
        } else {
          // Night — very dark
          skyColor = 0x05050a; fogColor = 0x05050a; fogNear = 18; fogFar = 50;
        }
        this.scene.background = new THREE.Color(skyColor);
        this.scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);
        // Night indicator
        const nightEl = document.getElementById('night-indicator');
        if (nightEl) nightEl.style.display = state.night ? 'block' : 'none';
      }
      // Show/hide pause overlay — keep mouse locked during pause
      const pauseEl = document.getElementById('pause-overlay');
      const isPaused = !!(this.myPlayer && this.myPlayer.pau);
      if (isPaused) {
        pauseEl.classList.remove('hidden');
      } else {
        pauseEl.classList.add('hidden');
      }
      this._wasPaused = isPaused;
      this.interpAlpha = 0;
      const _t0 = performance.now();
      this.updateScene(state, this._lastDt || 0.016);
      const _t1 = performance.now();
      this.updateHUD();
      const _t2 = performance.now();
      this._sceneTime = _t1 - _t0;
      this._hudTime = _t2 - _t1;
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
      const kidText = this.kidFriendly
        ? 'Oh no! The big boss bumped you into a cozy room! Your toy blaster is gone, but you still have your trusty foam knife. A silly guard is holding the shiny key — bonk them to get it! Open the door and you get all your toys back!'
        : data.text;
      document.getElementById('escape-overlay').textContent = kidText;
      document.getElementById('escape-overlay').classList.remove('hidden');
      document.getElementById('start-screen').classList.add('hidden');
      document.getElementById('game-over-screen').classList.add('hidden');
      // Black screen transition — fade to black, build cell, then fade back in
      let blackEl = document.getElementById('black-transition');
      if (!blackEl) {
        blackEl = document.createElement('div');
        blackEl.id = 'black-transition';
        blackEl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:99999;pointer-events:none;opacity:0;transition:opacity 0.5s ease;';
        document.body.appendChild(blackEl);
      }
      // Fade to black
      blackEl.style.opacity = '1';
      // After 0.5s (screen is black), build the cell
      setTimeout(() => {
        this.buildPrisonCell();
      }, 500);
      // After 2s, fade back in — player is now in the cell
      setTimeout(() => {
        blackEl.style.opacity = '0';
      }, 2000);
      // Remove after fade completes
      setTimeout(() => {
        blackEl.style.opacity = '0';
        if (blackEl.parentElement) blackEl.parentElement.removeChild(blackEl);
      }, 2800);
    });

    this.socket.on('escapeUpdate', (text) => {
      document.getElementById('escape-overlay').textContent = text;
    });

    this.socket.on('escapeWin', () => {
      document.getElementById('escape-overlay').classList.add('hidden');
      this.clearPrisonCell();
      // Don't show escaped screen — boss fight begins now
    });

    this.socket.on('skeletonWorldStart', () => {
      // Transition to skeleton world — change environment
      this.enterSkeletonWorld();
    });

    this.socket.on('skeletonBossDefeated', (data) => {
      // Victory! Show victory screen
      if (this.myPlayer) {
        document.getElementById('escaped-score').textContent =
          `${this.myPlayer.k} kills · Wave ${data.wave} · Score ${data.score} · ${this.myPlayer.g} gold`;
      }
      const title = document.querySelector('#escaped-screen h1');
      const subtitle = document.querySelector('#escaped-screen h2');
      if (title) title.textContent = 'SKELETON WORLD CONQUERED!';
      if (subtitle) subtitle.textContent = 'You destroyed the Mutant Skeleton Boss and cleared the boneyard!';
      document.getElementById('escaped-screen').classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
      this.exitSkeletonWorld();
    });

    this.socket.on('gameOver', (data) => {
      if (this.myPlayer) {
        document.getElementById('final-score').textContent =
          `${this.myPlayer.k} knockouts · Wave ${data.wave} · Score ${data.score}`;
      }
      this.clearPrisonCell();
      if (this.kidFriendly) {
        const title = document.querySelector('#game-over-screen h1');
        title.textContent = 'OH NO!';
        title.style.color = '#2980b9';
        document.getElementById('final-text').textContent = 'The silly zombies tagged you! But your gold and toys are saved!';
      } else {
        const title = document.querySelector('#game-over-screen h1');
        title.textContent = 'YOU DIED!';
        title.style.color = '#e74c3c';
        document.getElementById('final-text').textContent = 'The zombies got you... but your gold and weapons are saved!';
      }
      document.getElementById('game-over-screen').classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
    });

    this.socket.on('playerList', (list) => {
      this.renderPlayerList(list);
    });

    this.socket.on('playerFace', (data) => {
      this.playerFaces = this.playerFaces || {};
      this.playerFaces[data.id] = data.face;
      // If mesh already exists, update its face
      const mesh = this.otherPlayerMeshes[data.id];
      if (mesh && mesh.userData.faceDataURL === null) {
        this.updatePlayerMeshFace(mesh, data.face);
      }
    });

    this.socket.on('worldChange', (world) => {
      this.currentWorld = world;
      if (world === 'creepy') {
        this.creepyZoneGroup.visible = true;
        this.scene.background = new THREE.Color(0x0a0010);
        this.scene.fog = new THREE.Fog(0x0a0010, 15, 50);
      } else if (world === 'skeleton') {
        this.creepyZoneGroup.visible = false;
        this.scene.background = new THREE.Color(0x1a0a0a);
        this.scene.fog = new THREE.Fog(0x1a0a0a, 20, 60);
      } else {
        // main / water / default — grasslands
        this.creepyZoneGroup.visible = false;
        this.scene.background = new THREE.Color(0x1a1a2e);
        this.scene.fog = new THREE.Fog(0x1a1a2e, 30, 80);
      }
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
    this.groundMesh = ground;

    const grid = new THREE.GridHelper(CONFIG.worldSize * 2, 40, 0x2a4a2a, 0x2a4a2a);
    grid.position.y = 0.01;
    this.scene.add(grid);
    this.gridMesh = grid;

    // Water lake — irregular organic shape in the corner
    const waterX = -35, waterZ = -35, waterBaseRadius = 18;
    // Generate the same irregular boundary as the server
    const waterShape = new THREE.Shape();
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const angle = (i / N) * Math.PI * 2;
      const r = waterBaseRadius
        + Math.sin(angle * 3 + 1.2) * 4
        + Math.sin(angle * 5 + 0.7) * 2.5
        + Math.sin(angle * 7 + 2.1) * 1.5;
      const px = Math.cos(angle) * r;
      const pz = Math.sin(angle) * r;
      if (i === 0) waterShape.moveTo(px, pz);
      else waterShape.lineTo(px, pz);
    }
    waterShape.closePath();
    const waterGeo = new THREE.ShapeGeometry(waterShape);
    const waterMat = new THREE.MeshLambertMaterial({
      color: 0x1a4a7a, transparent: true, opacity: 0.75,
      emissive: 0x0a2a4a, emissiveIntensity: 0.3
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(waterX, 0.02, waterZ);
    this.scene.add(water);
    // Sandy shore — slightly larger irregular shape
    const shoreShape = new THREE.Shape();
    for (let i = 0; i <= N; i++) {
      const angle = (i / N) * Math.PI * 2;
      const r = waterBaseRadius + 2.5
        + Math.sin(angle * 3 + 1.2) * 4
        + Math.sin(angle * 5 + 0.7) * 2.5
        + Math.sin(angle * 7 + 2.1) * 1.5;
      const px = Math.cos(angle) * r;
      const pz = Math.sin(angle) * r;
      if (i === 0) shoreShape.moveTo(px, pz);
      else shoreShape.lineTo(px, pz);
    }
    shoreShape.closePath();
    const shoreGeo = new THREE.ShapeGeometry(shoreShape);
    const shoreMat = new THREE.MeshLambertMaterial({ color: 0xc4a878 });
    const shore = new THREE.Mesh(shoreGeo, shoreMat);
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(waterX, 0.015, waterZ);
    this.scene.add(shore);
    this.waterMesh = water;

    // Creepy zombie zone — dark wasteland area (separate world, hidden by default)
    this.creepyZoneGroup = new THREE.Group();
    this.creepyZoneGroup.visible = false;
    const czX = 35, czZ = 35, czR = 22;
    // Dark corrupted ground
    const czGeo = new THREE.CircleGeometry(czR, 32);
    const czMat = new THREE.MeshLambertMaterial({ color: 0x1a0a1a, emissive: 0x0a000a, emissiveIntensity: 0.2 });
    const czGround = new THREE.Mesh(czGeo, czMat);
    czGround.rotation.x = -Math.PI / 2;
    czGround.position.set(czX, 0.012, czZ);
    this.creepyZoneGroup.add(czGround);
    // Dark ring border
    const czRingGeo = new THREE.RingGeometry(czR - 0.5, czR, 32);
    const czRingMat = new THREE.MeshBasicMaterial({ color: 0x660066, transparent: true, opacity: 0.5 });
    const czRing = new THREE.Mesh(czRingGeo, czRingMat);
    czRing.rotation.x = -Math.PI / 2;
    czRing.position.set(czX, 0.013, czZ);
    this.creepyZoneGroup.add(czRing);
    // Dead trees — dark bare trunks
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a0a, emissive: 0x0a0a00, emissiveIntensity: 0.15 });
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 3 + Math.random() * (czR - 5);
      const tx = czX + Math.cos(angle) * dist;
      const tz = czZ + Math.sin(angle) * dist;
      const treeH = 3 + Math.random() * 3;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, treeH, 5), trunkMat);
      trunk.position.set(tx, treeH / 2, tz);
      trunk.rotation.z = (Math.random() - 0.5) * 0.3;
      trunk.castShadow = true;
      this.creepyZoneGroup.add(trunk);
      // A few bare branches
      for (let b = 0; b < 3; b++) {
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 1 + Math.random(), 3), trunkMat);
        branch.position.set(tx, treeH - 0.5 + b * 0.4, tz);
        branch.rotation.z = (Math.random() - 0.5) * 1.5;
        branch.rotation.x = (Math.random() - 0.5) * 1.5;
        this.creepyZoneGroup.add(branch);
      }
    }
    // Gravestones
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a, emissive: 0x0a0a0a, emissiveIntensity: 0.1 });
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 2 + Math.random() * (czR - 4);
      const sx = czX + Math.cos(angle) * dist;
      const sz = czZ + Math.sin(angle) * dist;
      const stoneH = 0.8 + Math.random() * 0.6;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.5, stoneH, 0.15), stoneMat);
      stone.position.set(sx, stoneH / 2, sz);
      stone.rotation.y = Math.random() * Math.PI * 2;
      stone.castShadow = true;
      this.creepyZoneGroup.add(stone);
    }
    // Glowing purple fog particles
    const fogMat = new THREE.MeshBasicMaterial({ color: 0x660066, transparent: true, opacity: 0.15 });
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * czR;
      const fx = czX + Math.cos(angle) * dist;
      const fz = czZ + Math.sin(angle) * dist;
      const fog = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 2, 6, 6), fogMat);
      fog.position.set(fx, 0.5 + Math.random() * 2, fz);
      this.creepyZoneGroup.add(fog);
    }
    this.scene.add(this.creepyZoneGroup);
    // Store grasslands objects for toggling
    this.grasslandsGroup = new THREE.Group();

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

    // Trees — at small obstacle positions
    const treePositions = [
      [-15,-10],[12,-8],[-5,15],[8,12],[-20,5],
      [18,18],[-12,-20],[5,-15],[22,-5],[-25,-3],
    ];
    for (const [x,z] of treePositions) this.createTree(x, z);

    // Crates — at large obstacle positions (can jump on top)
    const cratePositions = [[-3,-5,1.5],[6,3,1.5],[-8,8,1.5],[10,-12,1.5],[15,6,1.5]];
    for (const [x,z,s] of cratePositions) this.createCrate(x, z, s);

    // Cover walls — long blocks for hiding behind
    const coverMat = new THREE.MeshLambertMaterial({ color: 0x6a5a4a });
    const coverWalls = [
      {x:-18,z:12,w:4,d:1},{x:20,z:-15,w:4,d:1},{x:0,z:-22,w:1,d:4},
      {x:-30,z:0,w:1,d:4},{x:28,z:10,w:4,d:1},{x:3,z:25,w:1,d:4},
      {x:-10,z:-28,w:4,d:1},{x:30,z:-25,w:4,d:1},
    ];
    for (const c of coverWalls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(c.w, 1.5, c.d), coverMat);
      wall.position.set(c.x, 0.75, c.z);
      wall.castShadow = true; wall.receiveShadow = true;
      this.scene.add(wall);
    }
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

  createCrate(x, z, size = 1.5) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshLambertMaterial({color:0x8B6914}));
    crate.position.set(x, size / 2, z);
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

    // Hands holding the gun (skin-colored boxes)
    const handMat = new THREE.MeshBasicMaterial({color:0xf5c89a});
    const handGeo = new THREE.BoxGeometry(0.14, 0.14, 0.22);
    // Right hand on grip
    const handR = new THREE.Mesh(handGeo, handMat);
    handR.position.set(0.04, -0.12, 0.1); this.gun.add(handR);
    // Left hand supporting barrel
    const handL = new THREE.Mesh(handGeo, handMat);
    handL.position.set(-0.04, -0.05, -0.45); this.gun.add(handL);
    // Forearms leading back toward camera
    const forearmMat = new THREE.MeshBasicMaterial({color:0x3498db});
    const forearmGeo = new THREE.BoxGeometry(0.12, 0.12, 0.35);
    const forearmR = new THREE.Mesh(forearmGeo, forearmMat);
    forearmR.position.set(0.04, -0.12, 0.35); this.gun.add(forearmR);
    const forearmL = new THREE.Mesh(forearmGeo, forearmMat);
    forearmL.position.set(-0.04, -0.05, -0.2); this.gun.add(forearmL);
    this.gunParts.handR = handR;
    this.gunParts.handL = handL;
    this.gunParts.forearmR = forearmR;
    this.gunParts.forearmL = forearmL;
    this.gunParts.forearmMat = forearmMat;

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
    const isKatana = gunName === 'katana' || gunName === 'goldenKatana';
    if (isKatana) {
      // Tint the katana model — gold for the treasure-chest version
      const gold = gunName === 'goldenKatana';
      const [kh, kg, kb, kt] = this.katanaMesh.children;
      kh.material.color.setHex(gold ? 0x7a5a00 : 0x1a1a1a);
      kg.material.color.setHex(gold ? 0xffcc00 : 0x8a7a3a);
      kb.material.color.setHex(gold ? 0xffd700 : 0xe8e8e8);
      kt.material.color.setHex(gold ? 0xffe680 : 0xc8c8c8);
    }
    const twoHanded = gunName === 'rifle' || gunName === 'smg' || gunName === 'shotgun';
    this.gunParts.body.visible = !isMelee;
    this.gunParts.barrel.visible = !isMelee;
    this.gunParts.mag.visible = !isMelee;
    this.gunParts.handR.visible = !isMelee;
    this.gunParts.handL.visible = !isMelee;
    this.gunParts.forearmR.visible = !isMelee;
    this.gunParts.forearmL.visible = !isMelee;
    // Adjust left hand position for two-handed weapons (further forward on barrel)
    if (!isMelee && !this.myPlayer.r) {
      if (twoHanded) {
        this.gunParts.handL.position.set(-0.04, -0.05, -0.55); // further forward
        this.gunParts.forearmL.position.set(-0.04, -0.05, -0.3);
      } else {
        this.gunParts.handL.position.set(-0.04, -0.05, -0.45); // pistol — closer
        this.gunParts.forearmL.position.set(-0.04, -0.05, -0.2);
      }
    }
    this.knifeMesh.visible = isMelee && !isKatana;
    this.katanaMesh.visible = isMelee && isKatana;
    this.muzzleFlash.visible = !isMelee;
  }

  // ─── Input ───
  setupInput() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.shiftHeld = this.shiftHeld || {};
        this.shiftHeld[e.code] = true;
        // Both shifts held — super speed!
        this.keys['super'] = !!(this.shiftHeld.ShiftLeft && this.shiftHeld.ShiftRight);
      }
      if (!this.connected) return;
      if (k === 'r' && this.playing) this.socket.emit('reload');
      if ((k === 'p' || e.code === 'Escape') && this.playing) {
        this.socket.emit('togglePause');
        e.preventDefault();
      }
      if (e.code === 'Tab' && this.playing) { this.socket.emit('toggleShop'); e.preventDefault(); }
      if (e.code === 'F4' && this.playing) { this.socket.emit('toggleFriendlyFire'); e.preventDefault(); }
      if (e.code === 'KeyG' && this.playing) this.socket.emit('toggleAutoFire');
      if (e.code === 'Digit2' && this.playing) this.socket.emit('switchGun', 'knife');
      if (e.code === 'Digit3' && this.playing) this.socket.emit('switchGun', 'katana');
      if (e.code === 'Digit4' && this.playing) this.socket.emit('switchGun', 'smg');
      if (e.code === 'Digit5' && this.playing) this.socket.emit('switchGun', 'shotgun');
      if (e.code === 'Digit6' && this.playing) this.socket.emit('switchGun', 'rifle');
      if (e.code === 'Digit7' && this.playing && !this.spawnerMode) this.socket.emit('switchGun', 'goldenKatana');
      if (e.code === 'Digit1' && this.playing) this.socket.emit('switchGun', 'pistol');
      // Buy gun hotkeys
      if (e.code === 'KeyF' && this.playing) this.socket.emit('buyGun', 'smg');
      if (e.code === 'KeyH' && this.playing) this.socket.emit('buyGun', 'shotgun');
      if (e.code === 'KeyJ' && this.playing) this.socket.emit('buyGun', 'katana');
      if (e.code === 'KeyK' && this.playing) this.socket.emit('buyGun', 'rifle');
      if (e.code === 'KeyM' && this.playing) {
        this.thirdPerson = !this.thirdPerson;
        e.preventDefault();
      }
      if (e.code === 'KeyB' && this.playing) {
        this.toggleWorldMap();
        e.preventDefault();
      }
      if (e.code === 'Slash' && this.playing) {
        this.socket.emit('toggleSpawnerMode');
        e.preventDefault();
      }
      // Spawn eggs — only in spawner mode
      if (this.myPlayer && this.myPlayer.sp && this.playing) {
        if (e.code === 'Digit7') this.socket.emit('spawnEgg', 'zombie');
        if (e.code === 'Digit8') this.socket.emit('spawnEgg', 'skeleton');
        if (e.code === 'Digit9') this.socket.emit('spawnEgg', 'creepy');
        if (e.code === 'Comma') this.socket.emit('spawnEgg', 'buff');
        if (e.code === 'Period') this.socket.emit('spawnEgg', 'spitter');
        if (e.code === 'Equal') this.socket.emit('spawnEgg', 'buffSkeleton');
        if (e.code === 'Digit0') this.socket.emit('spawnEgg', 'friendly');
      }
      // Upgrade hotkeys
      if (e.code === 'KeyZ' && this.playing) this.socket.emit('recallBuddies');
      if (e.code === 'KeyX' && this.playing) this.socket.emit('buyUpgrade', 'fireRate');
      if (e.code === 'KeyC' && this.playing) this.socket.emit('buyUpgrade', 'magSize');
      if (e.code === 'KeyV' && this.playing) this.socket.emit('buyUpgrade', 'health');
      // Buy item hotkeys
      if (e.code === 'KeyN' && this.playing) this.socket.emit('buyItem', 'grenade');
      if (e.code === 'Comma' && this.playing && !(this.myPlayer && this.myPlayer.sp)) this.socket.emit('buyItem', 'medkit');
      if (e.code === 'Period' && this.playing) this.socket.emit('buyItem', 'airstrike');
      // Use item hotkeys
      if (e.code === 'KeyT' && this.playing) this.socket.emit('useItem', 'grenade');
      if (e.code === 'KeyO' && this.playing) this.socket.emit('useItem', 'rocket');
      if (e.code === 'KeyU' && this.playing) this.socket.emit('useItem', 'medkit');
      if (e.code === 'KeyI' && this.playing) this.socket.emit('useItem', 'airstrike');
      if (e.code === 'KeyY' && this.playing) {
        if (!document.pointerLockElement) this.canvas.requestPointerLock();
        e.preventDefault();
      }
      if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && this.playing) this.socket.emit('escapeInteract');
      // Revive downed teammate
      if (e.code === 'KeyR' && this.playing) this.socket.emit('reviveTeammate');
      if (k === ' ') e.preventDefault();
      this.sendInput();
    });

    window.addEventListener('keyup', e => {
      this.keys[e.key.toLowerCase()] = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (this.shiftHeld) this.shiftHeld[e.code] = false;
        this.keys['super'] = !!(this.shiftHeld && this.shiftHeld.ShiftLeft && this.shiftHeld.ShiftRight);
      }
      this.sendInput();
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = (document.pointerLockElement === this.canvas);
    });

    document.addEventListener('mousemove', e => {
      if (!this.pointerLocked || !this.playing || (this.myPlayer && this.myPlayer.pau)) return;
      this.yaw -= e.movementX * 0.002;
      this.pitch -= e.movementY * 0.002;
      this.pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, this.pitch));
      this.sendInput();
    });

    document.addEventListener('mousedown', e => {
      if (!this.pointerLocked || !this.playing || (this.myPlayer && this.myPlayer.pau)) return;
      if (e.button === 0) this.socket.emit('shoot');
    });

    document.getElementById('start-btn').addEventListener('click', () => {
      this.kidFriendly = document.getElementById('kid-friendly-toggle').checked;
      this.socket.emit('setKidFriendly', this.kidFriendly);
      document.body.classList.toggle('kid-friendly', this.kidFriendly);
      // Send player name
      const nameInput = document.getElementById('player-name-input');
      const playerName = (nameInput && nameInput.value.trim()) || `Player ${Math.floor(Math.random()*1000)}`;
      this.socket.emit('setName', playerName.substring(0, 16));
      // Send face — either drawn canvas or emoji
      const emojiVal = document.getElementById('emoji-select').value;
      const faceCanvas = document.getElementById('face-canvas');
      if (faceCanvas && this._faceDrawn) {
        // Check if canvas has been drawn on (not just the default skin color)
        this.playerFaceDataURL = faceCanvas.toDataURL('image/png');
        this.socket.emit('setFace', this.playerFaceDataURL);
      } else if (emojiVal) {
        this.playerEmoji = emojiVal;
        this.socket.emit('setEmoji', this.playerEmoji);
      } else {
        this.playerEmoji = '😀';
        this.socket.emit('setEmoji', this.playerEmoji);
      }
      // Send character colors
      const shirtColor = document.getElementById('shirt-color').value;
      const pantsColor = document.getElementById('pants-color').value;
      const headColor = document.getElementById('head-color').value;
      this.playerColors = { shirt: shirtColor, pants: pantsColor, skin: headColor };
      this.socket.emit('setColors', this.playerColors);
      // Save to localStorage for persistence across refresh
      localStorage.setItem('zombie_shirt_color', shirtColor);
      localStorage.setItem('zombie_pants_color', pantsColor);
      localStorage.setItem('zombie_head_color', headColor);
      localStorage.setItem('zombie_player_name', playerName);
      // Update first-person forearm color to match shirt
      if (this.gunParts.forearmMat) {
        this.gunParts.forearmMat.color.set(shirtColor);
      }
      this.socket.emit('playerReady');
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

    // Face drawing canvas
    this._faceDrawn = false;
    this._faceColor = '#000000';
    const faceCanvas = document.getElementById('face-canvas');
    if (faceCanvas) {
      const fctx = faceCanvas.getContext('2d');
      // Restore saved face from localStorage
      const savedFace = localStorage.getItem('zombie_face_data');
      if (savedFace) {
        const img = new Image();
        img.onload = () => {
          fctx.drawImage(img, 0, 0, 128, 128);
          this._faceDrawn = true;
        };
        img.src = savedFace;
      } else {
        fctx.fillStyle = '#f5c89a';
        fctx.fillRect(0, 0, 128, 128);
      }
      // Restore saved emoji
      const savedEmoji = localStorage.getItem('zombie_emoji');
      if (savedEmoji) document.getElementById('emoji-select').value = savedEmoji;
      // Restore saved colors
      const savedShirt = localStorage.getItem('zombie_shirt_color');
      const savedPants = localStorage.getItem('zombie_pants_color');
      const savedHead = localStorage.getItem('zombie_head_color');
      if (savedShirt) document.getElementById('shirt-color').value = savedShirt;
      if (savedPants) document.getElementById('pants-color').value = savedPants;
      if (savedHead) document.getElementById('head-color').value = savedHead;
      // Restore saved name
      const savedName = localStorage.getItem('zombie_player_name');
      if (savedName) document.getElementById('player-name-input').value = savedName;
      let drawing = false, lastX = 0, lastY = 0;
      const getPos = (e) => {
        const rect = faceCanvas.getBoundingClientRect();
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        return {
          x: (cx - rect.left) * (128 / rect.width),
          y: (cy - rect.top) * (128 / rect.height),
        };
      };
      const startDraw = (e) => {
        e.preventDefault();
        drawing = true;
        this._faceDrawn = true;
        const p = getPos(e);
        lastX = p.x; lastY = p.y;
        fctx.fillStyle = this._faceColor;
        fctx.beginPath();
        fctx.arc(p.x, p.y, parseFloat(document.getElementById('brush-size').value) / 2, 0, Math.PI * 2);
        fctx.fill();
      };
      const moveDraw = (e) => {
        if (!drawing) return;
        e.preventDefault();
        const p = getPos(e);
        fctx.strokeStyle = this._faceColor;
        fctx.lineWidth = parseFloat(document.getElementById('brush-size').value);
        fctx.lineCap = 'round';
        fctx.lineJoin = 'round';
        fctx.beginPath();
        fctx.moveTo(lastX, lastY);
        fctx.lineTo(p.x, p.y);
        fctx.stroke();
        lastX = p.x; lastY = p.y;
      };
      const endDraw = () => {
        drawing = false;
        localStorage.setItem('zombie_face_data', faceCanvas.toDataURL('image/png'));
      };
      faceCanvas.addEventListener('mousedown', startDraw);
      faceCanvas.addEventListener('mousemove', moveDraw);
      faceCanvas.addEventListener('mouseup', endDraw);
      faceCanvas.addEventListener('mouseleave', endDraw);
      faceCanvas.addEventListener('touchstart', startDraw);
      faceCanvas.addEventListener('touchmove', moveDraw);
      faceCanvas.addEventListener('touchend', endDraw);
      // Color buttons
      document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this._faceColor = btn.dataset.color;
          this._erasing = false;
          document.getElementById('eraser-btn').style.borderColor = '#555';
        });
      });
      // Eraser button
      document.getElementById('eraser-btn').addEventListener('click', () => {
        this._erasing = !this._erasing;
        if (this._erasing) {
          this._faceColor = '#f5c89a';
          document.getElementById('eraser-btn').style.borderColor = '#2ecc71';
        } else {
          this._faceColor = '#000000';
          document.getElementById('eraser-btn').style.borderColor = '#555';
        }
      });
      // Clear button
      document.getElementById('clear-face-btn').addEventListener('click', () => {
        fctx.fillStyle = '#f5c89a';
        fctx.fillRect(0, 0, 128, 128);
        this._faceDrawn = false;
        localStorage.removeItem('zombie_face_data');
      });
      // Emoji select clears the drawn face preference
      document.getElementById('emoji-select').addEventListener('change', () => {
        if (document.getElementById('emoji-select').value) {
          this._faceDrawn = false;
          localStorage.setItem('zombie_emoji', document.getElementById('emoji-select').value);
          localStorage.removeItem('zombie_face_data');
        } else {
          localStorage.removeItem('zombie_emoji');
        }
      });
    }
  }

  setupWorldMap() {
    // Draw world card icons on canvas
    document.querySelectorAll('canvas[data-icon]').forEach(canvas => {
      const ctx = canvas.getContext('2d');
      const icon = canvas.dataset.icon;
      ctx.clearRect(0, 0, 64, 64);
      if (icon === 'grasslands') {
        // Tree icon
        ctx.fillStyle = '#5a3a2a';
        ctx.fillRect(28, 36, 8, 22);
        ctx.fillStyle = '#2a6a2a';
        ctx.beginPath();
        ctx.arc(32, 28, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3a8a3a';
        ctx.beginPath();
        ctx.arc(26, 24, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(38, 24, 10, 0, Math.PI * 2);
        ctx.fill();
      } else if (icon === 'creepy') {
        // Creepy zombie face — dark green skin, hollow eyes, jagged mouth
        ctx.fillStyle = '#2a4a1a';
        ctx.beginPath();
        ctx.arc(32, 32, 26, 0, Math.PI * 2);
        ctx.fill();
        // Hollow eyes
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(22, 26, 7, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(42, 26, 7, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        // Red glow in eyes
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.arc(22, 27, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(42, 27, 2.5, 0, Math.PI * 2);
        ctx.fill();
        // Jagged teeth mouth
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(20, 42, 24, 8);
        ctx.fillStyle = '#ddd';
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.moveTo(22 + i * 5, 42);
          ctx.lineTo(25 + i * 5, 42);
          ctx.lineTo(23.5 + i * 5, 47);
          ctx.fill();
        }
        // Cracks on face
        ctx.strokeStyle = '#0a0a0a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(32, 8); ctx.lineTo(30, 18); ctx.lineTo(34, 22);
        ctx.stroke();
      } else if (icon === 'skeleton') {
        // Skeleton skull face
        ctx.fillStyle = '#e8e8d0';
        ctx.beginPath();
        ctx.arc(32, 28, 22, 0, Math.PI * 2);
        ctx.fill();
        // Jaw
        ctx.fillRect(22, 42, 20, 12);
        // Eye sockets
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(23, 26, 7, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(41, 26, 7, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        // Nose
        ctx.beginPath();
        ctx.moveTo(32, 32); ctx.lineTo(28, 40); ctx.lineTo(36, 40);
        ctx.fill();
        // Teeth
        ctx.fillStyle = '#e8e8d0';
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(24 + i * 4, 42, 3, 10);
        }
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.moveTo(24 + i * 4, 42); ctx.lineTo(24 + i * 4, 52);
          ctx.stroke();
        }
        // Cracks
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(14, 20); ctx.lineTo(20, 24);
        ctx.stroke();
      }
    });

    document.querySelectorAll('.world-card').forEach(card => {
      card.addEventListener('click', () => {
        const world = card.dataset.world;
        if (world === 'main') {
          this.socket.emit('travelToWorld', 'main');
        } else if (world === 'creepy') {
          this.socket.emit('travelToWorld', 'creepy');
        } else if (world === 'skeleton') {
          this.socket.emit('travelToWorld', 'skeleton');
        }
        this.toggleWorldMap();
      });
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'scale(1.08)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'scale(1)';
      });
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
      const kidBoss = this.kidFriendly;
      const skinColors = kidBoss ? [0x66bb66, 0x44aa88, 0x3399aa, 0x2266bb] : [0x4a6a3a, 0x2a4a1a, 0x1a2a0a, 0x0a0a05];
      const shirtColors = kidBoss ? [0xffaa00, 0xff8800, 0xff66aa, 0xaa66ff] : [0x1a4a4a, 0x0a2a2a, 0x050a0a, 0x000000];
      const pantsColors = kidBoss ? [0x4488ff, 0x3366cc, 0x6644cc, 0x8844aa] : [0x2a1a4a, 0x1a0a2a, 0x0a050a, 0x000000];
      const eyeColors = kidBoss ? [0x4444ff, 0x44aaff, 0x44ffaa, 0xffff44] : [0x660000, 0xff0000, 0xff3300, 0xffff00];
      const hornColors = kidBoss ? [0xddaa44, 0xccaa66, 0xbbaa88, 0xaabbcc] : [0x3a2a1a, 0x2a1a0a, 0x1a0a05, 0x000000];
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
      // Glowing core in chest for phase 3 — blue in kid mode, red otherwise
      if (phase >= 3) {
        const coreMat = new THREE.MeshBasicMaterial({color: kidBoss ? 0x44aaff : 0xff0000, transparent: true, opacity: 0.9});
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), coreMat);
        core.position.set(0, 2.0, 0.5); group.add(core);
        group.userData.core = core;
      }
      // Drip dots for phase 1+ — colorful in kid mode, blood otherwise
      if (phase >= 1) {
        const dripBaseColor = kidBoss ? 0x44ff88 : 0x990000;
        const bloodMat = new THREE.MeshBasicMaterial({color: dripBaseColor});
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
    const skinMat = new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x66bb66 : 0x4a7a4a});
    const shirtMat = new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x44aaff : 0x3a6aad});
    const pantsMat = new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x6644cc : 0x2a2a5a});
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

  createFriendlyZombieMesh() {
    const group = new THREE.Group();
    const skinMat = new THREE.MeshLambertMaterial({color: 0x55cc55});
    const shirtMat = new THREE.MeshLambertMaterial({color: 0xddaa22});
    const pantsMat = new THREE.MeshLambertMaterial({color: 0x5a4a2a});
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5), skinMat);
    head.position.y = 1.8; head.castShadow = true; group.add(head);
    // Glowing green eyes
    const eyeMat = new THREE.MeshBasicMaterial({color:0x00ff66});
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.12,0.12,0.05), eyeMat);
    eyeL.position.set(-0.12,1.85,0.26); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.12; group.add(eyeR);
    // Green headband
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.54,0.1,0.54), new THREE.MeshBasicMaterial({color:0x00cc44}));
    band.position.y = 2.0; group.add(band);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.75,0.3), shirtMat);
    torso.position.y = 1.15; torso.castShadow = true; group.add(torso);
    const armGeo = new THREE.BoxGeometry(0.25,0.5,0.25);
    const armL = new THREE.Mesh(armGeo, skinMat); armL.position.set(-0.38,1.3,0.3); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, skinMat); armR.position.set(0.38,1.3,0.3); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    const legGeo = new THREE.BoxGeometry(0.22,0.75,0.22);
    const legL = new THREE.Mesh(legGeo, pantsMat); legL.position.set(-0.13,0.375,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, pantsMat); legR.position.set(0.13,0.375,0); legR.castShadow = true; group.add(legR);
    group.userData = { armL, armR, legL, legR, head, isFriendly: true };
    return group;
  }

  createBuffZombieMesh() {
    const group = new THREE.Group();
    const scale = 1.4;
    // Cache shared geometries and materials to avoid GPU memory explosion with many buff zombies
    if (!this._buffCache) {
      this._buffCache = {
        skinMat: new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0xff8844 : 0x8a2a2a}),
        shirtMat: new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0xffaa00 : 0x4a1a1a}),
        pantsMat: new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x4488ff : 0x2a0a0a}),
        eyeMat: new THREE.MeshBasicMaterial({color: this.kidFriendly ? 0x4444ff : 0xff0000}),
        headGeo: new THREE.BoxGeometry(0.55*scale, 0.55*scale, 0.55*scale),
        eyeGeo: new THREE.BoxGeometry(0.13*scale, 0.13*scale, 0.06*scale),
        torsoGeo: new THREE.BoxGeometry(0.65*scale, 0.85*scale, 0.4*scale),
        armGeo: new THREE.BoxGeometry(0.35*scale, 0.65*scale, 0.35*scale),
        legGeo: new THREE.BoxGeometry(0.28*scale, 0.85*scale, 0.28*scale),
      };
    }
    const c = this._buffCache;
    const head = new THREE.Mesh(c.headGeo, c.skinMat);
    head.position.y = 1.8*scale; head.castShadow = true; group.add(head);
    const eyeL = new THREE.Mesh(c.eyeGeo, c.eyeMat);
    eyeL.position.set(-0.13*scale, 1.85*scale, 0.29*scale); group.add(eyeL);
    const eyeR = new THREE.Mesh(c.eyeGeo, c.eyeMat);
    eyeR.position.set(0.13*scale, 1.85*scale, 0.29*scale); group.add(eyeR);
    const torso = new THREE.Mesh(c.torsoGeo, c.shirtMat);
    torso.position.y = 1.15*scale; torso.castShadow = true; group.add(torso);
    const armL = new THREE.Mesh(c.armGeo, c.skinMat); armL.position.set(-0.45*scale, 1.35*scale, 0.35*scale); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(c.armGeo, c.skinMat); armR.position.set(0.45*scale, 1.35*scale, 0.35*scale); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    const legL = new THREE.Mesh(c.legGeo, c.pantsMat); legL.position.set(-0.15*scale, 0.425*scale, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(c.legGeo, c.pantsMat); legR.position.set(0.15*scale, 0.425*scale, 0); legR.castShadow = true; group.add(legR);
    group.userData = { armL, armR, legL, legR, head, sharedGeo: true };
    return group;
  }

  createSkeletonMesh() {
    const group = new THREE.Group();
    const scale = 1.05;
    const boneMat = new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0xffffff : 0xdddddd});
    const darkMat = new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x88aaff : 0x2a2a2a});
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45*scale,0.45*scale,0.45*scale), boneMat);
    head.position.y = 1.8*scale; head.castShadow = true; group.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({color: this.kidFriendly ? 0x44aaff : 0xff0000});
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

  createBuffSkeletonMesh() {
    const group = new THREE.Group();
    const scale = 1.5; // bigger than skeleton
    const boneMat = new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0xffffff : 0xcccccc});
    const darkMat = new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x88aaff : 0x3a3a3a});
    const redEyeMat = new THREE.MeshBasicMaterial({color: this.kidFriendly ? 0xff4444 : 0xff0000});
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55*scale,0.55*scale,0.55*scale), boneMat);
    head.position.y = 1.8*scale; head.castShadow = true; group.add(head);
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.12*scale,0.12*scale,0.06*scale), redEyeMat);
    eyeL.position.set(-0.12*scale,1.82*scale,0.28*scale); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.12*scale; group.add(eyeR);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.45*scale,0.85*scale,0.3*scale), darkMat);
    torso.position.y = 1.15*scale; torso.castShadow = true; group.add(torso);
    // Spiked shoulder pads
    const shoulderGeo = new THREE.ConeGeometry(0.15*scale, 0.3*scale, 4);
    const shoulderL = new THREE.Mesh(shoulderGeo, boneMat);
    shoulderL.position.set(-0.35*scale, 1.7*scale, 0); shoulderL.rotation.z = -0.5; group.add(shoulderL);
    const shoulderR = new THREE.Mesh(shoulderGeo, boneMat);
    shoulderR.position.set(0.35*scale, 1.7*scale, 0); shoulderR.rotation.z = 0.5; group.add(shoulderR);
    const armGeo = new THREE.BoxGeometry(0.18*scale,0.85*scale,0.18*scale);
    const armL = new THREE.Mesh(armGeo, boneMat); armL.position.set(-0.4*scale,1.3*scale,0.3*scale); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, boneMat); armR.position.set(0.4*scale,1.3*scale,0.3*scale); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    const legGeo = new THREE.BoxGeometry(0.16*scale,0.9*scale,0.16*scale);
    const legL = new THREE.Mesh(legGeo, boneMat); legL.position.set(-0.15*scale,0.45*scale,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, boneMat); legR.position.set(0.15*scale,0.45*scale,0); legR.castShadow = true; group.add(legR);
    group.userData = { armL, armR, legL, legR, head, isBuffSkeleton: true };
    return group;
  }

  createGuardMesh() {
    return this.createBuffZombieMesh();
  }

  createNecromancerMesh() {
    const group = new THREE.Group();
    const scale = 1.1;
    if (!this._necroCache) {
      this._necroCache = {
        headGeo: new THREE.BoxGeometry(0.5*scale,0.5*scale,0.5*scale),
        eyeGeo: new THREE.BoxGeometry(0.1*scale,0.1*scale,0.05*scale),
        torsoGeo: new THREE.BoxGeometry(0.7*scale,1.0*scale,0.5*scale),
        orbGeo: new THREE.BoxGeometry(0.15*scale,0.15*scale,0.15*scale),
        armGeo: new THREE.BoxGeometry(0.2*scale,0.7*scale,0.2*scale),
        legGeo: new THREE.BoxGeometry(0.25*scale,0.85*scale,0.25*scale),
        robeMat: new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x6644aa : 0x2a0a3a}),
        skinMat: new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x88dd88 : 0x4a6a4a}),
        glowMat: new THREE.MeshBasicMaterial({color: this.kidFriendly ? 0x88ff88 : 0x00ff44}),
        eyeMat: new THREE.MeshBasicMaterial({color: this.kidFriendly ? 0x44ff44 : 0x00ff00}),
      };
    }
    const c = this._necroCache;
    const head = new THREE.Mesh(c.headGeo, c.skinMat);
    head.position.y = 1.8*scale; head.castShadow = true; group.add(head);
    const eyeL = new THREE.Mesh(c.eyeGeo, c.eyeMat);
    eyeL.position.set(-0.12*scale,1.85*scale,0.26*scale); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.12*scale; group.add(eyeR);
    const torso = new THREE.Mesh(c.torsoGeo, c.robeMat);
    torso.position.y = 1.1*scale; torso.castShadow = true; group.add(torso);
    const orb = new THREE.Mesh(c.orbGeo, c.glowMat);
    orb.position.set(0, 1.2*scale, 0.26*scale); group.add(orb);
    const armL = new THREE.Mesh(c.armGeo, c.robeMat); armL.position.set(-0.4*scale,1.3*scale,0.3*scale); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(c.armGeo, c.robeMat); armR.position.set(0.4*scale,1.3*scale,0.3*scale); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    const legL = new THREE.Mesh(c.legGeo, c.robeMat); legL.position.set(-0.15*scale,0.425*scale,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(c.legGeo, c.robeMat); legR.position.set(0.15*scale,0.425*scale,0); legR.castShadow = true; group.add(legR);
    group.userData = { armL, armR, legL, legR, head, isNecromancer: true, sharedGeo: true };
    return group;
  }

  createExploderMesh() {
    const group = new THREE.Group();
    const scale = 1.0;
    if (!this._exploderCache) {
      this._exploderCache = {
        headGeo: new THREE.BoxGeometry(0.6*scale,0.5*scale,0.5*scale),
        eyeGeo: new THREE.BoxGeometry(0.12*scale,0.12*scale,0.06*scale),
        torsoGeo: new THREE.BoxGeometry(0.8*scale,0.9*scale,0.7*scale),
        fuseGeo: new THREE.BoxGeometry(0.08*scale,0.25*scale,0.08*scale),
        armGeo: new THREE.BoxGeometry(0.25*scale,0.45*scale,0.25*scale),
        legGeo: new THREE.BoxGeometry(0.3*scale,0.55*scale,0.3*scale),
        bodyMat: new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0xff6644 : 0x8a0a0a}),
        headMat: new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0xffaa44 : 0x4a0a0a}),
        fuseMat: new THREE.MeshBasicMaterial({color: this.kidFriendly ? 0xffff00 : 0xff3300}),
        eyeMat: new THREE.MeshBasicMaterial({color: this.kidFriendly ? 0xff8800 : 0xff0000}),
      };
    }
    const c = this._exploderCache;
    const head = new THREE.Mesh(c.headGeo, c.headMat);
    head.position.y = 1.7*scale; head.castShadow = true; group.add(head);
    const eyeL = new THREE.Mesh(c.eyeGeo, c.eyeMat);
    eyeL.position.set(-0.13*scale,1.75*scale,0.27*scale); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.13*scale; group.add(eyeR);
    const torso = new THREE.Mesh(c.torsoGeo, c.bodyMat);
    torso.position.y = 1.0*scale; torso.castShadow = true; group.add(torso);
    const fuse = new THREE.Mesh(c.fuseGeo, c.fuseMat);
    fuse.position.set(0, 2.1*scale, 0); group.add(fuse);
    const armL = new THREE.Mesh(c.armGeo, c.bodyMat); armL.position.set(-0.5*scale,1.2*scale,0.2*scale); armL.rotation.x = -Math.PI/3; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(c.armGeo, c.bodyMat); armR.position.set(0.5*scale,1.2*scale,0.2*scale); armR.rotation.x = -Math.PI/3; armR.castShadow = true; group.add(armR);
    const legL = new THREE.Mesh(c.legGeo, c.bodyMat); legL.position.set(-0.18*scale,0.275*scale,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(c.legGeo, c.bodyMat); legR.position.set(0.18*scale,0.275*scale,0); legR.castShadow = true; group.add(legR);
    group.userData = { armL, armR, legL, legR, head, fuse, isExploder: true, sharedGeo: true };
    return group;
  }

  createSpitterMesh() {
    const group = new THREE.Group();
    const scale = 1.0;
    if (!this._spitterCache) {
      this._spitterCache = {
        headGeo: new THREE.BoxGeometry(0.5*scale,0.5*scale,0.5*scale),
        eyeGeo: new THREE.BoxGeometry(0.1*scale,0.1*scale,0.05*scale),
        torsoGeo: new THREE.BoxGeometry(0.65*scale,0.85*scale,0.5*scale),
        armGeo: new THREE.BoxGeometry(0.2*scale,0.6*scale,0.2*scale),
        legGeo: new THREE.BoxGeometry(0.25*scale,0.75*scale,0.25*scale),
        sacGeo: new THREE.SphereGeometry(0.2*scale, 6, 6),
        bodyMat: new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x66aa44 : 0x2a4a1a}),
        headMat: new THREE.MeshLambertMaterial({color: this.kidFriendly ? 0x88cc55 : 0x3a5a2a}),
        sacMat: new THREE.MeshBasicMaterial({color: this.kidFriendly ? 0xaaff44 : 0x88ff00, transparent: true, opacity: 0.7}),
        eyeMat: new THREE.MeshBasicMaterial({color: this.kidFriendly ? 0xffff00 : 0xccff00}),
      };
    }
    const c = this._spitterCache;
    const head = new THREE.Mesh(c.headGeo, c.headMat);
    head.position.y = 1.7*scale; head.castShadow = true; group.add(head);
    const eyeL = new THREE.Mesh(c.eyeGeo, c.eyeMat);
    eyeL.position.set(-0.12*scale,1.75*scale,0.26*scale); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.12*scale; group.add(eyeR);
    const torso = new THREE.Mesh(c.torsoGeo, c.bodyMat);
    torso.position.y = 1.0*scale; torso.castShadow = true; group.add(torso);
    // Glowing acid sac on back
    const sac = new THREE.Mesh(c.sacGeo, c.sacMat);
    sac.position.set(0, 1.2*scale, -0.3*scale); group.add(sac);
    const armL = new THREE.Mesh(c.armGeo, c.bodyMat); armL.position.set(-0.4*scale,1.2*scale,0.2*scale); armL.rotation.x = -Math.PI/3; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(c.armGeo, c.bodyMat); armR.position.set(0.4*scale,1.2*scale,0.2*scale); armR.rotation.x = -Math.PI/3; armR.castShadow = true; group.add(armR);
    const legL = new THREE.Mesh(c.legGeo, c.bodyMat); legL.position.set(-0.15*scale,0.375*scale,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(c.legGeo, c.bodyMat); legR.position.set(0.15*scale,0.375*scale,0); legR.castShadow = true; group.add(legR);
    group.userData = { armL, armR, legL, legR, head, sac, isSpitter: true, sharedGeo: true };
    return group;
  }

  createIronGolemMesh() {
    const group = new THREE.Group();
    const s = 1.6; // larger than normal zombies
    if (!this._golemCache) {
      this._golemCache = {
        headGeo: new THREE.BoxGeometry(0.7*s, 0.6*s, 0.7*s),
        torsoGeo: new THREE.BoxGeometry(1.0*s, 1.2*s, 0.7*s),
        armGeo: new THREE.BoxGeometry(0.35*s, 1.0*s, 0.35*s),
        legGeo: new THREE.BoxGeometry(0.4*s, 0.9*s, 0.4*s),
        fistGeo: new THREE.BoxGeometry(0.5*s, 0.5*s, 0.5*s),
        eyeGeo: new THREE.BoxGeometry(0.12*s, 0.12*s, 0.05*s),
        bodyMat: new THREE.MeshLambertMaterial({ color: 0x666677, emissive: 0x111122, emissiveIntensity: 0.2 }),
        jointMat: new THREE.MeshLambertMaterial({ color: 0x444455 }),
        eyeMat: new THREE.MeshBasicMaterial({ color: 0x00ff44 }),
      };
    }
    const c = this._golemCache;
    const head = new THREE.Mesh(c.headGeo, c.bodyMat);
    head.position.y = 2.5*s; head.castShadow = true; group.add(head);
    // Glowing green eyes
    const eyeL = new THREE.Mesh(c.eyeGeo, c.eyeMat);
    eyeL.position.set(-0.18*s, 2.55*s, 0.36*s); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.18*s; group.add(eyeR);
    // Torso
    const torso = new THREE.Mesh(c.torsoGeo, c.bodyMat);
    torso.position.y = 1.4*s; torso.castShadow = true; group.add(torso);
    // Shoulder joints
    const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.2*s, 0.2*s, 0.2*s), c.jointMat);
    shoulderL.position.set(-0.55*s, 1.9*s, 0); group.add(shoulderL);
    const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.55*s; group.add(shoulderR);
    // Big arms with fists
    const armL = new THREE.Mesh(c.armGeo, c.bodyMat);
    armL.position.set(-0.7*s, 1.3*s, 0); armL.castShadow = true; group.add(armL);
    const fistL = new THREE.Mesh(c.fistGeo, c.bodyMat);
    fistL.position.set(-0.7*s, 0.7*s, 0); fistL.castShadow = true; group.add(fistL);
    const armR = new THREE.Mesh(c.armGeo, c.bodyMat);
    armR.position.set(0.7*s, 1.3*s, 0); armR.castShadow = true; group.add(armR);
    const fistR = new THREE.Mesh(c.fistGeo, c.bodyMat);
    fistR.position.set(0.7*s, 0.7*s, 0); fistR.castShadow = true; group.add(fistR);
    // Legs
    const legL = new THREE.Mesh(c.legGeo, c.bodyMat);
    legL.position.set(-0.25*s, 0.45*s, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(c.legGeo, c.bodyMat);
    legR.position.set(0.25*s, 0.45*s, 0); legR.castShadow = true; group.add(legR);
    // Hip joint
    const hip = new THREE.Mesh(new THREE.BoxGeometry(0.3*s, 0.2*s, 0.3*s), c.jointMat);
    hip.position.set(0, 0.8*s, 0); group.add(hip);
    group.userData = { armL, armR, legL, legR, head, fistL, fistR, isGolem: true, sharedGeo: true };
    return group;
  }

  createCreepyZombieMesh(reviveCount = 0) {
    if (this.kidFriendly) return this.createZombieMesh();
    const group = new THREE.Group();
    const scale = 1.25 + reviveCount * 0.2;

    // Cache shared geometries/materials for reviveCount=0 (most common)
    if (!this._creepyCache) {
      this._creepyCache = {
        headGeo: new THREE.BoxGeometry(0.6, 0.8, 0.6),
        eyeGeo: new THREE.BoxGeometry(0.18, 0.18, 0.1),
        glowGeo: new THREE.SphereGeometry(0.16, 6, 6),
        fangGeo: new THREE.ConeGeometry(0.04, 0.15, 3),
        jawGeo: new THREE.BoxGeometry(0.42, 0.18, 0.35),
        torsoGeo: new THREE.BoxGeometry(0.45, 0.9, 0.32),
        ribGeo: new THREE.BoxGeometry(0.35, 0.05, 0.05),
        armGeo: new THREE.BoxGeometry(0.12, 1.0, 0.12),
        clawGeo: new THREE.ConeGeometry(0.03, 0.28, 3),
        legGeo: new THREE.BoxGeometry(0.15, 0.85, 0.15),
        spikeGeo: new THREE.ConeGeometry(0.07, 0.35, 4),
        veinGeo: new THREE.BoxGeometry(0.025, 0.35, 0.025),
        tendrilGeo: new THREE.CylinderGeometry(0.02, 0.05, 0.5, 4),
        boneGeo: new THREE.CylinderGeometry(0.04, 0.06, 0.3, 4),
        dripGeo: new THREE.SphereGeometry(0.045, 4, 4),
        oozeGeo: new THREE.BoxGeometry(0.06, 0.15, 0.04),
        skinMat: new THREE.MeshLambertMaterial({color: 0x020202, emissive: 0x330000, emissiveIntensity: 0.6}),
        darkMat: new THREE.MeshLambertMaterial({color: 0x010101, emissive: 0x110000, emissiveIntensity: 0.3}),
        eyeMat: new THREE.MeshBasicMaterial({color: 0xffffff}),
        glowMat: new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.5}),
        fangMat: new THREE.MeshBasicMaterial({color: 0xddccaa}),
        jawMat: new THREE.MeshLambertMaterial({color: 0x020202, emissive: 0x220000, emissiveIntensity: 0.6}),
        ribMat: new THREE.MeshBasicMaterial({color: 0xaaaa88}),
        clawMat: new THREE.MeshBasicMaterial({color: 0x0a0a0a}),
        bloodMat: new THREE.MeshBasicMaterial({color: 0x880000}),
        spikeMat: new THREE.MeshBasicMaterial({color: 0x2a0a0a}),
        veinMat: new THREE.MeshBasicMaterial({color: 0xaa0000, transparent: true, opacity: 0.7}),
        tendrilMat: new THREE.MeshLambertMaterial({color: 0x050000, emissive: 0x330000, emissiveIntensity: 0.5}),
        oozeMat: new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: 0.8}),
        boneMat: new THREE.MeshBasicMaterial({color: 0xccccaa}),
      };
    }
    const c = this._creepyCache;
    const useCache = reviveCount === 0;
    // For revived creepy zombies, adjust materials but still use cached geometries
    const skinMat = useCache ? c.skinMat : new THREE.MeshLambertMaterial({color: 0x020202, emissive: 0x330000, emissiveIntensity: 0.6 + reviveCount * 0.2});
    const darkMat = useCache ? c.darkMat : new THREE.MeshLambertMaterial({color: 0x010101, emissive: 0x110000, emissiveIntensity: 0.3});
    const spikeMat = useCache ? c.spikeMat : new THREE.MeshBasicMaterial({color: 0x660000});
    const glowMat = useCache ? c.glowMat : new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.5 + reviveCount * 0.15});

    // Oversized, hunched head
    const head = new THREE.Mesh(useCache ? c.headGeo : new THREE.BoxGeometry(0.6*scale,0.8*scale,0.6*scale), skinMat);
    head.position.y = 1.9*scale; head.castShadow = true; head.rotation.x = 0.4; group.add(head);
    const headBottom = 1.9*scale - 0.4*scale;
    // Glowing white eyes
    const eyeL = new THREE.Mesh(useCache ? c.eyeGeo : new THREE.BoxGeometry(0.18*scale,0.18*scale,0.1*scale), c.eyeMat);
    eyeL.position.set(-0.14*scale,1.98*scale,0.31*scale); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.14*scale; group.add(eyeR);
    // Eye halos
    const glowL = new THREE.Mesh(useCache ? c.glowGeo : new THREE.SphereGeometry(0.16*scale, 6, 6), glowMat);
    glowL.position.set(-0.14*scale,1.98*scale,0.32*scale); group.add(glowL);
    const glowR = glowL.clone(); glowR.position.x = 0.14*scale; group.add(glowR);
    // Jagged fangs — reduced to 5 upper + 5 lower
    for (let i = -2; i <= 2; i++) {
      const fang = new THREE.Mesh(useCache ? c.fangGeo : new THREE.ConeGeometry(0.04*scale, 0.15*scale, 3), c.fangMat);
      fang.position.set(i * 0.07*scale, headBottom - 0.07*scale, 0.28*scale); fang.rotation.x = Math.PI; group.add(fang);
    }
    // Lower jaw with fangs
    const jawGroup = new THREE.Group();
    jawGroup.position.set(0, headBottom, 0.27*scale);
    const jaw = new THREE.Mesh(useCache ? c.jawGeo : new THREE.BoxGeometry(0.42*scale, 0.18*scale, 0.35*scale), c.jawMat);
    jaw.position.set(0, -0.12*scale, 0.0); jawGroup.add(jaw);
    for (let i = -2; i <= 2; i++) {
      const fang = new THREE.Mesh(useCache ? c.fangGeo : new THREE.ConeGeometry(0.04*scale, 0.15*scale, 3), c.fangMat);
      fang.position.set(i * 0.07*scale, -0.22*scale, 0.03*scale); jawGroup.add(fang);
    }
    group.add(jawGroup);
    // Hunched torso
    const torso = new THREE.Mesh(useCache ? c.torsoGeo : new THREE.BoxGeometry(0.45*scale,0.9*scale,0.32*scale), darkMat);
    torso.position.y = 1.15*scale; torso.rotation.x = 0.3; torso.castShadow = true; group.add(torso);
    // Exposed ribs — 3 instead of 4
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.Mesh(useCache ? c.ribGeo : new THREE.BoxGeometry(0.35*scale, 0.05*scale, 0.05*scale), c.ribMat);
      rib.position.set(0, 1.4*scale - i*0.18*scale, 0.2*scale);
      group.add(rib);
    }
    // Long thin arms
    const armL = new THREE.Mesh(useCache ? c.armGeo : new THREE.BoxGeometry(0.12*scale,1.0*scale,0.12*scale), skinMat); armL.position.set(-0.35*scale,1.3*scale,0.5*scale); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(useCache ? c.armGeo : new THREE.BoxGeometry(0.12*scale,1.0*scale,0.12*scale), skinMat); armR.position.set(0.35*scale,1.3*scale,0.5*scale); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    // Claws — 3 per hand instead of 5
    for (const armX of [-0.35, 0.35]) {
      for (let cl = -1; cl <= 1; cl++) {
        const claw = new THREE.Mesh(useCache ? c.clawGeo : new THREE.ConeGeometry(0.03*scale, 0.28*scale, 3), c.clawMat);
        claw.position.set(armX*scale + cl*0.05*scale, 1.3*scale, 0.95*scale);
        claw.rotation.x = -Math.PI/2;
        group.add(claw);
      }
    }
    // Thin legs
    const legL = new THREE.Mesh(useCache ? c.legGeo : new THREE.BoxGeometry(0.15*scale,0.85*scale,0.15*scale), skinMat); legL.position.set(-0.12*scale,0.425*scale,0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(useCache ? c.legGeo : new THREE.BoxGeometry(0.15*scale,0.85*scale,0.15*scale), skinMat); legR.position.set(0.12*scale,0.425*scale,0); legR.castShadow = true; group.add(legR);
    // Blood drips — reduced to 6 body + 3 jaw
    for (let i = 0; i < 6; i++) {
      const drip = new THREE.Mesh(useCache ? c.dripGeo : new THREE.SphereGeometry(0.045*scale, 4, 4), c.bloodMat);
      drip.position.set((Math.random()-0.5)*0.45*scale, 0.7*scale + Math.random()*0.6*scale, 0.2*scale + Math.random()*0.15*scale);
      group.add(drip);
    }
    for (let i = 0; i < 3; i++) {
      const drip = new THREE.Mesh(useCache ? c.dripGeo : new THREE.SphereGeometry(0.04*scale, 4, 4), c.bloodMat);
      drip.position.set((Math.random()-0.5)*0.35*scale, headBottom - 0.25*scale - Math.random()*0.2*scale, 0.27*scale);
      group.add(drip);
    }
    // Back spikes — reduced to 5
    const spikeCount = 5 + reviveCount * 2;
    for (let i = 0; i < spikeCount; i++) {
      const spike = new THREE.Mesh(useCache ? c.spikeGeo : new THREE.ConeGeometry(0.07*scale, 0.35*scale + reviveCount * 0.05, 4), spikeMat);
      spike.position.set((Math.random()-0.5)*0.35*scale, 1.6*scale - i*0.16*scale, -0.25*scale);
      spike.rotation.x = -0.4;
      group.add(spike);
    }
    // Red veins — reduced to 4
    for (let i = 0; i < 4; i++) {
      const vein = new THREE.Mesh(useCache ? c.veinGeo : new THREE.BoxGeometry(0.025*scale, 0.35*scale, 0.025*scale), c.veinMat);
      vein.position.set((Math.random()-0.5)*0.38*scale, 1.05*scale + Math.random()*0.35*scale, 0.18*scale);
      group.add(vein);
    }
    // Tendrils — 2 instead of 4
    for (let i = -1; i <= 1; i += 2) {
      const tendril = new THREE.Mesh(useCache ? c.tendrilGeo : new THREE.CylinderGeometry(0.02*scale, 0.05*scale, 0.5*scale, 4), c.tendrilMat);
      tendril.position.set(i * 0.15*scale, 2.35*scale, 0);
      tendril.rotation.z = i * 0.25;
      group.add(tendril);
    }
    // Black ooze from eyes — 2 per eye instead of 3
    for (const eyeX of [-0.14, 0.14]) {
      for (let j = 0; j < 2; j++) {
        const ooze = new THREE.Mesh(useCache ? c.oozeGeo : new THREE.BoxGeometry(0.06*scale, 0.15*scale + j*0.1*scale, 0.04*scale), c.oozeMat);
        ooze.position.set(eyeX*scale, 1.85*scale - j*0.12*scale, 0.31*scale);
        group.add(ooze);
      }
    }
    // Bone fragments on shoulders
    for (const sx of [-0.3, 0.3]) {
      const bone = new THREE.Mesh(useCache ? c.boneGeo : new THREE.CylinderGeometry(0.04*scale, 0.06*scale, 0.3*scale, 4), c.boneMat);
      bone.position.set(sx*scale, 1.55*scale, -0.1*scale);
      bone.rotation.z = sx > 0 ? 0.5 : -0.5;
      group.add(bone);
    }
    if (useCache) group.userData.sharedGeo = true;
    group.userData = { ...group.userData, armL, armR, legL, legR, head, jawGroup, isCreepy: true };
    return group;
  }

  createMutantSkeletonBossMesh() {
    const group = new THREE.Group();
    const scale = 2.5; // Much bigger than normal skeleton
    const boneMat = new THREE.MeshLambertMaterial({ color: this.kidFriendly ? 0xffffff : 0xe8e8e8, emissive: 0x222244, emissiveIntensity: 0.3 });
    const darkMat = new THREE.MeshLambertMaterial({ color: this.kidFriendly ? 0x4466aa : 0x1a1a2a });
    const spikeMat = new THREE.MeshBasicMaterial({ color: this.kidFriendly ? 0xaaccff : 0xcccccc });

    // Oversized skull head — mutated with bony protrusions
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7*scale, 0.8*scale, 0.7*scale), boneMat);
    head.position.y = 2.0*scale; head.castShadow = true; group.add(head);
    // Skull spikes on top
    for (let i = -2; i <= 2; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08*scale, 0.3*scale, 4), spikeMat);
      spike.position.set(i * 0.12*scale, 2.5*scale, 0);
      group.add(spike);
    }
    // Glowing eye sockets — deep red, large
    const eyeColor = this.kidFriendly ? 0x44aaff : 0xff0000;
    const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.18*scale, 0.18*scale, 0.08*scale), eyeMat);
    eyeL.position.set(-0.16*scale, 2.05*scale, 0.36*scale); group.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.16*scale; group.add(eyeR);
    // Eye glow halos
    const glowMat = new THREE.MeshBasicMaterial({ color: eyeColor, transparent: true, opacity: 0.5 });
    const glowL = new THREE.Mesh(new THREE.SphereGeometry(0.2*scale, 6, 6), glowMat);
    glowL.position.set(-0.16*scale, 2.05*scale, 0.38*scale); group.add(glowL);
    const glowR = glowL.clone(); glowR.position.x = 0.16*scale; group.add(glowR);
    // Massive jaw with fangs
    const jawGroup = new THREE.Group();
    jawGroup.position.set(0, 1.65*scale, 0.3*scale);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.55*scale, 0.25*scale, 0.5*scale), boneMat);
    jaw.position.set(0, -0.1*scale, 0); jawGroup.add(jaw);
    const fangMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = -2; i <= 2; i++) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.06*scale, 0.2*scale, 3), fangMat);
      fang.position.set(i * 0.1*scale, -0.2*scale, 0.1*scale); fang.rotation.x = Math.PI; jawGroup.add(fang);
    }
    group.add(jawGroup);

    // Huge ribcage torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6*scale, 1.2*scale, 0.45*scale), darkMat);
    torso.position.y = 1.2*scale; torso.castShadow = true; group.add(torso);
    // Rib bones — visible ribs on torso front
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.5*scale, 0.06*scale, 0.05*scale), boneMat);
      rib.position.set(0, 1.5*scale - i * 0.25*scale, 0.25*scale);
      group.add(rib);
    }
    // Spine spikes down the back
    for (let i = 0; i < 5; i++) {
      const spine = new THREE.Mesh(new THREE.ConeGeometry(0.06*scale, 0.25*scale, 4), spikeMat);
      spine.position.set(0, 1.7*scale - i * 0.25*scale, -0.3*scale);
      spine.rotation.x = -0.3;
      group.add(spine);
    }

    // 4 arms — 2 normal + 2 extra mutant arms from shoulders
    const armGeo = new THREE.BoxGeometry(0.15*scale, 1.0*scale, 0.15*scale);
    // Normal arms
    const armL = new THREE.Mesh(armGeo, boneMat); armL.position.set(-0.45*scale, 1.5*scale, 0.35*scale); armL.rotation.x = -Math.PI/2; armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, boneMat); armR.position.set(0.45*scale, 1.5*scale, 0.35*scale); armR.rotation.x = -Math.PI/2; armR.castShadow = true; group.add(armR);
    // Extra mutant arms — from shoulders, reaching sideways
    const armL2 = new THREE.Mesh(armGeo, boneMat); armL2.position.set(-0.55*scale, 1.7*scale, 0); armL2.rotation.z = Math.PI/2; armL2.castShadow = true; group.add(armL2);
    const armR2 = new THREE.Mesh(armGeo, boneMat); armR2.position.set(0.55*scale, 1.7*scale, 0); armR2.rotation.z = -Math.PI/2; armR2.castShadow = true; group.add(armR2);
    // Clawed hands on all 4 arms
    const clawMat = new THREE.MeshBasicMaterial({ color: this.kidFriendly ? 0xaaccff : 0xaaaaaa });
    for (const [ax, ay, az] of [[-0.45,1.5,0.85],[0.45,1.5,0.85],[-0.95,1.7,0],[0.95,1.7,0]]) {
      for (let c = -1; c <= 1; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.04*scale, 0.2*scale, 3), clawMat);
        claw.position.set(ax + c*0.06*scale, ay, az);
        if (az === 0) claw.rotation.z = ax < 0 ? Math.PI/2 : -Math.PI/2;
        group.add(claw);
      }
    }

    // Thick bone legs
    const legGeo = new THREE.BoxGeometry(0.18*scale, 1.1*scale, 0.18*scale);
    const legL = new THREE.Mesh(legGeo, boneMat); legL.position.set(-0.18*scale, 0.55*scale, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, boneMat); legR.position.set(0.18*scale, 0.55*scale, 0); legR.castShadow = true; group.add(legR);

    group.userData = { armL, armR, legL, legR, head, jawGroup, isSkeletonBoss: true };
    return group;
  }

  createCreepyBossMesh(revivePhase = 0) {
    if (this.kidFriendly) return this.createZombieMesh(true, revivePhase);
    const group = new THREE.Group();
    const scale = 2.0 + revivePhase * 0.2;
    // Dark corrupted skin
    const skinMat = new THREE.MeshLambertMaterial({ color: 0x1a3a0a, emissive: 0x0a1a00, emissiveIntensity: 0.3 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x0a1a05, emissive: 0x050a00, emissiveIntensity: 0.2 });
    // Body — large torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.0*scale, 1.4*scale, 0.6*scale), skinMat);
    torso.position.y = 1.5*scale; torso.castShadow = true; group.add(torso);
    // Chest spikes
    const spikeMat = new THREE.MeshLambertMaterial({ color: 0x0a0a00, emissive: 0x330000, emissiveIntensity: 0.4 });
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08*scale, 0.4*scale, 4), spikeMat);
      spike.position.set(-0.3*scale + i*0.2*scale, 1.8*scale, 0.3*scale);
      spike.rotation.x = Math.PI / 2;
      group.add(spike);
    }
    // Head — large creepy head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5*scale, 0.55*scale, 0.5*scale), darkMat);
    head.position.y = 2.6*scale; head.castShadow = true; group.add(head);
    // Glowing red eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1*scale, 0.06*scale, 0.05*scale), eyeMat);
    eyeL.position.set(-0.12*scale, 2.65*scale, 0.26*scale); group.add(eyeL);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.1*scale, 0.06*scale, 0.05*scale), eyeMat);
    eyeR.position.set(0.12*scale, 2.65*scale, 0.26*scale); group.add(eyeR);
    // Horns
    const hornMat = new THREE.MeshLambertMaterial({ color: 0x1a0a00 });
    const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.08*scale, 0.4*scale, 6), hornMat);
    hornL.position.set(-0.2*scale, 3.0*scale, 0); hornL.rotation.z = 0.3; group.add(hornL);
    const hornR = new THREE.Mesh(new THREE.ConeGeometry(0.08*scale, 0.4*scale, 6), hornMat);
    hornR.position.set(0.2*scale, 3.0*scale, 0); hornR.rotation.z = -0.3; group.add(hornR);
    // Jaw with jagged teeth
    const jawGroup = new THREE.Group();
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.4*scale, 0.15*scale, 0.4*scale), darkMat);
    jaw.position.y = 2.35*scale; jawGroup.add(jaw);
    const toothMat = new THREE.MeshBasicMaterial({ color: 0xddccaa });
    for (let i = 0; i < 5; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.04*scale, 0.12*scale, 4), toothMat);
      tooth.position.set(-0.15*scale + i*0.075*scale, 2.25*scale, 0.2*scale);
      tooth.rotation.x = Math.PI;
      jawGroup.add(tooth);
    }
    group.add(jawGroup);
    // Arms — long, reaching
    const armGeo = new THREE.BoxGeometry(0.22*scale, 1.6*scale, 0.22*scale);
    const armL = new THREE.Mesh(armGeo, skinMat);
    armL.position.set(-0.65*scale, 1.5*scale, 0); armL.castShadow = true; group.add(armL);
    armL.rotation.z = 0.3;
    const armR = new THREE.Mesh(armGeo, skinMat);
    armR.position.set(0.65*scale, 1.5*scale, 0); armR.castShadow = true; group.add(armR);
    armR.rotation.z = -0.3;
    // Clawed hands
    const clawMat = new THREE.MeshLambertMaterial({ color: 0x0a0a00, emissive: 0x220000, emissiveIntensity: 0.3 });
    const handL = new THREE.Mesh(new THREE.BoxGeometry(0.25*scale, 0.3*scale, 0.25*scale), clawMat);
    handL.position.set(-0.8*scale, 0.7*scale, 0); group.add(handL);
    const handR = new THREE.Mesh(new THREE.BoxGeometry(0.25*scale, 0.3*scale, 0.25*scale), clawMat);
    handR.position.set(0.8*scale, 0.7*scale, 0); group.add(handR);
    // Legs — thick, stompy
    const legGeo = new THREE.BoxGeometry(0.3*scale, 1.3*scale, 0.3*scale);
    const legL = new THREE.Mesh(legGeo, skinMat);
    legL.position.set(-0.25*scale, 0.65*scale, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, skinMat);
    legR.position.set(0.25*scale, 0.65*scale, 0); legR.castShadow = true; group.add(legR);
    // Purple aura particles
    const auraMat = new THREE.MeshBasicMaterial({ color: 0x660066, transparent: true, opacity: 0.2 });
    for (let i = 0; i < 8; i++) {
      const aura = new THREE.Mesh(new THREE.SphereGeometry(0.3*scale, 6, 6), auraMat);
      const angle = (i / 8) * Math.PI * 2;
      aura.position.set(Math.cos(angle) * 0.8*scale, 1.5*scale + Math.sin(angle) * 0.5*scale, Math.sin(angle) * 0.4*scale);
      group.add(aura);
    }

    group.userData = { armL, armR, legL, legR, head, jawGroup, isCreepyBoss: true, revivePhase };
    return group;
  }

  createZombieMeshByType(type, isBoss, revivePhase = 0, creepyRevive = 0, isCreepyBoss = false) {
    if (type === 'skeletonBoss') return this.createMutantSkeletonBossMesh();
    if (isCreepyBoss) return this.createCreepyBossMesh(revivePhase);
    if (isBoss) return this.createZombieMesh(true, revivePhase);
    if (type === 'buff') return this.createBuffZombieMesh();
    if (type === 'skeleton') return this.createSkeletonMesh();
    if (type === 'buffSkeleton') return this.createBuffSkeletonMesh();
    if (type === 'guard') return this.createGuardMesh();
    if (type === 'creepy') return this.createCreepyZombieMesh(creepyRevive);
    if (type === 'necromancer') return this.createNecromancerMesh();
    if (type === 'exploder') return this.createExploderMesh();
    if (type === 'spitter') return this.createSpitterMesh();
    if (type === 'ironGolem') return this.createIronGolemMesh();
    return this.createZombieMesh();
  }

  // ─── Mesh disposal helper ───
  disposeMesh(mesh) {
    if (!mesh) return;
    const isShared = mesh.userData && mesh.userData.sharedGeo;
    mesh.traverse(c => {
      if (c.userData && c.userData.healthBar) {
        const hb = c.userData.healthBar;
        if (hb.material) {
          if (hb.material.map) hb.material.map.dispose();
          hb.material.dispose();
        }
      }
      if (isShared) return; // skip disposing shared cached geometries/materials
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        if (Array.isArray(c.material)) c.material.forEach(mat => mat.dispose());
        else c.material.dispose();
      }
    });
  }

  // ─── Health bar helper ───
  createHealthBar(yOffset = 2.2) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 8;
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.scale.set(0.7, 0.08, 1);
    sprite.position.set(0, yOffset, 0);
    sprite.visible = false;
    sprite.userData = { canvas, tex, healthBar: true, lastHitTime: 0 };
    return sprite;
  }

  updateHealthBar(sprite, hp, maxHp) {
    if (!sprite || !sprite.userData.canvas) return;
    const canvas = sprite.userData.canvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 8);
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 64, 8);
    // Health fill
    const pct = Math.max(0, Math.min(1, hp / maxHp));
    if (pct > 0.5) ctx.fillStyle = '#2ecc71';
    else if (pct > 0.25) ctx.fillStyle = '#f1c40f';
    else ctx.fillStyle = '#e74c3c';
    ctx.fillRect(1, 1, (64 - 2) * pct, 6);
    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 63, 7);
    sprite.userData.tex.needsUpdate = true;
  }

  // ─── Scene sync ───
  // Map short type char to full type name
  static TYPE_MAP = { n: 'normal', b: 'buff', s: 'skeleton', g: 'guard', c: 'creepy', k: 'skeletonBoss', e: 'exploder', m: 'necromancer', p: 'spitter', i: 'ironGolem', x: 'buffSkeleton' };

  updateScene(state, dt) {
    const TYPE_MAP = ZombieMultiplayerClient.TYPE_MAP;
    const now = performance.now();

    // Animate water surface — gentle bobbing
    if (this.waterMesh) {
      this.waterMesh.position.y = 0.02 + Math.sin(now * 0.001) * 0.03;
      this.waterMesh.material.opacity = 0.7 + Math.sin(now * 0.0015) * 0.08;
    }

    // Update zombies
    const seenZombieIds = new Set();
    for (const z of state.zombies) {
      seenZombieIds.add(z.id);
      let mesh = this.zombieMeshes[z.id];
      // Recreate boss mesh if revive phase changed
      if (mesh && z.boss && mesh.userData.revivePhase !== (z.rv || 0)) {
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
        mesh = null;
      }
      // Recreate creepy boss mesh if revive phase changed
      if (mesh && z.cb && mesh.userData.revivePhase !== (z.rv || 0)) {
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
        mesh = null;
      }
      // Recreate creepy zombie mesh if creepy revive count changed
      if (mesh && TYPE_MAP[z.t] === 'creepy' && !z.cb && mesh.userData.creepyRevive !== (z.crv || 0)) {
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
        mesh = null;
      }
      if (!mesh) {
        mesh = z.fr ? this.createFriendlyVariantMesh(TYPE_MAP[z.t])
          : this.createZombieMeshByType(TYPE_MAP[z.t] || 'normal', z.boss, z.rv || 0, z.crv || 0, z.cb === 1);
        if (TYPE_MAP[z.t] === 'creepy') mesh.userData.creepyRevive = z.crv || 0;
        // Add health bar above head
        const hbY = TYPE_MAP[z.t] === 'skeletonBoss' ? 6.5 : (z.cb ? 5.5 : (z.boss ? 4.5 : (TYPE_MAP[z.t] === 'ironGolem' ? 4.5 : (TYPE_MAP[z.t] === 'buff' || TYPE_MAP[z.t] === 'guard' || TYPE_MAP[z.t] === 'buffSkeleton' ? 3.0 : (TYPE_MAP[z.t] === 'necromancer' || TYPE_MAP[z.t] === 'exploder' || TYPE_MAP[z.t] === 'spitter' ? 2.5 : 2.3)))));
        const hb = this.createHealthBar(hbY);
        mesh.add(hb);
        mesh.userData.healthBar = hb;
        this.scene.add(mesh);
        this.zombieMeshes[z.id] = mesh;
      }
      // Interpolate position (dying zombies can still be kicked around)
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
      } else {
        // Dying zombie — still update position for corpse kicking
        const prev = this.prevPositions.zombies[z.id];
        if (prev) {
          const t = Math.min(this.interpAlpha, 1);
          mesh.position.x = prev.x + (z.x - prev.x) * t;
          mesh.position.z = prev.z + (z.z - prev.z) * t;
        } else {
          mesh.position.x = z.x;
          mesh.position.z = z.z;
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
      // Exploder explosion effect
      if (z.exp) {
        this.spawnExplosionEffect(z.x, z.z);
      }
      // Spitter acid spit projectiles
      if (z.spit && z.spit.length > 0) {
        for (const sp of z.spit) {
          this.spawnAcidSpitEffect(sp[0], sp[1], sp[2]);
        }
      }
      // Enrage visual — red pulse
      if (z.eng) {
        const t = performance.now() / 200;
        const pulse = Math.sin(t) * 0.3 + 0.5;
        mesh.traverse(child => {
          if (child.material && child.material.emissive !== undefined) {
            child.material.emissive.setRGB(pulse * 0.5, 0, 0);
            child.material.emissiveIntensity = pulse;
          }
        });
      }
      // Creepy zombie invisibility — hide mesh when invisible
      if (z.inv) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
      }
      if (z.crk) {
        this.spawnCrackEffect(z.x, z.z, z.cdx, z.cdz, z.clen);
      }
      // Lightning hit effect
      if (z.lit) {
        this.spawnLightningEffect(z.x, z.z);
      }
      // Friendly zombie — level scaling, name tag, crafted gear
      if (z.fr) {
        const lv = z.lv || 1;
        mesh.scale.setScalar(1 + 0.12 * (lv - 1));
        if (z.gh && !mesh.userData.gearHelmet) {
          const hy = mesh.userData.head ? mesh.userData.head.position.y + 0.33 : 2.1;
          const gearH = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.58), new THREE.MeshLambertMaterial({ color: 0xc0c0cc }));
          gearH.position.y = hy; mesh.add(gearH); mesh.userData.gearHelmet = gearH;
        }
        if (z.gs && !mesh.userData.gearSword) {
          const gearS = new THREE.Group();
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.12), new THREE.MeshLambertMaterial({ color: 0xe8e8d8 }));
          blade.position.y = 0.35; gearS.add(blade);
          const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: 0x8a6a2a }));
          gearS.add(hilt);
          gearS.position.set(0.5, 1.15, 0.3); gearS.rotation.x = -0.9;
          mesh.add(gearS); mesh.userData.gearSword = gearS;
        }
        if (z.nm && mesh.userData.buddyLv !== lv) {
          if (mesh.userData.buddyLabel) {
            mesh.remove(mesh.userData.buddyLabel);
            mesh.userData.buddyLabel.material.map.dispose();
            mesh.userData.buddyLabel.material.dispose();
          }
          const label = this.makeBuddyLabel(lv > 1 ? `${z.nm} Lv${lv}` : z.nm);
          mesh.add(label);
          mesh.userData.buddyLabel = label;
          mesh.userData.buddyLv = lv;
        }
      }
      // Friendly zombie — green aura
      if (z.fr) {
        const t = performance.now() / 300;
        const pulse = Math.sin(t) * 0.3 + 0.5;
        mesh.traverse(child => {
          if (child.material && child.material.emissive !== undefined) {
            child.material.emissive.setRGB(0, pulse * 0.5, 0);
            child.material.emissiveIntensity = pulse * 0.5;
          }
        });
      }
      // Boss reviving — pulse and shake (red in normal, blue in kid mode)
      if (z.rvv) {
        const t = performance.now() / 1000;
        const pulse = Math.sin(t * 10) * 0.5 + 0.5;
        mesh.position.y = Math.sin(t * 15) * 0.1; // shake
        mesh.rotation.z = Math.sin(t * 20) * 0.05;
        // Flash all materials
        const pulseColor = this.kidFriendly ? new THREE.Color(0, pulse * 0.5, pulse) : new THREE.Color(pulse, 0, 0);
        mesh.traverse(child => {
          if (child.material && child.material.color) {
            child.material.emissive = pulseColor;
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
      // Creepy zombie attack animation — continuous mouth chomp + head shake while in combat
      if (z.cmb && ud.isCreepy && !z.dy) {
        const atkT = performance.now() / 1000;
        // Mouth chomp — open and close rapidly
        if (ud.jawGroup) {
          ud.jawGroup.rotation.x = Math.abs(Math.sin(atkT * 18)) * 0.45; // rapid open/close
        }
        // Head shake — rapid side-to-side
        if (ud.head) {
          ud.head.rotation.z = Math.sin(atkT * 22) * 0.12; // rapid shake
          ud.head.rotation.y = Math.sin(atkT * 20) * 0.08;
        }
      } else if (ud.isCreepy) {
        // Reset mouth and head when not in combat
        if (ud.jawGroup) {
          ud.jawGroup.rotation.x *= 0.8; // ease back to closed
        }
        if (ud.head && !z.rvv) {
          ud.head.rotation.z *= 0.8;
          ud.head.rotation.y *= 0.8;
        }
      }
      // Zombie attacks you
      if (z.atk && this.myPlayer) {
        const d = Math.hypot(z.x - this.myPlayer.x, z.z - this.myPlayer.z);
        if (d < 5) this.cameraShake = 0.4;
      }
      // Water damage splash effect for creepy zombies
      if (z.wdmg) {
        this.spawnWaterSplash(z.x, z.z);
      }
      // Update health bar — only show when recently attacked
      if (ud.healthBar) {
        if (z.dy) {
          ud.healthBar.visible = false;
        } else {
          const prevHp = ud.lastHp;
          const nowSec = performance.now() / 1000;
          if (prevHp !== undefined && z.hp < prevHp) {
            ud.healthBar.userData.lastHitTime = nowSec;
          }
          ud.lastHp = z.hp;
          const sinceHit = nowSec - (ud.healthBar.userData.lastHitTime || 0);
          if (sinceHit < 3) {
            ud.healthBar.visible = true;
            // Only redraw canvas when health actually changes
            if (ud.lastDrawnHp !== z.hp) {
              this.updateHealthBar(ud.healthBar, z.hp || 0, z.mhp || 1);
              ud.lastDrawnHp = z.hp;
            }
          } else {
            ud.healthBar.visible = false;
          }
        }
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
        // Boss jump-smash animation
        if (z.jmp && z.boss) {
          const phase = z.jp;
          const jtm = z.jtm || 0;
          if (phase === 'windup') {
            // Crouch down — bend knees, pull arms back
            const windupProgress = 1 - (jtm / 0.6); // 0 to 1
            const crouch = windupProgress;
            mesh.position.y = -crouch * 0.4; // body lowers
            if (ud.legL && ud.legR) {
              ud.legL.rotation.x = crouch * 0.6; // bend knees
              ud.legR.rotation.x = crouch * 0.6;
            }
            if (ud.armL && ud.armR) {
              // Arms pulled back behind body
              ud.armL.rotation.x = -Math.PI / 2 - crouch * 0.8;
              ud.armR.rotation.x = -Math.PI / 2 - crouch * 0.8;
              ud.armL.rotation.z = -crouch * 0.4;
              ud.armR.rotation.z = crouch * 0.4;
            }
            if (ud.head) {
              ud.head.rotation.x = crouch * 0.3; // head tilts down
            }
          } else if (phase === 'air') {
            // Jumping up — knees unbend, arms raised high, body in air
            const airProgress = 1 - (jtm / 0.5); // 0 to 1
            // Parabolic arc: up then start coming down
            const jumpHeight = Math.sin(airProgress * Math.PI) * 8; // peak at middle
            mesh.position.y = jumpHeight;
            if (ud.legL && ud.legR) {
              ud.legL.rotation.x = -0.3 + airProgress * 0.5; // legs extend then tuck
              ud.legR.rotation.x = -0.3 + airProgress * 0.5;
            }
            if (ud.armL && ud.armR) {
              // Arms raised above head
              ud.armL.rotation.x = -Math.PI - 0.3;
              ud.armR.rotation.x = -Math.PI - 0.3;
              ud.armL.rotation.z = -0.3;
              ud.armR.rotation.z = 0.3;
            }
            if (ud.head) {
              ud.head.rotation.x = -0.2; // head looks up
            }
          } else if (phase === 'land') {
            // Slamming down — arms smash down, body crashes
            const landProgress = 1 - (jtm / 0.3); // 0 to 1
            mesh.position.y = 0;
            if (ud.legL && ud.legR) {
              ud.legL.rotation.x = landProgress * 0.4; // slight bend on impact
              ud.legR.rotation.x = landProgress * 0.4;
            }
            if (ud.armL && ud.armR) {
              // Arms slam down hard
              ud.armL.rotation.x = -Math.PI / 2 + landProgress * 1.2;
              ud.armR.rotation.x = -Math.PI / 2 + landProgress * 1.2;
              ud.armL.rotation.z = 0;
              ud.armR.rotation.z = 0;
            }
            if (ud.head) {
              ud.head.rotation.x = landProgress * 0.4; // head snaps down
            }
            // Camera shake on land
            if (this.myPlayer) {
              const d = Math.hypot(z.x - this.myPlayer.x, z.z - this.myPlayer.z);
              if (d < 10) this.cameraShake = Math.max(this.cameraShake, 0.6 * (1 - d / 10));
            }
          }
        } else {
          // Normal walk animation
          if (ud.isGolem) {
            // Iron Golem — heavier stomp animation
            if (ud.legL && ud.legR) {
              ud.legL.rotation.x = swing * 0.3;
              ud.legR.rotation.x = -swing * 0.3;
            }
            if (ud.armL && ud.armR) {
              ud.armL.rotation.x = swing * 0.25;
              ud.armR.rotation.x = -swing * 0.25;
            }
            if (ud.head) {
              ud.head.position.y = (ud.head.userData.baseY || ud.head.position.y);
              if (!ud.head.userData.baseY) ud.head.userData.baseY = ud.head.position.y;
              ud.head.position.y = ud.head.userData.baseY + Math.abs(swing) * 0.05;
            }
            mesh.position.y = Math.abs(swing) * 0.08;
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
      }
      // Apply hit knockback offsets to body parts
      const parts = ['head', 'armL', 'armR', 'legL', 'legR', 'torso'];
      for (const pn of parts) {
        const pm = ud[pn];
        if (!pm || !pm.userData.kb) continue;
        const kb = pm.userData.kb;
        if (kb.t <= 0) {
          // Restore base position
          if (pm.userData.basePos !== undefined) {
            pm.position.x = pm.userData.basePos.x;
            pm.position.y = pm.userData.basePos.y;
            pm.position.z = pm.userData.basePos.z;
          }
          pm.userData.kb = null;
          continue;
        }
        // Apply offset (decelerating)
        pm.position.x = pm.userData.basePos.x + kb.ox;
        pm.position.y = pm.userData.basePos.y + kb.oy;
        pm.position.z = pm.userData.basePos.z + kb.oz;
        // Integrate velocity with deceleration
        kb.ox += kb.vx * dt;
        kb.oy += kb.vy * dt;
        kb.oz += kb.vz * dt;
        // Gravity and friction
        kb.vy -= 0.4 * dt;
        kb.vx *= 0.85;
        kb.vz *= 0.85;
        kb.t -= dt;
      }
      // Whole-mesh body recoil (for zombies without a torso part)
      if (mesh.userData.bodyKb && mesh.userData.bodyKb.t > 0) {
        const bk = mesh.userData.bodyKb;
        const intensity = bk.t / 0.2; // fades from 1 to 0
        mesh.position.x += bk.ox * intensity;
        mesh.position.z += bk.oz * intensity;
        bk.t -= dt;
      }
    }
    // Remove dead zombies
    for (const id of Object.keys(this.zombieMeshes)) {
      if (!seenZombieIds.has(parseInt(id))) {
        const m = this.zombieMeshes[id];
        this.scene.remove(m);
        this.disposeMesh(m);
        delete this.zombieMeshes[id];
        delete this.prevPositions.zombies[id];
      }
    }

    // Friendly-zombie cage (escape story) — [x, z, open, cagedCount]
    if (state.cage && !state.cage[2]) {
      if (!this.cageGroup) this.buildCage(state.cage[0], state.cage[1], state.cage[3]);
    } else if (this.cageGroup) {
      this.clearCage();
    }

    // Locked treasure chests — [id, x, z], opened with Chest Keys
    if (!this.lockedChestMeshes) this.lockedChestMeshes = {};
    const seenLcIds = new Set();
    for (const c of (state.lockedChests || [])) {
      const cid = c[0];
      seenLcIds.add(cid);
      let lcMesh = this.lockedChestMeshes[cid];
      if (!lcMesh) {
        lcMesh = new THREE.Group();
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a, emissive: 0x664400, emissiveIntensity: 0.35 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.8), bodyMat);
        body.position.y = 0.4; body.castShadow = true; lcMesh.add(body);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.8), bodyMat);
        lid.position.y = 0.95; lid.castShadow = true; lcMesh.add(lid);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.12, 0.84), new THREE.MeshBasicMaterial({ color: 0xffd700 }));
        trim.position.y = 0.8; lcMesh.add(trim);
        const lock = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.12), new THREE.MeshBasicMaterial({ color: 0xffd700 }));
        lock.position.set(0, 0.55, 0.45); lcMesh.add(lock);
        lcMesh.position.set(c[1], 0, c[2]);
        this.scene.add(lcMesh);
        this.lockedChestMeshes[cid] = lcMesh;
      }
      lcMesh.rotation.y = Math.sin(now / 800 + cid) * 0.15;
    }
    for (const id of Object.keys(this.lockedChestMeshes)) {
      if (!seenLcIds.has(Number(id))) {
        const m = this.lockedChestMeshes[id];
        this.scene.remove(m);
        m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        delete this.lockedChestMeshes[id];
      }
    }

    // Mystery egg pickups — [id, x, z]
    if (!this.eggMeshes) this.eggMeshes = {};
    const seenEggIds = new Set();
    for (const e of (state.eggs || [])) {
      const eid = e[0];
      seenEggIds.add(eid);
      let eggMesh = this.eggMeshes[eid];
      if (!eggMesh) {
        eggMesh = new THREE.Group();
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(0.45, 10, 10),
          new THREE.MeshLambertMaterial({ color: 0xfff4d6, emissive: 0x886644, emissiveIntensity: 0.3 })
        );
        shell.scale.y = 1.3; shell.position.y = 0.55; shell.castShadow = true; eggMesh.add(shell);
        const spotMat = new THREE.MeshBasicMaterial({ color: 0x66cc66 });
        for (let s = 0; s < 4; s++) {
          const spot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), spotMat);
          const a = (s / 4) * Math.PI * 2;
          spot.position.set(Math.cos(a) * 0.38, 0.5 + (s % 2) * 0.25, Math.sin(a) * 0.38);
          eggMesh.add(spot);
        }
        eggMesh.position.set(e[1], 0, e[2]);
        this.scene.add(eggMesh);
        this.eggMeshes[eid] = eggMesh;
      }
      // Wobble like it's alive
      eggMesh.rotation.z = Math.sin(now / 150 + eid) * 0.12;
      eggMesh.position.y = Math.abs(Math.sin(now / 400 + eid)) * 0.15;
    }
    for (const id of Object.keys(this.eggMeshes)) {
      if (!seenEggIds.has(Number(id))) {
        const m = this.eggMeshes[id];
        this.scene.remove(m);
        m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        delete this.eggMeshes[id];
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

    // Update power-up pickups — state.powerups is [id, type, x, z] arrays
    const seenPuIds = new Set();
    const puArr = state.powerups || [];
    const puColors = {
      maxHealth: 0xffffff, speedBoots: 0x33ff66, reloadGlove: 0x3366ff,
      goldenBullet: 0xffaa00, lightningRod: 0x66ffff, necroSkull: 0xff3366,
    };
    const puIcons = {
      maxHealth: '+HP', speedBoots: 'SPD', reloadGlove: 'RLD',
      goldenBullet: 'GBL', lightningRod: 'LTG', necroSkull: 'SKL',
    };
    if (!this.powerUpMeshes) this.powerUpMeshes = {};
    for (const pu of puArr) {
      const pid = pu[0], ptype = pu[1], px = pu[2], pz = pu[3];
      seenPuIds.add(pid);
      let mesh = this.powerUpMeshes[pid];
      if (!mesh) {
        mesh = new THREE.Group();
        const color = puColors[ptype] || 0xffffff;
        // Floating orb
        const orbMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), orbMat);
        orb.position.y = 0.8;
        mesh.add(orb);
        // Glow halo
        const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 });
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), glowMat);
        glow.position.y = 0.8;
        mesh.add(glow);
        // Base ring
        const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 16), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        mesh.add(ring);
        mesh.userData.orb = orb;
        mesh.userData.glow = glow;
        this.scene.add(mesh);
        this.powerUpMeshes[pid] = mesh;
      }
      mesh.position.set(px, 0, pz);
      const orb = mesh.userData.orb;
      if (orb) orb.position.y = 0.8 + Math.sin(now / 200 + pid) * 0.15;
      if (mesh.userData.glow) mesh.userData.glow.position.y = orb.position.y;
      if (mesh.children[2]) mesh.children[2].rotation.z += 0.02;
    }
    for (const id of Object.keys(this.powerUpMeshes)) {
      if (!seenPuIds.has(parseInt(id))) {
        this.scene.remove(this.powerUpMeshes[id]);
        delete this.powerUpMeshes[id];
      }
    }

    // Update chests — state.chests is [id, x, z] arrays
    const seenChestIds = new Set();
    const chestArr = state.chests || [];
    for (const c of chestArr) {
      const cid = c[0], cx = c[1], cz = c[2];
      seenChestIds.add(cid);
      let mesh = this.chestMeshes[cid];
      if (!mesh) {
        mesh = new THREE.Group();
        // Chest body
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8B4513, emissive: 0x442200, emissiveIntensity: 0.3 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.7), bodyMat);
        body.position.y = 0.35;
        body.castShadow = true;
        mesh.add(body);
        // Chest lid
        const lidMat = new THREE.MeshLambertMaterial({ color: 0x8B4513, emissive: 0x442200, emissiveIntensity: 0.3 });
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 0.7), lidMat);
        lid.position.y = 0.8;
        lid.castShadow = true;
        mesh.add(lid);
        // Gold trim
        const trimMat = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
        const trim1 = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 0.75), trimMat);
        trim1.position.y = 0.7;
        mesh.add(trim1);
        // Glowing top
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.6 });
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), glowMat);
        glow.position.y = 1.2;
        mesh.add(glow);
        mesh.userData.glow = glow;
        this.scene.add(mesh);
        this.chestMeshes[cid] = mesh;
      }
      mesh.position.set(cx, 0, cz);
      mesh.position.y = Math.sin(now / 400 + cid) * 0.1;
      mesh.rotation.y += 0.01;
      if (mesh.userData.glow) {
        mesh.userData.glow.scale.setScalar(1 + Math.sin(now / 200 + cid) * 0.15);
        mesh.userData.glow.material.opacity = 0.4 + Math.sin(now / 200 + cid) * 0.2;
      }
    }
    for (const id of Object.keys(this.chestMeshes)) {
      if (!seenChestIds.has(parseInt(id))) {
        const m = this.chestMeshes[id];
        this.scene.remove(m);
        m.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
        delete this.chestMeshes[id];
      }
    }

    // Update weapon pickups — state.weaponPickups is [id, gunName, x, z] arrays
    const seenWeaponIds = new Set();
    const wpArr = state.weaponPickups || [];
    const gunColors = { pistol: 0x3498db, smg: 0x2ecc71, shotgun: 0xe67e22, rifle: 0xe74c3c, katana: 0x9b59b6, goldenKatana: 0xffd700 };
    for (const w of wpArr) {
      const wid = w[0], wgun = w[1], wx = w[2], wz = w[3];
      seenWeaponIds.add(wid);
      let mesh = this.weaponMeshes[wid];
      if (!mesh) {
        const group = new THREE.Group();
        const color = gunColors[wgun] || 0xffdd00;
        // Gun box
        const gunMat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.8), gunMat);
        box.castShadow = true;
        group.add(box);
        // Glow pillar
        const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 });
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 3, 12), glowMat);
        glow.position.y = 1.5;
        group.add(glow);
        this.scene.add(group);
        this.weaponMeshes[wid] = group;
      }
      mesh.position.set(wx, 0.5 + Math.sin(now / 300 + wid) * 0.15, wz);
      mesh.rotation.y += 0.03;
    }
    for (const id of Object.keys(this.weaponMeshes)) {
      if (!seenWeaponIds.has(parseInt(id))) {
        const m = this.weaponMeshes[id];
        this.scene.remove(m);
        m.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
        delete this.weaponMeshes[id];
      }
    }

    // Update other players
    const seenPlayerIds = new Set();
    for (const p of state.players) {
      if (p.id === this.myId) continue;
      seenPlayerIds.add(p.id);
      let mesh = this.otherPlayerMeshes[p.id];
      if (!mesh) {
        const faceData = (this.playerFaces && this.playerFaces[p.id]) || p.face || null;
        mesh = this.createPlayerMesh(p.emo || '😀', faceData, p.name || 'Player', p.col);
        this.scene.add(mesh);
        this.otherPlayerMeshes[p.id] = mesh;
      }
      // Interpolate position — server sends camera height (y=1.7 on ground, higher when jumping)
      const prev = this.prevPositions.players[p.id];
      if (prev) {
        const t = Math.min(this.interpAlpha, 1);
        mesh.position.x = prev.x + (p.x - prev.x) * t;
        mesh.position.z = prev.z + (p.z - prev.z) * t;
        const feetY = (prev.y + (p.y - prev.y) * t) - 1.7;
        mesh.position.y = Math.max(0, feetY);
      } else {
        mesh.position.set(p.x, Math.max(0, p.y - 1.7), p.z);
      }
      mesh.rotation.y = p.yaw + Math.PI;
      mesh.visible = !p.dead && !p.clk; // cloaked players are invisible
      this.updatePlayerArmor(mesh, p.art || '');
      // Walk animation for other players — detect movement by comparing positions
      const ud = mesh.userData;
      // Show/hide gun based on weapon type
      const pGunName = p.gun;
      const pGun = GUNS[pGunName];
      const pIsMelee = pGun && pGun.melee;
      if (ud.gunGroup) {
        // Paused player — hand up gesture, hide gun
        if (p.pau) {
          ud.gunGroup.visible = false;
          if (ud.armR) {
            ud.armR.rotation.x = -2.2; // arm straight up
            ud.armR.rotation.z = 0;
          }
          if (ud.armL) {
            ud.armL.rotation.x = -2.0; // other hand up too
            ud.armL.rotation.z = -0.3;
          }
        } else {
        ud.gunGroup.visible = !pIsMelee && !p.dead;
        const twoHanded = pGunName === 'rifle' || pGunName === 'smg' || pGunName === 'shotgun';
        // Adjust left hand on gun for two-handed weapons
        if (ud.gunGroup.userData && ud.gunGroup.userData.handL) {
          if (twoHanded) {
            ud.gunGroup.userData.handL.position.set(0, -0.03, -0.45);
          } else {
            ud.gunGroup.userData.handL.position.set(0, -0.03, -0.3);
          }
        }
        // Reload animation for other players — dip gun and bring left hand from bottom
        if (p.r === 1 && !pIsMelee) {
          if (!ud.reloadStart) ud.reloadStart = performance.now() / 1000;
          const rT = performance.now() / 1000 - ud.reloadStart;
          const rPhase = Math.min(rT * 3, Math.PI);
          const dip = Math.sin(rPhase) * 0.2;
          ud.gunGroup.position.set(-0.45, 1.25 - dip, 0.1);
          ud.gunGroup.rotation.x = -0.15 - dip * 0.8; // dip down for reload
          ud.gunGroup.rotation.y = Math.PI; // keep barrel flipped
          ud.gunGroup.rotation.z = dip * 0.3; // tilt gun
          if (ud.armR) ud.armR.rotation.x = -1.2 - dip;
          if (ud.armL) {
            // Left arm swings down to bottom of gun (magazine swap)
            const reach = Math.sin(rPhase);
            if (twoHanded) {
              ud.armL.rotation.x = -0.5 + reach * 0.8; // arm drops down then comes back up
              ud.armL.rotation.z = 0.3 - reach * 0.5;
            } else {
              ud.armL.rotation.x = -0.2 + reach * 0.6;
              ud.armL.rotation.z = -reach * 0.3;
            }
          }
        } else {
          ud.reloadStart = 0;
          // Idle / walking — gun held forward and up
          ud.gunGroup.position.set(-0.45, 1.25, 0.1);
          ud.gunGroup.rotation.x = -0.15; // barrel forward, slight upward aim
          ud.gunGroup.rotation.y = Math.PI; // keep barrel flipped
          // Right arm holds gun
          if (ud.armR) ud.armR.rotation.x = -1.2;
          // Left arm: two-handed weapons hold barrel, pistol swings free
          if (ud.armL) {
            if (twoHanded) {
              ud.armL.rotation.x = -1.3;
              ud.armL.rotation.z = 0.4;
            } else {
              ud.armL.rotation.x = 0;
              ud.armL.rotation.z = 0;
            }
          }
        }
        } // end not paused
      }
      const prevPos = this.prevPositions.players[p.id];
      const moving = prevPos && (Math.abs(p.x - prevPos.x) > 0.01 || Math.abs(p.z - prevPos.z) > 0.01);
      if (!ud.walkPhase) ud.walkPhase = 0;
      if (moving) ud.walkPhase += dt * 8;
      if (ud.legL && ud.legR) {
        const s = Math.sin(ud.walkPhase);
        ud.legL.rotation.x = s * 0.3;
        ud.legR.rotation.x = -s * 0.3;
      }
      if (ud.armL && ud.armR && p.r !== 1 && !p.pau) {
        const s = Math.sin(ud.walkPhase);
        // Right arm always holds gun — slight sway only
        ud.armR.rotation.x = -1.2 + s * 0.05;
        // Left arm: two-handed weapons hold gun, pistol swings free
        if (pGunName === 'rifle' || pGunName === 'smg' || pGunName === 'shotgun') {
          ud.armL.rotation.x = -1.3 + s * 0.05;
        } else {
          ud.armL.rotation.x = -s * 0.2;
        }
      }
      // Name tag
      if (mesh.userData.nameTag) {
        mesh.userData.nameTag.position.set(0, 2.5, 0);
        mesh.userData.nameTag.lookAt(this.camera.position);
      }
      // Health bar — only show when recently attacked
      if (ud.healthBar) {
        const prevHp = ud.lastHp;
        const nowSec = performance.now() / 1000;
        if (prevHp !== undefined && p.h < prevHp) {
          ud.healthBar.userData.lastHitTime = nowSec;
        }
        ud.lastHp = p.h;
        const sinceHit = nowSec - (ud.healthBar.userData.lastHitTime || 0);
        if (sinceHit < 3) {
          ud.healthBar.visible = true;
          if (ud.lastDrawnHp !== p.h) {
            this.updateHealthBar(ud.healthBar, p.h || 100, p.mhp || 100);
            ud.lastDrawnHp = p.h;
          }
        } else {
          ud.healthBar.visible = false;
        }
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
          if (t.hit) {
            this.spawnImpactHole(t.x2, t.y2, t.z2, t.zid);
            // Apply knockback to the shot body part
            if (t.zid >= 0 && t.part && this.zombieMeshes[t.zid]) {
              this.applyHitKnockback(this.zombieMeshes[t.zid], t.part, t.x2, t.y2, t.z2);
            }
          }
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

    // Process item effects from all players
    if (state.players) {
      for (const p of state.players) {
        if (!p.eff) continue;
        for (const e of p.eff) {
          if (e.t === 'g' && !this._seenEff.has(`g_${p.id}_${e.x}_${e.z}`)) {
            this._seenEff.add(`g_${p.id}_${e.x}_${e.z}`);
            this.spawnGrenadeEffect(e.x, e.z);
          } else if (e.t === 'r' && !this._seenEff.has(`r_${p.id}_${e.x}_${e.z}`)) {
            this._seenEff.add(`r_${p.id}_${e.x}_${e.z}`);
            this.spawnRocketEffect(e.x, e.z);
          } else if (e.t === 'a' && !this._seenEff.has(`a_${p.id}`)) {
            this._seenEff.add(`a_${p.id}`);
            this.spawnAirstrikeEffect();
          }
        }
      }
      // Clean old seen effects (keep set small)
      if (this._seenEff.size > 50) {
        const arr = Array.from(this._seenEff);
        this._seenEff = new Set(arr.slice(-20));
      }
    }

    // Update camera to my player
    if (this.myPlayer) {
      this.camera.rotation.order = 'YXZ';

      if (this.thirdPerson) {
        // Third-person: camera orbits around player — yaw/pitch control the orbit
        const dist = 6;
        const height = 3;
        const camX = this.myPlayer.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist;
        const camY = this.myPlayer.y + height - Math.sin(this.pitch) * dist;
        const camZ = this.myPlayer.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist;
        this.camera.position.set(camX, camY, camZ);
        // Camera looks at player
        this.camera.lookAt(this.myPlayer.x, this.myPlayer.y + 0.5, this.myPlayer.z);
        // Show local player mesh
        if (!this.localPlayerMesh) {
          this.localPlayerMesh = this.createPlayerMesh(this.playerEmoji, this.playerFaceDataURL, this.myName || 'You', this.playerColors);
          this.scene.add(this.localPlayerMesh);
        }
        if (this.localPlayerMesh) {
          this.localPlayerMesh.visible = true;
          this.localPlayerMesh.position.set(this.myPlayer.x, 0, this.myPlayer.z);
          // Face the direction the camera is looking (away from camera)
          this.localPlayerMesh.rotation.y = this.yaw + Math.PI;
          this.updatePlayerArmor(this.localPlayerMesh, this.myPlayer.art || '');
        }
        // Hide gun in third person
        this.gun.visible = false;
      } else {
        // First-person: camera at player eye
        this.camera.position.set(this.myPlayer.x, this.myPlayer.y, this.myPlayer.z);
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
        // Hide local player mesh
        if (this.localPlayerMesh) this.localPlayerMesh.visible = false;
      }

      // Camera shake from creepy zombie attacks
      if (this.cameraShake > 0) {
        this.cameraShake -= dt;
        const shakeT = performance.now() / 1000;
        const shakeAmt = this.cameraShake * 0.15;
        this.camera.position.x += Math.sin(shakeT * 40) * shakeAmt;
        this.camera.position.y += Math.cos(shakeT * 35) * shakeAmt;
        this.camera.rotation.z = Math.sin(shakeT * 45) * shakeAmt;
      } else {
        this.camera.rotation.z = 0;
      }

      // Gun recoil
      const recoil = this.myPlayer.gr || 0;
      const isPaused = this.myPlayer.pau === 1;
      // Hide gun when paused or in third-person
      this.gun.visible = !isPaused && !this.thirdPerson;
      // Reload animation — left arm swings from barrel to magazine (bottom of gun) and back
      const isReloading = this.myPlayer.r === 1;
      if (isReloading) {
        if (!this._reloadStartTime) this._reloadStartTime = performance.now() / 1000;
        const reloadT = performance.now() / 1000 - this._reloadStartTime;
        const phase = Math.min(reloadT * 3, Math.PI);
        const dip = Math.sin(phase) * 0.15;
        // Gun tilts slightly — right hand holds it steady
        this.gun.position.z = -0.5 + recoil + dip * 0.15;
        this.gun.position.y = -0.3 - recoil * 0.3 - dip * 0.1;
        this.gun.rotation.x = dip * 0.8;
        this.gun.rotation.z = dip * 0.4;
        // Left arm: swings from barrel position down to magazine (bottom of gun) and back
        // sin(phase): 0 → 1 → 0, so hand goes to mag at peak and returns
        const reach = Math.sin(phase);
        if (this.gunParts.handL) {
          // From barrel (-0.45 z, -0.05 y) to magazine (0 z, -0.25 y) — visible on screen
          this.gunParts.handL.position.x = -0.04;
          this.gunParts.handL.position.y = -0.05 - reach * 0.2;  // drops to mag level
          this.gunParts.handL.position.z = -0.45 + reach * 0.45;  // slides from barrel to mag
        }
        if (this.gunParts.forearmL) {
          this.gunParts.forearmL.position.x = -0.04;
          this.gunParts.forearmL.position.y = -0.05 - reach * 0.15;
          this.gunParts.forearmL.position.z = -0.2 + reach * 0.2;
        }
      } else {
        this._reloadStartTime = 0;
        this.gun.position.z = -0.5 + recoil;
        this.gun.position.y = -0.3 - recoil * 0.3;
        this.gun.rotation.x = 0;
        this.gun.rotation.z = 0;
        // Reset left hand to barrel position
        if (this.gunParts.handL) {
          this.gunParts.handL.position.set(-0.04, -0.05, -0.45);
        }
        if (this.gunParts.forearmL) {
          this.gunParts.forearmL.position.set(-0.04, -0.05, -0.2);
        }
      }

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

  updatePlayerArmor(mesh, tier) {
    if (!mesh || mesh.userData.armorTier === tier) return;
    if (mesh.userData.armorGroup) {
      mesh.remove(mesh.userData.armorGroup);
      mesh.userData.armorGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      mesh.userData.armorGroup = null;
    }
    mesh.userData.armorTier = tier;
    if (!tier) return;
    const colors = { leather: 0x8a5a2a, iron: 0xc0c0cc, diamond: 0x55eeff };
    const mat = new THREE.MeshLambertMaterial({
      color: colors[tier] || 0xc0c0cc,
      emissive: tier === 'diamond' ? 0x115566 : 0x000000,
      emissiveIntensity: tier === 'diamond' ? 0.5 : 0,
    });
    const g = new THREE.Group();
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.95, 0.45), mat);
    chest.position.y = 1.15; chest.castShadow = true; g.add(chest);
    const shoulderGeo = new THREE.BoxGeometry(0.28, 0.18, 0.32);
    const shL = new THREE.Mesh(shoulderGeo, mat); shL.position.set(-0.42, 1.58, 0); g.add(shL);
    const shR = new THREE.Mesh(shoulderGeo, mat); shR.position.set(0.42, 1.58, 0); g.add(shR);
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.46), mat);
    helmet.position.y = 2.06; g.add(helmet);
    mesh.add(g);
    mesh.userData.armorGroup = g;
  }

  createPlayerMesh(emoji, faceDataURL, name, colors) {
    const col = colors || { shirt: '#3498db', pants: '#2a2a4a', skin: '#f5c89a' };
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: col.shirt });
    const headMat = new THREE.MeshLambertMaterial({ color: col.skin });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.35), bodyMat);
    body.position.y = 1.15; body.castShadow = true; group.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
    head.position.y = 1.85; head.castShadow = true; group.add(head);
    // Face — drawn face texture or emoji on front of head
    const faceCanvas = document.createElement('canvas');
    faceCanvas.width = 128; faceCanvas.height = 128;
    const fctx = faceCanvas.getContext('2d');
    if (faceDataURL) {
      const img = new Image();
      img.onload = () => {
        fctx.clearRect(0, 0, 128, 128);
        fctx.drawImage(img, 0, 0, 128, 128);
        faceTexture.needsUpdate = true;
      };
      img.src = faceDataURL;
    } else {
      const faceEmoji = emoji || this.playerEmoji || '😀';
      fctx.clearRect(0, 0, 128, 128);
      fctx.font = '100px sans-serif';
      fctx.textAlign = 'center';
      fctx.textBaseline = 'middle';
      fctx.fillText(faceEmoji, 64, 64);
      group.userData.emoji = faceEmoji;
    }
    const faceTexture = new THREE.CanvasTexture(faceCanvas);
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture, transparent: true });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), faceMat);
    face.position.set(0, 1.85, 0.201);
    face.userData.isFace = true;
    group.add(face);
    group.userData.faceDataURL = faceDataURL || null;
    const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
    const armL = new THREE.Mesh(armGeo, bodyMat); armL.position.set(-0.4, 1.15, 0); armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, bodyMat); armR.position.set(0.4, 1.15, 0); armR.castShadow = true; group.add(armR);
    // Gun in right hand — held forward and slightly up
    const gunGroup = new THREE.Group();
    const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.6), new THREE.MeshLambertMaterial({color:0x2a2a2a}));
    gunGroup.add(gunBody);
    const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.4), new THREE.MeshLambertMaterial({color:0x1a1a1a}));
    gunBarrel.position.set(0, 0.03, -0.45); gunGroup.add(gunBarrel);
    const gunMag = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.25, 0.12), new THREE.MeshLambertMaterial({color:0x333333}));
    gunMag.position.set(0, -0.18, 0.1); gunGroup.add(gunMag);
    // Hands on gun
    const handMat = new THREE.MeshLambertMaterial({color: col.skin});
    const handR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.16), handMat);
    handR.position.set(0, -0.08, 0.05); gunGroup.add(handR);
    const handL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.16), handMat);
    handL.position.set(0, -0.03, -0.3); gunGroup.add(handL);
    gunGroup.userData = { handL };
    // Position gun so it appears on right side after mesh rotation.y = yaw + PI
    // Gun is at local x=-0.45 (becomes world x=+0.45 after 180° rotation)
    // Gun group rotated PI around Y so barrel points local +z (becomes world -z = look direction)
    gunGroup.position.set(-0.45, 1.25, 0.1);
    gunGroup.rotation.x = -0.15; // slight upward aim
    gunGroup.rotation.y = Math.PI; // flip so barrel points +z in local (forward after mesh rotation)
    group.add(gunGroup);
    const legGeo = new THREE.BoxGeometry(0.22, 0.75, 0.22);
    const legL = new THREE.Mesh(legGeo, new THREE.MeshLambertMaterial({color: col.pants})); legL.position.set(-0.15, 0.375, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, new THREE.MeshLambertMaterial({color: col.pants})); legR.position.set(0.15, 0.375, 0); legR.castShadow = true; group.add(legR);

    // Name tag (simple sprite)
    const tagName = name || 'Player';
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#3498db';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tagName.substring(0, 12), 128, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    sprite.scale.set(1.5, 0.4, 1);
    sprite.position.set(0, 2.5, 0);
    group.add(sprite);
    // Health bar above name tag
    const hb = this.createHealthBar(2.85);
    group.add(hb);
    group.userData = { nameTag: sprite, armL, armR, legL, legR, head, gunGroup, walkPhase: 0, healthBar: hb, faceDataURL: faceDataURL || null };

    return group;
  }

  updatePlayerMeshFace(mesh, faceDataURL) {
    if (!faceDataURL || !mesh) return;
    mesh.userData.faceDataURL = faceDataURL;
    // Find the face plane (tagged with userData.isFace)
    for (const child of mesh.children) {
      if (child.userData && child.userData.isFace && child.material && child.material.map) {
        const canvas = child.material.map.image;
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, 128, 128);
          ctx.drawImage(img, 0, 0, 128, 128);
          child.material.map.needsUpdate = true;
        };
        img.src = faceDataURL;
        return;
      }
    }
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
    // Round length to reduce unique geometries
    const roundedLen = Math.round(len * 10) / 10;
    if (!this._tracerGeoCache) this._tracerGeoCache = {};
    const cacheKey = `${cfg.radius}_${roundedLen}`;
    if (!this._tracerGeoCache[cacheKey]) {
      this._tracerGeoCache[cacheKey] = new THREE.CylinderGeometry(cfg.radius, cfg.radius, roundedLen, 6);
    }
    // Pool materials by gun type — clone for independent opacity (clone is cheap, no shader compile)
    if (!this._tracerMatCache) this._tracerMatCache = {};
    if (!this._tracerMatCache[gunName]) {
      this._tracerMatCache[gunName] = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.9 });
    }
    const mat = this._tracerMatCache[gunName].clone();
    const mesh = new THREE.Mesh(this._tracerGeoCache[cacheKey], mat);
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
    // Explosion particles — shared geometry, individual materials for independent fading
    const kidMode = this.kidFriendly;
    if (!this._particleGeo) {
      this._particleGeo = kidMode ? new THREE.OctahedronGeometry(0.08, 0) : new THREE.SphereGeometry(0.08, 4, 4);
      this._particleColors = kidMode ? [0x44ff44, 0x44ffaa, 0x4444ff, 0xffff44, 0x44ffff, 0xffaa44] : [0xcc0000];
    }
    for (let i = 0; i < 6; i++) {
      const pColor = kidMode ? this._particleColors[i % this._particleColors.length] : 0xcc0000;
      const pMat = new THREE.MeshBasicMaterial({ color: pColor, transparent: true, opacity: 1 });
      const particle = new THREE.Mesh(this._particleGeo, pMat);
      const s = 0.5 + Math.random() * 0.5;
      particle.scale.setScalar(s);
      particle.position.set(wx, offsetY, wz);
      this.scene.add(particle);
      this.bullets.push({
        mesh: particle, life: 0.5 + Math.random() * 0.3, maxLife: 0.8, isParticle: true,
        vx: (Math.random() - 0.5) * 8,
        vy: 2 + Math.random() * 5,
        vz: (Math.random() - 0.5) * 8,
      });
    }
    // Flash sphere — pooled
    if (!this._flashGeo) this._flashGeo = kidMode ? new THREE.OctahedronGeometry(0.35, 0) : new THREE.SphereGeometry(0.3, 8, 8);
    if (!this._flashMat) this._flashMat = new THREE.MeshBasicMaterial({ color: kidMode ? 0x44ff88 : 0xff3300, transparent: true, opacity: 0.8 });
    const flash = new THREE.Mesh(this._flashGeo, this._flashMat);
    flash.position.set(wx, offsetY, wz);
    this.scene.add(flash);
    this.bullets.push({ mesh: flash, life: 0.2, maxLife: 0.2, isFlash: true });
  }

  spawnWaterSplash(x, z) {
    // Water splash particles — blue droplets flying up
    for (let i = 0; i < 6; i++) {
      const drop = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x4a9ada, transparent: true, opacity: 0.8 })
      );
      drop.position.set(x + (Math.random() - 0.5) * 0.8, 0.3, z + (Math.random() - 0.5) * 0.8);
      const vx = (Math.random() - 0.5) * 4;
      const vy = 3 + Math.random() * 3;
      const vz = (Math.random() - 0.5) * 4;
      this.scene.add(drop);
      this.bullets.push({ mesh: drop, life: 0.6, maxLife: 0.6, isParticle: true, vx, vy, vz, gravity: true });
    }
  }

  spawnSlamEffect(x, z) {
    // Expanding shockwave ring on ground
    const ringColor = this.kidFriendly ? 0x44ddff : 0xff6600;
    const ringMat = new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.8, 16), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    this.scene.add(ring);
    this.bullets.push({ mesh: ring, life: 0.6, maxLife: 0.6, isShockwave: true });
  }

  spawnExplosionEffect(x, z) {
    // Large expanding fireball ring
    const expColor = this.kidFriendly ? 0xff8844 : 0xff3300;
    const ringMat = new THREE.MeshBasicMaterial({ color: expColor, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 1.0, 20), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.1, z);
    this.scene.add(ring);
    this.bullets.push({ mesh: ring, life: 0.5, maxLife: 0.5, isShockwave: true });
    // Particle debris
    for (let i = 0; i < 12; i++) {
      const debris = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.12),
        new THREE.MeshBasicMaterial({ color: this.kidFriendly ? 0xffaa44 : 0xaa2200, transparent: true, opacity: 0.9 })
      );
      debris.position.set(x, 1.0, z);
      const vx = (Math.random() - 0.5) * 10;
      const vy = 4 + Math.random() * 6;
      const vz = (Math.random() - 0.5) * 10;
      this.scene.add(debris);
      this.bullets.push({ mesh: debris, life: 0.8, maxLife: 0.8, isParticle: true, vx, vy, vz, gravity: true });
    }
    if (this.myPlayer) {
      const d = Math.hypot(x - this.myPlayer.x, z - this.myPlayer.z);
      if (d < 10) this.cameraShake = Math.max(this.cameraShake, 0.8 * (1 - d / 10));
    }
  }

  spawnAcidSpitEffect(x, y, z) {
    const spitMat = new THREE.MeshBasicMaterial({ color: this.kidFriendly ? 0xaaff44 : 0x88ff00, transparent: true, opacity: 0.9 });
    const spit = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), spitMat);
    spit.position.set(x, y, z);
    this.scene.add(spit);
    this.bullets.push({ mesh: spit, life: 0.3, maxLife: 0.3, isParticle: false });
    // Small trail glow
    const glowMat = new THREE.MeshBasicMaterial({ color: this.kidFriendly ? 0xccff88 : 0xaaff00, transparent: true, opacity: 0.3 });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 6), glowMat);
    glow.position.set(x, y, z);
    this.scene.add(glow);
    this.bullets.push({ mesh: glow, life: 0.2, maxLife: 0.2, isParticle: false });
  }

  spawnLightningEffect(x, z) {
    const boltMat = new THREE.MeshBasicMaterial({ color: 0x66ffff, transparent: true, opacity: 0.9 });
    // Vertical bolt
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 10, 0.1), boltMat);
    bolt.position.set(x, 5, z);
    this.scene.add(bolt);
    this.bullets.push({ mesh: bolt, life: 0.3, maxLife: 0.3, isParticle: false });
    // Impact ring
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x66ffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.8, 16), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.1, z);
    this.scene.add(ring);
    this.bullets.push({ mesh: ring, life: 0.4, maxLife: 0.4, isShockwave: true });
    // Sparks
    for (let i = 0; i < 6; i++) {
      const spark = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), boltMat);
      spark.position.set(x, 1.5, z);
      const vx = (Math.random() - 0.5) * 8;
      const vy = 3 + Math.random() * 5;
      const vz = (Math.random() - 0.5) * 8;
      this.scene.add(spark);
      this.bullets.push({ mesh: spark, life: 0.5, maxLife: 0.5, isParticle: true, vx, vy, vz, gravity: true });
    }
  }

  spawnCrackEffect(x, z, dx, dz, length) {
    const len = length || 30;
    // Main crack line — dark jagged line on ground
    const crackColor = this.kidFriendly ? 0x336699 : 0x1a0a00;
    const crackMat = new THREE.MeshBasicMaterial({ color: crackColor, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(2.0, len), crackMat);
    crack.rotation.x = -Math.PI / 2;
    // Position at midpoint of crack
    crack.position.set(x + dx * len / 2, 0.03, z + dz * len / 2);
    // Rotate to align with direction
    crack.rotation.z = Math.atan2(dx, dz);
    this.scene.add(crack);
    this.bullets.push({ mesh: crack, life: 3.0, maxLife: 3.0, isCrack: true });
    // Glowing edges — orange/red glow along the crack
    const glowColor = this.kidFriendly ? 0x44ddff : 0xff3300;
    const glowMat = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
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
      const pMat = new THREE.MeshBasicMaterial({ color: this.kidFriendly ? 0x886644 : 0x3a1a00, transparent: true, opacity: 1 });
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
    const projColor = this.kidFriendly ? 0x44aaff : 0xff00ff;
    const projMat = new THREE.MeshBasicMaterial({ color: projColor, transparent: true, opacity: 1 });
    const proj = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), projMat);
    proj.position.set(x, y, z);
    this.scene.add(proj);
    this.bullets.push({ mesh: proj, life: 0.4, maxLife: 0.4, isProjectile: true });
  }

  spawnGrenadeEffect(x, z) {
    const kid = this.kidFriendly;
    // Big expanding sphere
    const boomColor = kid ? 0x44ddff : 0xff6600;
    const boomMat = new THREE.MeshBasicMaterial({ color: boomColor, transparent: true, opacity: 0.8 });
    const boom = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 16), boomMat);
    boom.position.set(x, 1, z);
    this.scene.add(boom);
    this.bullets.push({ mesh: boom, life: 0.5, maxLife: 0.5, isExplosion: true, expandRate: 30 });
    // Ring on ground
    const ringColor = kid ? 0x44ddff : 0xff4400;
    const ringMat = new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.5, 24), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    this.scene.add(ring);
    this.bullets.push({ mesh: ring, life: 0.6, maxLife: 0.6, isShockwave: true });
    // Particles
    for (let i = 0; i < 20; i++) {
      const pColor = kid ? [0x44ff44, 0x44aaff, 0xffff44][i % 3] : [0xff4400, 0xff6600, 0xcc0000][i % 3];
      const pMat = new THREE.MeshBasicMaterial({ color: pColor, transparent: true, opacity: 1 });
      const pSize = 0.1 + Math.random() * 0.15;
      const particle = new THREE.Mesh(new THREE.BoxGeometry(pSize, pSize, pSize), pMat);
      particle.position.set(x, 1 + Math.random(), z);
      this.scene.add(particle);
      this.bullets.push({
        mesh: particle, life: 0.6 + Math.random() * 0.4, maxLife: 1.0, isParticle: true,
        vx: (Math.random() - 0.5) * 12,
        vy: 5 + Math.random() * 8,
        vz: (Math.random() - 0.5) * 12,
      });
    }
  }

  spawnRocketEffect(x, z) {
    const kid = this.kidFriendly;
    // Bigger explosion than grenade
    const boomColor = kid ? 0x44aaff : 0xff0000;
    const boomMat = new THREE.MeshBasicMaterial({ color: boomColor, transparent: true, opacity: 0.9 });
    const boom = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 20), boomMat);
    boom.position.set(x, 1, z);
    this.scene.add(boom);
    this.bullets.push({ mesh: boom, life: 0.6, maxLife: 0.6, isExplosion: true, expandRate: 40 });
    // Double ring
    const ringColor = kid ? 0x44aaff : 0xff2200;
    for (let r = 0; r < 2; r++) {
      const ringMat = new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(1 + r * 0.5, 1.5 + r * 0.5, 24), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.05, z);
      this.scene.add(ring);
      this.bullets.push({ mesh: ring, life: 0.7 + r * 0.2, maxLife: 0.9, isShockwave: true });
    }
    // Lots of particles
    for (let i = 0; i < 30; i++) {
      const pColor = kid ? [0x44ff44, 0x44aaff, 0xffff44, 0xff8844][i % 4] : [0xff0000, 0xff4400, 0xff6600, 0xcc0000][i % 4];
      const pMat = new THREE.MeshBasicMaterial({ color: pColor, transparent: true, opacity: 1 });
      const pSize = 0.12 + Math.random() * 0.2;
      const particle = new THREE.Mesh(new THREE.BoxGeometry(pSize, pSize, pSize), pMat);
      particle.position.set(x, 1 + Math.random() * 2, z);
      this.scene.add(particle);
      this.bullets.push({
        mesh: particle, life: 0.8 + Math.random() * 0.5, maxLife: 1.3, isParticle: true,
        vx: (Math.random() - 0.5) * 16,
        vy: 6 + Math.random() * 10,
        vz: (Math.random() - 0.5) * 16,
      });
    }
  }

  spawnAirstrikeEffect() {
    const kid = this.kidFriendly;
    // Multiple explosions across the map
    for (let i = 0; i < 8; i++) {
      const x = (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 80;
      setTimeout(() => {
        const boomColor = kid ? 0x44ddff : 0xff6600;
        const boomMat = new THREE.MeshBasicMaterial({ color: boomColor, transparent: true, opacity: 0.8 });
        const boom = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 16), boomMat);
        boom.position.set(x, 1, z);
        this.scene.add(boom);
        this.bullets.push({ mesh: boom, life: 0.5, maxLife: 0.5, isExplosion: true, expandRate: 35 });
        // Particles
        for (let j = 0; j < 12; j++) {
          const pColor = kid ? [0x44ff44, 0x44aaff, 0xffff44][j % 3] : [0xff4400, 0xff6600, 0xcc0000][j % 3];
          const pMat = new THREE.MeshBasicMaterial({ color: pColor, transparent: true, opacity: 1 });
          const pSize = 0.1 + Math.random() * 0.12;
          const particle = new THREE.Mesh(new THREE.BoxGeometry(pSize, pSize, pSize), pMat);
          particle.position.set(x, 1 + Math.random(), z);
          this.scene.add(particle);
          this.bullets.push({
            mesh: particle, life: 0.5 + Math.random() * 0.3, maxLife: 0.8, isParticle: true,
            vx: (Math.random() - 0.5) * 10,
            vy: 4 + Math.random() * 6,
            vz: (Math.random() - 0.5) * 10,
          });
        }
      }, i * 200);
    }
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
  }

  buildCage(x, z, cagedCount) {
    this.clearCage();
    const g = new THREE.Group();
    const barMat = new THREE.MeshLambertMaterial({ color: 0x444455 });
    const size = 5, h = 3;
    for (let i = 0; i <= 8; i++) {
      const t = -size / 2 + (i * size / 8);
      for (const [bx, bz] of [[t, -size / 2], [t, size / 2], [-size / 2, t], [size / 2, t]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), barMat);
        bar.position.set(bx, h / 2, bz); bar.castShadow = true; g.add(bar);
      }
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(size + 0.3, 0.15, size + 0.3), barMat);
    top.position.y = h; g.add(top);
    // Caged buddies pacing inside (visual only — real ones spawn when unlocked)
    const shown = Math.min(3, Math.max(2, cagedCount + 2));
    for (let i = 0; i < shown; i++) {
      const buddy = this.createFriendlyZombieMesh();
      buddy.position.set((Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5);
      buddy.rotation.y = Math.random() * Math.PI * 2;
      g.add(buddy);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.cageGroup = g;
  }

  createFriendlyVariantMesh(type) {
    let mesh;
    if (type === 'skeleton') mesh = this.createSkeletonMesh();
    else if (type === 'spitter') mesh = this.createSpitterMesh();
    else if (type === 'buff') mesh = this.createBuffZombieMesh();
    else return this.createFriendlyZombieMesh();
    // Clone materials so the green friendly aura doesn't tint shared/cached materials
    mesh.traverse(o => { if (o.material) o.material = o.material.clone(); });
    return mesh;
  }

  makeBuddyLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#66ff99';
    ctx.strokeText(text, 128, 44);
    ctx.fillText(text, 128, 44);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.scale.set(2.2, 0.55, 1);
    sprite.position.y = 2.75;
    return sprite;
  }

  clearCage() {
    if (!this.cageGroup) return;
    this.scene.remove(this.cageGroup);
    this.cageGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.cageGroup = null;
  }

  enterSkeletonWorld() {
    // Change ground to dark bone-filled wasteland
    if (this.groundMesh) {
      this.scene.remove(this.groundMesh);
      this.groundMesh.geometry.dispose();
      this.groundMesh.material.dispose();
    }
    const groundGeo = new THREE.PlaneGeometry(CONFIG.worldSize * 2, CONFIG.worldSize * 2);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x2a2a35 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.groundMesh = ground;
    // Darken grid
    if (this.gridMesh) {
      this.gridMesh.material.color.setHex(0x1a1a25);
    }
    // Add scattered bones on the ground
    this.skeletonWorldObjects = [];
    const boneMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, emissive: 0x111122, emissiveIntensity: 0.2 });
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * (CONFIG.worldSize - 10);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      // Random bone shape — either a long bone or a skull
      if (Math.random() < 0.6) {
        const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2 + Math.random() * 0.8, 5), boneMat);
        bone.position.set(x, 0.1, z);
        bone.rotation.z = Math.PI / 2;
        bone.rotation.y = Math.random() * Math.PI * 2;
        bone.castShadow = true;
        this.scene.add(bone);
        this.skeletonWorldObjects.push(bone);
      } else {
        const skull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), boneMat);
        skull.position.set(x, 0.2, z);
        skull.rotation.y = Math.random() * Math.PI * 2;
        skull.castShadow = true;
        this.scene.add(skull);
        this.skeletonWorldObjects.push(skull);
      }
    }
    // Fog for atmosphere
    this.scene.fog = new THREE.Fog(0x1a1a2a, 30, 80);
    // Change background color
    this.scene.background = new THREE.Color(0x1a1a2a);
  }

  exitSkeletonWorld() {
    // Restore normal ground
    if (this.groundMesh) {
      this.scene.remove(this.groundMesh);
      this.groundMesh.geometry.dispose();
      this.groundMesh.material.dispose();
    }
    const groundGeo = new THREE.PlaneGeometry(CONFIG.worldSize * 2, CONFIG.worldSize * 2);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3a5f3a });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.groundMesh = ground;
    // Restore grid color
    if (this.gridMesh) {
      this.gridMesh.material.color.setHex(0x2a4a2a);
    }
    // Remove scattered bones
    if (this.skeletonWorldObjects) {
      for (const obj of this.skeletonWorldObjects) {
        this.scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
      }
      this.skeletonWorldObjects = null;
    }
    // Remove fog
    this.scene.fog = null;
    // Restore background
    this.scene.background = new THREE.Color(0x87ceeb);
  }

  applyHitKnockback(mesh, part, hx, hy, hz) {
    const ud = mesh.userData;
    if (!ud) return;
    // For 'body' hits, use torso if available, otherwise recoil the whole mesh
    let partMesh = ud[part];
    if (part === 'body') {
      partMesh = ud.torso || null;
      if (!partMesh) {
        // Whole-mesh recoil for zombies without a torso part
        if (!mesh.userData.bodyKb) mesh.userData.bodyKb = { t: 0, ox: 0, oz: 0 };
        const zx = mesh.position.x, zz = mesh.position.z;
        const dx = hx - zx, dz = hz - zz;
        const len = Math.hypot(dx, dz) || 1;
        mesh.userData.bodyKb.ox = (dx / len) * 0.12;
        mesh.userData.bodyKb.oz = (dz / len) * 0.12;
        mesh.userData.bodyKb.t = 0.2;
        return;
      }
    }
    if (!partMesh) return;
    // Direction from zombie center to hit point — push part outward (convert to local space)
    const zx = mesh.position.x, zz = mesh.position.z;
    const dx = hx - zx, dz = hz - zz;
    const len = Math.hypot(dx, dz) || 1;
    const wnx = dx / len, wnz = dz / len;
    // Convert world direction to local space (inverse Y rotation)
    const cosY = Math.cos(mesh.rotation.y);
    const sinY = Math.sin(mesh.rotation.y);
    const nx = wnx * cosY - wnz * sinY;
    const nz = wnx * sinY + wnz * cosY;
    // Store knockback state on the part mesh
    if (!partMesh.userData.kb) partMesh.userData.kb = { ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0, t: 0 };
    const kb = partMesh.userData.kb;
    // Reset to fresh knockback
    kb.vx = nx * 0.15;
    kb.vy = 0.08;
    kb.vz = nz * 0.15;
    kb.t = 0.25; // 250ms of knockback animation
    // Store base position if not already
    if (partMesh.userData.basePos === undefined) {
      partMesh.userData.basePos = { x: partMesh.position.x, y: partMesh.position.y, z: partMesh.position.z };
    }
  }

  spawnImpactHole(x, y, z, zid) {
    // Rate-limit: max 1 impact hole per frame to prevent burst allocation
    if (this._lastHoleFrame === this._frameCount) return;
    this._lastHoleFrame = this._frameCount;
    // Limit total holes using a counter
    if (!this._holeCount) this._holeCount = 0;
    if (this._holeCount >= 20) {
      for (let i = 0; i < this.bullets.length; i++) {
        if (this.bullets[i].isHole) {
          const b = this.bullets[i];
          if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
          this.bullets.splice(i, 1);
          this._holeCount--;
          break;
        }
      }
    }
    // Reuse shared geometries AND materials to reduce GC pressure
    if (!this._holeGeo) this._holeGeo = new THREE.SphereGeometry(0.08, 6, 6);
    if (!this._ringGeo) this._ringGeo = new THREE.CircleGeometry(0.12, 8);
    if (!this._holeMats) {
      const hc = this.kidFriendly ? 0x3366cc : 0xcc0000;
      const rc = this.kidFriendly ? 0x3366cc : 0xaa0000;
      this._holeColors = { hole: hc, ring: rc };
    }
    const group = new THREE.Group();
    const holeMat = new THREE.MeshBasicMaterial({ color: this._holeColors.hole, transparent: true, opacity: 1 });
    const hole = new THREE.Mesh(this._holeGeo, holeMat);
    group.add(hole);
    const ringMat = new THREE.MeshBasicMaterial({ color: this._holeColors.ring, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(this._ringGeo, ringMat);
    // If near ground, lay flat; otherwise face outward
    if (y < 0.3) {
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
    } else {
      // Face camera without lookAt (avoids matrix update)
      ring.rotation.y = this.yaw;
    }
    group.add(ring);

    // If zid is valid, attach to zombie mesh so hole follows the zombie
    if (zid !== undefined && zid >= 0 && this.zombieMeshes[zid]) {
      const zMesh = this.zombieMeshes[zid];
      // Push hole slightly toward zombie center so it sits on the body surface, not floating in front
      const zcx = zMesh.position.x, zcz = zMesh.position.z;
      const pushDx = zcx - x, pushDz = zcz - z;
      const pushLen = Math.hypot(pushDx, pushDz);
      const pushAmount = 0.15; // pull hole 0.15 units toward zombie center
      let adjX = x, adjZ = z;
      if (pushLen > 0.001) {
        adjX = x + (pushDx / pushLen) * pushAmount;
        adjZ = z + (pushDz / pushLen) * pushAmount;
      }
      // Compute local position manually (inverse Y rotation: localX = dx*cos - dz*sin, localZ = dx*sin + dz*cos)
      const dx = adjX - zcx;
      const dz = adjZ - zcz;
      const cosY = Math.cos(zMesh.rotation.y);
      const sinY = Math.sin(zMesh.rotation.y);
      const sc = zMesh.scale.x || 1;
      group.position.set((dx * cosY - dz * sinY) / sc, y / (zMesh.scale.y || 1), (dx * sinY + dz * cosY) / sc);
      zMesh.add(group);
    } else {
      group.position.set(x, Math.max(y, 0.01), z);
      this.scene.add(group);
    }
    this.bullets.push({ mesh: group, life: 2.0, maxLife: 2.0, isHole: true });
    this._holeCount = (this._holeCount || 0) + 1;
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        // Remove from whatever parent it's attached to (scene or zombie mesh)
        if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
        if (b.isHole) {
          // Dispose individual materials (geometries are shared)
          b.mesh.children.forEach(c => { c.material.dispose(); });
          if (this._holeCount) this._holeCount--;
        } else if (b.isParticle) {
          // Particles use shared geometry — dispose individual material only
          b.mesh.material.dispose();
        } else if (b.isFlash) {
          // Flash uses shared geometry/material — don't dispose
        } else if (b.isLimb || b.isExplosion || b.isShockwave || b.isCrackGlow) {
          // These create their own geometries — dispose them
          b.mesh.geometry.dispose();
          b.mesh.material.dispose();
        } else {
          // Tracers use shared geometry but cloned material — dispose material only
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
      } else if (b.isExplosion) {
        // Expanding explosion sphere
        const p = 1 - b.life / b.maxLife;
        const rate = b.expandRate || 30;
        b.mesh.scale.setScalar(1 + p * rate * 0.1);
        b.mesh.material.opacity = (1 - p) * 0.8;
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
        if (b.mesh.children[0]) b.mesh.children[0].material.opacity = fadeRatio;
        if (b.mesh.children[1]) b.mesh.children[1].material.opacity = 0.7 * fadeRatio;
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
    document.getElementById('gold-val').textContent = p.sp ? '∞' : p.g;
    const keysEl = document.getElementById('keys-val');
    if (keysEl) keysEl.textContent = '🗝️' + (p.ck || 0);
    const eggEl = document.getElementById('egg-val');
    if (eggEl) eggEl.textContent = p.eggn ? `🥚×${p.eggn} · ${p.egg}w` : '—';
    const armorEl = document.getElementById('armor-val');
    if (armorEl) {
      const icons = { leather: '🥾', iron: '🛡️', diamond: '💎' };
      armorEl.textContent = p.ar ? `${icons[p.art] || '🛡️'} ${p.ar}` : '—';
    }
    // Spawner mode indicator
    const spawnerEl = document.getElementById('spawner-indicator');
    if (spawnerEl) spawnerEl.style.display = p.sp ? 'block' : 'none';
    const gunName = GUNS[p.gun] ? GUNS[p.gun].name : p.gun;
    const autoTag = p.af ? ' [AUTO]' : '';
    if (p.r) {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — RELOADING...`;
    } else if (p.ammo === Infinity || p.ammo === 'Infinity') {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — ∞`;
    } else {
      document.getElementById('ammo-val').textContent = `${gunName}${autoTag} — ${p.ammo}/∞`;
    }
    const maxHP = p.mhp || this.playerMeta.maxHealth || CONFIG.maxHealth;
    const pct = (p.h / maxHP) * 100;
    document.getElementById('health-bar').style.width = pct + '%';

    // Damage overlay
    if (p.h < (this._lastHealth || p.h)) {
      const overlay = document.getElementById('damage-overlay');
      overlay.classList.add('hit');
      setTimeout(() => overlay.classList.remove('hit'), 150);
    }
    this._lastHealth = p.h;

    // Downed overlay
    const downedEl = document.getElementById('downed-overlay');
    if (downedEl) {
      if (p.dwn) {
        downedEl.style.display = 'block';
        const timerEl = document.getElementById('downed-timer');
        if (timerEl) timerEl.textContent = `Revive in: ${p.dwt}s — A teammate must press [R] near you`;
      } else {
        downedEl.style.display = 'none';
      }
    }
    // Golden bullets indicator
    const gbEl = document.getElementById('golden-bullets');
    if (gbEl) {
      gbEl.style.display = p.gb > 0 ? 'block' : 'none';
      if (p.gb > 0) gbEl.textContent = `GOLDEN BULLETS: ${p.gb} — 3x DMG!`;
    }

    // Show downed teammate indicator + revive hint
    if (this.serverState && this.serverState.players) {
      let canRevive = false;
      for (const other of this.serverState.players) {
        if (other.id === this.myId || !other.dwn) continue;
        // Show revive hint if close enough
        const d = Math.hypot(other.x - p.x, other.z - p.z);
        if (d < 2.5) canRevive = true;
      }
      const reviveHint = document.getElementById('revive-hint');
      if (reviveHint) reviveHint.style.display = canRevive ? 'block' : 'none';
    }

    // Inventory bar
    const invBar = document.getElementById('inventory-bar');
    const wpnBar = document.getElementById('weapon-bar');
    if (this.playing) {
      invBar.style.display = 'flex';
      wpnBar.style.display = 'flex';
      // Weapon hotbar
      const ownedGuns = this.playerMeta.ownedGuns || { knife: true, pistol: true };
      const gunIcons = { pistol: '🔫', knife: '🔪', katana: '🗡️', smg: '🔫', shotgun: '🔫', rifle: '🔫', goldenKatana: '⚔️' };
      const gunKeys = { pistol: '1', knife: '2', katana: '3', smg: '4', shotgun: '5', rifle: '6', goldenKatana: '7' };
      const gunOrder = ['pistol','knife','katana','smg','shotgun','rifle','goldenKatana'];
      let wpnHtml = '';
      for (const key of gunOrder) {
        if (!ownedGuns[key]) continue;
        const equipped = p.gun === key;
        const name = GUNS[key] ? GUNS[key].name : key;
        wpnHtml += `<div class="wpn-slot${equipped ? ' equipped' : ' owned'}">`;
        wpnHtml += `<span class="wpn-key">${gunKeys[key]}</span>`;
        wpnHtml += `<span class="wpn-icon">${gunIcons[key]}</span>`;
        wpnHtml += `<span class="wpn-name">${name}</span>`;
        wpnHtml += '</div>';
      }
      wpnBar.innerHTML = wpnHtml;
      // Items
      const items = p.it || { grenade:0, rocket:0, medkit:0, airstrike:0 };
      const itemIcons = { grenade: '💣', rocket: '🚀', medkit: '🩹', airstrike: '✈️' };
      const itemKeys = { grenade: 'T', rocket: 'Y', medkit: 'U', airstrike: 'I' };
      const itemNames = { grenade: 'Grenade', rocket: 'Rocket', medkit: 'Medkit', airstrike: 'Airstrike' };
      const onCooldown = (p.icd || 0) > 0;
      let html = '';
      for (const key of ['grenade','rocket','medkit','airstrike']) {
        const count = items[key] || 0;
        const has = count > 0;
        html += `<div class="inv-slot${has ? ' has-item' : ''}${onCooldown && has ? ' on-cooldown' : ''}">`;
        html += `<span class="inv-key">${itemKeys[key]}</span>`;
        html += `<span class="inv-icon">${has ? itemIcons[key] : '·'}</span>`;
        html += `<span class="inv-name">${itemNames[key]}</span>`;
        if (has) html += `<span class="inv-count">${count}</span>`;
        html += '</div>';
      }
      invBar.innerHTML = html;
    } else {
      invBar.style.display = 'none';
      wpnBar.style.display = 'none';
    }
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
    const hotkeys = { pistol: '1', knife: '2', katana: '3', smg: '4', shotgun: '5', rifle: '6', goldenKatana: '7' };
    const buyHotkeys = { smg: 'F', shotgun: 'H', katana: 'J', rifle: 'K' };
    const upgradeHotkeys = { fireRate: 'X', magSize: 'C', health: 'V' };
    const isSpawner = p.sp === 1;
    let html = `<div style="color:#ffdd00;font-size:18px;font-weight:900;margin-bottom:8px;">GOLD: ${isSpawner ? '∞' : p.g}</div>`;

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
      if (owned || gun.chestOnly) continue;
      const canBuy = isSpawner || p.g >= gun.price;
      const stats = gun.melee ? `DMG ${gun.damage} · RNG ${gun.meleeRange}` : `DMG ${gun.damage} · MAG ${gun.magSize}`;
      html += `<div class="shop-item ${canBuy?'':'disabled'}" ${canBuy?`data-action="buyGun" data-key="${key}"`:''}><span>${gun.name} ${buyHotkeys[key]?`<span style="color:#666;font-size:10px;">[${buyHotkeys[key]}]</span>`:''}<br><span style="font-size:10px;color:#666;">${stats}</span></span><span>${isSpawner?'FREE':gun.price+'g'}</span></div>`;
    }

    // Crafting
    const mats = p.mat || [0, 0, 0, 0, 0, 0]; // bone, goo, gunpowder, iron, shadow, core
    html += '<div style="color:#aaa;font-size:11px;font-weight:700;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px;">Crafting</div>';
    html += `<div style="font-size:11px;color:#999;margin-bottom:4px;">Materials: 🦴${mats[0]} Bone · 🟢${mats[1]} Goo · 💥${mats[2]} Powder · 🔩${mats[3]} Iron · 🌑${mats[4]} Shadow · 💜${mats[5]} Core</div>`;
    const CRAFT_RECIPES = [
      { key: 'ironHelmet', name: '⛑️ Iron Helmets', desc: 'All your buddies get +50 HP forever', costText: '4 Iron', can: mats[3] >= 4, owned: !!p.bgh },
      { key: 'boneSword',  name: '🗡️ Bone Swords',  desc: 'All your buddies get +15 DMG forever', costText: '5 Bone', can: mats[0] >= 5, owned: !!p.bgs },
      { key: 'golemHeart', name: '🗿 Golem Heart',  desc: 'Summon the Iron Golem (1500 HP tank)', costText: '1 Core + 10 Bone', can: mats[5] >= 1 && mats[0] >= 10, owned: false },
      { key: 'shadowCloak', name: '🌫️ Shadow Cloak', desc: 'Invisible to zombies for 10 seconds', costText: '1 Core + 5 Shadow', can: mats[5] >= 1 && mats[4] >= 5, owned: false },
    ];
    for (const r of CRAFT_RECIPES) {
      const canCraft = r.can && !r.owned;
      html += `<div class="shop-item ${r.owned ? 'equipped' : (canCraft ? '' : 'disabled')}" ${canCraft ? `data-action="craft" data-key="${r.key}"` : ''}>
        <span>${r.name}${r.owned ? ' <span style="color:#2ecc71;font-size:10px;">CRAFTED</span>' : ''}<br><span style="font-size:10px;color:#666;">${r.desc}</span></span>
        <span style="font-size:10px;color:#888;">${r.owned ? '✓' : r.costText}</span>
      </div>`;
    }

    // Armor
    html += '<div style="color:#aaa;font-size:11px;font-weight:700;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px;">Armor</div>';
    const ARMOR_SHOP = [
      { key: 'leather', name: 'Leather Armor', icon: '🥾', price: 150, points: 100, absorb: 25 },
      { key: 'iron',    name: 'Iron Armor',    icon: '🛡️', price: 350, points: 200, absorb: 50 },
      { key: 'diamond', name: 'Diamond Armor', icon: '💎', price: 700, points: 350, absorb: 70 },
    ];
    for (const a of ARMOR_SHOP) {
      const wearing = p.art === a.key;
      const canBuy = !wearing && (isSpawner || p.g >= a.price);
      html += `<div class="shop-item ${wearing?'equipped':(canBuy?'':'disabled')}" ${canBuy?`data-action="buyArmor" data-key="${a.key}"`:''}>
        <span>${a.icon} ${a.name}${wearing?` <span style="color:#2ecc71;font-size:10px;">WEARING · ${p.ar}</span>`:''}<br><span style="font-size:10px;color:#666;">Soaks ${a.absorb}% damage · ${a.points} durability</span></span>
        <span>${wearing?'ON':(isSpawner?'FREE':a.price+'g')}</span>
      </div>`;
    }

    // Upgrades
    html += '<div style="color:#aaa;font-size:11px;font-weight:700;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px;">Upgrades</div>';
    for (const [key, up] of Object.entries(UPGRADES)) {
      const lvl = meta.upgrades[key] || 0;
      const maxed = lvl >= up.maxLevel;
      const price = up.price * (lvl + 1);
      const canBuy = !maxed && (isSpawner || p.g >= price);
      const uhk = upgradeHotkeys[key] || '';
      html += `<div class="shop-item ${maxed?'maxed':(canBuy?'':'disabled')}" ${canBuy?`data-action="buyUpgrade" data-key="${key}"`:''}>
        <span>${up.name} ${uhk?`<span style="color:#666;font-size:10px;">[${uhk}]</span>`:''} <span style="color:#666;font-size:10px;">Lv.${lvl}/${up.maxLevel}</span></span>
        <span>${maxed?'MAX':(isSpawner?'FREE':price+'g')}</span>
      </div>`;
    }
    // Items (consumables)
    const itemBuyHotkeys = { grenade: 'N', rocket: 'M', medkit: ',', airstrike: '.' };
    const itemUseHotkeys = { grenade: 'T', rocket: 'Y', medkit: 'U', airstrike: 'I' };
    const itemDescs = { grenade: 'AoE 300dmg', rocket: 'AoE 500dmg', medkit: 'Full heal', airstrike: '500dmg all' };
    html += '<div style="color:#aaa;font-size:11px;font-weight:700;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px;">Items (consumables)</div>';
    const playerItems = p.it || { grenade:0, rocket:0, medkit:0, airstrike:0 };
    for (const [key, item] of Object.entries(ITEMS)) {
      const count = playerItems[key] || 0;
      const canBuy = count < item.maxStack && (isSpawner || p.g >= item.price);
      const bhk = itemBuyHotkeys[key] || '';
      const uhk = itemUseHotkeys[key] || '';
      const desc = itemDescs[key] || '';
      html += `<div class="shop-item ${canBuy?'':'disabled'}" ${canBuy?`data-action="buyItem" data-key="${key}"`:''}>
        <span>${item.name} ${bhk?`<span style="color:#666;font-size:10px;">[buy:${bhk}]</span>`:''} ${uhk?`<span style="color:#888;font-size:10px;">[use:${uhk}]</span>`:''}<br><span style="font-size:10px;color:#666;">${desc} · x${count}/${item.maxStack}</span></span>
        <span>${isSpawner?'FREE':item.price+'g'}</span>
      </div>`;
    }
    // Creative mode section
    html += '<div style="color:#aaa;font-size:11px;font-weight:700;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px;">Creative Mode</div>';
    html += `<div class="shop-item ${isSpawner?'equipped':''}" style="${isSpawner?'border-color:#2ecc71;':''}">
      <span>Creative Mode ${isSpawner?'<span style="color:#2ecc71;font-size:10px;">ACTIVE</span>':'<span style="color:#666;font-size:10px;">OFF</span>'}<br><span style="font-size:10px;color:#666;">Invincible, free purchases, spawn eggs</span></span>
      <span style="font-size:10px;color:#666;">[/]</span>
    </div>`;
    if (isSpawner) {
      html += `<div class="shop-item" data-action="spawnEgg" data-key="zombie" style="border-color:#4a7a4a;">
        <span>🧟 Zombie Egg<br><span style="font-size:10px;color:#666;">Spawn a normal zombie</span></span>
        <span style="font-size:10px;color:#666;">[7]</span>
      </div>`;
      html += `<div class="shop-item" data-action="spawnEgg" data-key="skeleton" style="border-color:#aaaaaa;">
        <span>💀 Skeleton Egg<br><span style="font-size:10px;color:#666;">Spawn a skeleton</span></span>
        <span style="font-size:10px;color:#666;">[8]</span>
      </div>`;
      html += `<div class="shop-item" data-action="spawnEgg" data-key="creepy" style="border-color:#884488;">
        <span>👹 Creepy Egg<br><span style="font-size:10px;color:#666;">Spawn a creepy zombie</span></span>
        <span style="font-size:10px;color:#666;">[9]</span>
      </div>`;
      html += `<div class="shop-item" data-action="spawnEgg" data-key="buff" style="border-color:#cc6600;">
        <span>💪 Buff Egg<br><span style="font-size:10px;color:#666;">Spawn a buff zombie</span></span>
        <span style="font-size:10px;color:#666;">[,]</span>
      </div>`;
      html += `<div class="shop-item" data-action="spawnEgg" data-key="necromancer" style="border-color:#6644aa;">
        <span>🔮 Necromancer Egg<br><span style="font-size:10px;color:#666;">Revives dead zombies</span></span>
        <span style="font-size:10px;color:#666;">[click]</span>
      </div>`;
      html += `<div class="shop-item" data-action="spawnEgg" data-key="exploder" style="border-color:#8a0a0a;">
        <span>💣 Exploder Egg<br><span style="font-size:10px;color:#666;">Explodes on contact</span></span>
        <span style="font-size:10px;color:#666;">[click]</span>
      </div>`;
      html += `<div class="shop-item" data-action="spawnEgg" data-key="spitter" style="border-color:#2a4a1a;">
        <span>🤢 Spitter Egg<br><span style="font-size:10px;color:#666;">Ranged acid spit attack</span></span>
        <span style="font-size:10px;color:#666;">[.]</span>
      </div>`;
      html += `<div class="shop-item" data-action="spawnEgg" data-key="buffSkeleton" style="border-color:#1a1a1a;">
        <span>🦴 Buff Skeleton Egg<br><span style="font-size:10px;color:#666;">Heavy skeleton with slam AoE</span></span>
        <span style="font-size:10px;color:#666;">[=]</span>
      </div>`;
      html += `<div class="shop-item" data-action="spawnEgg" data-key="friendly" style="border-color:#1a1a1a;">
        <span>💚 Zombie Buddy Egg<br><span style="font-size:10px;color:#666;">Friendly ally, fights zombies for you</span></span>
        <span style="font-size:10px;color:#666;">[0]</span>
      </div>`;
    }
    html += `<div style="margin-top:10px;font-size:10px;color:#555;">Press <kbd>B</kbd> shop · <kbd>F</kbd>SMG <kbd>H</kbd>Shotgun <kbd>J</kbd>Katana <kbd>K</kbd>Rifle · <kbd>Z</kbd>CallBuddies <kbd>X</kbd>FR <kbd>C</kbd>Mag <kbd>V</kbd>HP ·<kbd>N</kbd>Gre <kbd>M</kbd>Rck <kbd>,</kbd>Med <kbd>.</kbd>Air · <kbd>T</kbd>UseGre <kbd>Y</kbd>UseRck <kbd>U</kbd>UseMed <kbd>I</kbd>UseAir · <kbd>/</kbd>Creative</div>`;
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
    this._frameCount = (this._frameCount || 0) + 1;
    // FPS tracking
    if (!this._fpsFrames) this._fpsFrames = 0;
    if (!this._fpsTimer) this._fpsTimer = performance.now();
    this._fpsFrames++;
    const now = performance.now();
    if (now - this._fpsTimer >= 500) {
      this._fps = Math.round(this._fpsFrames * 1000 / (now - this._fpsTimer));
      this._fpsFrames = 0;
      this._fpsTimer = now;
    }
    // Show perf overlay
    if (this._frameCount % 10 === 0) {
      let perfEl = document.getElementById('perf-overlay');
      if (!perfEl) {
        perfEl = document.createElement('div');
        perfEl.id = 'perf-overlay';
        perfEl.style.cssText = 'position:fixed;bottom:4px;left:4px;font:11px monospace;color:#0f0;background:rgba(0,0,0,0.7);padding:2px 6px;z-index:9999;pointer-events:none;';
        document.body.appendChild(perfEl);
      }
      const bt = this.bullets.length;
      const st = (this._sceneTime || 0).toFixed(1);
      const ht = (this._hudTime || 0).toFixed(1);
      const rt = (this._renderTime || 0).toFixed(1);
      const ubt = (this._bulletsTime || 0).toFixed(1);
      perfEl.textContent = `FPS:${this._fps} B:${bt} scene:${st}ms bullets:${ubt}ms render:${rt}ms`;
    }
    // Advance interpolation alpha (server ticks every 40ms)
    this.interpAlpha += dt / 0.04;
    // Flush throttled input
    this.flushInput();
    const _bt0 = performance.now();
    this.updateBullets(dt);
    this._bulletsTime = performance.now() - _bt0;
    // Gun bob animation — subtle sway based on time (skip during reload)
    if (this.playing && this.myPlayer && !this.myPlayer.dead && this.myPlayer.r !== 1) {
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
      // Reset rotation when not reloading
      this.gun.rotation.x = 0;
      this.gun.rotation.z = 0;
    }
    const _rt0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this._renderTime = performance.now() - _rt0;
  }

  toggleWorldMap() {
    const overlay = document.getElementById('world-map-overlay');
    if (overlay.classList.contains('hidden')) {
      overlay.classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
      this.mapOpen = true;
    } else {
      overlay.classList.add('hidden');
      this.mapOpen = false;
    }
  }
}

window.addEventListener('load', () => {
  window.client = new ZombieMultiplayerClient();
});

'use strict';

// ─── Config ───
const CONFIG = {
  worldW: 32,
  worldD: 32,
  worldH: 12,
  blockSize: 1,
  playerSpeed: 5,
  playerHeight: 1.8,
  playerWidth: 0.6,
  gravity: 28,
  jumpSpeed: 9,
  reach: 5,
  mineTime: { dirt: 0.5, grass: 0.5, wood: 1.0, leaves: 0.3, stone: 1.5, iron: 2.5, coal: 1.5, plank: 0.8 },
  attackRange: 4,
  attackCooldown: 0.4,
  dayLength: 120,
  nightStart: 0.55,
  zombieSpeed: 2.2,
  zombieHealth: 3,
  zombieDamage: 6,
  playerHealth: 100,
};

const BLOCK = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5, IRON: 6, COAL: 7, PLANK: 8,
};

const BLOCK_COLORS = {
  1: 0x4caf50, 2: 0x8d6e63, 3: 0x9e9e9e, 4: 0x6d4c41, 5: 0x2e7d32, 6: 0xcfd8dc, 7: 0x424242, 8: 0xbcaaa4,
};

const BLOCK_NAMES = {
  1: 'Grass', 2: 'Dirt', 3: 'Stone', 4: 'Wood', 5: 'Leaves', 6: 'Iron Ore', 7: 'Coal Ore', 8: 'Planks',
};

const TOOL_TIER = { dirt: 0, grass: 0, wood: 0, leaves: 0, plank: 0, stone: 1, iron: 2, coal: 1 };
const TIER_LEVEL = { wood: 1, stone: 2, iron: 3 };
const TIER_COLOR = { wood: 0x8d6e63, stone: 0x9e9e9e, iron: 0xcfd8dc };

const RECIPES = [
  { id: 'planks',       name: 'Planks x4',     icon: '', cost: { wood: 1 }, gives: { plank: 4 } },
  { id: 'wood_sword',   name: 'Wooden Sword',   icon: '', cost: { plank: 2 }, tool: 'sword',  tier: 'wood' },
  { id: 'wood_pick',    name: 'Wooden Pickaxe', icon: '',  cost: { plank: 3 }, tool: 'pickaxe', tier: 'wood' },
  { id: 'stone_sword',  name: 'Stone Sword',    icon: '', cost: { plank: 1, stone: 2 }, tool: 'sword',  tier: 'stone' },
  { id: 'stone_pick',   name: 'Stone Pickaxe',  icon: '',  cost: { plank: 1, stone: 3 }, tool: 'pickaxe', tier: 'stone' },
  { id: 'iron_sword',   name: 'Iron Sword',     icon: '',  cost: { plank: 1, iron: 2 }, tool: 'sword',  tier: 'iron' },
  { id: 'iron_pick',    name: 'Iron Pickaxe',   icon: '',  cost: { plank: 1, iron: 3 }, tool: 'pickaxe', tier: 'iron' },
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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
    this.scene.fog = new THREE.Fog(0x87ceeb, 30, 80);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.rotation.order = 'YXZ';

    this.keys = {};
    this.yaw = 0;
    this.pitch = 0;
    this.running = false;
    this.gameOver = false;
    this.clock = new THREE.Clock();
    this.dayTime = 0.25;
    this.day = 1;

    this.blockGeo = new THREE.BoxGeometry(1, 1, 1);
    this.blockMeshMap = new Map();

    this.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff5e0, 1.0);
    this.sun.position.set(30, 50, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -30;
    this.sun.shadow.camera.right = 30;
    this.sun.shadow.camera.top = 30;
    this.sun.shadow.camera.bottom = -30;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 120;
    this.scene.add(this.sun);

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
    this.canvas.addEventListener('click', () => {
      if (this.running && !this.gameOver && !this.craftingOpen && !document.pointerLockElement)
        this.canvas.requestPointerLock();
    });
  }

  // ─── World generation ───
  generateWorld() {
    this.world = [];
    for (let x = 0; x < CONFIG.worldW; x++) {
      this.world[x] = [];
      for (let y = 0; y < CONFIG.worldH; y++) {
        this.world[x][y] = [];
        for (let z = 0; z < CONFIG.worldD; z++) this.world[x][y][z] = BLOCK.AIR;
      }
    }

    const heightMap = [];
    for (let x = 0; x < CONFIG.worldW; x++) {
      heightMap[x] = [];
      for (let z = 0; z < CONFIG.worldD; z++) {
        const cx = x - CONFIG.worldW / 2, cz = z - CONFIG.worldD / 2;
        const h = 4 + Math.sin(cx * 0.3) * 1.5 + Math.cos(cz * 0.25) * 1.5 + Math.sin((cx + cz) * 0.15) * 1;
        heightMap[x][z] = Math.max(2, Math.round(h));
      }
    }

    for (let x = 0; x < CONFIG.worldW; x++) {
      for (let z = 0; z < CONFIG.worldD; z++) {
        const h = heightMap[x][z];
        for (let y = 0; y <= h; y++) {
          if (y === h) this.world[x][y][z] = BLOCK.GRASS;
          else if (y >= h - 2) this.world[x][y][z] = BLOCK.DIRT;
          else this.world[x][y][z] = BLOCK.STONE;
        }
        for (let y = 0; y < h - 2; y++) {
          const r = Math.random();
          if (y < h - 4 && r < 0.04) this.world[x][y][z] = BLOCK.IRON;
          else if (y < h - 3 && r < 0.08) this.world[x][y][z] = BLOCK.COAL;
        }
      }
    }

    // Trees
    for (let i = 0; i < 12; i++) {
      const tx = 3 + Math.floor(Math.random() * (CONFIG.worldW - 6));
      const tz = 3 + Math.floor(Math.random() * (CONFIG.worldD - 6));
      const h = heightMap[tx][tz];
      if (this.world[tx][h][tz] !== BLOCK.GRASS) continue;
      const trunkH = 3 + Math.floor(Math.random() * 2);
      for (let y = 1; y <= trunkH; y++) this.world[tx][h + y][tz] = BLOCK.WOOD;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dy = 0; dy <= 1; dy++) {
            if (Math.abs(dx) + Math.abs(dz) + dy > 3) continue;
            const lx = tx + dx, lz = tz + dz, ly = h + trunkH + dy;
            if (lx >= 0 && lx < CONFIG.worldW && lz >= 0 && lz < CONFIG.worldD && ly < CONFIG.worldH) {
              if (this.world[lx][ly][lz] === BLOCK.AIR) this.world[lx][ly][lz] = BLOCK.LEAVES;
            }
          }
        }
      }
    }

    for (let x = 0; x < CONFIG.worldW; x++)
      for (let y = 0; y < CONFIG.worldH; y++)
        for (let z = 0; z < CONFIG.worldD; z++)
          if (this.world[x][y][z] !== BLOCK.AIR) this.createBlockMesh(x, y, z);
  }

  isAir(x, y, z) {
    if (x < 0 || x >= CONFIG.worldW || y < 0 || y >= CONFIG.worldH || z < 0 || z >= CONFIG.worldD) return true;
    return this.world[x][y][z] === BLOCK.AIR;
  }

  shouldRenderBlock(x, y, z) {
    return this.isAir(x + 1, y, z) || this.isAir(x - 1, y, z) ||
           this.isAir(x, y + 1, z) || this.isAir(x, y - 1, z) ||
           this.isAir(x, y, z + 1) || this.isAir(x, y, z - 1);
  }

  createBlockMesh(x, y, z) {
    const type = this.world[x][y][z];
    if (type === BLOCK.AIR) return;
    if (!this.shouldRenderBlock(x, y, z)) return;
    const mat = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS[type] });
    const mesh = new THREE.Mesh(this.blockGeo, mat);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { x, y, z, type };
    this.scene.add(mesh);
    this.blockMeshMap.set(`${x},${y},${z}`, mesh);
  }

  removeBlockMesh(x, y, z) {
    const key = `${x},${y},${z}`;
    const mesh = this.blockMeshMap.get(key);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.material.dispose();
      this.blockMeshMap.delete(key);
    }
  }

  refreshNeighborMeshes(x, y, z) {
    const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (const [dx,dy,dz] of dirs) {
      const nx = x+dx, ny = y+dy, nz = z+dz;
      if (nx < 0 || nx >= CONFIG.worldW || ny < 0 || ny >= CONFIG.worldH || nz < 0 || nz >= CONFIG.worldD) continue;
      if (this.world[nx][ny][nz] !== BLOCK.AIR) {
        this.removeBlockMesh(nx, ny, nz);
        this.createBlockMesh(nx, ny, nz);
      }
    }
  }

  // ─── Input ───
  setupInput() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === 'e' && this.running && !this.gameOver) this.toggleCrafting();
      if (k >= '1' && k <= '9' && this.running) this.selectSlot(parseInt(k) - 1);
      if (k === 'escape' && this.craftingOpen) this.toggleCrafting();
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    document.addEventListener('mousemove', e => {
      if (!document.pointerLockElement) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = clamp(this.pitch - e.movementY * 0.0022, -1.4, 1.2);
    });
    document.addEventListener('mousedown', e => {
      if (!document.pointerLockElement || !this.running || this.gameOver || this.craftingOpen) return;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.placeBlock();
    });
    document.addEventListener('mouseup', e => {
      if (e.button === 0) { this.mouseDown = false; this.miningTarget = null; this.miningProgress = 0; }
    });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('wheel', e => {
      if (!document.pointerLockElement || !this.running || this.gameOver) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      this.selectSlot((this.selectedSlot + dir + 9) % 9);
    });
  }

  // ─── Game flow ───
  start() {
    if (this.blockMeshMap) {
      for (const mesh of this.blockMeshMap.values()) { this.scene.remove(mesh); mesh.material.dispose(); }
      this.blockMeshMap.clear();
    }
    for (const z of this.zombies || []) this.scene.remove(z.mesh);
    if (this.fpvTool) { this.camera.remove(this.fpvTool); this.fpvTool = null; }

    this.gameOver = false;
    this.day = 1;
    this.dayTime = 0.25;
    this.zombies = [];
    this.health = CONFIG.playerHealth;
    this.velY = 0;
    this.onGround = false;
    this.attackTimer = 0;
    this.attackAnim = 0;
    this.miningTarget = null;
    this.miningProgress = 0;
    this.craftingOpen = false;
    this.mouseDown = false;

    this.inv = { wood: 0, plank: 0, dirt: 0, stone: 0, iron: 0, coal: 0 };
    this.bestPickaxe = 0;
    this.bestSword = 0;
    this.hotbar = new Array(9).fill(null).map(() => ({ type: 'empty' }));
    this.selectedSlot = 0;

    this.generateWorld();

    const cx = Math.floor(CONFIG.worldW / 2);
    const cz = Math.floor(CONFIG.worldD / 2);
    let spawnY = 0;
    for (let y = CONFIG.worldH - 1; y >= 0; y--) {
      if (this.world[cx][y][cz] !== BLOCK.AIR) { spawnY = y + 1; break; }
    }
    this.player = { x: cx + 0.5, y: spawnY, z: cz + 0.5 };

    document.getElementById('hud-top').style.display = 'flex';
    document.getElementById('health-bar').style.display = 'block';
    document.getElementById('crosshair').style.display = 'block';
    document.getElementById('hotbar').style.display = 'flex';
    document.getElementById('crafting').style.display = 'none';

    this.updateHotbar();
    this.updateHUD();
    this.running = true;
    this.clock.start();
    this.loop();
  }

  // ─── Block interaction ───
  getLookingAt() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    const origin = this.camera.position.clone();
    const step = 0.05;
    for (let d = 0; d < CONFIG.reach; d += step) {
      const px = origin.x + dir.x * d, py = origin.y + dir.y * d, pz = origin.z + dir.z * d;
      const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
      if (bx < 0 || bx >= CONFIG.worldW || by < 0 || by >= CONFIG.worldH || bz < 0 || bz >= CONFIG.worldD) continue;
      if (this.world[bx][by][bz] !== BLOCK.AIR) return { x: bx, y: by, z: bz, type: this.world[bx][by][bz] };
    }
    return null;
  }

  getPlacePos() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    const origin = this.camera.position.clone();
    const step = 0.05;
    let prev = null;
    for (let d = 0; d < CONFIG.reach; d += step) {
      const px = origin.x + dir.x * d, py = origin.y + dir.y * d, pz = origin.z + dir.z * d;
      const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
      if (bx < 0 || bx >= CONFIG.worldW || by < 0 || by >= CONFIG.worldH || bz < 0 || bz >= CONFIG.worldD) continue;
      if (this.world[bx][by][bz] !== BLOCK.AIR) {
        if (prev && this.world[prev.x][prev.y][prev.z] === BLOCK.AIR) return prev;
        return null;
      }
      prev = { x: bx, y: by, z: bz };
    }
    return null;
  }

  placeBlock() {
    const slot = this.hotbar[this.selectedSlot];
    if (!slot || slot.type !== 'block' || slot.count <= 0) { this.showMessage('Select a block to place'); return; }
    const pos = this.getPlacePos();
    if (!pos) return;
    const px = Math.floor(this.player.x), py = Math.floor(this.player.y), pz = Math.floor(this.player.z);
    if (pos.x === px && pos.z === pz && (pos.y === py || pos.y === py - 1)) return;
    this.world[pos.x][pos.y][pos.z] = slot.blockType;
    this.createBlockMesh(pos.x, pos.y, pos.z);
    this.refreshNeighborMeshes(pos.x, pos.y, pos.z);
    slot.count--;
    if (slot.count <= 0) { slot.type = 'empty'; }
    this.updateHotbar();
  }

  updateMining(dt) {
    const target = this.getLookingAt();
    if (!target) { this.miningTarget = null; this.miningProgress = 0; return; }
    if (!this.miningTarget || this.miningTarget.x !== target.x || this.miningTarget.y !== target.y || this.miningTarget.z !== target.z) {
      const typeName = Object.keys(BLOCK).find(k => BLOCK[k] === target.type).toLowerCase();
      const required = TOOL_TIER[typeName] || 0;
      if (this.bestPickaxe < required) {
        this.showMessage(`Need a ${required === 1 ? 'wood' : 'stone'} pickaxe or better!`);
        this.miningTarget = null;
        return;
      }
      this.miningTarget = target;
      this.miningProgress = 0;
    }
    const typeName = Object.keys(BLOCK).find(k => BLOCK[k] === target.type).toLowerCase();
    let mineTime = CONFIG.mineTime[typeName] || 1.0;
    if (this.bestPickaxe > 0 && TOOL_TIER[typeName] > 0) mineTime /= (1 + this.bestPickaxe * 0.3);
    this.miningProgress += dt;
    const key = `${target.x},${target.y},${target.z}`;
    const mesh = this.blockMeshMap.get(key);
    if (mesh) {
      const crack = this.miningProgress / mineTime;
      mesh.material.emissive = new THREE.Color(crack * 0.3, crack * 0.15, 0);
      mesh.material.emissiveIntensity = 1;
    }
    if (this.miningProgress >= mineTime) {
      this.breakBlock(target.x, target.y, target.z);
      this.miningTarget = null;
      this.miningProgress = 0;
    } else {
      const pct = Math.floor((this.miningProgress / mineTime) * 100);
      this.showMessage(`Mining ${BLOCK_NAMES[target.type]}... ${pct}%`);
    }
  }

  breakBlock(x, y, z) {
    const type = this.world[x][y][z];
    if (type === BLOCK.AIR) return;
    this.world[x][y][z] = BLOCK.AIR;
    this.removeBlockMesh(x, y, z);
    this.refreshNeighborMeshes(x, y, z);
    if (type === BLOCK.GRASS || type === BLOCK.DIRT) this.addItem('dirt', 1);
    else if (type === BLOCK.STONE) this.addItem('stone', 1);
    else if (type === BLOCK.WOOD) this.addItem('wood', 1);
    else if (type === BLOCK.LEAVES) { if (Math.random() < 0.1) this.addItem('wood', 1); }
    else if (type === BLOCK.IRON) this.addItem('iron', 1);
    else if (type === BLOCK.COAL) this.addItem('coal', 1);
    else if (type === BLOCK.PLANK) this.addItem('plank', 1);
    this.showMessage(`+1 ${BLOCK_NAMES[type]}`);
    this.updateHotbar();
  }

  addItem(name, count) { this.inv[name] = (this.inv[name] || 0) + count; }

  // ─── Combat ───
  attack() {
    if (this.attackTimer > 0) return;
    this.attackTimer = CONFIG.attackCooldown;
    this.attackAnim = 1;
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    dir.y = 0; dir.normalize();
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      const toZ = new THREE.Vector3(z.mesh.position.x - this.player.x, 0, z.mesh.position.z - this.player.z);
      const d = toZ.length();
      if (d > CONFIG.attackRange) continue;
      toZ.normalize();
      if (toZ.dot(dir) < 0.5) continue;
      const dmg = 1 + this.bestSword;
      z.health -= dmg;
      z.hitFlash = 1;
      z.mesh.position.addScaledVector(toZ, 1.2);
      if (z.health <= 0) { this.scene.remove(z.mesh); this.zombies.splice(i, 1); this.showMessage('Zombie slain!'); }
    }
    this.updateHUD();
  }

  // ─── Crafting ───
  toggleCrafting() {
    this.craftingOpen = !this.craftingOpen;
    const el = document.getElementById('crafting');
    if (this.craftingOpen) {
      el.style.display = 'flex';
      if (document.pointerLockElement) document.exitPointerLock();
      this.renderRecipes();
    } else {
      el.style.display = 'none';
      this.canvas.requestPointerLock();
    }
  }

  renderRecipes() {
    const list = document.getElementById('recipe-list');
    list.innerHTML = '';
    for (const r of RECIPES) {
      const canCraft = Object.entries(r.cost).every(([res, amt]) => (this.inv[res] || 0) >= amt);
      const div = document.createElement('div');
      div.className = 'recipe' + (canCraft ? '' : ' disabled');
      const costStr = Object.entries(r.cost).map(([k, v]) => `${v} ${k}`).join(', ');
      div.innerHTML = `<div class="recipe-info"><span class="recipe-name">${r.name}</span><span class="recipe-cost">Cost: ${costStr}</span></div><span class="recipe-icon">${r.icon}</span>`;
      if (canCraft) div.addEventListener('click', () => this.craft(r));
      list.appendChild(div);
    }
  }

  craft(recipe) {
    for (const [res, amt] of Object.entries(recipe.cost)) this.inv[res] -= amt;
    if (recipe.gives) {
      for (const [res, amt] of Object.entries(recipe.gives)) { this.addItem(res, amt); this.showMessage(`+${amt} ${res}`); }
    }
    if (recipe.tool) {
      const lvl = TIER_LEVEL[recipe.tier];
      if (recipe.tool === 'pickaxe') this.bestPickaxe = Math.max(this.bestPickaxe, lvl);
      if (recipe.tool === 'sword') this.bestSword = Math.max(this.bestSword, lvl);
      let slot = this.hotbar.findIndex(s => s.type === 'empty');
      if (slot < 0) slot = 8;
      this.hotbar[slot] = { type: 'tool', tool: recipe.tool, tier: recipe.tier, icon: recipe.icon, name: recipe.name };
      this.showMessage(`Crafted ${recipe.name}!`);
    }
    this.updateHotbar();
    this.renderRecipes();
    this.updateFPVTool();
  }

  // ─── Hotbar ───
  selectSlot(i) { this.selectedSlot = clamp(i, 0, 8); this.updateHotbar(); this.updateFPVTool(); }

  updateHotbar() {
    const resMap = [
      { res: 'wood', icon: '', label: 'Wood', block: BLOCK.WOOD },
      { res: 'plank', icon: '', label: 'Planks', block: BLOCK.PLANK },
      { res: 'dirt', icon: '', label: 'Dirt', block: BLOCK.DIRT },
      { res: 'stone', icon: '', label: 'Stone', block: BLOCK.STONE },
      { res: 'iron', icon: '', label: 'Iron', block: BLOCK.IRON },
    ];
    // Preserve tool slots
    const tools = this.hotbar.filter(s => s && s.type === 'tool');
    // Rebuild hotbar
    this.hotbar = new Array(9).fill(null).map(() => ({ type: 'empty' }));
    let idx = 0;
    for (const r of resMap) {
      if (this.inv[r.res] > 0) {
        this.hotbar[idx] = { type: 'block', blockType: r.block, count: this.inv[r.res], icon: r.icon, label: r.label, res: r.res };
        idx++;
      }
    }
    // Add tools back
    for (const t of tools) {
      while (idx < 9 && this.hotbar[idx].type !== 'empty') idx++;
      if (idx < 9) this.hotbar[idx] = t;
    }

    const el = document.getElementById('hotbar');
    el.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const s = this.hotbar[i];
      const div = document.createElement('div');
      div.className = 'slot' + (i === this.selectedSlot ? ' active' : '');
      if (!s || s.type === 'empty') div.innerHTML = `<span class="label">·</span>`;
      else if (s.type === 'block') div.innerHTML = `<span class="icon">${s.icon}</span><span class="count">${s.count}</span><span class="label">${s.label}</span>`;
      else if (s.type === 'tool') div.innerHTML = `<span class="icon">${s.icon}</span><span class="label">${s.name.split(' ')[0]}</span>`;
      el.appendChild(div);
    }
  }

  updateFPVTool() {
    if (this.fpvTool) { this.camera.remove(this.fpvTool); this.fpvTool = null; }
    const s = this.hotbar[this.selectedSlot];
    if (!s || s.type !== 'tool') return;
    const color = TIER_COLOR[s.tier];
    const g = new THREE.Group();
    if (s.tool === 'sword') {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), new THREE.MeshLambertMaterial({ color: 0x6d4c41 }));
      handle.position.set(0.35, -0.55, -1.0); g.add(handle);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), new THREE.MeshLambertMaterial({ color }));
      blade.position.set(0.35, -0.15, -1.0); g.add(blade);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.1), new THREE.MeshLambertMaterial({ color }));
      guard.position.set(0.35, -0.4, -1.0); g.add(guard);
    } else if (s.tool === 'pickaxe') {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), new THREE.MeshLambertMaterial({ color: 0x6d4c41 }));
      handle.position.set(0.35, -0.45, -1.0); handle.rotation.z = 0.3; g.add(handle);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), new THREE.MeshLambertMaterial({ color }));
      head.position.set(0.35, -0.1, -1.0); g.add(head);
    }
    this.fpvTool = g;
    this.camera.add(g);
    this.scene.add(this.camera);
  }

  // ─── Collision ───
  isSolid(x, y, z) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < 0 || bx >= CONFIG.worldW || by < 0 || by >= CONFIG.worldH || bz < 0 || bz >= CONFIG.worldD) return false;
    const t = this.world[bx][by][bz];
    return t !== BLOCK.AIR && t !== BLOCK.LEAVES;
  }

  checkCollision(x, y, z) {
    const w = CONFIG.playerWidth / 2, h = CONFIG.playerHeight;
    for (let dx = -w; dx <= w; dx += w * 2)
      for (let dz = -w; dz <= w; dz += w * 2)
        for (let dy = 0; dy < h; dy += h)
          if (this.isSolid(x + dx, y + dy, z + dz)) return true;
    return false;
  }

  // ─── Day/Night ───
  updateDayNight(dt) {
    this.dayTime += dt / CONFIG.dayLength;
    if (this.dayTime >= 1) { this.dayTime -= 1; this.day++; }
    const isNight = this.dayTime >= CONFIG.nightStart;
    const t = this.dayTime;
    let skyColor;
    if (t < 0.05) skyColor = new THREE.Color(0x0a0a20);
    else if (t < 0.15) { const f = (t - 0.05) / 0.1; skyColor = new THREE.Color(0x0a0a20).lerp(new THREE.Color(0xff8c42), f); }
    else if (t < 0.45) { const f = (t - 0.15) / 0.3; skyColor = new THREE.Color(0xff8c42).lerp(new THREE.Color(0x87ceeb), f); }
    else if (t < 0.55) skyColor = new THREE.Color(0x87ceeb);
    else if (t < 0.65) { const f = (t - 0.55) / 0.1; skyColor = new THREE.Color(0x87ceeb).lerp(new THREE.Color(0xff5a36), f); }
    else if (t < 0.75) { const f = (t - 0.65) / 0.1; skyColor = new THREE.Color(0xff5a36).lerp(new THREE.Color(0x0a0a20), f); }
    else skyColor = new THREE.Color(0x0a0a20);
    this.scene.background = skyColor;
    this.scene.fog.color = skyColor;
    const lightLevel = isNight ? 0.2 : 0.6 + Math.sin((t - 0.15) / 0.4 * Math.PI) * 0.4;
    this.ambient.intensity = lightLevel;
    this.sun.intensity = isNight ? 0.05 : 1.0;
    const sunAngle = t * Math.PI * 2 - Math.PI / 2;
    this.sun.position.set(Math.cos(sunAngle) * 50, Math.sin(sunAngle) * 50, 20);
    if (isNight && this.zombies.length < 4 + this.day * 2) {
      if (Math.random() < 0.015 + this.day * 0.003) this.spawnZombie();
    }
    if (!isNight && this.zombies.length > 0) {
      if (Math.random() < 0.04) { const z = this.zombies.pop(); this.scene.remove(z.mesh); }
    }
    document.getElementById('hud-day').textContent = this.day;
    document.getElementById('hud-time').textContent = isNight ? '' : '';
    document.getElementById('hud-zombies').textContent = this.zombies.length;
  }

  spawnZombie() {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0x558b2f });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), skin);
    body.position.y = 1.1; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), skin);
    head.position.y = 1.9; head.castShadow = true; g.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.04), eyeMat);
    e1.position.set(-0.12, 1.95, 0.28); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.12; g.add(e2);
    const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.8), skin);
    a1.position.set(-0.46, 1.55, 0.4); g.add(a1);
    const a2 = a1.clone(); a2.position.x = 0.46; g.add(a2);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), new THREE.MeshLambertMaterial({ color: 0x37474f }));
    legs.position.y = 0.35; g.add(legs);
    const angle = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * 5;
    g.position.set(this.player.x + Math.cos(angle) * r, 0, this.player.z + Math.sin(angle) * r);
    this.scene.add(g);
    this.zombies.push({ mesh: g, health: CONFIG.zombieHealth + this.day, attackCD: 0, hitFlash: 0 });
  }

  // ─── Update ───
  update(dt) {
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.attackAnim > 0) this.attackAnim = Math.max(0, this.attackAnim - dt * 4);
    if (this.fpvTool) {
      if (this.attackAnim > 0) {
        const swing = Math.sin(this.attackAnim * Math.PI);
        this.fpvTool.rotation.x = -swing * 1.5;
        this.fpvTool.position.y = -swing * 0.2;
      } else {
        this.fpvTool.rotation.x *= 0.8;
        this.fpvTool.position.y *= 0.8;
      }
    }

    if (this.mouseDown) {
      const target = this.getLookingAt();
      if (target) this.updateMining(dt);
      else { this.miningTarget = null; this.miningProgress = 0; this.attack(); }
    } else { this.miningTarget = null; this.miningProgress = 0; }

    // Movement
    let mx = 0, mz = 0;
    if (this.keys['w']) mz -= 1;
    if (this.keys['s']) mz += 1;
    if (this.keys['a']) mx -= 1;
    if (this.keys['d']) mx += 1;
    const sneaking = this.keys['shift'];
    const speed = sneaking ? CONFIG.playerSpeed * 0.4 : CONFIG.playerSpeed;
    if (mx || mz) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = -sin * (-mz) + cos * mx;
      const wz = -cos * (-mz) - sin * mx;
      const newX = this.player.x + wx * speed * dt;
      if (!this.checkCollision(newX, this.player.y, this.player.z)) this.player.x = newX;
      const newZ = this.player.z + wz * speed * dt;
      if (!this.checkCollision(this.player.x, this.player.y, newZ)) this.player.z = newZ;
    }

    // Jump / gravity with collision
    if (this.keys[' '] && this.onGround) { this.velY = CONFIG.jumpSpeed; this.onGround = false; }
    this.velY -= CONFIG.gravity * dt;
    const newY = this.player.y + this.velY * dt;
    if (!this.checkCollision(this.player.x, newY, this.player.z)) {
      this.player.y = newY;
      this.onGround = false;
    } else {
      if (this.velY < 0) this.onGround = true;
      this.velY = 0;
    }

    this.player.x = clamp(this.player.x, 0.5, CONFIG.worldW - 0.5);
    this.player.z = clamp(this.player.z, 0.5, CONFIG.worldD - 0.5);

    // Camera FPV
    const eyeY = this.player.y + CONFIG.playerHeight - 0.2;
    this.camera.position.set(this.player.x, eyeY, this.player.z);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    this.updateDayNight(dt);

    // Zombies
    for (const z of this.zombies) {
      const dir = new THREE.Vector3(this.player.x - z.mesh.position.x, 0, this.player.z - z.mesh.position.z);
      const d = dir.length();
      if (d > 1.2) {
        dir.normalize();
        z.mesh.position.addScaledVector(dir, CONFIG.zombieSpeed * dt);
        z.mesh.rotation.y = Math.atan2(dir.x, dir.z);
      } else {
        z.attackCD -= dt;
        if (z.attackCD <= 0) {
          z.attackCD = 1;
          this.health -= CONFIG.zombieDamage;
          if (this.health <= 0) { this.endGame('The zombies overwhelmed you'); return; }
        }
      }
      if (z.hitFlash > 0) {
        z.hitFlash -= dt * 3;
        z.mesh.traverse(c => { if (c.material && c.material.emissive) c.material.emissive.setRGB(z.hitFlash, 0, 0); });
      }
    }

    document.getElementById('health-fill').style.width = Math.max(0, this.health) + '%';
  }

  showMessage(msg) {
    const el = document.getElementById('message');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }

  updateHUD() { document.getElementById('hud-zombies').textContent = this.zombies.length; }

  endGame(msg) {
    this.gameOver = true;
    this.running = false;
    document.exitPointerLock();
    document.getElementById('final-text').textContent = msg;
    document.getElementById('final-score').textContent = `Survived ${this.day} day${this.day === 1 ? '' : 's'}`;
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('crafting').style.display = 'none';
  }

  loop() {
    if (!this.running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.gameOver && !this.craftingOpen) this.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.loop());
  }
}

new Game();

// ============================================================
//  ZOMBIE SHOOTER 3D — Multiplayer Co-op Server
// ============================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve zombie multiplayer at root — BEFORE static middleware
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'zombie-multiplayer.html'));
});
app.get('/zombie-multiplayer', (req, res) => {
  res.sendFile(path.join(__dirname, 'zombie-multiplayer.html'));
});
app.use(express.static(path.join(__dirname)));

// ─── Config (mirrors zombie.js) ───
const CONFIG = {
  worldSize: 60, playerSpeed: 5.5, playerSprintSpeed: 9, playerJump: 8,
  gravity: 25, playerHeight: 1.7, playerRadius: 0.4, maxHealth: 100,
  bulletRange: 100, zombieHealth: 102, zombieSpeed: 1.8, zombieDamage: 15,
  zombieAttackRange: 1.8, zombieAttackCooldown: 1.0,
  waveBaseCount: 5, waveSpeedIncrease: 0.2, waveCountIncrease: 3,
  waveBreakTime: 5, goldPickupRadius: 1.5, maxGoldPickups: 8, goldSpawnInterval: 8,
};

const GUNS = {
  knife:  { name:'Knife', magSize:Infinity, reloadTime:0, fireRate:0.3, damage:60, pellets:1, spread:0, price:0, melee:true, meleeRange:3.0 },
  katana: { name:'Katana', magSize:Infinity, reloadTime:0, fireRate:0.35, damage:120, pellets:1, spread:0, price:300, melee:true, meleeRange:5.0 },
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

const OBSTACLES = [
  {x:-15,z:-10,w:1,d:1},{x:12,z:-8,w:1,d:1},{x:-5,z:15,w:1,d:1},
  {x:8,z:12,w:1,d:1},{x:-20,z:5,w:1,d:1},{x:18,z:18,w:1,d:1},
  {x:-12,z:-20,w:1,d:1},{x:5,z:-15,w:1,d:1},{x:22,z:-5,w:1,d:1},
  {x:-25,z:-3,w:1,d:1},{x:-3,z:-5,w:1.5,d:1.5},{x:6,z:3,w:1.5,d:1.5},
  {x:-8,z:8,w:1.5,d:1.5},{x:10,z:-12,w:1.5,d:1.5},{x:15,z:6,w:1.5,d:1.5},
];

// ─── Game State ───
let players = {};
let zombies = [];
let goldPickups = [];
let particles = [];
let nextZombieId = 1;
let nextGoldId = 1;
let wave = 1;
let waveActive = false;
let waveBreakTimer = 3;
let zombiesToSpawn = 0;
let spawnTimer = 0;
let bossPending = false;
let bossSpawned = false;
let goldSpawnTimer = 3;
let gameStarted = false;
let escapeMode = false;
let escapeStep = null;
let doorOpen = false;
let keyDropped = false;
let keyPos = null;
let killFeed = [];

function getGunStat(player, stat) {
  const gun = GUNS[player.currentGun];
  const lvl = player.upgrades;
  switch (stat) {
    case 'damage': return gun.damage + lvl.damage * 10;
    case 'fireRate': return gun.fireRate * Math.pow(0.8, lvl.fireRate);
    case 'magSize': return gun.magSize + lvl.magSize * 5;
    case 'reloadTime': return gun.reloadTime;
    case 'pellets': return gun.pellets;
    case 'spread': return gun.spread;
    case 'maxHealth': return CONFIG.maxHealth + lvl.health * 25;
    default: return gun[stat];
  }
}

function createPlayer(id) {
  return {
    id, name: `Player ${Object.keys(players).length + 1}`,
    x: 0, y: CONFIG.playerHeight, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    health: CONFIG.maxHealth, maxHealth: CONFIG.maxHealth,
    score: 0, kills: 0, gold: 0, wave: 1,
    currentGun: 'pistol',
    ownedGuns: { knife: true, pistol: true },
    ammo: GUNS.pistol.magSize,
    reserveAmmo: GUNS.pistol.magSize * 3,
    upgrades: { damage: 0, fireRate: 0, magSize: 0, health: 0 },
    reloading: false, reloadTimer: 0,
    fireTimer: 0, autoFire: false,
    shopOpen: false, onGround: true,
    keys: {},
    dead: false,
    escapeMode: false, escapeStep: null, hasKey: false,
    preEscapeGun: null, preEscapeOwned: null,
    muzzleFlash: 0, gunRecoil: 0,
    shootTracers: [],
  };
}

// ─── Zombie spawning ───
function spawnZombie() {
  let type = 'normal';
  const r = Math.random();
  if (wave >= 4 && r < 0.15) type = 'skeleton';
  else if (wave >= 3 && r < 0.35) type = 'buff';

  const angle = Math.random() * Math.PI * 2;
  const dist = CONFIG.worldSize - 5;
  const x = Math.cos(angle) * dist;
  const z = Math.sin(angle) * dist;

  const speed = CONFIG.zombieSpeed; // never gets faster
  let health = CONFIG.zombieHealth;
  let damage = CONFIG.zombieDamage;
  let attackRange = CONFIG.zombieAttackRange;

  if (type === 'buff') { health *= 3; damage *= 2; attackRange *= 1.3; }
  else if (type === 'skeleton') { health *= 0.6; damage *= 1.2; attackRange *= 1.2; }

  zombies.push({
    id: nextZombieId++, x, z, type,
    health, maxHealth: health,
    speed: type === 'skeleton' ? speed * 1.6 : type === 'buff' ? speed * 0.75 : speed,
    damage, attackRange, attackTimer: 0,
    walkPhase: Math.random() * Math.PI * 2,
    isBoss: false, hasKey: false,
    lostLimbs: {}, limbDamage: {},
  });
}

function spawnBoss() {
  const angle = Math.random() * Math.PI * 2;
  const dist = CONFIG.worldSize - 5;
  const x = Math.cos(angle) * dist;
  const z = Math.sin(angle) * dist;
  const speed = CONFIG.zombieSpeed * 0.85; // boss speed never scales with wave
  const health = 137500; // 5x harder: 2500 rifle hits (55 dmg each) to kill
  zombies.push({
    id: nextZombieId++, x, z, type: 'boss',
    health, maxHealth: health, speed,
    damage: CONFIG.zombieDamage * 75, attackRange: CONFIG.zombieAttackRange * 2.5, // 5x damage
    attackTimer: 0, attackCooldown: 0.7, walkPhase: Math.random() * Math.PI * 2,
    isBoss: true, hasKey: false,
    lostLimbs: {}, limbDamage: {},
    reviveCount: 0, reviveTimer: 0, reviving: false,
    specialAttackTimer: 5, // timer for special attacks
  });
  broadcastKillFeed('BOSS HAS APPEARED!');
}

function spawnGuard() {
  zombies.push({
    id: nextZombieId++, x: 0, z: 4, type: 'guard',
    health: 300, maxHealth: 300,
    speed: CONFIG.zombieSpeed * 0.6,
    damage: CONFIG.zombieDamage, attackRange: CONFIG.zombieAttackRange,
    attackTimer: 0, walkPhase: 0,
    isBoss: false, hasKey: true,
    lostLimbs: {}, limbDamage: {},
  });
}

function spawnEscapeZombie() {
  const x = -4 + Math.random() * 8;
  const z = 7 + Math.random() * 3;
  zombies.push({
    id: nextZombieId++, x, z, type: 'normal',
    health: CONFIG.zombieHealth, maxHealth: CONFIG.zombieHealth,
    speed: CONFIG.zombieSpeed * 0.8,
    damage: CONFIG.zombieDamage, attackRange: CONFIG.zombieAttackRange,
    attackTimer: 0, walkPhase: Math.random() * Math.PI * 2,
    isBoss: false, hasKey: false,
    lostLimbs: {}, limbDamage: {},
  });
}

function killZombie(zombie, killerId) {
  if (zombie.dying) return; // already dead, no double rewards
  const player = players[killerId];
  if (!player) return;

  // Boss revive logic — revives 3 times before truly dying
  if (zombie.isBoss && zombie.reviveCount < 3 && !zombie.reviving) {
    zombie.reviving = true;
    zombie.reviveTimer = 3; // 3 seconds to revive
    zombie.health = 0;
    zombie.lostLimbs = {}; // limbs grow back on revive
    zombie.limbDamage = {};
    // Give partial reward for downing the boss
    const downScore = 50 * wave;
    const downGold = 30 + wave * 5;
    player.score += downScore;
    player.gold += downGold;
    broadcastKillFeed(`${player.name}: BOSS DOWNED! Reviving... (${zombie.reviveCount + 1}/3)`);
    return;
  }

  // Mark zombie as dying instead of removing immediately — stays 10 seconds
  zombie.dying = true;
  zombie.deathTimer = 10;
  zombie.dead = true;

  let score = 10 * wave, goldDrop = 5 + Math.floor(Math.random()*10) + wave;
  if (zombie.isBoss) { score = 200 * wave; goldDrop = 100 + wave * 20; }
  else if (zombie.type === 'guard') { score = 50 * wave; goldDrop = 50 + wave * 10; }
  else if (zombie.type === 'buff') { score = 25 * wave; goldDrop = 20 + wave * 5; }
  else if (zombie.type === 'skeleton') { score = 15 * wave; goldDrop = 10 + wave * 3; }

  player.score += score;
  player.kills++;
  player.gold += goldDrop;

  // Drop key if guard
  if (zombie.hasKey) {
    keyDropped = true;
    keyPos = { x: zombie.x, z: zombie.z };
  }

  // Kill feed
  let msg = '';
  if (zombie.isBoss) msg = `BOSS ELIMINATED! +${score}`;
  else if (zombie.type === 'guard') msg = `GUARD ELIMINATED! +${score}`;
  else if (zombie.type === 'buff') msg = `BUFF ZOMBIE ELIMINATED! +${score}`;
  else if (zombie.type === 'skeleton') msg = `SKELETON ELIMINATED! +${score}`;
  else msg = `+${score} Zombie eliminated!`;
  broadcastKillFeed(`${player.name}: ${msg}`);

  // Check wave complete or escape win (only count active zombies)
  const aliveZombies = zombies.filter(z => !z.dying && !z.reviving);
  if (escapeMode) {
    checkEscapeWin();
  } else if (aliveZombies.length === 0 && zombiesToSpawn === 0) {
    endWave();
  }
}

function broadcastKillFeed(msg) {
  killFeed.push({ msg, time: Date.now() });
  if (killFeed.length > 5) killFeed.shift();
  io.emit('killFeed', killFeed);
}

// ─── Wave management ───
function startWave() {
  zombiesToSpawn = CONFIG.waveBaseCount + (wave - 1) * CONFIG.waveCountIncrease;
  waveActive = true;
  spawnTimer = 0;
  bossSpawned = false;
  if (wave >= 5) bossPending = true;
  io.emit('waveAnnounce', bossPending ? `WAVE ${wave} — BOSS INCOMING!` : `WAVE ${wave}`);
}

function endWave() {
  waveActive = false;
  waveBreakTimer = CONFIG.waveBreakTime;
  bossPending = false;
  bossSpawned = false;
  const clearedWave = wave;
  wave++;
  // Bonus for all players
  for (const p of Object.values(players)) {
    p.health = Math.min(getGunStat(p, 'maxHealth'), p.health + 25);
    p.reserveAmmo += getGunStat(p, 'magSize') * 2;
    p.gold += 30 + clearedWave * 10;
    p.wave = wave;
  }
  io.emit('waveAnnounce', `WAVE ${clearedWave} CLEARED! +25 HP`);
}

// ─── Escape sequence ───
function startEscape() {
  escapeMode = true;
  escapeStep = 'guard';
  keyDropped = false;
  keyPos = null;
  doorOpen = false;
  zombies = [];

  for (const p of Object.values(players)) {
    p.escapeMode = true;
    p.escapeStep = 'guard';
    p.hasKey = false;
    p.health = getGunStat(p, 'maxHealth');
    p.preEscapeGun = p.currentGun;
    p.preEscapeOwned = { ...p.ownedGuns };
    p.ownedGuns = { knife: true };
    p.currentGun = 'knife';
    p.ammo = Infinity;
    p.reserveAmmo = Infinity;
    p.reloading = false;
    p.fireTimer = 0;
    p.shopOpen = false;
    // Place in cell
    p.x = 0; p.y = CONFIG.playerHeight; p.z = 0;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.yaw = 0; p.pitch = 0;
    p.dead = false;
  }

  spawnGuard();
  io.emit('escapeStart', {
    text: 'The boss knocked you out... Your eyes open in a dark prison cell. They took your guns, but forgot your knife. A zombie guard holds the key.',
  });
}

function pickUpKey(playerId) {
  const p = players[playerId];
  if (!p || !p.escapeMode || p.escapeStep !== 'guard' || !keyDropped || !keyPos) return;
  const dx = p.x - keyPos.x, dz = p.z - keyPos.z;
  if (Math.hypot(dx, dz) > 2.5) return;
  keyDropped = false;
  keyPos = null;
  p.hasKey = true;
  p.escapeStep = 'key';
  io.emit('escapeUpdate', 'You got the key. Press Shift near the cell door to unlock it.');
}

function unlockCell(playerId) {
  const p = players[playerId];
  if (!p || !p.escapeMode || p.escapeStep !== 'key' || !p.hasKey || doorOpen) return;
  // Check distance to door (at z=6)
  const dz = Math.abs(p.z - 6);
  const dx = Math.abs(p.x);
  if (dx > 3.5 || dz > 3.5) return;
  doorOpen = true;
  p.hasKey = false;
  escapeStep = 'fight';
  for (const pl of Object.values(players)) pl.escapeStep = 'fight';
  for (let i = 0; i < 5; i++) spawnEscapeZombie();
  io.emit('escapeUpdate', 'ALERT! The cell is open. 5 zombies are coming in!');
}

function checkEscapeWin() {
  if (escapeStep !== 'fight') return;
  const aliveCount = zombies.filter(z => !z.dying && !z.reviving).length;
  if (aliveCount === 0) endEscape();
}

function endEscape() {
  escapeMode = false;
  escapeStep = 'won';
  for (const p of Object.values(players)) {
    p.escapeMode = false;
    p.ownedGuns = p.preEscapeOwned || p.ownedGuns;
    p.currentGun = p.preEscapeGun || p.currentGun;
    p.gold += 500;
    p.score += 1000;
  }
  io.emit('escapeWin', {});
}

// ─── Shooting (server-side raycast) ───
function handleShoot(playerId) {
  const p = players[playerId];
  if (!p || p.dead || p.reloading || p.fireTimer > 0) return;

  const gun = GUNS[p.currentGun];
  if (gun.melee) {
    p.fireTimer = getGunStat(p, 'fireRate');
    p.gunRecoil = 0.12;
    p.muzzleFlash = 0.5; // visual feedback for knife swing
    const damage = getGunStat(p, 'damage');
    const meleeRange = gun.meleeRange || 3.0;
    // Direction from yaw/pitch
    const dir = getLookDir(p);
    let closestHit = null, closestDist = meleeRange;
    for (const z of zombies) {
      if (z.dying || z.reviving) continue;
      const hit = rayHitZombie(p, dir, z, meleeRange);
      if (hit && hit.dist < closestDist) { closestDist = hit.dist; closestHit = { zombie: z, point: hit.point }; }
    }
    // Knife slash tracer — short line in front of player
    const slashEnd = { x: p.x + dir.x * meleeRange, y: p.y + dir.y * meleeRange, z: p.z + dir.z * meleeRange };
    p.shootTracers.push({ x1: p.x, y1: p.y - 0.2, z1: p.z, x2: slashEnd.x, y2: slashEnd.y - 0.2, z2: slashEnd.z, life: 0.1, gun: 'knife', hit: closestHit ? 1 : 0 });
    if (closestHit) {
      closestHit.zombie.health -= damage;
      if (closestHit.zombie.health <= 0) killZombie(closestHit.zombie, playerId);
    }
    return;
  }

  if (p.ammo <= 0) { startReload(playerId); return; }
  p.ammo--;
  p.fireTimer = getGunStat(p, 'fireRate');
  p.gunRecoil = 0.08;
  p.muzzleFlash = 1;

  const damage = getGunStat(p, 'damage');
  const pellets = getGunStat(p, 'pellets');
  const spread = getGunStat(p, 'spread');

  for (let pellet = 0; pellet < pellets; pellet++) {
    const dir = getLookDir(p, spread);
    let closestHit = null, closestDist = CONFIG.bulletRange;
    for (const z of zombies) {
      if (z.dying || z.reviving) continue; // can't hit dead or reviving zombies
      const hit = rayHitZombie(p, dir, z, closestDist);
      if (hit && hit.dist < closestDist) { closestDist = hit.dist; closestHit = { zombie: z, point: hit.point, part: hit.part }; }
    }
    // Tracer endpoint
    const hitZombie = closestHit !== null;
    const endX = p.x + dir.x * Math.min(closestDist, CONFIG.bulletRange);
    const endY = p.y + dir.y * Math.min(closestDist, CONFIG.bulletRange);
    const endZ = p.z + dir.z * Math.min(closestDist, CONFIG.bulletRange);
    // Check environment hit (ground at y=0 or world boundary)
    let envHit = false;
    if (endY <= 0) envHit = true;
    const halfWorld = CONFIG.worldSize - 1;
    if (Math.abs(endX) > halfWorld || Math.abs(endZ) > halfWorld) envHit = true;
    // Start tracer from slightly below camera (gun muzzle position)
    const muzzleY = p.y - 0.3;
    const muzzleX = p.x + Math.cos(p.yaw) * 0.3;
    const muzzleZ = p.z - Math.sin(p.yaw) * 0.3;
    p.shootTracers.push({ x1: muzzleX, y1: muzzleY, z1: muzzleZ, x2: endX, y2: endY, z2: endZ, life: 0.12, gun: p.currentGun, hit: (hitZombie || envHit) ? 1 : 0, zid: hitZombie ? closestHit.zombie.id : -1, part: hitZombie ? closestHit.part : '', explode: 0 });

    if (closestHit) {
      const z = closestHit.zombie;
      const part = closestHit.part;
      // Accumulate limb damage — 100 damage to rip off a limb
      if (part !== 'body') {
        if (!z.limbDamage) z.limbDamage = {};
        if (!z.limbDamage[part]) z.limbDamage[part] = 0;
        z.limbDamage[part] += damage;
        if (z.limbDamage[part] >= 100 && !(z.lostLimbs && z.lostLimbs[part])) {
          // Rip off the limb!
          if (!z.lostLimbs) z.lostLimbs = {};
          z.lostLimbs[part] = true;
          // Mark tracer for explosion effect
          p.shootTracers[p.shootTracers.length - 1].explode = 1;
          // Slow zombie if a leg was lost
          if (part === 'legL' || part === 'legR') {
            z.speed *= 0.5;
          }
          // Don't apply body damage when limb rips off — the limb damage IS the damage
        } else if (z.limbDamage[part] < 100) {
          // Still accumulating damage to limb — don't hurt body
        }
      } else {
        z.health -= damage;
      }
      if (z.health <= 0) killZombie(z, playerId);
    }
  }
}

function getLookDir(p, spread = 0) {
  const sx = (Math.random() - 0.5) * spread;
  const sy = (Math.random() - 0.5) * spread;
  const cp = Math.cos(p.pitch + sy);
  const dir = {
    x: -Math.sin(p.yaw + sx) * cp,
    y: Math.sin(p.pitch + sy),
    z: -Math.cos(p.yaw + sx) * cp,
  };
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len > 0) { dir.x /= len; dir.y /= len; dir.z /= len; }
  return dir;
}

function rayHitZombie(p, dir, z, maxDist) {
  // Simple ray-cylinder intersection (zombie at z.x, z.z with radius ~0.6, height ~2.2)
  const radius = z.isBoss ? 1.5 : z.type === 'buff' ? 0.9 : 0.5;
  const height = z.isBoss ? 6.6 : z.type === 'buff' ? 2.5 : 2.2;

  // Ray: P = origin + t * dir
  // Cylinder axis is vertical at (z.x, z.z) from y=0 to y=height
  const ox = p.x, oy = p.y, oz = p.z;
  const dx = dir.x, dy = dir.y, dz = dir.z;

  // Project to XZ plane
  const a = dx * dx + dz * dz;
  if (a < 0.0001) return null;
  const b = 2 * (dx * (ox - z.x) + dz * (oz - z.z));
  const c = (ox - z.x) * (ox - z.x) + (oz - z.z) * (oz - z.z) - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  let t = t1 >= 0 ? t1 : (t2 >= 0 ? t2 : -1);
  if (t < 0 || t > maxDist) return null;
  // Check height
  const hitY = oy + t * dy;
  if (hitY < 0 || hitY > height) return null;
  const hitX = ox + t * dx;
  const hitZ = oz + t * dz;
  // Determine hit body part
  const armYMin = z.isBoss ? 1.5 : 1.0;
  const armYMax = z.isBoss ? 4.5 : 1.6;
  const armOffset = z.isBoss ? 1.15 : 0.38;
  const legYMax = z.isBoss ? 1.5 : 0.75;
  const legOffset = z.isBoss ? 0.4 : 0.13;
  let part = 'body';
  const relX = hitX - z.x;
  // Check arms
  if (hitY >= armYMin && hitY <= armYMax) {
    if (Math.abs(relX) > armOffset * 0.6) {
      const armPart = relX < 0 ? 'armL' : 'armR';
      if (!(z.lostLimbs && z.lostLimbs[armPart])) part = armPart;
    }
  }
  // Check legs
  if (hitY < legYMax) {
    if (Math.abs(relX) > legOffset * 0.5) {
      const legPart = relX < 0 ? 'legL' : 'legR';
      if (!(z.lostLimbs && z.lostLimbs[legPart])) part = legPart;
    }
  }
  return {
    dist: t,
    point: { x: hitX, y: hitY, z: hitZ },
    part,
  };
}

function startReload(playerId) {
  const p = players[playerId];
  if (!p) return;
  const gun = GUNS[p.currentGun];
  if (gun.infinite || gun.melee) return;
  if (p.reloading) return;
  if (p.ammo >= getGunStat(p, 'magSize')) return;
  p.reloading = true;
  p.reloadTimer = getGunStat(p, 'reloadTime');
}

function finishReload(playerId) {
  const p = players[playerId];
  if (!p) return;
  p.ammo = getGunStat(p, 'magSize');
  p.reloading = false;
}

function switchGun(playerId, gunName) {
  const p = players[playerId];
  if (!p || p.escapeMode) return;
  if (!p.ownedGuns[gunName]) return;
  p.currentGun = gunName;
  const gun = GUNS[gunName];
  if (gun.melee || gun.infinite) { p.ammo = Infinity; p.reserveAmmo = Infinity; }
  else { p.ammo = getGunStat(p, 'magSize'); p.reserveAmmo = getGunStat(p, 'magSize') * 3; }
  p.reloading = false;
}

function buyGun(playerId, gunName) {
  const p = players[playerId];
  if (!p || p.dead || p.ownedGuns[gunName] || p.gold < GUNS[gunName].price) return;
  p.gold -= GUNS[gunName].price;
  p.ownedGuns[gunName] = true;
  switchGun(playerId, gunName);
}

function buyUpgrade(playerId, key) {
  const p = players[playerId];
  if (!p || p.dead) return;
  const up = UPGRADES[key];
  const lvl = p.upgrades[key];
  if (lvl >= up.maxLevel) return;
  const price = up.price * (lvl + 1);
  if (p.gold < price) return;
  p.gold -= price;
  p.upgrades[key]++;
  if (key === 'health') p.health += 25;
  if (key === 'magSize') p.ammo = getGunStat(p, 'magSize');
}

// ─── Player movement ───
function updatePlayer(p, dt) {
  if (p.dead) return;
  const speed = (p.keys['shift'] && !p.escapeMode ? CONFIG.playerSprintSpeed : CONFIG.playerSpeed);
  let mx = 0, mz = 0;
  if (p.keys['w']) mz -= 1;
  if (p.keys['s']) mz += 1;
  if (p.keys['a']) mx -= 1;
  if (p.keys['d']) mx += 1;
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }

  // Camera direction (from yaw/pitch, projected to horizontal)
  const cp = Math.cos(p.pitch);
  const fx = -Math.sin(p.yaw) * cp;
  const fz = -Math.cos(p.yaw) * cp;
  const fy = Math.sin(p.pitch);
  // Horizontal forward
  let hfx = -Math.sin(p.yaw), hfz = -Math.cos(p.yaw);
  const hlen = Math.hypot(hfx, hfz);
  if (hlen > 0) { hfx /= hlen; hfz /= hlen; }
  // Right vector
  const rx = -hfz, rz = hfx;

  p.vx = (hfx * (-mz) + rx * mx) * speed;
  p.vz = (hfz * (-mz) + rz * mx) * speed;

  if (p.keys[' '] && p.onGround) { p.vy = CONFIG.playerJump; p.onGround = false; }
  p.vy -= CONFIG.gravity * dt;

  const newX = p.x + p.vx * dt;
  const newZ = p.z + p.vz * dt;
  const newY = p.y + p.vy * dt;

  const half = CONFIG.worldSize - 1;
  p.x = Math.max(-half, Math.min(half, newX));
  p.z = Math.max(-half, Math.min(half, newZ));

  // Escape mode cell bounds
  if (p.escapeMode) {
    p.x = Math.max(-5, Math.min(5, p.x));
    p.z = Math.max(-5, Math.min(5, p.z));
  }

  // Obstacle collision
  for (const obs of OBSTACLES) {
    const dx = p.x - obs.x, dz = p.z - obs.z;
    const minDist = obs.w / 2 + CONFIG.playerRadius;
    if (Math.abs(dx) < minDist && Math.abs(dz) < minDist) {
      if (Math.abs(dx) > Math.abs(dz)) p.x = obs.x + Math.sign(dx) * minDist;
      else p.z = obs.z + Math.sign(dz) * minDist;
    }
  }

  if (newY <= CONFIG.playerHeight) { p.y = CONFIG.playerHeight; p.vy = 0; p.onGround = true; }
  else p.y = newY;

  // Timers
  if (p.fireTimer > 0) p.fireTimer -= dt;
  if (p.gunRecoil > 0) p.gunRecoil = Math.max(0, p.gunRecoil - dt * 0.5);
  if (p.muzzleFlash > 0) p.muzzleFlash = Math.max(0, p.muzzleFlash - dt * 8);
  if (p.reloading) {
    p.reloadTimer -= dt;
    if (p.reloadTimer <= 0) finishReload(p.id);
  }
  // Clear tracers
  for (let i = p.shootTracers.length - 1; i >= 0; i--) {
    p.shootTracers[i].life -= dt;
    if (p.shootTracers[i].life <= 0) p.shootTracers.splice(i, 1);
  }
  // Auto-fire
  if (p.autoFire && !p.reloading && !p.dead) handleShoot(p.id);
}

// ─── Zombie AI ───
function updateZombies(dt) {
  // Remove expired dying zombies
  for (let i = zombies.length - 1; i >= 0; i--) {
    if (zombies[i].dying) {
      zombies[i].deathTimer -= dt;
      if (zombies[i].deathTimer <= 0) zombies.splice(i, 1);
    }
  }

  // Process boss revives
  for (const z of zombies) {
    if (z.reviving) {
      z.reviveTimer -= dt;
      if (z.reviveTimer <= 0) {
        z.reviving = false;
        z.reviveCount++;
        // Each revival: 5x base, increasing damage and speed
        const baseHealth = 137500;
        z.maxHealth = Math.floor(baseHealth * (1 + z.reviveCount * 0.3));
        z.health = z.maxHealth;
        z.damage = CONFIG.zombieDamage * 75 * (1 + z.reviveCount * 0.5);
        z.speed = CONFIG.zombieSpeed * 0.85 * (1 + z.reviveCount * 0.2);
        z.lostLimbs = {}; // limbs grow back creepier
        z.limbDamage = {};
        broadcastKillFeed(`BOSS REVIVED! Phase ${z.reviveCount}/3 — STRONGER!`);
      }
      continue; // don't process AI while reviving
    }
  }

  // Find nearest alive player for each zombie
  for (const z of zombies) {
    if (z.dying || z.reviving) continue; // skip dead/reviving zombies
    let target = null, minDist = Infinity;
    for (const p of Object.values(players)) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - z.x, p.z - z.z);
      if (d < minDist) { minDist = d; target = p; }
    }
    if (!target) continue;

    const dx = target.x - z.x, dz = target.z - z.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.01) {
      z.x += (dx / dist) * z.speed * dt;
      z.z += (dz / dist) * z.speed * dt;
      z.walkPhase += dt * z.speed * 2;
      z.rot = Math.atan2(dx, dz);
    }

    // Attack
    z.attackTimer -= dt;
    const attackRange = z.attackRange || CONFIG.zombieAttackRange;
    if (z.isBoss) {
      // Boss special attacks
      z.specialAttackTimer -= dt;
      if (z.specialAttackTimer <= 0) {
        z.specialAttackTimer = 5 + Math.random() * 3; // every 5-8 seconds
        const attackType = Math.floor(Math.random() * 4);
        if (attackType === 0) {
          // CHARGE — fast dash toward target, dealing damage on hit
          z.charging = true;
          z.chargeTimer = 1.0;
          z.chargeDx = dx / dist;
          z.chargeDz = dz / dist;
          broadcastKillFeed('BOSS CHARGES!');
        } else if (attackType === 1 || attackType === 2) {
          // GROUND CRACK — boss smashes ground, crack line shoots toward target
          z.crackAttack = true;
          z.crackTimer = 0.6; // wind-up time before crack appears
          z.crackDx = dx / dist;
          z.crackDz = dz / dist;
          z.crackLength = 30; // crack extends 30 units
          z.crackWidth = 2.0;
          z.slamEffect = 1; // visual: boss slams ground
          z.attackTimer = 2.0;
          broadcastKillFeed('BOSS SMASHES THE GROUND!');
        } else {
          // RANGED — shoot projectile at target (instant hit, long range)
          if (dist < 30) {
            target.health -= z.damage * 0.4;
            if (target.health <= 0) { target.health = 0; target.dead = true; }
            z.rangedEffect = 1; // visual flag
            z.attackTimer = 1.0;
            broadcastKillFeed('BOSS HURLS A PROJECTILE!');
          }
        }
      }
      // Handle ground crack attack
      if (z.crackAttack) {
        z.crackTimer -= dt;
        if (z.crackTimer <= 0) {
          // Crack appears — damage any player standing on the line
          z.crackEffect = 1; // visual flag for client
          for (const p of Object.values(players)) {
            if (p.dead) continue;
            // Project player position onto crack line
            const px = p.x - z.x, pz = p.z - z.z;
            const t = px * z.crackDx + pz * z.crackDz; // projection along crack direction
            if (t > 0 && t < z.crackLength) {
              // Perpendicular distance from player to crack line
              const perpX = px - t * z.crackDx;
              const perpZ = pz - t * z.crackDz;
              const perpDist = Math.hypot(perpX, perpZ);
              if (perpDist < z.crackWidth) {
                p.health -= z.damage * 0.7;
                if (p.health <= 0) { p.health = 0; p.dead = true; }
              }
            }
          }
          z.crackAttack = false;
          z.attackTimer = 1.5;
        }
      }
      // Handle charge movement
      if (z.charging) {
        z.chargeTimer -= dt;
        const chargeSpeed = z.speed * 4;
        z.x += z.chargeDx * chargeSpeed * dt;
        z.z += z.chargeDz * chargeSpeed * dt;
        // Check collision with any player
        for (const p of Object.values(players)) {
          if (p.dead) continue;
          const pd = Math.hypot(p.x - z.x, p.z - z.z);
          if (pd < attackRange) {
            p.health -= z.damage;
            if (p.health <= 0) { p.health = 0; p.dead = true; }
            z.charging = false;
          }
        }
        if (z.chargeTimer <= 0) z.charging = false;
        // If boss killed someone during charge, trigger escape
        const anyDead = Object.values(players).some(p => p.dead);
        if (anyDead && !escapeMode) { startEscape(); return; }
        // Keep world bounds
        const half = CONFIG.worldSize - 1;
        z.x = Math.max(-half, Math.min(half, z.x));
        z.z = Math.max(-half, Math.min(half, z.z));
      }
      // Normal boss melee attack when in range
      if (dist < attackRange && z.attackTimer <= 0 && !z.charging) {
        z.attackTimer = z.attackCooldown || 0.7;
        target.health -= z.damage;
        if (target.health <= 0) {
          target.health = 0;
          target.dead = true;
          // Boss knocks player out → trigger escape sequence
          if (!escapeMode) {
            startEscape();
            return;
          }
        }
      }
    } else if (dist < attackRange && z.attackTimer <= 0) {
      z.attackTimer = CONFIG.zombieAttackCooldown;
      target.health -= (z.damage || CONFIG.zombieDamage);
      if (target.health <= 0) {
        target.health = 0;
        target.dead = true;
        // Check if all players dead
        const allDead = Object.values(players).every(p => p.dead);
        if (allDead && !escapeMode) {
          io.emit('gameOver', { wave, score: Object.values(players).reduce((s,p)=>s+p.score,0) });
        }
      }
    }
  }
}

// ─── Gold pickups ───
function updateGoldPickups(dt) {
  for (let i = goldPickups.length - 1; i >= 0; i--) {
    const g = goldPickups[i];
    for (const p of Object.values(players)) {
      if (p.dead) continue;
      const dx = p.x - g.x, dz = p.z - g.z;
      if (Math.hypot(dx, dz) < CONFIG.goldPickupRadius) {
        p.gold += g.value;
        goldPickups.splice(i, 1);
        break;
      }
    }
  }
  goldSpawnTimer -= dt;
  if (goldSpawnTimer <= 0 && goldPickups.length < CONFIG.maxGoldPickups) {
    const half = CONFIG.worldSize - 5;
    goldPickups.push({
      id: nextGoldId++,
      x: (Math.random() - 0.5) * half * 2,
      z: (Math.random() - 0.5) * half * 2,
      value: 5 + Math.floor(Math.random() * 15),
    });
    goldSpawnTimer = CONFIG.goldSpawnInterval;
  }
}

// ─── Game loop ───
let lastTime = Date.now();
function gameLoop() {
  const now = Date.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (gameStarted && Object.keys(players).length > 0) {
    // Update players
    for (const p of Object.values(players)) updatePlayer(p, dt);

    if (!escapeMode) {
      // Wave management
      if (!waveActive) {
        waveBreakTimer -= dt;
        if (waveBreakTimer <= 0) startWave();
      } else {
        if (zombiesToSpawn > 0) {
          spawnTimer -= dt;
          if (spawnTimer <= 0) {
            spawnZombie();
            zombiesToSpawn--;
            spawnTimer = 1.5 + Math.random() * 1.5;
          }
        } else if (bossPending && !bossSpawned) {
          bossSpawned = true;
          bossPending = false;
          spawnBoss();
        }
      }
      updateGoldPickups(dt);
    } else {
      checkEscapeWin();
    }

    updateZombies(dt);

    // Check if all players dead (non-escape)
    if (!escapeMode) {
      const allDead = Object.values(players).every(p => p.dead);
      if (allDead) {
        io.emit('gameOver', { wave, score: Object.values(players).reduce((s,p)=>s+p.score,0) });
      }
    }
  }

  // Broadcast state — optimized: only send what changes frequently
  const state = {
    players: Object.values(players).map(p => ({
      id: p.id,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
      h: Math.ceil(p.health), s: p.score, k: p.kills, g: p.gold,
      gun: p.currentGun, ammo: p.ammo,
      r: p.reloading ? 1 : 0, af: p.autoFire ? 1 : 0, shop: p.shopOpen ? 1 : 0,
      dead: p.dead ? 1 : 0, em: p.escapeMode ? 1 : 0, es: p.escapeStep,
      hk: p.hasKey ? 1 : 0, gr: +p.gunRecoil.toFixed(2), mf: +p.muzzleFlash.toFixed(2),
      tr: p.shootTracers.length > 0 ? p.shootTracers : undefined,
    })),
    zombies: zombies.map(z => {
      const ll = z.lostLimbs || {};
      const base = {
        id: z.id, x: +z.x.toFixed(2), z: +z.z.toFixed(2), t: z.type[0],
        boss: z.isBoss ? 1 : 0, wp: +z.walkPhase.toFixed(2), r: +z.rot.toFixed(3),
        la: ll.armL ? 1 : 0, ra: ll.armR ? 1 : 0, ll: ll.legL ? 1 : 0, rl: ll.legR ? 1 : 0,
        rv: z.reviveCount || 0, rvv: z.reviving ? 1 : 0,
        chg: z.charging ? 1 : 0, slm: z.slamEffect ? 1 : 0, rng: z.rangedEffect ? 1 : 0,
        crk: z.crackEffect ? 1 : 0, cdx: z.crackDx || 0, cdz: z.crackDz || 0, clen: z.crackLength || 0,
      };
      // Reset one-shot effect flags
      if (z.slamEffect) z.slamEffect = 0;
      if (z.rangedEffect) z.rangedEffect = 0;
      if (z.crackEffect) z.crackEffect = 0;
      if (z.dying) {
        return { ...base, dy: 1, dt: Math.ceil(z.deathTimer) };
      }
      return { ...base, hp: Math.ceil(z.health), mhp: z.maxHealth, dy: 0, dt: 0 };
    }),
    gold: goldPickups.map(g => [g.id, +g.x.toFixed(2), +g.z.toFixed(2)]),
    wave, waveActive, escapeMode, escapeStep, doorOpen, keyDropped, keyPos,
    zRemain: zombies.filter(z => !z.dying && !z.reviving).length + zombiesToSpawn,
  };
  io.emit('state', state);
}

setInterval(gameLoop, 40); // 25 TPS — good balance of smoothness and bandwidth

function sendPlayerMeta(playerId) {
  const p = players[playerId];
  if (!p) return;
  io.to(playerId).emit('playerMeta', {
    upgrades: p.upgrades,
    ownedGuns: p.ownedGuns,
    maxHealth: getGunStat(p, 'maxHealth'),
    currentGun: p.currentGun,
  });
}

// ─── Socket handlers ───
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  players[socket.id] = createPlayer(socket.id);

  if (Object.keys(players).length === 1) {
    // First player starts the game
    gameStarted = true;
    wave = 1;
    waveActive = false;
    waveBreakTimer = 3;
    zombies = [];
    goldPickups = [];
    escapeMode = false;
  }

  socket.emit('connected', { id: socket.id, name: players[socket.id].name });
  // Send full player meta to the new player
  sendPlayerMeta(socket.id);
  io.emit('playerList', Object.values(players).map(p => ({ id: p.id, name: p.name })));

  socket.on('input', (data) => {
    const p = players[socket.id];
    if (!p || p.dead) return;
    // Validate keys — only accept known keys, ignore extras
    const validKeys = ['w','a','s','d',' ','shift'];
    const cleanKeys = {};
    if (data.keys) {
      for (const k of validKeys) {
        if (data.keys[k]) cleanKeys[k] = true;
      }
    }
    p.keys = cleanKeys;
    // Clamp yaw/pitch to valid ranges
    if (data.yaw !== undefined) p.yaw = data.yaw;
    if (data.pitch !== undefined) p.pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, data.pitch));
  });

  // Rate-limit shooting — server enforces fire rate, but also limit shoot events
  socket.on('shoot', () => {
    const p = players[socket.id];
    if (!p) return;
    // Server-side fire rate check in handleShoot, but also prevent event spam
    const now = Date.now();
    if (!p._lastShootEvent) p._lastShootEvent = 0;
    if (now - p._lastShootEvent < 30) return; // max ~33 shoots/sec
    p._lastShootEvent = now;
    handleShoot(socket.id);
  });
  socket.on('reload', () => startReload(socket.id));
  socket.on('buyGun', (gun) => {
    if (typeof gun !== 'string' || !GUNS[gun]) return;
    buyGun(socket.id, gun); sendPlayerMeta(socket.id);
  });
  socket.on('buyUpgrade', (key) => {
    if (typeof key !== 'string' || !UPGRADES[key]) return;
    buyUpgrade(socket.id, key); sendPlayerMeta(socket.id);
  });
  socket.on('switchGun', (gun) => {
    if (typeof gun !== 'string' || !GUNS[gun]) return;
    switchGun(socket.id, gun); sendPlayerMeta(socket.id);
  });
  socket.on('toggleShop', () => {
    const p = players[socket.id];
    if (!p || p.dead) return;
    p.shopOpen = !p.shopOpen;
  });
  socket.on('toggleAutoFire', () => {
    const p = players[socket.id];
    if (!p || p.dead || p.escapeMode) return;
    // Only allow auto-fire on guns that support it
    const gun = GUNS[p.currentGun];
    if (!gun || gun.melee) return;
    p.autoFire = !p.autoFire;
  });
  socket.on('escapeInteract', () => {
    const p = players[socket.id];
    if (!p || !p.escapeMode) return;
    if (p.escapeStep === 'guard' && keyDropped) pickUpKey(socket.id);
    else if (p.escapeStep === 'key' && p.hasKey) unlockCell(socket.id);
  });
  socket.on('respawn', () => {
    const p = players[socket.id];
    if (!p) return;
    p.dead = false;
    p.health = getGunStat(p, 'maxHealth');
    p.x = 0; p.y = CONFIG.playerHeight; p.z = 0;
    p.vx = 0; p.vy = 0; p.vz = 0;
    sendPlayerMeta(socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerList', Object.values(players).map(p => ({ id: p.id, name: p.name })));
    if (Object.keys(players).length === 0) {
      gameStarted = false;
      zombies = [];
      goldPickups = [];
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Zombie Shooter multiplayer server running on port ${PORT}`);
});

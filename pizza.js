'use strict';

const CONFIG = {
  roomSize: 30,
  wallHeight: 8,
  playerSpeed: 7,
  playerHeight: 1.6,
  playerWidth: 0.4,
  gravity: 28,
  gameDuration: 180,
  dayDuration: 60,         // 1 minute per day
  shoppingDuration: 30,    // seconds to buy ingredients between days
  totalDays: 3,
  ovenBakeTime: 5,
  ovenBurnTime: 10,
  orderTimeLimit: 60,
  baseHireCost: 50,
  hireCostIncrease: 25,
  chefCookTime: 8,
  ovenCost: 60,             // cost to buy a second oven
  shopOffset: 22,          // distance to outdoor shop area (z)
  shopWidth: 20,           // width of shop area
  shopDepth: 16,           // depth of shop area
  doorwayWidth: 4,         // gap in the wall for the door
};

const INGREDIENTS = {
  dough:     { color: 0xd4a574, name: 'Dough',     price: 3 },
  cheese:    { color: 0xf1c40f, name: 'Cheese',    price: 5 },
  pepperoni: { color: 0xc0392b, name: 'Pepperoni', price: 8 },
};

const VARIETIES = [
  { name: 'Cheese Pizza',    ingredients: { dough: 1, cheese: 1 }, sellPrice: 25, color: 0xf1c40f },
  { name: 'Pepperoni Pizza', ingredients: { dough: 1, cheese: 1, pepperoni: 1 }, sellPrice: 40, color: 0xc0392b },
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

class PizzaGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2c2c4a);
    this.scene.fog = new THREE.Fog(0x2c2c4a, 40, 100);

    this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.rotation.order = 'YXZ';

    this.keys = {};
    this.yaw = 0;
    this.running = false;
    this.gameOver = false;
    this.clock = new THREE.Clock();

    this.money = 50;
    this.served = 0;
    this.timeLeft = CONFIG.gameDuration;
    this.day = 1;
    this.dayTimeLeft = CONFIG.dayDuration;
    this.phase = 'open';   // 'open' = serving, 'shopping' = buying ingredients
    this.storeOpen = true; // player can close store to stop customers
    this.shoppingTimeLeft = 0;
    this.orders = [];
    this.pizza = null;       // current pizza in hand
    this.nearStation = null;
    this.nearCustomer = null;
    this.ovenPizza = null;   // pizza in oven (legacy ref, uses ovens[0])
    this.ovenTimer = 0;
    this.ovens = [];         // array of { pizza, timer, door, light, stationIdx }
    this.orderIdCounter = 0;
    this.hiredChefs = [];
    this.hireCost = CONFIG.baseHireCost;
    this.chefIdCounter = 0;
    this.inventory = { dough: 0, cheese: 0, pepperoni: 0 };
    this.displayPizzas = [];  // baked pizzas on display counter
    this.displayMeshes = [];  // visual pizza meshes on counter

    this.setupLights();
    this.setupKitchen();
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

    this.animate();
  }

  setupLights() {
    this.ambient = new THREE.AmbientLight(0xfff5e0, 0.5);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.7);
    this.sun.position.set(10, 20, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -20;
    this.sun.shadow.camera.right = 20;
    this.sun.shadow.camera.top = 30;
    this.sun.shadow.camera.bottom = -20;
    this.sun.shadow.camera.far = 80;
    this.scene.add(this.sun);
    // Warm kitchen light
    this.kitchenLight = new THREE.PointLight(0xffaa55, 0.5, 25);
    this.kitchenLight.position.set(0, 6, 0);
    this.scene.add(this.kitchenLight);
    // Oven glow
    this.ovenLight = new THREE.PointLight(0xff4400, 0, 8);
    this.ovenLight.position.set(0, 1.5, -12);
    this.scene.add(this.ovenLight);
    // Outdoor shop light
    this.shopLight = new THREE.PointLight(0xffffff, 0.4, 25);
    this.shopLight.position.set(0, 6, CONFIG.roomSize / 2 + CONFIG.shopOffset);
    this.scene.add(this.shopLight);
  }

  setupKitchen() {
    const half = CONFIG.roomSize / 2;
    const shopZ = half + CONFIG.shopOffset;
    const shopHalfW = CONFIG.shopWidth / 2;
    const shopHalfD = CONFIG.shopDepth / 2;
    const doorHalf = CONFIG.doorwayWidth / 2;

    // Restaurant floor — checkerboard
    const floorTex = this.makeCheckerTexture(0x8b6f47, 0x6d5535, 64);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(CONFIG.roomSize, CONFIG.roomSize),
      new THREE.MeshLambertMaterial({ map: floorTex })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Outdoor shop floor — grass/concrete
    const shopFloorTex = this.makeCheckerTexture(0x7f8c8d, 0x95a5a6, 64);
    const shopFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(CONFIG.shopWidth, CONFIG.shopDepth + CONFIG.shopOffset),
      new THREE.MeshLambertMaterial({ map: shopFloorTex })
    );
    shopFloor.rotation.x = -Math.PI / 2;
    shopFloor.position.set(0, 0, half + (CONFIG.shopDepth + CONFIG.shopOffset) / 2);
    shopFloor.receiveShadow = true;
    this.scene.add(shopFloor);

    // Walls — restaurant (back, left, right, and front with doorway gap)
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xd4a574 });
    const wallGeo = new THREE.PlaneGeometry(CONFIG.roomSize, CONFIG.wallHeight);
    const walls = [
      { pos: [0, CONFIG.wallHeight/2, -half], rot: [0, 0, 0] },
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
    // Front wall with doorway — two segments
    const frontWallLen = (CONFIG.roomSize - CONFIG.doorwayWidth) / 2;
    const frontWallGeo = new THREE.PlaneGeometry(frontWallLen, CONFIG.wallHeight);
    const fw1 = new THREE.Mesh(frontWallGeo, wallMat);
    fw1.position.set(-(doorHalf + frontWallLen / 2), CONFIG.wallHeight/2, half);
    fw1.rotation.y = Math.PI;
    fw1.receiveShadow = true; this.scene.add(fw1);
    const fw2 = new THREE.Mesh(frontWallGeo, wallMat);
    fw2.position.set(doorHalf + frontWallLen / 2, CONFIG.wallHeight/2, half);
    fw2.rotation.y = Math.PI;
    fw2.receiveShadow = true; this.scene.add(fw2);

    // Outdoor shop walls
    const shopWallMat = new THREE.MeshLambertMaterial({ color: 0xbdc3c7 });
    const shopWallGeo = new THREE.PlaneGeometry(CONFIG.shopWidth, CONFIG.wallHeight);
    // Left shop wall
    const slw = new THREE.Mesh(shopWallGeo, shopWallMat);
    slw.position.set(-shopHalfW, CONFIG.wallHeight/2, shopZ);
    slw.rotation.y = Math.PI/2;
    slw.receiveShadow = true; this.scene.add(slw);
    // Right shop wall
    const srw = new THREE.Mesh(shopWallGeo, shopWallMat);
    srw.position.set(shopHalfW, CONFIG.wallHeight/2, shopZ);
    srw.rotation.y = -Math.PI/2;
    srw.receiveShadow = true; this.scene.add(srw);
    // Back shop wall
    const sbw = new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.shopWidth, CONFIG.wallHeight), shopWallMat);
    sbw.position.set(0, CONFIG.wallHeight/2, shopZ + shopHalfD);
    sbw.receiveShadow = true; this.scene.add(sbw);

    // Stations
    this.stations = [];
    this.stationMeshes = [];

    // Ingredient stores — OUTSIDE in the shop area
    this.addStation('buyDough', -6, shopZ, 0xd4a574, 'Buy Dough ($3)', 2, 1.2, 2);
    this.addStation('buyCheese', 0, shopZ, 0xf1c40f, 'Buy Cheese ($5)', 2, 1.2, 2);
    this.addStation('buyPepperoni', 6, shopZ, 0xc0392b, 'Buy Pepperoni ($8)', 2, 1.2, 2);
    // Prep stations — make pizzas from ingredients (inside restaurant)
    this.addStation('makeCheese', -6, -5, 0xf39c12, 'Make Cheese Pizza', 2, 1.2, 2);
    this.addStation('makePepperoni', 2, -5, 0xe74c3c, 'Make Pepperoni Pizza', 2, 1.2, 2);
    // Oven
    this.addStation('oven', 10, -10, 0xe74c3c, 'Oven 1', 3, 2.5, 3);
    // Buy second oven station (shows where oven 2 will appear)
    this.addStation('buyOven', 6, -10, 0x95a5a6, 'Buy Oven 2 ($60)', 3, 2.5, 3);
    // Pizza display counter (corner) — baked pizzas stack here
    this.addStation('display', 12, 8, 0x2ecc71, 'Pizza Display', 3, 1.2, 3);
    // Hire station
    this.addStation('hire', -13, 8, 0xf39c12, 'Hire Chef', 2, 1.2, 1.5);

    // Customer area markers (front area)
    this.customerSpots = [
      { x: -6, z: 10 },
      { x: 0, z: 10 },
      { x: 6, z: 10 },
    ];
    this.customers = [];
  }

  makeCheckerTexture(c1, c2, size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = size / 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#' + c1.toString(16).padStart(6, '0') : '#' + c2.toString(16).padStart(6, '0');
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    return tex;
  }

  addStation(type, x, z, color, label, w, h, d) {
    w = w || 2; h = h || 1.2; d = d || 2;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Label text above station
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = 'position:fixed;color:#fff;font-size:14px;font-weight:700;pointer-events:none;z-index:5;text-shadow:0 2px 4px rgba(0,0,0,0.8);';
    labelDiv.textContent = label;
    document.body.appendChild(labelDiv);

    this.stations.push({ type, x, z, w, h, d, topY: h, label, labelDiv });
    this.stationMeshes.push(mesh);

    // Special: oven door glow + light
    if (type === 'oven') {
      const door = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.5),
        new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.3 })
      );
      door.position.set(x, 1.2, z + d/2 + 0.01);
      this.scene.add(door);
      const light = new THREE.PointLight(0xff4400, 0, 8);
      light.position.set(x, 1.5, z);
      this.scene.add(light);
      const ovenIdx = this.ovens.length;
      this.ovens.push({ pizza: null, timer: 0, door, light, stationIdx: this.stations.length - 1 });
      // Keep legacy refs pointing to first oven
      if (ovenIdx === 0) {
        this.ovenDoor = door;
        this.ovenLight = light;
      }
    }
  }

  spawnCustomer() {
    if (this.customers.length >= 3) return;
    const usedSpots = this.customers.map(c => c.spotIndex);
    const available = this.customerSpots.map((_, i) => i).filter(i => !usedSpots.includes(i));
    if (available.length === 0) return;
    const spotIndex = available[0];
    const spot = this.customerSpots[spotIndex];

    const variety = Math.floor(Math.random() * VARIETIES.length);
    const g = new THREE.Group();

    const colors = [0x3498db, 0xe74c3c, 0x2ecc71, 0xf39c12, 0x9b59b6];
    const c = colors[Math.floor(Math.random() * colors.length)];
    const bodyMat = new THREE.MeshLambertMaterial({ color: c });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.5), bodyMat);
    body.position.y = 0.5; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), bodyMat);
    head.position.y = 1.3; head.castShadow = true; g.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
    e1.position.set(-0.12, 1.35, 0.25); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.12; g.add(e2);
    const smile = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), eyeMat);
    smile.position.set(0, 1.2, 0.25); g.add(smile);

    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = Math.PI;
    this.scene.add(g);

    const order = {
      id: ++this.orderIdCounter,
      variety,
      timeLeft: CONFIG.orderTimeLimit,
      customer: g,
      spotIndex,
      color: c,
    };
    this.customers.push(order);
    this.orders.push(order);
    this.updateOrderPanel();
  }

  setupInput() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
      if (k === ' ' && this.running && !this.gameOver) this.doAction();
      if (k === 'h' && this.running && !this.gameOver) this.tryHireChef();
      if (k === 'shift' && this.running && !this.gameOver) this.putPizzaBackOnDisplay();
      if (k === 'o' && this.running && !this.gameOver) this.toggleStore();
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
  }

  putPizzaBackOnDisplay() {
    if (!this.pizza) return;
    const station = this.findNearbyStation();
    if (!station || station.type !== 'display') return;
    // Remove from player hand
    this.playerMesh.remove(this.pizza.mesh);
    const variety = this.pizza.variety;
    this.pizza = null;
    // Add back to display
    this.addPizzaToDisplay(variety);
    this.showMessage(`Put ${VARIETIES[variety].name} back on display.`, 'good');
  }

  toggleStore() {
    if (this.phase !== 'open') return;
    this.storeOpen = !this.storeOpen;
    if (this.storeOpen) {
      this.showMessage('Store OPEN! Customers coming.', 'good');
    } else {
      this.showMessage('Store CLOSED! No new customers.', 'bad');
      // Make existing customers leave
      for (const c of this.customers) c.leaving = true;
    }
  }

  start() {
    this.gameOver = false;
    if (this.money === undefined) this.money = 50;
    this.served = 0;
    this.day = 1;
    this.dayTimeLeft = CONFIG.dayDuration;
    this.phase = 'open';
    this.storeOpen = true;
    this.shoppingTimeLeft = 0;
    this.orders = [];
    this.pizza = null;
    this.ovenPizza = null;
    this.ovenTimer = 0;
    // Reset all ovens
    for (const oven of this.ovens) {
      if (oven.pizza) { this.scene.remove(oven.pizza.mesh); oven.pizza = null; }
      oven.timer = 0;
      oven.chefReserved = false;
      if (oven.door) oven.door.material.opacity = 0.3;
      if (oven.light) oven.light.intensity = 0;
    }
    this.orderIdCounter = 0;
    this.yaw = 0;
    this.player = { x: 0, y: 0, z: 0 };
    this.velY = 0;
    this.onGround = true;
    this.spawnTimer = 0;
    // Keep hire cost across restarts (chefs persist too)

    // Reset inventory but keep it across rounds if earned
    if (this.inventory === undefined) this.inventory = { dough: 0, cheese: 0, pepperoni: 0 };

    // Clear display pizzas
    for (const m of this.displayMeshes) this.scene.remove(m);
    this.displayMeshes = [];
    this.displayPizzas = [];

    // Clear customers
    for (const c of this.customers) this.scene.remove(c.customer);
    this.customers = [];

    // Reset chef states but keep them employed
    const chefSpots = [{x: -7, z: -5}, {x: 3, z: -5}, {x: -3, z: 5}, {x: 7, z: 5}];
    for (let i = 0; i < this.hiredChefs.length; i++) {
      const ch = this.hiredChefs[i];
      ch.state = 'idle';
      ch.timer = 0;
      ch.targetOrder = null;
      ch.stuckTimer = 0;
      ch.buyTarget = null;
      ch.buyCooldown = 0;
      ch.reservedOven = null;
      if (ch.pizzaMesh) { ch.mesh.remove(ch.pizzaMesh); ch.pizzaMesh = null; }
      // Reset position to spawn spot
      const spot = chefSpots[i % chefSpots.length];
      ch.x = spot.x;
      ch.z = spot.z;
      ch.mesh.position.set(spot.x, 0, spot.z);
      // Ensure mesh is still in scene
      if (!ch.mesh.parent) this.scene.add(ch.mesh);
    }

    // Create player mesh
    if (!this.playerMesh) {
      this.playerMesh = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0xecf0f1 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.4), bodyMat);
      body.position.y = 0.5; body.castShadow = true; this.playerMesh.add(body);
      // Chef hat
      const hat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      hat.position.y = 1.25; hat.castShadow = true; this.playerMesh.add(hat);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.45), new THREE.MeshLambertMaterial({ color: 0xf5dab1 }));
      head.position.y = 0.95; head.castShadow = true; this.playerMesh.add(head);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
      e1.position.set(-0.1, 1.0, 0.23); this.playerMesh.add(e1);
      const e2 = e1.clone(); e2.position.x = 0.1; this.playerMesh.add(e2);
      // Arms
      const armMat = new THREE.MeshLambertMaterial({ color: 0xecf0f1 });
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 0.15), armMat);
      armL.position.set(-0.4, 0.5, 0); armL.castShadow = true; this.playerMesh.add(armL);
      const armR = armL.clone(); armR.position.x = 0.4; this.playerMesh.add(armR);
      this.scene.add(this.playerMesh);
    }

    // Spawn initial customers
    this.spawnCustomer();
    this.spawnCustomer();

    document.getElementById('hud').style.display = 'flex';
    document.getElementById('order-panel').style.display = 'flex';
    document.getElementById('pizza-status').style.display = 'block';
    document.getElementById('inventory-panel').style.display = 'block';
    this.updateInventoryUI();

    this.running = true;
    this.clock.start();
  }

  // ─── Pizza logic ───
  createPizzaMesh(varietyIdx) {
    const v = VARIETIES[varietyIdx];
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 0.1, 16),
      new THREE.MeshLambertMaterial({ color: 0xd4a05a })
    );
    base.castShadow = true;
    g.add(base);
    const sauce = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.03, 16),
      new THREE.MeshLambertMaterial({ color: 0xc0392b })
    );
    sauce.position.y = 0.06;
    g.add(sauce);
    // Cheese layer
    const cheese = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.02, 16),
      new THREE.MeshLambertMaterial({ color: 0xf1c40f })
    );
    cheese.position.y = 0.08;
    g.add(cheese);
    // Pepperoni bits
    if (varietyIdx === 1) {
      for (let j = 0; j < 6; j++) {
        const bit = new THREE.Mesh(
          new THREE.BoxGeometry(0.15, 0.05, 0.15),
          new THREE.MeshLambertMaterial({ color: 0xc0392b })
        );
        const angle = (j / 6) * Math.PI * 2;
        const r = 0.3;
        bit.position.set(Math.cos(angle) * r, 0.1, Math.sin(angle) * r);
        g.add(bit);
      }
    }
    return g;
  }

  addPizzaToDisplay(varietyIdx) {
    const mesh = this.createPizzaMesh(varietyIdx);
    const displayStation = this.stations.find(s => s.type === 'display');
    const stackIdx = this.displayPizzas.length;
    mesh.position.set(
      displayStation.x + (stackIdx % 3) * 0.8 - 0.8,
      displayStation.h + 0.1 + Math.floor(stackIdx / 3) * 0.2,
      displayStation.z
    );
    this.scene.add(mesh);
    this.displayMeshes.push(mesh);
    this.displayPizzas.push({ variety: varietyIdx, mesh });
  }

  getOvenForStation(station) {
    for (const oven of this.ovens) {
      if (oven.stationIdx !== undefined && this.stations[oven.stationIdx] === station) return oven;
    }
    return null;
  }

  getAvailableOven() {
    return this.ovens.find(o => !o.pizza);
  }

  getOvenByIndex(idx) {
    return this.ovens[idx];
  }

  buySecondOven() {
    if (this.ovens.length >= 2) { this.showMessage('Already have 2 ovens!', 'bad'); return; }
    if (this.money < CONFIG.ovenCost) { this.showMessage(`Need $${CONFIG.ovenCost} for a second oven!`, 'bad'); return; }
    this.money -= CONFIG.ovenCost;
    // Replace the buyOven station with a real oven
    const buySt = this.stations.find(s => s.type === 'buyOven');
    if (!buySt) return;
    buySt.type = 'oven';
    buySt.label = 'Oven 2';
    buySt.labelDiv.textContent = 'Oven 2';
    // Change the mesh color to red like the first oven
    const meshIdx = this.stations.indexOf(buySt);
    if (this.stationMeshes[meshIdx]) {
      this.stationMeshes[meshIdx].material.color.setHex(0xe74c3c);
    }
    // Create oven door + light for the second oven
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.3 })
    );
    door.position.set(buySt.x, 1.2, buySt.z + buySt.d / 2 + 0.01);
    this.scene.add(door);
    const light = new THREE.PointLight(0xff4400, 0, 8);
    light.position.set(buySt.x, 1.5, buySt.z);
    this.scene.add(light);
    this.ovens.push({ pizza: null, timer: 0, door, light, stationIdx: this.stations.indexOf(buySt) });
    this.showMessage('Bought a second oven! Now you can bake 2 pizzas at once.', 'good');
  }

  updateInventoryUI() {
    const el = document.getElementById('inventory-panel');
    if (!el) return;
    el.innerHTML = `
      <div style="color:#d4a574;">Dough: ${this.inventory.dough}</div>
      <div style="color:#f1c40f;">Cheese: ${this.inventory.cheese}</div>
      <div style="color:#e74c3c;">Pepperoni: ${this.inventory.pepperoni}</div>
    `;
  }

  doAction() {
    // If near a customer with a pizza, serve to them
    if (this.nearCustomer && this.pizza) {
      this.serveToCustomer(this.nearCustomer);
      return;
    }
    if (!this.nearStation) return;
    const s = this.nearStation;

    // Buy ingredients
    if (s.type === 'buyDough') {
      if (this.money < INGREDIENTS.dough.price) { this.showMessage('Not enough money!', 'bad'); return; }
      this.money -= INGREDIENTS.dough.price;
      this.inventory.dough++;
      this.updateInventoryUI();
      this.showMessage(`Bought dough! ($${INGREDIENTS.dough.price})`, 'good');
    }
    else if (s.type === 'buyCheese') {
      if (this.money < INGREDIENTS.cheese.price) { this.showMessage('Not enough money!', 'bad'); return; }
      this.money -= INGREDIENTS.cheese.price;
      this.inventory.cheese++;
      this.updateInventoryUI();
      this.showMessage(`Bought cheese! ($${INGREDIENTS.cheese.price})`, 'good');
    }
    else if (s.type === 'buyPepperoni') {
      if (this.money < INGREDIENTS.pepperoni.price) { this.showMessage('Not enough money!', 'bad'); return; }
      this.money -= INGREDIENTS.pepperoni.price;
      this.inventory.pepperoni++;
      this.updateInventoryUI();
      this.showMessage(`Bought pepperoni! ($${INGREDIENTS.pepperoni.price})`, 'good');
    }
    // Make pizzas from ingredients
    else if (s.type === 'makeCheese') {
      if (this.pizza) { this.showMessage('Hands full!', 'bad'); return; }
      if (!this.getAvailableOven()) { this.showMessage('All ovens full!', 'bad'); return; }
      if (this.inventory.dough < 1 || this.inventory.cheese < 1) { this.showMessage('Need dough + cheese!', 'bad'); return; }
      this.inventory.dough--; this.inventory.cheese--;
      this.updateInventoryUI();
      this.pizza = { variety: 0, baked: false, mesh: this.createPizzaMesh(0) };
      this.playerMesh.add(this.pizza.mesh);
      this.pizza.mesh.position.set(0.4, 0.8, 0.3);
      this.pizza.mesh.rotation.x = -0.3;
      this.showMessage('Made cheese pizza! Bake it in the oven.', 'good');
    }
    else if (s.type === 'makePepperoni') {
      if (this.pizza) { this.showMessage('Hands full!', 'bad'); return; }
      if (!this.getAvailableOven()) { this.showMessage('All ovens full!', 'bad'); return; }
      if (this.inventory.dough < 1 || this.inventory.cheese < 1 || this.inventory.pepperoni < 1) { this.showMessage('Need dough + cheese + pepperoni!', 'bad'); return; }
      this.inventory.dough--; this.inventory.cheese--; this.inventory.pepperoni--;
      this.updateInventoryUI();
      this.pizza = { variety: 1, baked: false, mesh: this.createPizzaMesh(1) };
      this.playerMesh.add(this.pizza.mesh);
      this.pizza.mesh.position.set(0.4, 0.8, 0.3);
      this.pizza.mesh.rotation.x = -0.3;
      this.showMessage('Made pepperoni pizza! Bake it in the oven.', 'good');
    }
    // Oven — put pizza in to bake (use the specific oven the player is near)
    else if (s.type === 'oven') {
      const oven = this.getOvenForStation(s);
      if (!oven) { this.showMessage('No oven here!', 'bad'); return; }
      if (oven.pizza) { this.showMessage('This oven is full!', 'bad'); return; }
      if (!this.pizza) { this.showMessage('No pizza to bake!', 'bad'); return; }
      if (this.pizza.baked) { this.showMessage('Already baked!', 'bad'); return; }
      oven.pizza = this.pizza;
      this.playerMesh.remove(this.pizza.mesh);
      oven.pizza.mesh.position.set(s.x, 1.5, s.z);
      this.scene.add(oven.pizza.mesh);
      this.pizza = null;
      oven.timer = 0;
      oven.door.material.opacity = 0.6;
      oven.light.intensity = 2;
      this.showMessage('Baking... will auto-stack when done', 'good');
    }
    // Buy a second oven
    else if (s.type === 'buyOven') {
      this.buySecondOven();
    }
    // Display — grab a baked pizza
    else if (s.type === 'display') {
      if (this.pizza) { this.showMessage('Hands full!', 'bad'); return; }
      if (this.displayPizzas.length === 0) { this.showMessage('No pizzas on display!', 'bad'); return; }
      const dp = this.displayPizzas.pop();
      this.scene.remove(dp.mesh);
      this.displayMeshes.pop();
      this.pizza = { variety: dp.variety, baked: true, mesh: dp.mesh };
      this.playerMesh.add(this.pizza.mesh);
      this.pizza.mesh.position.set(0.5, 0.9, 0.4);
      this.pizza.mesh.rotation.x = -0.3;
      this.showMessage(`Grabbed ${VARIETIES[dp.variety].name}! Serve to a customer.`, 'good');
      // Re-stack remaining pizzas
      this.restackDisplay();
    }
    else if (s.type === 'hire') {
      this.tryHireChef();
    }
  }

  restackDisplay() {
    const displayStation = this.stations.find(s => s.type === 'display');
    for (let i = 0; i < this.displayPizzas.length; i++) {
      const dp = this.displayPizzas[i];
      dp.mesh.position.set(
        displayStation.x + (i % 3) * 0.8 - 0.8,
        displayStation.h + 0.1 + Math.floor(i / 3) * 0.2,
        displayStation.z
      );
    }
  }

  serveToCustomer(customer) {
    if (!this.pizza || !this.pizza.baked) { this.showMessage('No baked pizza!', 'bad'); return; }
    // Check if pizza variety matches customer order
    if (customer.variety !== this.pizza.variety) {
      this.showMessage(`Customer wants ${VARIETIES[customer.variety].name}!`, 'bad');
      return;
    }
    const payment = VARIETIES[this.pizza.variety].sellPrice;
    this.money += payment;
    this.served++;
    this.playerMesh.remove(this.pizza.mesh);
    this.showMessage(`Sold ${VARIETIES[this.pizza.variety].name}! +$${payment}`, 'good');
    this.pizza = null;
    customer.leaving = true;
  }

  tryHireChef() {
    if (this.money < this.hireCost) { this.showMessage(`Need $${this.hireCost} to hire!`, 'bad'); return; }
    this.money -= this.hireCost;
    this.hireCost += CONFIG.hireCostIncrease;
    this.spawnChef();
    this.showMessage(`Hired a chef! -$${this.hireCost - CONFIG.hireCostIncrease}`, 'good');
  }

  spawnChef() {
    const id = ++this.chefIdCounter;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.4), bodyMat);
    body.position.y = 0.5; body.castShadow = true; g.add(body);
    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshLambertMaterial({ color: 0xe74c3c }));
    hat.position.y = 1.25; g.add(hat);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.45), new THREE.MeshLambertMaterial({ color: 0xf5dab1 }));
    head.position.y = 0.95; g.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
    e1.position.set(-0.1, 1.0, 0.23); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.1; g.add(e2);
    // Chef stands at a random spot in the kitchen
    const spots = [{x: -7, z: -5}, {x: 3, z: -5}, {x: -3, z: 5}, {x: 7, z: 5}];
    const spot = spots[(this.chefIdCounter - 1) % spots.length];
    g.position.set(spot.x, 0, spot.z);
    this.scene.add(g);
    this.hiredChefs.push({
      mesh: g, id, x: spot.x, z: spot.z,
      state: 'idle', timer: 0, targetOrder: null,
      pizzaMesh: null,
    });
  }

  pickChefBuyTarget() {
    // Only buy if money is above a safety margin
    if (this.money < 15) return null;
    // Find the ingredient with the lowest stock that's below 3
    const priority = [
      { key: 'dough', station: 'buyDough' },
      { key: 'cheese', station: 'buyCheese' },
      { key: 'pepperoni', station: 'buyPepperoni' },
    ];
    let lowest = null;
    for (const p of priority) {
      if (this.inventory[p.key] < 3) {
        if (!lowest || this.inventory[p.key] < this.inventory[lowest.key]) {
          lowest = p;
        }
      }
    }
    return lowest ? lowest.station : null;
  }

  updateChefs(dt) {
    for (const chef of this.hiredChefs) {
      chef.timer += dt;

      // Safety: if chef is stuck in a non-idle state too long, reset
      if (chef.state !== 'idle' && chef.state !== 'baking' && chef.state !== 'serveWait' && chef.state !== 'buyWait') {
        chef.stuckTimer = (chef.stuckTimer || 0) + dt;
        if (chef.stuckTimer > 20) {
          // Unassign order and reset
          if (chef.targetOrder) chef.targetOrder.assigned = false;
          if (chef.pizzaMesh) { chef.mesh.remove(chef.pizzaMesh); chef.pizzaMesh = null; }
          chef.targetOrder = null;
          chef.state = 'idle';
          chef.timer = 0;
          chef.stuckTimer = 0;
        }
      } else {
        chef.stuckTimer = 0;
      }

      if (chef.state === 'idle') {
        // Find first unassigned order that the player isn't working on
        const order = this.orders.find(o => !o.assigned && !o.playerWorking && !o.leaving);
        if (order) {
          // Check if we have ingredients for this variety
          const v = VARIETIES[order.variety];
          let canMake = true;
          for (const ing in v.ingredients) {
            if (this.inventory[ing] < v.ingredients[ing]) { canMake = false; break; }
          }
          if (canMake) {
            // Deduct ingredients
            for (const ing in v.ingredients) this.inventory[ing] -= v.ingredients[ing];
            this.updateInventoryUI();
            order.assigned = true;
            chef.targetOrder = order;
            chef.state = 'gotoOven';
            chef.timer = 0;
            chef.stuckTimer = 0;
            // Show pizza in hands
            if (chef.pizzaMesh) chef.mesh.remove(chef.pizzaMesh);
            chef.pizzaMesh = this.createPizzaMesh(order.variety);
            chef.pizzaMesh.position.set(0.4, 0.8, 0.3);
            chef.pizzaMesh.rotation.x = -0.3;
            chef.mesh.add(chef.pizzaMesh);
          } else {
            // Not enough ingredients — go buy what's needed (but not too much)
            chef.buyTarget = this.pickChefBuyTarget();
            if (chef.buyTarget) {
              chef.state = 'gotoBuy';
              chef.timer = 0;
              chef.stuckTimer = 0;
            }
          }
        } else {
          // No orders — occasionally top up inventory if low
          chef.buyCooldown = (chef.buyCooldown || 0) + dt;
          if (chef.buyCooldown > 5) {
            chef.buyCooldown = 0;
            chef.buyTarget = this.pickChefBuyTarget();
            if (chef.buyTarget) {
              chef.state = 'gotoBuy';
              chef.timer = 0;
              chef.stuckTimer = 0;
            }
          }
        }
      }

      // Movement helper — move toward target with station avoidance, return true when arrived
      const moveToward = (tx, tz, speed) => {
        const dx = tx - chef.x, dz = tz - chef.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) return true;
        let nx = chef.x + (dx / d) * speed * dt;
        let nz = chef.z + (dz / d) * speed * dt;
        // Avoid walking through stations — push out like player collision
        for (const s of this.stations) {
          if (s.type === 'hire') continue;
          const halfW = s.w / 2 + 0.3;
          const halfD = s.d / 2 + 0.3;
          if (nx > s.x - halfW && nx < s.x + halfW && nz > s.z - halfD && nz < s.z + halfD) {
            const sdx = nx - s.x, sdz = nz - s.z;
            if (Math.abs(sdx / halfW) > Math.abs(sdz / halfD)) {
              nx = s.x + Math.sign(sdx) * halfW;
            } else {
              nz = s.z + Math.sign(sdz) * halfD;
            }
          }
        }
        // Clamp to room + shop area
        const half = CONFIG.roomSize / 2 - 0.5;
        const shopZ = CONFIG.roomSize / 2 + CONFIG.shopOffset;
        const shopHalfW = CONFIG.shopWidth / 2 - 0.5;
        const shopHalfD = CONFIG.shopDepth / 2 - 0.5;
        const doorHalf = CONFIG.doorwayWidth / 2;
        if (nz < half - 0.5) {
          nx = clamp(nx, -half, half);
          nz = clamp(nz, -half, half);
        } else if (nz > half + 0.5) {
          nx = clamp(nx, -shopHalfW, shopHalfW);
          nz = clamp(nz, half, shopZ + shopHalfD);
        } else {
          if (Math.abs(nx) > doorHalf) nz = half - 0.5;
        }
        chef.x = nx;
        chef.z = nz;
        chef.mesh.rotation.y = Math.atan2(dx, dz);
        return false;
      };

      const chefSpeed = 4;

      if (chef.state === 'gotoBuy') {
        const st = this.stations.find(s => s.type === chef.buyTarget);
        if (moveToward(st.x, st.z, chefSpeed)) {
          chef.state = 'buyWait';
          chef.timer = 0;
          chef.stuckTimer = 0;
        }
      }
      else if (chef.state === 'buyWait') {
        if (chef.timer >= 1.5) {
          // Buy 1 of the target ingredient if we can afford it and don't have too many
          const ingKey = chef.buyTarget.replace('buy', '').toLowerCase();
          const ing = INGREDIENTS[ingKey];
          if (ing && this.money >= ing.price && this.inventory[ingKey] < 5) {
            this.money -= ing.price;
            this.inventory[ingKey]++;
            this.updateInventoryUI();
          }
          chef.buyTarget = null;
          chef.state = 'idle';
          chef.timer = 0;
          chef.stuckTimer = 0;
        }
      }
      else if (chef.state === 'gotoOven') {
        // If customer left, abandon
        if (!chef.targetOrder || !this.customers.includes(chef.targetOrder)) {
          if (chef.targetOrder) chef.targetOrder.assigned = false;
          if (chef.pizzaMesh) { chef.mesh.remove(chef.pizzaMesh); chef.pizzaMesh = null; }
          if (chef.reservedOven) { chef.reservedOven.chefReserved = false; chef.reservedOven = null; }
          chef.targetOrder = null;
          chef.state = 'idle';
          chef.timer = 0;
          chef.stuckTimer = 0;
        } else {
          // Find an available oven to walk to
          if (!chef.reservedOven) {
            const availOven = this.ovens.find(o => !o.pizza && !o.chefReserved);
            if (availOven) {
              availOven.chefReserved = true;
              chef.reservedOven = availOven;
            }
          }
          if (chef.reservedOven) {
            const st = this.stations[chef.reservedOven.stationIdx];
            if (moveToward(st.x, st.z, chefSpeed)) {
              chef.ovenTimer = 0;
              if (chef.pizzaMesh) { chef.mesh.remove(chef.pizzaMesh); chef.pizzaMesh = null; }
              chef.pizzaMesh = this.createPizzaMesh(chef.targetOrder.variety);
              chef.pizzaMesh.position.set(0, 1.5, 0);
              chef.mesh.add(chef.pizzaMesh);
              chef.state = 'baking';
              chef.timer = 0;
              chef.stuckTimer = 0;
            }
          } else {
            // No oven available — wait
            chef.stuckTimer = (chef.stuckTimer || 0) + dt;
            if (chef.stuckTimer > 10) {
              if (chef.targetOrder) chef.targetOrder.assigned = false;
              if (chef.pizzaMesh) { chef.mesh.remove(chef.pizzaMesh); chef.pizzaMesh = null; }
              chef.targetOrder = null;
              chef.state = 'idle';
              chef.timer = 0;
              chef.stuckTimer = 0;
            }
          }
        }
      }
      else if (chef.state === 'baking') {
        chef.ovenTimer = (chef.ovenTimer || 0) + dt;
        if (chef.ovenTimer >= CONFIG.chefCookTime) {
          if (chef.pizzaMesh) {
            chef.mesh.remove(chef.pizzaMesh);
            chef.pizzaMesh = this.createPizzaMesh(chef.targetOrder.variety);
            chef.pizzaMesh.position.set(0.4, 0.8, 0.3);
            chef.pizzaMesh.rotation.x = -0.3;
            chef.mesh.add(chef.pizzaMesh);
          }
          chef.state = 'gotoCustomer';
          chef.timer = 0;
          chef.stuckTimer = 0;
          if (chef.reservedOven) { chef.reservedOven.chefReserved = false; chef.reservedOven = null; }
        }
      }
      else if (chef.state === 'gotoCustomer') {
        if (!chef.targetOrder || !this.customers.includes(chef.targetOrder)) {
          // Customer left — unassign and reset
          if (chef.targetOrder) chef.targetOrder.assigned = false;
          if (chef.pizzaMesh) { chef.mesh.remove(chef.pizzaMesh); chef.pizzaMesh = null; }
          chef.targetOrder = null;
          chef.state = 'idle';
          chef.timer = 0;
          chef.stuckTimer = 0;
        } else {
          const cx = chef.targetOrder.customer.position.x;
          const cz = chef.targetOrder.customer.position.z;
          if (moveToward(cx, cz, chefSpeed)) {
            chef.state = 'serveWait';
            chef.timer = 0;
            chef.stuckTimer = 0;
          }
        }
      }
      else if (chef.state === 'serveWait') {
        if (chef.timer >= 1) {
          if (chef.targetOrder && this.customers.includes(chef.targetOrder)) {
            const payment = VARIETIES[chef.targetOrder.variety].sellPrice;
            this.money += payment;
            this.served++;
            this.showMessage(`Chef served ${VARIETIES[chef.targetOrder.variety].name}! +$${payment}`, 'good');
            chef.targetOrder.leaving = true;
          }
          if (chef.pizzaMesh) { chef.mesh.remove(chef.pizzaMesh); chef.pizzaMesh = null; }
          chef.targetOrder = null;
          chef.state = 'idle';
          chef.timer = 0;
          chef.stuckTimer = 0;
        }
      }

      chef.mesh.position.set(chef.x, 0, chef.z);
    }
  }

  removeCustomer(order) {
    this.scene.remove(order.customer);
    const idx = this.customers.indexOf(order);
    if (idx >= 0) this.customers.splice(idx, 1);
    const oidx = this.orders.indexOf(order);
    if (oidx >= 0) this.orders.splice(oidx, 1);
    this.updateOrderPanel();
  }

  findNearbyCustomer() {
    let closest = null, closestD = 3;
    for (const c of this.customers) {
      if (c.leaving) continue;
      const d = Math.hypot(this.player.x - c.customer.position.x, this.player.z - c.customer.position.z);
      if (d < closestD) { closestD = d; closest = c; }
    }
    return closest;
  }

  updateOrderPanel() {
    const panel = document.getElementById('order-panel');
    panel.innerHTML = '';
    for (const order of this.orders) {
      if (order.leaving) continue;
      const card = document.createElement('div');
      card.className = 'order-card';
      const v = VARIETIES[order.variety];
      card.innerHTML = `
        <div class="order-name">${v.name}</div>
        <div class="order-toppings">$${v.sellPrice}</div>
        <div class="order-timer">${Math.ceil(order.timeLeft)}s left</div>
      `;
      panel.appendChild(card);
    }
  }

  showMessage(msg, type) {
    const el = document.getElementById('message');
    el.textContent = msg;
    el.className = type || '';
    el.classList.add('show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }

  // ─── Collision ───
  checkStationCollision(x, z) {
    for (const s of this.stations) {
      const halfW = s.w / 2 + CONFIG.playerWidth;
      const halfD = s.d / 2 + CONFIG.playerWidth;
      if (x > s.x - halfW && x < s.x + halfW && z > s.z - halfD && z < s.z + halfD) {
        // Push player out
        const dx = x - s.x, dz = z - s.z;
        if (Math.abs(dx / halfW) > Math.abs(dz / halfD)) {
          x = s.x + Math.sign(dx) * halfW;
        } else {
          z = s.z + Math.sign(dz) * halfD;
        }
      }
    }
    return { x, z };
  }

  findNearbyStation() {
    let closest = null, closestD = 2.5;
    for (const s of this.stations) {
      const d = Math.hypot(this.player.x - s.x, this.player.z - s.z);
      if (d < closestD) { closestD = d; closest = s; }
    }
    return closest;
  }

  // ─── Update ───
  update(dt) {
    if (this.phase === 'shopping') {
      this.updateShopping(dt);
    } else {
      this.updateOpen(dt);
    }
    this.updateCommon(dt);
  }

  updateOpen(dt) {
    this.dayTimeLeft -= dt;
    if (this.dayTimeLeft <= 0) {
      if (this.day >= CONFIG.totalDays) { this.endGame(); return; }
      this.startShopping(); return;
    }

    // Spawn customers (only if store is open)
    this.spawnTimer -= dt;
    if (this.storeOpen && this.spawnTimer <= 0 && this.customers.length < 3) {
      this.spawnTimer = 6 + Math.random() * 4;
      this.spawnCustomer();
    }

    // Update hired chefs
    this.updateChefs(dt);

    // Update leaving customers (walk away then remove)
    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i];
      if (c.leaving) {
        c.customer.position.z += 5 * dt;
        c.customer.position.x *= 0.99;
        if (c.customer.position.z > CONFIG.roomSize / 2 + 2) {
          this.removeCustomer(c);
        }
      }
    }

    // Update order timers
    for (let i = this.orders.length - 1; i >= 0; i--) {
      this.orders[i].timeLeft -= dt;
      if (this.orders[i].timeLeft <= 0) {
        this.showMessage(`Customer left angry!`, 'bad');
        this.removeCustomer(this.orders[i]);
      }
    }
    this.updateOrderPanel();

    // Oven logic — process all ovens
    for (const oven of this.ovens) {
      if (!oven.pizza) continue;
      oven.timer += dt;
      if (oven.timer >= CONFIG.ovenBakeTime && !oven.pizza.baked) {
        oven.pizza.baked = true;
        oven.pizza.mesh.traverse(c => {
          if (c.material && c.material.color && c.geometry.type === 'CylinderGeometry') {
            c.material.color.lerp(new THREE.Color(0x8B4513), 0.3);
          }
        });
        this.showMessage('Pizza baked! Auto-stacking on display...', 'good');
      }
      if (oven.pizza.baked && oven.timer >= CONFIG.ovenBakeTime + 1) {
        this.scene.remove(oven.pizza.mesh);
        this.addPizzaToDisplay(oven.pizza.variety);
        oven.pizza = null;
        oven.door.material.opacity = 0.3;
        oven.light.intensity = 0;
        oven.timer = 0;
      }
      if (oven.timer >= CONFIG.ovenBurnTime) {
        this.showMessage('Pizza BURNED!', 'bad');
        this.scene.remove(oven.pizza.mesh);
        oven.pizza = null;
        oven.door.material.opacity = 0.3;
        oven.light.intensity = 0;
        oven.timer = 0;
      }
    }
  }

  updateShopping(dt) {
    this.shoppingTimeLeft -= dt;
    if (this.shoppingTimeLeft <= 0) {
      this.startNextDay();
      return;
    }
    // Oven still works during shopping — process all ovens
    for (const oven of this.ovens) {
      if (!oven.pizza) continue;
      oven.timer += dt;
      if (oven.timer >= CONFIG.ovenBakeTime && !oven.pizza.baked) {
        oven.pizza.baked = true;
        oven.pizza.mesh.traverse(c => {
          if (c.material && c.material.color && c.geometry.type === 'CylinderGeometry') {
            c.material.color.lerp(new THREE.Color(0x8B4513), 0.3);
          }
        });
      }
      if (oven.pizza.baked && oven.timer >= CONFIG.ovenBakeTime + 1) {
        this.scene.remove(oven.pizza.mesh);
        this.addPizzaToDisplay(oven.pizza.variety);
        oven.pizza = null;
        oven.door.material.opacity = 0.3;
        oven.light.intensity = 0;
        oven.timer = 0;
      }
      if (oven.timer >= CONFIG.ovenBurnTime) {
        this.scene.remove(oven.pizza.mesh);
        oven.pizza = null;
        oven.door.material.opacity = 0.3;
        oven.light.intensity = 0;
        oven.timer = 0;
      }
    }
  }

  updateCommon(dt) {
    // Movement
    let mx = 0, mz = 0;
    if (this.keys['w']) mz -= 1;
    if (this.keys['s']) mz += 1;
    if (this.keys['a']) mx -= 1;
    if (this.keys['d']) mx += 1;
    if (this.keys['arrowup']) mz -= 1;
    if (this.keys['arrowdown']) mz += 1;
    if (this.keys['arrowleft']) this.yaw += 2.5 * dt;
    if (this.keys['arrowright']) this.yaw -= 2.5 * dt;
    const speed = CONFIG.playerSpeed;
    if (mx || mz) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = -sin * (-mz) + cos * mx;
      const wz = -cos * (-mz) - sin * mx;
      this.player.x += wx * speed * dt;
      this.player.z += wz * speed * dt;
    }

    // Wall collision — use custom bounds instead of simple clamp
    const half = CONFIG.roomSize / 2 - CONFIG.playerWidth;
    const shopZ = CONFIG.roomSize / 2 + CONFIG.shopOffset;
    const shopHalfW = CONFIG.shopWidth / 2 - CONFIG.playerWidth;
    const shopHalfD = CONFIG.shopDepth / 2 - CONFIG.playerWidth;
    const doorHalf = CONFIG.doorwayWidth / 2;

    // If inside restaurant (z < half), clamp to restaurant bounds
    // If outside (z > half), clamp to shop bounds
    // The doorway connects them at |x| < doorHalf
    if (this.player.z < half - 0.5) {
      // Inside restaurant
      this.player.x = clamp(this.player.x, -half, half);
      this.player.z = clamp(this.player.z, -half, half);
    } else if (this.player.z > half + 0.5) {
      // Outside in shop area
      this.player.x = clamp(this.player.x, -shopHalfW, shopHalfW);
      this.player.z = clamp(this.player.z, half, shopZ + shopHalfD);
    } else {
      // In the doorway zone — only allow if within door width
      if (Math.abs(this.player.x) > doorHalf) {
        // Push back into restaurant
        this.player.z = half - 0.5;
      }
    }
    const coll = this.checkStationCollision(this.player.x, this.player.z);
    this.player.x = coll.x;
    this.player.z = coll.z;

    // Find nearby station and customer
    this.nearStation = this.findNearbyStation();
    this.nearCustomer = this.findNearbyCustomer();
    const prompt = document.getElementById('action-prompt');
    if (this.phase === 'shopping') {
      // During shopping, only show buy/make/oven prompts
      if (this.nearStation) {
        let text = '';
        const s = this.nearStation;
        if (s.type === 'buyDough') text = `Press SPACE to buy dough ($${INGREDIENTS.dough.price}) — have ${this.inventory.dough}`;
        else if (s.type === 'buyCheese') text = `Press SPACE to buy cheese ($${INGREDIENTS.cheese.price}) — have ${this.inventory.cheese}`;
        else if (s.type === 'buyPepperoni') text = `Press SPACE to buy pepperoni ($${INGREDIENTS.pepperoni.price}) — have ${this.inventory.pepperoni}`;
        else if (s.type === 'makeCheese') text = this.pizza ? 'Hands full!' : (!this.getAvailableOven() ? 'All ovens full!' : `Press SPACE to make Cheese Pizza`);
        else if (s.type === 'makePepperoni') text = this.pizza ? 'Hands full!' : (!this.getAvailableOven() ? 'All ovens full!' : `Press SPACE to make Pepperoni Pizza`);
        else if (s.type === 'oven') {
          const oven = this.getOvenForStation(s);
          text = (oven && oven.pizza) ? (oven.pizza.baked ? 'Baking done!' : 'Baking...') : (this.pizza ? 'Press SPACE to bake' : 'No pizza');
        }
        else if (s.type === 'buyOven') text = `Press SPACE to buy Oven 2 ($${CONFIG.ovenCost})`;
        else if (s.type === 'display') text = this.displayPizzas.length > 0 ? `${this.displayPizzas.length} pizzas on display` : 'No pizzas on display';
        else if (s.type === 'hire') text = `Press H to hire chef ($${this.hireCost})`;
        if (text) { prompt.textContent = text; prompt.style.display = 'block'; }
        else prompt.style.display = 'none';
      } else {
        prompt.style.display = 'none';
      }
    } else if (this.nearCustomer && this.pizza && this.pizza.baked) {
      const v = VARIETIES[this.pizza.variety];
      const cv = VARIETIES[this.nearCustomer.variety];
      if (this.pizza.variety === this.nearCustomer.variety) {
        prompt.textContent = `Press SPACE to serve ${v.name} (+$${v.sellPrice})`;
      } else {
        prompt.textContent = `They want ${cv.name}, you have ${v.name}!`;
      }
      prompt.style.display = 'block';
    } else if (this.nearStation) {
      let text = '';
      const s = this.nearStation;
      if (s.type === 'buyDough') text = `Press SPACE to buy dough ($${INGREDIENTS.dough.price}) — have ${this.inventory.dough}`;
      else if (s.type === 'buyCheese') text = `Press SPACE to buy cheese ($${INGREDIENTS.cheese.price}) — have ${this.inventory.cheese}`;
      else if (s.type === 'buyPepperoni') text = `Press SPACE to buy pepperoni ($${INGREDIENTS.pepperoni.price}) — have ${this.inventory.pepperoni}`;
      else if (s.type === 'makeCheese') text = this.pizza ? 'Hands full!' : (!this.getAvailableOven() ? 'All ovens full!' : `Press SPACE to make Cheese Pizza (need 1 dough + 1 cheese)`);
      else if (s.type === 'makePepperoni') text = this.pizza ? 'Hands full!' : (!this.getAvailableOven() ? 'All ovens full!' : `Press SPACE to make Pepperoni Pizza (need 1 dough + 1 cheese + 1 pepperoni)`);
      else if (s.type === 'oven') {
        const oven = this.getOvenForStation(s);
        text = (oven && oven.pizza) ? (oven.pizza.baked ? 'Baking done!' : 'Baking...') : (this.pizza ? 'Press SPACE to bake' : 'No pizza');
      }
      else if (s.type === 'buyOven') text = `Press SPACE to buy Oven 2 ($${CONFIG.ovenCost})`;
      else if (s.type === 'display') text = this.displayPizzas.length > 0 ? `Press SPACE to grab pizza (${this.displayPizzas.length} on display)` : 'No pizzas on display';
      else if (s.type === 'hire') text = `Press H to hire chef ($${this.hireCost})`;
      prompt.textContent = text;
      prompt.style.display = 'block';
    } else {
      prompt.style.display = 'none';
    }

    // Update player mesh
    this.playerMesh.position.set(this.player.x, this.player.y, this.player.z);
    this.playerMesh.rotation.y = this.yaw;

    // Third-person camera
    const camDist = 6, camHeight = 4.5;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const camX = this.player.x + sin * camDist;
    const camZ = this.player.z + cos * camDist;
    const camY = this.player.y + camHeight;
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.player.x, this.player.y + 1, this.player.z);

    // Update station labels
    for (const s of this.stations) {
      const pos = new THREE.Vector3(s.x, s.h + 0.8, s.z);
      pos.project(this.camera);
      const sx = (pos.x + 1) / 2 * window.innerWidth;
      const sy = (-pos.y + 1) / 2 * window.innerHeight;
      if (pos.z < 1) {
        s.labelDiv.style.display = 'block';
        s.labelDiv.style.left = sx + 'px';
        s.labelDiv.style.top = sy + 'px';
        s.labelDiv.style.transform = 'translateX(-50%)';
      } else {
        s.labelDiv.style.display = 'none';
      }
    }

    // Update pizza status UI
    const stageEl = document.getElementById('pizza-stage');
    const toppingEl = document.getElementById('topping-list');
    if (this.pizza) {
      const v = VARIETIES[this.pizza.variety];
      stageEl.textContent = this.pizza.baked ? `${v.name} — serve to customer!` : `${v.name} — bake it!`;
      toppingEl.textContent = '';
    } else {
      // Show oven statuses
      const bakingOvens = this.ovens.filter(o => o.pizza);
      if (bakingOvens.length > 0) {
        const parts = bakingOvens.map((o, i) => {
          const ovenNum = this.ovens.indexOf(o) + 1;
          const progress = Math.min(1, o.timer / CONFIG.ovenBakeTime);
          return o.pizza.baked ? `Oven ${ovenNum}: Baked!` : `Oven ${ovenNum}: ${Math.floor(progress * 100)}%`;
        });
        stageEl.textContent = parts.join(' · ');
        toppingEl.textContent = bakingOvens.map(o => VARIETIES[o.pizza.variety].name).join(', ');
      } else {
        stageEl.textContent = `No pizza — buy ingredients and make one! (${this.displayPizzas.length} on display)`;
        toppingEl.textContent = '';
      }
    }

    // HUD
    document.getElementById('score').textContent = '$' + this.money;
    document.getElementById('orders-served').textContent = this.served;
    if (this.phase === 'shopping') {
      document.getElementById('time-left').textContent = `SHOPPING — ${Math.ceil(this.shoppingTimeLeft)}s to buy ingredients`;
    } else {
      const status = this.storeOpen ? 'OPEN' : 'CLOSED';
      document.getElementById('time-left').textContent = `Day ${this.day}/${CONFIG.totalDays} · ${Math.ceil(this.dayTimeLeft)}s · ${status}`;
    }
  }

  startShopping() {
    this.phase = 'shopping';
    this.shoppingTimeLeft = CONFIG.shoppingDuration;
    // Clear customers — store is closed
    for (const c of this.customers) this.scene.remove(c.customer);
    this.customers = [];
    this.orders = [];
    // Reset chef states
    for (const ch of this.hiredChefs) {
      ch.state = 'idle';
      ch.timer = 0;
      ch.targetOrder = null;
      ch.stuckTimer = 0;
      ch.buyTarget = null;
      ch.buyCooldown = 0;
      if (ch.reservedOven) { ch.reservedOven.chefReserved = false; ch.reservedOven = null; }
      if (ch.pizzaMesh) { ch.mesh.remove(ch.pizzaMesh); ch.pizzaMesh = null; }
    }
    this.updateOrderPanel();
    this.showMessage(`Store closed! Buy ingredients for next day.`, 'good');
  }

  startNextDay() {
    this.day++;
    this.dayTimeLeft = CONFIG.dayDuration;
    this.phase = 'open';
    this.showMessage(`Day ${this.day} starts!`, 'good');
    this.spawnCustomer();
    this.spawnCustomer();
  }

  endGame() {
    this.gameOver = true;
    this.running = false;
    document.getElementById('final-score').textContent = `$${this.money} total · ${this.served} pizzas served`;
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('hud').style.display = 'none';
    document.getElementById('order-panel').style.display = 'none';
    document.getElementById('pizza-status').style.display = 'none';
    document.getElementById('inventory-panel').style.display = 'none';
    document.getElementById('action-prompt').style.display = 'none';
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

new PizzaGame();

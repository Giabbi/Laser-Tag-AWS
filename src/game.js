import * as THREE from 'https://unpkg.com/three@0.150.0/build/three.module.js';

export default class Game {
  constructor(container, network) {
    this.network = network;
    this.players = {};
    this.projectiles = [];

    this.gridSize     = 135;
    this.spacing      = 0.2;
    this.cubeSize     = 1;
    this.eyeHeight    = this.cubeSize - 0.2;
    this.halfSize     = (this.gridSize * this.spacing) / 2;
    this.moveSpeed    = 5;
    this.lookSens     = 0.002;
    this.bulletSpeed  = 20;
    this.bulletLife   = 3.0;
    this.bulletRadius = 0.1;
    this.fireInterval = 0.5;
    this.lastShotTime = 0;

    this.serverPosition = new THREE.Vector3();
    this.isServerPositionAuthoritative = false;
    this.interpolationAlpha = 0.2;

    this.scene    = new THREE.Scene();
    this.camera   = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias:true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('click', () =>
      this.renderer.domElement.requestPointerLock()
    );

    this._setupHeadAndCamera();
    this._setupControls();
    this._setupLights();
    this._setupFloorAndWalls();
    this._setupRamps();          // ★ revamped
    this.clock = new THREE.Clock();
    this._animate();

    window.addEventListener('resize', this.onWindowResize.bind(this), false);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _setupHeadAndCamera() {
    this.head = new THREE.Object3D();
    this.head.position.set(0, this.eyeHeight, 0);
    this.serverPosition.copy(this.head.position);

    this.camera.position.set(0, 0, 0);
    this.head.add(this.camera);
    this.scene.add(this.head);
  }

  _setupControls() {
    this.yaw = 0;
    this.pitch = 0;

    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement === this.renderer.domElement) {
        this.yaw   -= e.movementX * this.lookSens;
        this.pitch -= e.movementY * this.lookSens;
        this.pitch  = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.pitch));
        this.head.rotation.y   = this.yaw;
        this.camera.rotation.x = this.pitch;
      }
    });

    this.localMovementInput = { forward:false, backward:false, left:false, right:false };
    document.addEventListener('keydown', e => {
      if (document.pointerLockElement !== this.renderer.domElement && e.code !== 'Escape') return;
      if (e.code === 'KeyW') this.localMovementInput.forward = true;
      else if (e.code === 'KeyS') this.localMovementInput.backward = true;
      else if (e.code === 'KeyA') this.localMovementInput.left = true;
      else if (e.code === 'KeyD') this.localMovementInput.right = true;
      else if (e.code === 'Space') this._tryShoot();
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'KeyW') this.localMovementInput.forward = false;
      else if (e.code === 'KeyS') this.localMovementInput.backward = false;
      else if (e.code === 'KeyA') this.localMovementInput.left = false;
      else if (e.code === 'KeyD') this.localMovementInput.right = false;
    });
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x606060));
    this.scene.add(new THREE.HemisphereLight(0x888877, 0x777788, 0.8));
    const headLight = new THREE.PointLight(0xffffff, 0.7, 50);
    this.camera.add(headLight);
  }

  _setupFloorAndWalls() {
    const loader = new THREE.TextureLoader();
    const tex = loader.load('https://threejs.org/examples/textures/checker.png', t=>{
      t.wrapS=t.wrapT=THREE.RepeatWrapping;
      t.repeat.set(this.gridSize, this.gridSize);
    });
    const floorMat = new THREE.MeshStandardMaterial({ map: tex, roughness:0.8, metalness:0.2 });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.gridSize*this.spacing, this.gridSize*this.spacing),
      floorMat
    );
    floor.rotation.x = -Math.PI/2;
    this.scene.add(floor);

    const wallMat  = new THREE.MeshStandardMaterial({ color:0x333333, roughness:0.9 });
    const wallHeight = 3;
    const wx = new THREE.BoxGeometry(this.gridSize*this.spacing + 0.4, wallHeight, 0.2);
    const wz = new THREE.BoxGeometry(0.2, wallHeight, this.gridSize*this.spacing + 0.4);
    for (let dir of [-1,1]) {
      const n = new THREE.Mesh(wx, wallMat);
      n.position.set(0, wallHeight/2, dir*(this.halfSize + 0.1));
      this.scene.add(n);
      const e = new THREE.Mesh(wz, wallMat);
      e.position.set(dir*(this.halfSize + 0.1), wallHeight/2, 0);
      this.scene.add(e);
    }
  }

  /* ------------------------------------------------------ *
   *  Ramps – now distributed based on % of gridSize
   * ------------------------------------------------------ */
  _setupRamps() {
    this.obstacles = [];
    const rampGeo = new THREE.ConeGeometry(2, 2, 4);
    const rampMat = new THREE.MeshStandardMaterial({ color:0x555555, roughness:0.7, metalness:0.3 });

    // Fractions along the grid (0‑1 range)
    const frac = [0.2, 0.5, 0.8];
    const positions = [];
    frac.forEach(fx => frac.forEach(fz => positions.push([
      Math.round(fx * (this.gridSize-1)),
      Math.round(fz * (this.gridSize-1))
    ])));

    for (let [gx,gy] of positions) {
      const ramp = new THREE.Mesh(rampGeo, rampMat);
      ramp.position.set(
        (gx - this.gridSize/2 + 0.5) * this.spacing,
        1,
        (gy - this.gridSize/2 + 0.5) * this.spacing
      );
      ramp.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(ramp);
      this.obstacles.push({
        mesh: ramp,
        type: 'cone',
        halfBase: rampGeo.parameters.radius,
        height: rampGeo.parameters.height
      });
    }
  }

  /* Helper used for remote‑player Y as well */
  _calculateBaseY(wx, wz) {
    let base = 0;
    for (const obs of this.obstacles) {
      if (obs.type !== 'cone') continue;
      const dx = wx - obs.mesh.position.x;
      const dz = wz - obs.mesh.position.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < obs.halfBase) {
        const h = obs.height * (1 - dist / obs.halfBase);
        if (h > base) base = h;
      }
    }
    return base;
  }

  _animate() {
    requestAnimationFrame(()=>this._animate());
    const dt = this.clock.getDelta();
    this._updateLocalPlayerMovement(dt);
    this._updateProjectiles(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _updateLocalPlayerMovement(dt) {
    const s = this.moveSpeed * dt;
    if (this.localMovementInput.forward)  this.head.translateZ(-s);
    if (this.localMovementInput.backward) this.head.translateZ( s);
    if (this.localMovementInput.left)     this.head.translateX(-s);
    if (this.localMovementInput.right)    this.head.translateX( s);

    const margin = this.cubeSize / 2;
    this.head.position.x = Math.max(-this.halfSize + margin, Math.min(this.halfSize - margin, this.head.position.x));
    this.head.position.z = Math.max(-this.halfSize + margin, Math.min(this.halfSize - margin, this.head.position.z));

    const targetY = this._calculateBaseY(this.head.position.x, this.head.position.z) + this.eyeHeight;
    this.head.position.y += (targetY - this.head.position.y) * 0.2;
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length-1; i>=0; i--) {
      const p = this.projectiles[i];
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.life -= dt;
      const offWorld =
        Math.abs(p.mesh.position.x) > this.halfSize + 5 ||
        Math.abs(p.mesh.position.z) > this.halfSize + 5 ||
        p.mesh.position.y < -1 || p.mesh.position.y > 10;
      if (p.life <= 0 || offWorld) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i,1);
      }
    }
  }

  /* -------------------------- *
   *  Server snapshot handling
   * -------------------------- */
  setState(players) {
    for (const n in this.players) this._removePlayer(n);
    this.players = {};
    players.forEach(p => {
      if (p.name === this.network.name) {
        const wx = (p.x - this.gridSize/2 + 0.5) * this.spacing;
        const wz = (p.y - this.gridSize/2 + 0.5) * this.spacing;
        const wy = (p.baseY ?? this._calculateBaseY(wx,wz)) + this.eyeHeight;
        this.head.position.set(wx, wy, wz);
        this.serverPosition.set(wx, wy, wz);
      } else {
        this._spawnPlayer(p.name, p.x, p.y, p.baseY);
      }
    });
  }

  onPlayerMoved(name, x, y, localName, baseYFromServer) {
    const gridX = (name !== localName && (x==null)) ? this.players[name]?.userData.gridX ?? 0 : x;
    const gridY = (name !== localName && (y==null)) ? this.players[name]?.userData.gridY ?? 0 : y;

    const wx = (gridX - this.gridSize/2 + 0.5) * this.spacing;
    const wz = (gridY - this.gridSize/2 + 0.5) * this.spacing;
    const baseY = baseYFromServer ?? this._calculateBaseY(wx, wz);

    if (name === localName) {
      this.serverPosition.set(wx, baseY + this.eyeHeight, wz);
    } else {
      if (!this.players[name]) {
        this._spawnPlayer(name, gridX, gridY, baseY);
      } else {
        const mesh = this.players[name];
        mesh.position.set(wx, baseY + this.cubeSize/2, wz);
        mesh.userData.gridX = gridX;
        mesh.userData.gridY = gridY;
      }
    }
  }

  _spawnPlayer(name, gridX=0, gridY=0, baseY) {
    const wx = (gridX - this.gridSize/2 + 0.5) * this.spacing;
    const wz = (gridY - this.gridSize/2 + 0.5) * this.spacing;
    const by = baseY ?? this._calculateBaseY(wx, wz);

    if (name === this.network.name && this.head) return;
    if (this.players[name]) {
      this.players[name].position.set(wx, by + this.cubeSize/2, wz);
      return;
    }

    const geom = new THREE.BoxGeometry(this.cubeSize, this.cubeSize, this.cubeSize);
    const mat  = new THREE.MeshLambertMaterial({ color: Math.random()*0xffffff });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(wx, by + this.cubeSize/2, wz);
    mesh.userData.gridX = gridX;
    mesh.userData.gridY = gridY;
    this.scene.add(mesh);
    this.players[name] = mesh;
  }

  _removePlayer(name) {
    if (this.players[name]) {
      this.scene.remove(this.players[name]);
      this.players[name].geometry.dispose();
      this.players[name].material.dispose();
      delete this.players[name];
    }
  }

  _tryShoot() {
    const now = this.clock.getElapsedTime();
    if (now - this.lastShotTime < this.fireInterval) return;
    this.lastShotTime = now;

    const visualOriginVec = new THREE.Vector3(); // This is where the bullet visually originates
    this.camera.getWorldPosition(visualOriginVec);

    const dirVec = new THREE.Vector3();
    this.camera.getWorldDirection(dirVec); // Direction camera is looking

    const bulletGeo = new THREE.SphereGeometry(this.bulletRadius, 6, 6);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);

    // *** THIS WAS THE FIX: Use visualOriginVec, not undefined originVec ***
    bulletMesh.position.copy(visualOriginVec);

    this.scene.add(bulletMesh);
    this.projectiles.push({
      mesh:     bulletMesh,
      velocity: dirVec.clone().multiplyScalar(this.bulletSpeed),
      life:     this.bulletLife,
      shooterName: this.network.name // 'this.network' should be valid if game is initialized
    });

    // Send the visual origin and direction to the server.
    // The server will use its authoritative position for the player 'name' for the raycast.
    this.network.shoot(
      { x: visualOriginVec.x, y: visualOriginVec.y, z: visualOriginVec.z },
      { x: dirVec.x,    y: dirVec.y,    z: dirVec.z    }
    );
  }

  // New method to handle shoot effects from server message
  handleShootEffect(shooterName, hitInfo, origin, direction) {
    console.log("Shoot effect:", shooterName, hitInfo);

    /* ---------- visual bullet for *remote* shooters ---------- */
    if (shooterName !== this.network.name && origin && direction) {
      const bulletGeo = new THREE.SphereGeometry(this.bulletRadius, 6, 6);
      const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
      const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
      bulletMesh.position.set(origin.x, origin.y, origin.z);
      this.scene.add(bulletMesh);
      this.projectiles.push({
        mesh: bulletMesh,
        velocity: new THREE.Vector3(direction.x, direction.y, direction.z)
                    .multiplyScalar(this.bulletSpeed),
        life: this.bulletLife,
        shooterName
      });
    }

    /* ---------- simple hit feedback (flash red) -------------- */
    if (hitInfo) {
      const victim = this.players[hitInfo.name];
      if (victim) {
        const original = victim.material.color.getHex();
        victim.material.color.setHex(0xff0000);
        setTimeout(() => {
          if (victim) victim.material.color.setHex(original);
        }, 200);
      } else if (hitInfo.name === this.network.name) {
        // TODO: screen flash for self‑hit
        console.log("I was hit!");
      }
    }
  }

  dispose() {
    // Clean up Three.js resources, event listeners etc.
    // This is important if you re-initialize the game (e.g. after logout)
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    // Dispose geometries, materials, textures
    // Remove all children from scene
    while(this.scene.children.length > 0){
        const object = this.scene.children[0];
        if(object.geometry) object.geometry.dispose();
        if(object.material){
            if(Array.isArray(object.material)){
                object.material.forEach(material => material.dispose());
            } else {
                object.material.dispose();
            }
        }
        this.scene.remove(object);
    }
    if (this.renderer) {
        this.renderer.dispose();
    }
    // Any other cleanup
  }
}
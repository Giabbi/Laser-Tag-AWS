import * as THREE from 'https://unpkg.com/three@0.150.0/build/three.module.js';

export default class Game {
  constructor(container, network) {
    this.network = network;
    this.players = {};
    this.projectiles = [];

    // constants 
    this.gridSize     = 15;
    this.spacing      = 1.8;
    this.cubeSize     = 1;
    this.eyeHeight    = this.cubeSize - 0.2;
    this.halfSize     = (this.gridSize * this.spacing) / 2;
    this.moveSpeed    = 5;
    this.lookSens     = 0.002;
    this.bulletSpeed  = 20;
    this.bulletLife   = 3.0;
    this.bulletRadius = 0.2;
    this.fireInterval = 1.0;
    this.lastShotTime = 0;


    // Three.js init
    this.scene    = new THREE.Scene();
    this.camera   = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias:true });
    this.renderer.setSize(innerWidth, innerHeight);
    container.appendChild(this.renderer.domElement);

    // lock pointer
    this.renderer.domElement.addEventListener('click', () =>
      this.renderer.domElement.requestPointerLock()
    );

    this._setupControls();
    this._setupLights();
    this._setupFloorAndWalls();
    this._setupRamps();

    this.clock = new THREE.Clock();
    this._animate();
  }

  _setupControls() {
    // head for camera + look
    this.head = new THREE.Object3D();
    this.head.position.set(0, this.eyeHeight, 0);
    this.head.add(this.camera);
    this.scene.add(this.head);

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

    // WASD + Space
    this.keys = { w:false, s:false, a:false, d:false };
    document.addEventListener('keydown', e => {
      if      (e.code==='KeyW') this.keys.w = true;
      else if (e.code==='KeyS') this.keys.s = true;
      else if (e.code==='KeyA') this.keys.a = true;
      else if (e.code==='KeyD') this.keys.d = true;
      else if (e.code==='Space') this._tryShoot();
    });
    document.addEventListener('keyup', e => {
      if      (e.code==='KeyW') this.keys.w = false;
      else if (e.code==='KeyS') this.keys.s = false;
      else if (e.code==='KeyA') this.keys.a = false;
      else if (e.code==='KeyD') this.keys.d = false;
    });
    this.lastShotTime = 0;
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x404040, 1.5));
    this.scene.add(new THREE.HemisphereLight(0xeeeeff, 0x444422, 0.6));
    const headLight = new THREE.PointLight(0xffffff, 0.8);
    this.camera.add(headLight);
  }

  _setupFloorAndWalls() {
    // floor
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

    // walls
    const wallMat  = new THREE.MeshStandardMaterial({ color:0x222222, roughness:0.9 });
    const wx = new THREE.BoxGeometry(this.gridSize*this.spacing + 0.4, 2, 0.2);
    const wz = new THREE.BoxGeometry(0.2, 2, this.gridSize*this.spacing + 0.4);
    for (let dir of [-1,1]) {
      const n = new THREE.Mesh(wx, wallMat);
      n.position.set(0,1, dir*(this.halfSize + 0.1));
      this.scene.add(n);
      const e = new THREE.Mesh(wz, wallMat);
      e.position.set(dir*(this.halfSize + 0.1),1, 0);
      this.scene.add(e);
    }
  }

  _setupRamps() {
    this.obstacles = [];
    const rampGeo = new THREE.ConeGeometry(2,2,4);
    const rampMat = new THREE.MeshStandardMaterial({ color:0x555555, roughness:0.7 });
    const positions = [
      [2,2],[4,8],[8,2],[12,12],[7,7],
      [3,12],[10,4],[5,14],[14,5],[11,9]
    ];
    for (let [gx,gy] of positions) {
      const ramp = new THREE.Mesh(rampGeo, rampMat);
      ramp.position.set(
        (gx - this.gridSize/2)*this.spacing,
        1,
        (gy - this.gridSize/2)*this.spacing
      );
      ramp.rotation.y = Math.PI/4;
      this.scene.add(ramp);
      this.obstacles.push({
        mesh: ramp,
        halfBase: 2,
        height:   2,
        invRot:   -Math.PI/4
      });
    }
  }

  _animate() {
    requestAnimationFrame(()=>this._animate());
    const dt = this.clock.getDelta();
    this._updateMovement(dt);
    this._updateProjectiles(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _updateMovement(dt) {
    const d = this.moveSpeed * dt;
    if (this.keys.w) this.head.translateZ(-d);
    if (this.keys.s) this.head.translateZ( d);
    if (this.keys.a) this.head.translateX(-d);
    if (this.keys.d) this.head.translateX( d);

    // clamp inside walls
    const m = this.cubeSize/2;
    this.head.position.x = Math.max(-this.halfSize+m, Math.min(this.halfSize-m, this.head.position.x));
    this.head.position.z = Math.max(-this.halfSize+m, Math.min(this.halfSize-m, this.head.position.z));

    // ramp‐climb
    let baseY = 0;
    for (let obs of this.obstacles) {
      // world→local
      const dx = this.head.position.x - obs.mesh.position.x;
      const dz = this.head.position.z - obs.mesh.position.z;
      const c  = Math.cos(obs.invRot), s = Math.sin(obs.invRot);
      const lx = dx*c - dz*s, lz = dx*s + dz*c;
      if (Math.abs(lx)<=obs.halfBase && Math.abs(lz)<=obs.halfBase) {
        const m = Math.max(Math.abs(lx), Math.abs(lz));
        const y = obs.height*(1 - m/obs.halfBase);
        baseY = Math.max(baseY, y);
      }
    }
    this.head.position.y = baseY + this.eyeHeight;
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length-1; i>=0; i--) {
      const p = this.projectiles[i];
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.life -= dt;

      let dead = p.life<=0 || p.mesh.position.y <= this.bulletRadius;
      // player hits
      if (!dead) {
        for (let nm in this.players) {
          const box = new THREE.Box3().setFromObject(this.players[nm]);
          if (box.containsPoint(p.mesh.position)) { dead=true; break; }
        }
      }
      // ramp hits
      if (!dead) {
        for (let obs of this.obstacles) {
          const pos = p.mesh.position;
          const dx = pos.x - obs.mesh.position.x;
          const dz = pos.z - obs.mesh.position.z;
          const c  = Math.cos(obs.invRot), s=Math.sin(obs.invRot);
          const lx = dx*c - dz*s, lz = dx*s + dz*c;
          if (Math.abs(lx)<=obs.halfBase && Math.abs(lz)<=obs.halfBase) {
            const m = Math.max(Math.abs(lx), Math.abs(lz));
            const y = obs.height*(1 - m/obs.halfBase);
            if (pos.y <= y + this.bulletRadius) { dead=true; break; }
          }
        }
      }

      if (dead) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i,1);
      }
    }
  }

  // called by network events:
  setState(players) {
    players.forEach(p=>{
      if (!this.players[p.name]) {
        this._spawnPlayer(p.name, p.x, p.y);
      } else {
        this._movePlayer(p.name, p.x, p.y);
      }
    });
  }

  onPlayerMoved(name,x,y) {
    if (!this.players[name]) this._spawnPlayer(name,x,y);
    else                    this._movePlayer(name,x,y);
  }

  _spawnPlayer(name, x, y) {
    const worldX = (x - this.gridSize/2) * this.spacing;
    const worldZ = (y - this.gridSize/2) * this.spacing;
  
    if (name === this.network.name) {
      // Position the camera at your start‐cell
      this.head.position.set(worldX, this.eyeHeight, worldZ);
      return;
    }
  
    // Otherwise spawn everyone else as a cube
    const geom = new THREE.BoxGeometry(this.cubeSize, this.cubeSize, this.cubeSize);
    const mat  = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(worldX, this.cubeSize/2, worldZ);
    this.scene.add(mesh);
    this.players[name] = mesh;
  }
  
  _movePlayer(name, x, y) {
    const worldX = (x - this.gridSize/2) * this.spacing;
    const worldZ = (y - this.gridSize/2) * this.spacing;
  
    if (name === this.network.name) {
      // Move the camera when **you** move
      this.head.position.set(worldX, this.eyeHeight, worldZ);
    } else {
      // Slide everyone else's cube
      const mesh = this.players[name];
      if (mesh) mesh.position.set(worldX, this.cubeSize/2, worldZ);
    }
  }
  

  /** 
   * Attempt a shot if cooldown has elapsed: 
   * 1) spawn local projectile 
   * 2) send 3D ray to server 
   */
  _tryShoot() {
    const now = this.clock.getElapsedTime();
    if (now - this.lastShotTime < this.fireInterval) return;
    this.lastShotTime = now;

    // --- 1) local prediction (optional) ---
    const bulletGeo = new THREE.SphereGeometry(this.bulletRadius, 8, 8);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const bullet    = new THREE.Mesh(bulletGeo, bulletMat);

    // start at camera world pos
    const originVec = new THREE.Vector3();
    this.camera.getWorldPosition(originVec);
    bullet.position.copy(originVec);

    // compute forward dir
    const dirVec = new THREE.Vector3();
    this.camera.getWorldDirection(dirVec).normalize();

    this.scene.add(bullet);
    this.projectiles.push({
      mesh:     bullet,
      velocity: dirVec.clone().multiplyScalar(this.bulletSpeed),
      life:     this.bulletLife
    });

    // --- 2) server‐side authoritative shot ---
    this.network.shoot(
      { x: originVec.x, y: originVec.y, z: originVec.z },
      { x: dirVec.x,    y: dirVec.y,    z: dirVec.z    }
    );
  }
}

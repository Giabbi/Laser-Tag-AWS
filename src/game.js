import * as THREE from 'https://unpkg.com/three@0.150.0/build/three.module.js';

export default class Game {
  constructor(container, network) {
    this.network = network;
    this.players = {};
    this.projectiles = [];

    this.gridSize     = 135;
    this.spacing      = 0.2;
    this.cubeSize     = 1;
    this.eyeHeight    = this.cubeSize - 0.2; // Player's eye height from their base
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
    this.interpolationAlpha = 0.2; // Smoother: 0.1-0.2, Snappier: 0.3-0.5

    this.scene    = new THREE.Scene();
    this.camera   = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias:true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('click', () =>
      this.renderer.domElement.requestPointerLock()
    );

    this._setupHeadAndCamera(); // Combined setup for clarity
    this._setupControls();      // Event listeners for input
    this._setupLights();
    this._setupFloorAndWalls();
    this._setupRamps();         // Ensure this is called

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
    // 'head' is the main player object that moves and yaws (turns left/right)
    this.head = new THREE.Object3D();
    this.head.position.set(0, this.eyeHeight, 0); // Initial position on the ground
    this.serverPosition.copy(this.head.position);

    // Camera is a child of the head. It handles pitch (looking up/down).
    this.camera.position.set(0, 0, 0); // Camera is at the head's origin
    this.head.add(this.camera);
    this.scene.add(this.head);
  }

  _setupControls() {
    this.yaw = 0;   // Left-right rotation of the head
    this.pitch = 0; // Up-down rotation of the camera

    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement === this.renderer.domElement) {
        this.yaw   -= e.movementX * this.lookSens;
        this.pitch -= e.movementY * this.lookSens;
        this.pitch  = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.pitch)); // Clamp pitch

        this.head.rotation.y   = this.yaw;   // Apply yaw to the head
        this.camera.rotation.x = this.pitch; // Apply pitch to the camera
      }
    });

    this.localMovementInput = { forward:false, backward:false, left:false, right:false };
    document.addEventListener('keydown', e => {
        if (document.pointerLockElement !== this.renderer.domElement && e.code !== 'Escape') return;
        // Map WASD to intuitive local movement directions
        if (e.code === 'KeyW') this.localMovementInput.forward = true;
        else if (e.code === 'KeyS') this.localMovementInput.backward = true;
        else if (e.code === 'KeyA') this.localMovementInput.left = true;
        else if (e.code === 'KeyD') this.localMovementInput.right = true;
        else if (e.code === 'Space') this._tryShoot();
    });
     document.addEventListener('keyup', e => { // Corrected keyup
        if (e.code === 'KeyW') this.localMovementInput.forward = false;
        else if (e.code === 'KeyS') this.localMovementInput.backward = false;
        else if (e.code === 'KeyA') this.localMovementInput.left = false;
        else if (e.code === 'KeyD') this.localMovementInput.right = false; // Corrected this.localMovementInput.d to this.localMovementInput.right
    });
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x606060));
    this.scene.add(new THREE.HemisphereLight(0x888877, 0x777788, 0.8));
    const headLight = new THREE.PointLight(0xffffff, 0.7, 50);
    this.camera.add(headLight); // Light moves with the camera/head
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
    const wallHeight = 3; // Define wall height
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

  _setupRamps() {
    this.obstacles = []; // Initialize obstacles array
    const rampGeo = new THREE.ConeGeometry(2, 2, 4); // baseRadius, height, radialSegments
    const rampMat = new THREE.MeshStandardMaterial({ color:0x555555, roughness:0.7, metalness:0.3 });
    const positions = [ // gridX, gridY coordinates for ramp centers
      [2,2],[4,8],[8,2],[12,12],[7,7],
      [3,12],[10,4],[5,14],[14,5],[11,9]
    ];
    for (let [gx,gy] of positions) {
      const ramp = new THREE.Mesh(rampGeo, rampMat);
      // Convert grid coordinates to world coordinates
      // Assuming (0,0) grid is center of world for simplicity, adjust if needed
      ramp.position.set(
        (gx - this.gridSize/2 + 0.5) * this.spacing, // Center ramp in grid cell
        1, // Base of the cone (height/2) touches ground
        (gy - this.gridSize/2 + 0.5) * this.spacing
      );
      ramp.rotation.y = Math.random() * Math.PI * 2; // Random orientation
      this.scene.add(ramp);
      this.obstacles.push({ // Store data needed for collision/climbing
        mesh: ramp,
        type: 'cone', // You can add types if you have different obstacle shapes
        halfBase: rampGeo.parameters.radius, // Cone radius
        height: rampGeo.parameters.height,
        // For cones, exact invRot might not be as useful as for square ramps
        // You'd typically use distance to center and height calculation
      });
    }
  }


  _animate() {
    requestAnimationFrame(()=>this._animate());
    const dt = this.clock.getDelta();

    this._updateLocalPlayerMovement(dt);
    this._updateProjectiles(dt);

    this.renderer.render(this.scene, this.camera);
  }

  _updateLocalPlayerMovement(dt) {
    const currentMoveSpeed = this.moveSpeed * dt;

    // LOCAL PREDICTION: Movement is relative to the 'head' object's orientation.
    // This is now the *sole* driver for this.head.position.
    if (this.localMovementInput.forward) this.head.translateZ(-currentMoveSpeed);
    if (this.localMovementInput.backward) this.head.translateZ(currentMoveSpeed);
    if (this.localMovementInput.left) this.head.translateX(-currentMoveSpeed);
    if (this.localMovementInput.right) this.head.translateX(currentMoveSpeed);

    // Wall clamping - based on local predicted position
    const margin = this.cubeSize / 2;
    this.head.position.x = Math.max(-this.halfSize + margin, Math.min(this.halfSize - margin, this.head.position.x));
    this.head.position.z = Math.max(-this.halfSize + margin, Math.min(this.halfSize - margin, this.head.position.z));

    // Ramp/Obstacle climbing logic - based on local predicted position
    let calculatedBaseY = 0;
    for (let obs of this.obstacles) {
        if (obs.type === 'cone') {
            const dx = this.head.position.x - obs.mesh.position.x;
            const dz = this.head.position.z - obs.mesh.position.z;
            const distanceToConeCenter = Math.sqrt(dx*dx + dz*dz);

            if (distanceToConeCenter < obs.halfBase) {
                const heightOnCone = obs.height * (1 - (distanceToConeCenter / obs.halfBase));
                if (heightOnCone > calculatedBaseY) {
                    calculatedBaseY = heightOnCone;
                }
            }
        }
    }
    const targetYPosition = calculatedBaseY + this.eyeHeight;
    // Smoothly adjust local Y position.
    this.head.position.y += (targetYPosition - this.head.position.y) * 0.2; // Increased alpha for Y responsiveness

    // SERVER POSITION RECONCILIATION (LERPING) IS NOW REMOVED FOR THE LOCAL PLAYER
    // The 'this.serverPosition' is updated by onPlayerMoved for our own player,
    // but it's NOT used here to visually correct 'this.head.position'.
    // 'this.isServerPositionAuthoritative' is effectively ignored for self-movement visuals.
  }

  _updateProjectiles(dt) { // Mostly as before
    for (let i = this.projectiles.length-1; i>=0; i--) {
      const p = this.projectiles[i];
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.life -= dt;
      let dead = p.life <= 0;
      if (!dead && (Math.abs(p.mesh.position.x) > this.halfSize + 5 || Math.abs(p.mesh.position.z) > this.halfSize + 5 || p.mesh.position.y < -1 || p.mesh.position.y > 10)) {
          dead = true;
      }
      if (dead) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i,1);
      }
    }
  }

  setState(players) {
    console.log("GAME: setState called with players:", JSON.parse(JSON.stringify(players))); // Deep copy for logging
    for (const name in this.players) this._removePlayer(name);
    this.players = {};
    players.forEach(p => {
      if (p.name === this.network.name) {
        const worldX = (p.x - this.gridSize/2 + 0.5) * this.spacing;
        const worldZ = (p.y - this.gridSize/2 + 0.5) * this.spacing;
        // Server also sends Y, which might be just the base grid Y or calculated
        const worldY = p.baseY !== undefined ? p.baseY + this.eyeHeight : this.eyeHeight; // Assume server sends grid Y
        this.head.position.set(worldX, worldY, worldZ);
        this.serverPosition.set(worldX, worldY, worldZ);
        this.isServerPositionAuthoritative = true;
      } else {
        console.log(`GAME: setState spawning other player: <span class="math-inline">\{p\.name\} at grid \(x\:</span>{p.x}, y:${p.y}), baseY: ${p.baseY}`);
        this._spawnPlayer(p.name, p.x, p.y, p.baseY); // Pass baseY if available
      }
    });
  }

  onPlayerMoved(name, x, y, localPlayerName, baseYFromServer) {
    // Default incoming grid coordinates if undefined for other players
    // For localPlayerName, we assume x and y will always be valid from server logic.
    const currentGridX = (name !== localPlayerName && (x === undefined || x === null)) ? 
                         (this.players[name]?.userData?.gridX || 0) : // Use stored or 0 if missing
                         x;
    const currentGridY = (name !== localPlayerName && (y === undefined || y === null)) ?
                         (this.players[name]?.userData?.gridY || 0) : // Use stored or 0 if missing
                         y;
  
    const worldX = (currentGridX - this.gridSize / 2 + 0.5) * this.spacing;
    const worldZ = (currentGridY - this.gridSize / 2 + 0.5) * this.spacing;
  
    const serverCalculatedHeadY = baseYFromServer !== undefined ? baseYFromServer + this.eyeHeight : this.eyeHeight;
  
    if (name === localPlayerName) {
      this.serverPosition.set(worldX, serverCalculatedHeadY, worldZ);
    } else {
      if (!this.players[name]) {
        console.log(`GAME: Spawning new other player <span class="math-inline">\{name\} via onPlayerMoved with grid \(x\:</span>{currentGridX}, y:${currentGridY})`);
        this._spawnPlayer(name, currentGridX, currentGridY, baseYFromServer);
      } else {
        const otherPlayerMeshY = baseYFromServer !== undefined ? baseYFromServer + this.cubeSize / 2 : this.cubeSize / 2;
        console.log(`GAME: Updating existing other player <span class="math-inline">\{name\} to world \(x\:</span>{worldX.toFixed(2)}, y:<span class="math-inline">\{otherPlayerMeshY\.toFixed\(2\)\}, z\:</span>{worldZ.toFixed(2)}) [from grid x:<span class="math-inline">\{currentGridX\}, y\:</span>{currentGridY}]`);
        this.players[name].position.set(worldX, otherPlayerMeshY, worldZ);
        // Update stored grid coordinates
        this.players[name].userData.gridX = currentGridX;
        this.players[name].userData.gridY = currentGridY;
      }
    }
  }

  _spawnPlayer(name, gridX, gridY, baseY) {
    // Provide default grid coordinates if undefined
    const currentGridX = (gridX === undefined || gridX === null) ? 0 : gridX;
    const currentGridY = (gridY === undefined || gridY === null) ? 0 : gridY;
  
    const worldX = (currentGridX - this.gridSize/2 + 0.5) * this.spacing;
    const worldZ = (currentGridY - this.gridSize/2 + 0.5) * this.spacing;
    const playerYPos = baseY !== undefined ? baseY + this.cubeSize/2 : this.cubeSize/2;
  
    console.log(`GAME: _spawnPlayer for <span class="math-inline">\{name\} using grid \(x\:</span>{currentGridX}, y:<span class="math-inline">\{currentGridY\}\) \-\> world \(x\:</span>{worldX.toFixed(2)}, y:<span class="math-inline">\{playerYPos\.toFixed\(2\)\}, z\:</span>{worldZ.toFixed(2)})`);
  
  
    if (name === this.network.name && this.head) return;
    if (this.players[name]) {
      console.warn(`GAME: _spawnPlayer called for already existing player: ${name}. Updating position instead.`);
      this.players[name].position.set(worldX, playerYPos, worldZ); // Update position if somehow called again
      return;
    }
  
    const geom = new THREE.BoxGeometry(this.cubeSize, this.cubeSize, this.cubeSize);
    const mat  = new THREE.MeshLambertMaterial({ color: Math.random() * 0xffffff });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(worldX, playerYPos, worldZ);
  
    // Store grid coordinates on the mesh's userData for potential future reference
    mesh.userData.gridX = currentGridX;
    mesh.userData.gridY = currentGridY;
  
    this.scene.add(mesh);
    this.players[name] = mesh;
  }
  _removePlayer(name) { // As before
    if (this.players[name]) {
      this.scene.remove(this.players[name]);
      if (this.players[name].geometry) this.players[name].geometry.dispose();
      if (this.players[name].material) this.players[name].material.dispose();
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
  handleShootEffect(shooterName, hitInfo, /*_origin, _direction*/) {
      // _origin and _direction from server can be used to draw the actual laser path
      console.log("Shoot effect from server:", shooterName, "hit:", hitInfo);


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
      
      if (hitInfo) {
          console.log(`${shooterName} hit ${hitInfo.name}!`);
          // Maybe make the hit player flash red or something
          if (this.players[hitInfo.name]) {
              // Simple flash effect
              const originalColor = this.players[hitInfo.name].material.color.getHex();
              this.players[hitInfo.name].material.color.setHex(0xff0000);
              setTimeout(() => {
                  if (this.players[hitInfo.name]) { // Check if player still exists
                      this.players[hitInfo.name].material.color.setHex(originalColor);
                  }
              }, 200);
          } else if (hitInfo.name === this.network.name) { // If I was hit
              // TODO: Indicate self was hit (e.g. screen flash red)
              console.log("I was hit!");
          }

      } else {
          console.log(`${shooterName} missed.`);
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
// src/app.js
import Network from './network.js';
import Game    from './game.js';

async function main() {
  const loginOverlay = document.getElementById('loginOverlay');
  const btn          = document.getElementById('loginButton');
  const input        = document.getElementById('playerNameInput');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const resumeButton = document.getElementById('resumeButton');
  const logoutButton = document.getElementById('logoutButton');

  let network = null;
  let game    = null;
  let movementState = {
    up: false,
    down: false,
    left: false,
    right: false
  };
  let movementIntervalId = null;
  const MOVEMENT_SEND_INTERVAL = 100; // ms - send movement update every 100ms (10 times/sec)

  const dirMap = {
    KeyW: 'up',
    KeyS: 'down',
    KeyA: 'left',
    KeyD: 'right',
    ArrowUp:    'up',
    ArrowDown:  'down',
    ArrowLeft:  'left',
    ArrowRight: 'right'
  };

  function sendMovement() {
    if (!network || !game) return;

    // Determine the dominant direction or a combination if needed
    // For simplicity here, we'll send the first active direction.
    // You could enhance this to send multiple directions or a vector.
    let directionToSend = null;
    if (movementState.up) directionToSend = 'up';
    else if (movementState.down) directionToSend = 'down';
    else if (movementState.left) directionToSend = 'left';
    else if (movementState.right) directionToSend = 'right';

    if (directionToSend) {
      network.move(directionToSend);
    }
  }

  btn.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) return;
    loginOverlay.style.display = 'none';

    network = new Network(name, handleServerMessage);
    game    = new Game(document.body, network); // Pass network to Game

    // Stop previous interval if any (e.g., re-login)
    if (movementIntervalId) clearInterval(movementIntervalId);
    movementIntervalId = setInterval(sendMovement, MOVEMENT_SEND_INTERVAL);

    document.addEventListener('keydown', e => {
      const dir = dirMap[e.code];
      if (dir) {
        movementState[dir] = true;
        // Optional: if you want immediate feedback on the *first* press
        // sendMovement(); // but interval will handle subsequent ones
      }
    });

    document.addEventListener('keyup', e => {
      const dir = dirMap[e.code];
      if (dir) {
        movementState[dir] = false;
      }
    });

    game.renderer.domElement.addEventListener('click', () =>
      game.renderer.domElement.requestPointerLock()
    );
  });

  function handleServerMessage(msg) {
    if (!game) return;
    switch (msg.action) {
      case 'gameState':
        game.setState(msg.players);
        break;
      case 'playerMoved':
        // Pass your local player's name to onPlayerMoved
        game.onPlayerMoved(msg.name, msg.x, msg.y, network.name);
        break;
      case 'shootResult':
        // Assuming 'msg.result' was a typo and it's 'msg.message' or similar
        console.log(msg.message || msg.error || msg);
        // If you have a laser visualization for hits/misses, trigger it here
        if (game && msg.shooter) { // Check if game object and shooter exist
            game.handleShootEffect(msg.shooter, msg.hit, msg.origin, msg.direction);
        }
        break;
      case 'playerJoined':
        game._spawnPlayer(msg.player.name, msg.player.x, msg.player.y);
        break;
      case 'playerLeft':
        game._removePlayer(msg.name);
        break;
    }
  }

  document.addEventListener('pointerlockchange', () => {
    if (!game) return;
    if (document.pointerLockElement !== game.renderer.domElement) {
      pauseOverlay.style.display = 'flex';
      // Clear movement state when paused to prevent sending commands
      Object.keys(movementState).forEach(k => movementState[k] = false);
    }
  });

  resumeButton.addEventListener('click', () => {
    if (!game) return;
    pauseOverlay.style.display = 'none';
    game.renderer.domElement.requestPointerLock();
  });

  logoutButton.addEventListener('click', () => {
    if (movementIntervalId) clearInterval(movementIntervalId);
    if (!network) return;
    network.ws.close(); // This should trigger your logout.mjs via the $disconnect route
    // Consider resetting game state or redirecting
    // loginOverlay.style.display = 'flex'; // Show login screen
    // if (game) {
    //   game.dispose(); // Add a method to Game to clean up Three.js resources
    //   game = null;
    // }
    // network = null;
  });
}

window.addEventListener('load', main);
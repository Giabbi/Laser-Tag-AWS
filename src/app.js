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

  /* ----------------------------------------------- *
   *  NEW: helpers to suppress duplicate position pushes
   * ----------------------------------------------- */
  let lastGridX = null;
  let lastGridY = null;
  const MOVEMENT_SEND_INTERVAL = 100;   // ms

  /* ----------------------------------------------- *
   *  Send current grid position to the server
   * ----------------------------------------------- */
  function sendMovement() {
    if (!network || !game) return;

    // Convert world‑space back to integer grid coordinates
    const { x: wx, z: wz } = game.head.position;
    const gridX = Math.round(wx / game.spacing + game.gridSize / 2 - 0.5);
    const gridY = Math.round(wz / game.spacing + game.gridSize / 2 - 0.5);

    if (gridX !== lastGridX || gridY !== lastGridY) {
      network.updatePosition(gridX, gridY);
      lastGridX = gridX;
      lastGridY = gridY;
    }
  }

  /* ----------------------------------------------- *
   *  Login ‑> start game
   * ----------------------------------------------- */
  btn.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) return;

    loginOverlay.style.display = 'none';

    network = new Network(name, handleServerMessage);
    game    = new Game(document.body, network);    // passes “network” into Game

    // Push position 10×/sec
    setInterval(sendMovement, MOVEMENT_SEND_INTERVAL);

    game.renderer.domElement.addEventListener('click', () =>
      game.renderer.domElement.requestPointerLock()
    );
  });

  /* ----------------------------------------------- *
   *  WS → Three.js hooks
   * ----------------------------------------------- */
  function handleServerMessage(msg) {
    if (!game) return;
    switch (msg.action) {
      case 'gameState':    game.setState(msg.players);      break;
      case 'playerMoved':  game.onPlayerMoved(msg.name, msg.x, msg.y, network.name); break;
      case 'shootResult':
        console.log(msg.message || msg.error || msg);
        game.handleShootEffect(msg.shooter, msg.hit, msg.origin, msg.direction);
        break;
      case 'playerJoined': game._spawnPlayer(msg.player.name, msg.player.x, msg.player.y); break;
      case 'playerLeft':   game._removePlayer(msg.name); break;
    }
  }

  /* ----------------------------------------------- *
   *  Pause / resume / logout UI (unchanged)
   * ----------------------------------------------- */
  document.addEventListener('pointerlockchange', () => {
    if (!game) return;
    if (document.pointerLockElement !== game.renderer.domElement) {
      pauseOverlay.style.display = 'flex';
    }
  });
  resumeButton.addEventListener('click', () => {
    if (!game) return;
    pauseOverlay.style.display = 'none';
    game.renderer.domElement.requestPointerLock();
  });
  logoutButton.addEventListener('click', () => {
    if (network) network.ws.close();
  });
}

window.addEventListener('load', main);

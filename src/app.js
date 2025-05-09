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

  btn.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) return;
    loginOverlay.style.display = 'none';

    network = new Network(name, handleServerMessage);
    game    = new Game(document.body, network);

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
      document.addEventListener('keydown', e => {
        const dir = dirMap[e.code];
        if (dir) network.move(dir);
      });
      

    // Clicking the canvas engages pointer lock
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
        game.onPlayerMoved(msg.name, msg.x, msg.y);
        break;
      case 'shootResult':
        console.log(msg.result);
        break;
      case 'playerJoined':
        game._spawnPlayer(msg.player.name, msg.player.x, msg.player.y);
        break;
      case 'playerLeft':
        game._removePlayer(msg.name);
        break;
    }
  }

  // === PAUSE ON POINTER LOCK EXIT ===
  document.addEventListener('pointerlockchange', () => {
    if (!game) return;
    // if we lost lock, show pause overlay
    if (document.pointerLockElement !== game.renderer.domElement) {
      pauseOverlay.style.display = 'flex';
    }
  });

  // Resume re-locks pointer
  resumeButton.addEventListener('click', () => {
    if (!game) return;
    pauseOverlay.style.display = 'none';
    game.renderer.domElement.requestPointerLock();
  });

  // Logout closes the socket -> triggers your logout.mjs
  logoutButton.addEventListener('click', () => {
    if (!network) return;
    network.ws.close();
  });
}

window.addEventListener('load', main);

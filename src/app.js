// src/app.js
import Network from "./network.js";
import Game    from "./game.js";

async function main() {
  /* ---------- DOM handles ---------- */
  const loginOverlay = document.getElementById("loginOverlay");
  const btnLogin     = document.getElementById("loginButton");
  const inpName      = document.getElementById("playerNameInput");

  /* pause menu */
  const pauseOverlay = document.getElementById("pauseOverlay");
  const btnResume    = document.getElementById("resumeButton");
  const btnLogout    = document.getElementById("logoutButton");

  /* ---------- Runtime state ---------- */
  let network = null;
  let game    = null;

  /* ---------- Throttle movement ---------- */
  let lastGridX = null;
  let lastGridY = null;
  const MOVEMENT_SEND_INTERVAL = 100;           // ms

  function sendMovement() {
    if (!network || !game) return;

    const { x: wx, z: wz } = game.head.position;
    const gridX = Math.round(wx / game.spacing + game.gridSize / 2 - 0.5);
    const gridY = Math.round(wz / game.spacing + game.gridSize / 2 - 0.5);
    const baseY = game._calculateBaseY(wx, wz);

    if (gridX !== lastGridX || gridY !== lastGridY) {
      network.updatePosition(gridX, gridY, baseY);
      lastGridX = gridX;
      lastGridY = gridY;
    }
  }

  /* ---------- Login → connect ---------- */
  btnLogin.addEventListener("click", () => {
    const name = inpName.value.trim();
    if (!name) return;

    loginOverlay.style.display = "none";

    network = new Network(name, handleServerMessage);
    game    = new Game(document.body, network);

    /* send position 10× sec */
    setInterval(sendMovement, MOVEMENT_SEND_INTERVAL);

    /* click to regain lock */
    game.renderer.domElement.addEventListener("pointerdown", () => {
      if (document.pointerLockElement !== game.renderer.domElement) {
        game.renderer.domElement.requestPointerLock().catch(() => {});
      }
    });

    /* grab lock right away so the first Tab pause is clean */
    game.renderer.domElement.requestPointerLock();

    /* ---------- controls hint (center → corner) ---------- */
    const hint = document.createElement("div");
    hint.textContent = "WASD → move   •   Space → shoot   •   Tab → pause";
    Object.assign(hint.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: 1000,
      padding: "10px 16px",
      fontFamily: "sans-serif",
      fontSize: "18px",
      color: "#fff",
      background: "rgba(0,0,0,0.65)",
      borderRadius: "8px",
      pointerEvents: "none",
      transition: "all 0.5s ease"
    });
    document.body.appendChild(hint);

    /* after 15 s, pin to the corner */
    setTimeout(() => {
      Object.assign(hint.style, {
        top: "10px",
        left: "10px",
        transform: "none",
        fontSize: "14px",
        background: "rgba(0,0,0,0.35)"
      });
    }, 10000);
  });

  /* ---------- Pause overlay sync ---------- */
  function syncPauseOverlay() {
    if (!game) return;
    pauseOverlay.style.display =
      document.pointerLockElement === game.renderer.domElement ? "none" : "flex";
  }
  document.addEventListener("pointerlockchange", syncPauseOverlay);

  /* ---------- “Tab” is the pause key ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Tab" || !game) return;

    e.preventDefault();
    if (document.pointerLockElement === game.renderer.domElement) {
      document.exitPointerLock();          // programmatic unlock
    } else {
      game.renderer.domElement.requestPointerLock().catch(() => {});
    }
  });

  /* ---------- Resume button ---------- */
  btnResume.addEventListener("pointerdown", () => {
    if (!game) return;
    game.renderer.domElement.requestPointerLock().catch(() => {});
  });

  /* ---------- Logout ---------- */
  btnLogout.addEventListener("click", () => {
    if (network) network.ws.close();
  });

  /* ---------- WS bridge ---------- */
  function handleServerMessage(msg) {
    if (!game) return;

    switch (msg.action) {
      case "gameState":
        game.setState(msg.players);
        break;
      case "playerMoved":
        game.onPlayerMoved(
          msg.name,
          msg.x,
          msg.y,
          network.name,
          msg.baseY
        );
        break;
      case "shootResult":
        game.handleShootEffect(
          msg.shooter,
          msg.hit,
          msg.origin,
          msg.direction,
          msg.shooterScore
        );
        break;
      case "playerJoined":
        game._spawnPlayer(
          msg.player.name,
          msg.player.x,
          msg.player.y,
          msg.player.baseY,
          msg.player.score
        );
        break;
      case "playerLeft":
        game._removePlayer(msg.name);
        break;
      default:
        console.warn("Unknown WS action:", msg);
    }
  }
}

window.addEventListener("load", main);

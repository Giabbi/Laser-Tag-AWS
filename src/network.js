// src/network.js
export default class Network {
    /**
     * @param {string}    name       Player name
     * @param {function}  onMessage  Callback for inbound WS messages
     */
    constructor(name, onMessage) {
      this.name      = name;
      this.onMessage = onMessage;
  
      // Your API‑GW WebSocket endpoint
      this.wsUrl = "wss://besdqwvktd.execute-api.us-east-2.amazonaws.com/production";
      this.ws    = null;
  
      this.connect();
    }
  
    connect() {
      this.ws = new WebSocket(`${this.wsUrl}?name=${encodeURIComponent(this.name)}`);
  
      this.ws.onopen    = () => {
        console.log("WebSocket connected");
        // Ask the server for the current snapshot
        this.send({ action: "getGameState" });
      };
      this.ws.onmessage = ({ data }) => this.onMessage(JSON.parse(data));
      this.ws.onclose   = () => { alert("Disconnected"); window.location.reload(); };
      this.ws.onerror   = err  => console.error("WebSocket error:", err);
    }
  
    /* ------------------------------------------------- *
     *  Low‑level helper
     * ------------------------------------------------- */
    send(payload) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(payload));
      }
    }
  
    /* ------------------------------------------------- *
     *  Movement – now sends absolute grid coords
     * ------------------------------------------------- */
    updatePosition(x, y) {
      this.send({
        action : "movePlayer",
        name   : this.name,
        x,      // integer grid column (0 … gridSize‑1)
        y       // integer grid row    (0 … gridSize‑1)
      });
    }
  
    /* (Keep shoot() exactly as before) */
    shoot(origin, direction) {
      this.send({ action: "shoot", name: this.name, origin, direction });
    }
  }
  
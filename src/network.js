export default class Network {
    /**
     * @param {string} name      Player name
     * @param {function} onMessage  Callback for server messages
     */
    constructor(name, onMessage) {
      this.name      = name;
      this.onMessage = onMessage;
      this.ws         = null;
  
      // Your API Gateway WebSocket endpoint
      this.wsUrl = "wss://besdqwvktd.execute-api.us-east-2.amazonaws.com/production";
  
      this.connect();
    }
  
    connect() {
      this.ws = new WebSocket(`${this.wsUrl}?name=${encodeURIComponent(this.name)}`);
  
      this.ws.onopen = () => {
        // No initial poll needed—state is pushed by your registerPlayer lambda
        console.log("WebSocket connected");
        this.send({ action: "getGameState" });      
      };
  
      this.ws.onmessage = ({ data }) => {
        const msg = JSON.parse(data);
        this.onMessage(msg);
      };
  
      this.ws.onclose = () => {
        alert("Disconnected from server");
        window.location.reload();
      };
  
      this.ws.onerror = err => {
        console.error("WebSocket error:", err);
      };
    }
  
    /**
     * Low‐level send helper
     * @param {object} payload
     */
    send(payload) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(payload));
      }
    }
  
    /**
     * Tell the server to move the player one tile
     * @param {"up"|"down"|"left"|"right"} direction
     */
    move(direction) {
      this.send({
        action:    "movePlayer",
        name:      this.name,
        direction
      });
    }
  
    /**
     * Fire a 3D ray from origin along direction
     * @param {{x:number,y:number,z:number}} origin
     * @param {{x:number,y:number,z:number}} direction
     */
    shoot(origin, direction) {
      this.send({
        action:    "shoot",
        name:      this.name,
        origin,    // must be provided for server‐side raycast
        direction  // normalized world‐space vector
      });
    }
  }
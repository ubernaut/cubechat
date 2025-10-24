// WebSocket server address - automatically uses the host that served the page
// This allows phones and other devices to connect automatically
function getWebSocketServer() {
  // Check for environment variable override first
  if (import.meta.env.VITE_WS_SERVER) {
    return import.meta.env.VITE_WS_SERVER;
  }
  
  // Auto-detect: use the same host that served the page
  const hostname = window.location.hostname;
  return `ws://${hostname}:8080`;
}

const WS_SERVER = getWebSocketServer();

// P2P Network using WebSocket relay server
export class P2PNetwork {
  constructor() {
    this.ws = null;
    this.peers = new Map();
    this.localPlayer = null;
    this.messageHandlers = [];
  }

  async init() {
    // Generate player ID and deterministic color
    const playerId = this.generatePeerId();
    this.localPlayer = {
      id: playerId,
      position: this.generateRandomPosition(),
      color: this.getDeterministicColor(playerId),
      velocity: { x: 0, y: 0, z: 0 },
      rotation: 0
    };

    // Connect to WebSocket server
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(WS_SERVER);

        this.ws.onopen = () => {
          console.log('Connected to P2P relay server');
          
          // Announce presence
          this.send({
            type: 'join',
            peerId: this.localPlayer.id,
            data: this.localPlayer
          });

          console.log('P2P Network initialized (WebSocket Relay)');
          console.log('Peer ID:', this.localPlayer.id);
          console.log('Player Color:', this.localPlayer.color);

          // Start broadcasting player state
          this.startBroadcasting();

          resolve(this.localPlayer);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('Disconnected from P2P server');
        };

        // Timeout after 5 seconds
        setTimeout(() => {
          if (this.ws.readyState !== WebSocket.OPEN) {
            reject(new Error('Connection timeout'));
          }
        }, 5000);
      } catch (error) {
        console.error('Failed to initialize WebSocket:', error);
        resolve(this.localPlayer);
      }
    });
  }

  handleMessage(message) {
    // Don't process own messages
    if (message.peerId === this.localPlayer.id) {
      return;
    }

    if (message.type === 'player_state') {
      const wasNew = !this.peers.has(message.peerId);
      this.peers.set(message.peerId, message.data);
      
      // Notify handlers
      this.messageHandlers.forEach(handler => handler({
        type: 'player_update',
        peerId: message.peerId,
        data: message.data
      }));

      if (wasNew) {
        console.log('New player joined:', message.peerId);
      }
    } else if (message.type === 'player_leave') {
      this.peers.delete(message.peerId);
      
      this.messageHandlers.forEach(handler => handler({
        type: 'player_leave',
        peerId: message.peerId
      }));
      
      console.log('Player left:', message.peerId);
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // Generate deterministic color based on peer ID
  getDeterministicColor(peerId) {
    // Use peer ID to generate a consistent hash
    let hash = 0;
    for (let i = 0; i < peerId.length; i++) {
      hash = peerId.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Convert hash to hue value (0-360)
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 100%, 50%)`;
  }

  generatePeerId() {
    return 'peer-' + Math.random().toString(36).substr(2, 9);
  }

  generateRandomPosition() {
    // Ensure players don't spawn at the same location
    const spread = 50;
    return {
      x: (Math.random() - 0.5) * spread,
      y: 1,
      z: (Math.random() - 0.5) * spread
    };
  }


  startBroadcasting() {
    // Broadcast player state via WebSocket
    setInterval(() => {
      this.broadcastPlayerState();
    }, 100); // 10 times per second
  }

  broadcastPlayerState() {
    if (!this.localPlayer) return;

    this.send({
      type: 'player_state',
      peerId: this.localPlayer.id,
      data: this.localPlayer
    });
  }

  updateLocalPlayer(updates) {
    this.localPlayer = { ...this.localPlayer, ...updates };
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  getPeers() {
    return Array.from(this.peers.entries()).map(([id, data]) => ({
      id,
      ...data
    }));
  }

  async stop() {
    if (this.ws) {
      this.send({
        type: 'leave',
        peerId: this.localPlayer.id
      });
      this.ws.close();
    }
    console.log('P2P Network stopped');
  }
}

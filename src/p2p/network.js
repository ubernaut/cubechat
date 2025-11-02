// WebSocket server address - automatically uses the host that served the page
// This allows phones and other devices to connect automatically
function getWebSocketServer() {
  // Check for environment variable override first
  if (import.meta.env.VITE_WS_SERVER) {
    return import.meta.env.VITE_WS_SERVER;
  }
  
  // Auto-detect based on environment
  // In dev mode (localhost), use local WebSocket server
  // In production, use the production server
  if (import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:8080';
  }
  
  // Production: use secure WebSocket on secretworkshop.net
  return `wss://secretworkshop.net/cubechat/`;
}

const WS_SERVER = getWebSocketServer();

// P2P Network using WebSocket relay server with WebRTC support
export class P2PNetwork {
  constructor() {
    this.ws = null;
    this.peers = new Map();
    this.localPlayer = null;
    this.messageHandlers = [];
    this.localStream = null;
    this.peerConnections = new Map();
    this.remoteStreams = new Map();
    this.pendingIceCandidates = new Map(); // Queue ICE candidates until ready
    this.lastBroadcastState = null; // Track last broadcast state to detect changes
    this.dataChannels = new Map(); // Store data channels for each peer
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.isReconnecting = false;
    this.shouldReconnect = true;
  }

  async init() {
    // Request camera and microphone
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: true
      });
      console.log('Got local media stream');
    } catch (error) {
      console.error('Failed to get media:', error);
      // Continue without media if denied
    }

    // Generate player ID and deterministic color
    const playerId = this.generatePeerId();
    this.localPlayer = {
      id: playerId,
      position: this.generateRandomPosition(),
      color: this.getDeterministicColor(playerId),
      velocity: { x: 0, y: 0, z: 0 },
      rotation: 0,
      hasMedia: !!this.localStream
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
          
          // Attempt to reconnect if not intentionally stopped
          if (this.shouldReconnect && !this.isReconnecting) {
            this.attemptReconnect();
          }
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

  async handleMessage(message) {
    // Don't process own messages
    if (message.peerId === this.localPlayer.id) {
      return;
    }

    if (message.type === 'player_state') {
      const wasNew = !this.peers.has(message.peerId);
      this.peers.set(message.peerId, message.data);
      
      // Create WebRTC connection for new peer with media
      // Use peer ID comparison to decide who initiates (prevents duplicate connections)
      if (wasNew && this.localStream && message.data.hasMedia) {
        // Only initiate if our peer ID is "greater" (alphabetically)
        if (this.localPlayer.id > message.peerId) {
          console.log('Initiating connection to', message.peerId);
          await this.createPeerConnection(message.peerId);
        } else {
          console.log('Waiting for connection from', message.peerId);
        }
      }
      
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
      this.closePeerConnection(message.peerId);
      
      this.messageHandlers.forEach(handler => handler({
        type: 'player_leave',
        peerId: message.peerId
      }));
      
      console.log('Player left:', message.peerId);
    } else if (message.type === 'webrtc-offer') {
      await this.handleOffer(message.peerId, message.offer);
    } else if (message.type === 'webrtc-answer') {
      await this.handleAnswer(message.peerId, message.answer);
    } else if (message.type === 'webrtc-ice') {
      await this.handleIceCandidate(message.peerId, message.candidate);
    }
  }

  async createPeerConnection(peerId) {
    // Don't create duplicate connections
    if (this.peerConnections.has(peerId)) {
      console.log('Connection already exists for', peerId);
      return;
    }
    
    const config = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
    
    const pc = new RTCPeerConnection(config);
    this.peerConnections.set(peerId, pc);

    // Create data channel for position updates
    const dataChannel = pc.createDataChannel('playerState');
    this.setupDataChannel(peerId, dataChannel);

    // Add local tracks if available
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Handle incoming data channels
    pc.ondatachannel = (event) => {
      console.log('Received data channel from', peerId);
      this.setupDataChannel(peerId, event.channel);
    };

    // Handle incoming tracks
    pc.ontrack = (event) => {
      console.log('Received remote track from', peerId, event.streams[0]);
      const stream = event.streams[0];
      this.remoteStreams.set(peerId, stream);
      
      console.log('Stream tracks:', stream.getTracks().map(t => t.kind));
      
      this.messageHandlers.forEach(handler => handler({
        type: 'stream_added',
        peerId: peerId,
        stream: stream
      }));
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          type: 'webrtc-ice',
          peerId: this.localPlayer.id,
          targetPeer: peerId,
          candidate: event.candidate
        });
      }
    };

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({
      type: 'webrtc-offer',
      peerId: this.localPlayer.id,
      targetPeer: peerId,
      offer: offer
    });
  }

  async handleOffer(peerId, offer) {
    // Accept offers (we're the responder)
    if (this.peerConnections.has(peerId)) {
      console.log('Connection already exists for', peerId);
      return;
    }
    
    console.log('Accepting connection from', peerId);

    const config = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
    
    const pc = new RTCPeerConnection(config);
    this.peerConnections.set(peerId, pc);

    // Handle incoming data channels
    pc.ondatachannel = (event) => {
      console.log('Received data channel from', peerId);
      this.setupDataChannel(peerId, event.channel);
    };

    // Add local tracks if available
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      console.log('Received remote track from', peerId);
      this.remoteStreams.set(peerId, event.streams[0]);
      this.messageHandlers.forEach(handler => handler({
        type: 'stream_added',
        peerId: peerId,
        stream: event.streams[0]
      }));
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          type: 'webrtc-ice',
          peerId: this.localPlayer.id,
          targetPeer: peerId,
          candidate: event.candidate
        });
      }
    };

    await pc.setRemoteDescription(offer);
    
    // Process any queued ICE candidates
    if (this.pendingIceCandidates.has(peerId)) {
      const candidates = this.pendingIceCandidates.get(peerId);
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          console.error('Error adding queued ICE candidate:', error);
        }
      }
      this.pendingIceCandidates.delete(peerId);
    }
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    this.send({
      type: 'webrtc-answer',
      peerId: this.localPlayer.id,
      targetPeer: peerId,
      answer: answer
    });
  }

  async handleAnswer(peerId, answer) {
    const pc = this.peerConnections.get(peerId);
    if (pc && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(answer);
      
      // Process any queued ICE candidates
      if (this.pendingIceCandidates.has(peerId)) {
        const candidates = this.pendingIceCandidates.get(peerId);
        for (const candidate of candidates) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (error) {
            console.error('Error adding queued ICE candidate:', error);
          }
        }
        this.pendingIceCandidates.delete(peerId);
      }
    } else if (pc) {
      console.log('Ignoring answer - wrong state:', pc.signalingState);
    }
  }

  async handleIceCandidate(peerId, candidate) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return;
    
    // If remote description isn't set yet, queue the candidate
    if (!pc.remoteDescription) {
      if (!this.pendingIceCandidates.has(peerId)) {
        this.pendingIceCandidates.set(peerId, []);
      }
      this.pendingIceCandidates.get(peerId).push(candidate);
      return;
    }
    
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  }

  setupDataChannel(peerId, channel) {
    this.dataChannels.set(peerId, channel);

    channel.onopen = () => {
      console.log('Data channel opened with', peerId);
    };

    channel.onclose = () => {
      console.log('Data channel closed with', peerId);
      this.dataChannels.delete(peerId);
    };

    channel.onerror = (error) => {
      console.error('Data channel error with', peerId, error);
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        // Handle player state updates via P2P
        if (message.type === 'player_state') {
          this.peers.set(peerId, message.data);
          
          // Notify handlers
          this.messageHandlers.forEach(handler => handler({
            type: 'player_update',
            peerId: peerId,
            data: message.data
          }));
        }
      } catch (error) {
        console.error('Error parsing data channel message:', error);
      }
    };
  }

  closePeerConnection(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    
    // Close data channel
    const channel = this.dataChannels.get(peerId);
    if (channel) {
      channel.close();
      this.dataChannels.delete(peerId);
    }
    
    this.remoteStreams.delete(peerId);
    
    // Notify handlers that stream was removed
    this.messageHandlers.forEach(handler => handler({
      type: 'stream_removed',
      peerId: peerId
    }));
  }

  // Check distance and disconnect video if too far
  checkProximityAndManageConnections() {
    if (!this.localPlayer) return;
    
    const MAX_VIDEO_DISTANCE = 100; // Grid squares * 10 = units
    
    this.peers.forEach((peerData, peerId) => {
      const dx = peerData.position.x - this.localPlayer.position.x;
      const dz = peerData.position.z - this.localPlayer.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      const hasConnection = this.peerConnections.has(peerId);
      
      // Disconnect if too far
      if (distance > MAX_VIDEO_DISTANCE && hasConnection) {
        console.log('Disconnecting video from', peerId, '- too far:', distance);
        this.closePeerConnection(peerId);
      }
      // Reconnect if close enough and both have media
      else if (distance <= MAX_VIDEO_DISTANCE && !hasConnection && 
               this.localStream && peerData.hasMedia) {
        // Use same tie-breaker logic
        if (this.localPlayer.id > peerId) {
          console.log('Reconnecting video to', peerId, '- within range:', distance);
          this.createPeerConnection(peerId);
        }
      }
    });
  }

  getLocalStream() {
    return this.localStream;
  }

  getRemoteStream(peerId) {
    return this.remoteStreams.get(peerId);
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
    // Ensure players don't spawn at the same location (farther apart)
    const spread = 150; // Increased from 50 to 150 (3x farther)
    return {
      x: (Math.random() - 0.5) * spread,
      y: 3, // Raised to sit on grid (cube is 6x6x6, so center at y=3)
      z: (Math.random() - 0.5) * spread
    };
  }


  startBroadcasting() {
    // Check for changes and broadcast only when player state changes
    setInterval(() => {
      this.broadcastPlayerStateIfChanged();
    }, 100); // Check 10 times per second
    
    // Check proximity and manage connections every second
    setInterval(() => {
      this.checkProximityAndManageConnections();
    }, 1000);
  }

  // Check if player state has changed significantly
  hasPlayerStateChanged() {
    if (!this.lastBroadcastState) return true;
    
    const current = this.localPlayer;
    const last = this.lastBroadcastState;
    
    // Define threshold for position changes (small movements don't trigger update)
    const POSITION_THRESHOLD = 0.01;
    const ROTATION_THRESHOLD = 0.01;
    const VELOCITY_THRESHOLD = 0.001;
    
    // Check position changes
    if (Math.abs(current.position.x - last.position.x) > POSITION_THRESHOLD ||
        Math.abs(current.position.y - last.position.y) > POSITION_THRESHOLD ||
        Math.abs(current.position.z - last.position.z) > POSITION_THRESHOLD) {
      return true;
    }
    
    // Check velocity changes
    if (Math.abs(current.velocity.x - last.velocity.x) > VELOCITY_THRESHOLD ||
        Math.abs(current.velocity.y - last.velocity.y) > VELOCITY_THRESHOLD ||
        Math.abs(current.velocity.z - last.velocity.z) > VELOCITY_THRESHOLD) {
      return true;
    }
    
    // Check rotation changes
    if (Math.abs(current.rotation - last.rotation) > ROTATION_THRESHOLD) {
      return true;
    }
    
    return false;
  }

  broadcastPlayerStateIfChanged() {
    if (!this.localPlayer) return;
    
    // Only broadcast if state has changed
    if (this.hasPlayerStateChanged()) {
      const message = {
        type: 'player_state',
        data: this.localPlayer
      };
      
      // Send via P2P data channels to connected peers
      const sentViaPeer = this.sendToAllPeers(message);
      
      // Also send via WebSocket for peer discovery and as fallback
      // This ensures new players can discover us even if no P2P connection yet
      this.send({
        type: 'player_state',
        peerId: this.localPlayer.id,
        data: this.localPlayer
      });
      
      // Save current state as last broadcast state
      this.lastBroadcastState = {
        position: { ...this.localPlayer.position },
        velocity: { ...this.localPlayer.velocity },
        rotation: this.localPlayer.rotation
      };
    }
  }

  // Send message to all connected peers via data channels
  // Returns the number of peers reached
  sendToAllPeers(message) {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;
    
    this.dataChannels.forEach((channel, peerId) => {
      if (channel.readyState === 'open') {
        try {
          channel.send(messageStr);
          sentCount++;
        } catch (error) {
          console.error('Error sending to peer', peerId, error);
        }
      }
    });
    
    return sentCount;
  }

  // Keep the old method for manual broadcasting if needed
  broadcastPlayerState() {
    if (!this.localPlayer) return;

    const message = {
      type: 'player_state',
      data: this.localPlayer
    };
    
    // Send via P2P data channels to all connected peers
    this.sendToAllPeers(message);
    
    // Also send via WebSocket as fallback
    this.send({
      type: 'player_state',
      peerId: this.localPlayer.id,
      data: this.localPlayer
    });
    
    // Update last broadcast state
    this.lastBroadcastState = {
      position: { ...this.localPlayer.position },
      velocity: { ...this.localPlayer.velocity },
      rotation: this.localPlayer.rotation
    };
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

  async attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached. Please refresh the page.');
      return;
    }
    
    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, etc. (max 30s)
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);
    
    setTimeout(async () => {
      try {
        await this.reconnect();
        console.log('Reconnected successfully!');
        this.reconnectAttempts = 0; // Reset on success
        this.isReconnecting = false;
      } catch (error) {
        console.error('Reconnection failed:', error);
        this.isReconnecting = false;
        // Will trigger another attempt via onclose handler
      }
    }, delay);
  }

  async reconnect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(WS_SERVER);

        this.ws.onopen = () => {
          console.log('Reconnected to P2P relay server');
          
          // Re-announce presence with current state
          this.send({
            type: 'join',
            peerId: this.localPlayer.id,
            data: this.localPlayer
          });

          // Broadcast current state immediately
          this.broadcastPlayerState();

          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket reconnection error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('Disconnected from P2P server');
          
          // Attempt to reconnect if not intentionally stopped
          if (this.shouldReconnect && !this.isReconnecting) {
            this.attemptReconnect();
          }
        };

        // Timeout after 5 seconds
        setTimeout(() => {
          if (this.ws.readyState !== WebSocket.OPEN) {
            reject(new Error('Reconnection timeout'));
          }
        }, 5000);
      } catch (error) {
        console.error('Failed to reconnect:', error);
        reject(error);
      }
    });
  }

  async stop() {
    this.shouldReconnect = false; // Prevent reconnection attempts
    
    if (this.ws) {
      this.send({
        type: 'leave',
        peerId: this.localPlayer.id
      });
      this.ws.close();
    }
    
    // Close all peer connections
    this.peerConnections.forEach((pc, peerId) => {
      this.closePeerConnection(peerId);
    });
    
    // Stop local media stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
    
    console.log('P2P Network stopped');
  }
}

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
    this.remoteScreenStreams = new Map(); // Store screen share streams separately
    this.remoteCameraTracks = new Map(); // Store camera video tracks per peer
    this.remoteScreenTracks = new Map(); // Store screen video tracks per peer
    this.remoteAudioTracks = new Map(); // Store audio tracks per peer
    this.remoteTrackIds = new Map(); // Track which track IDs we've seen for each peer
    this.remoteScreenTrackIds = new Map(); // Store which track IDs are screen tracks per peer
    this.pendingIceCandidates = new Map(); // Queue ICE candidates until ready
    this.lastBroadcastState = null; // Track last broadcast state to detect changes
    this.dataChannels = new Map(); // Store data channels for each peer
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.isReconnecting = false;
    this.shouldReconnect = true;
    this.screenStream = null; // Store screen stream for reconnections
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
      hasMedia: !!this.localStream,
      screenSharing: false,
      billboardData: null
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

    // Add screen share tracks if currently sharing
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => {
        pc.addTrack(track, this.screenStream);
        console.log('Added screen track to new peer connection', peerId);
      });
    }

    // Handle incoming data channels
    pc.ondatachannel = (event) => {
      console.log('Received data channel from', peerId);
      this.setupDataChannel(peerId, event.channel);
    };

    // Handle incoming tracks with robust track type separation
    pc.ontrack = (event) => {
      const track = event.track;
      
      console.log(`[${peerId}] Received ${track.kind} track:`, {
        id: track.id,
        label: track.label,
        settings: track.getSettings()
      });
      
      // Initialize track ID set for this peer if not exists
      if (!this.remoteTrackIds.has(peerId)) {
        this.remoteTrackIds.set(peerId, new Set());
      }
      
      const seenTracks = this.remoteTrackIds.get(peerId);
      const isNewTrack = !seenTracks.has(track.id);
      
      if (!isNewTrack) {
        console.log(`[${peerId}] Track ${track.id} already processed, skipping`);
        return;
      }
      
      seenTracks.add(track.id);
      
      // ROBUST TRACK TYPE DETECTION
      // Determine track type based on multiple signals
      const settings = track.getSettings();
      const label = track.label.toLowerCase();
      
      let trackType = 'unknown';
      
      if (track.kind === 'audio') {
        trackType = 'audio';
      } else if (track.kind === 'video') {
        // Check metadata first - most reliable
        const screenTrackIds = this.remoteScreenTrackIds?.get(peerId);
        const isInMetadata = screenTrackIds?.has(track.id);
        
        // Check for screen share indicators (in priority order)
        const hasDisplaySurface = settings.displaySurface !== undefined;
        const hasScreenLabel = label.includes('screen') || label.includes('monitor') || label.includes('window');
        
        if (isInMetadata) {
          trackType = 'screen';
          console.log(`[${peerId}] SCREEN track detected via metadata:`, track.id);
        } else if (hasDisplaySurface) {
          trackType = 'screen';
          console.log(`[${peerId}] SCREEN track detected via displaySurface:`, settings.displaySurface);
        } else if (hasScreenLabel) {
          trackType = 'screen';
          console.log(`[${peerId}] SCREEN track detected via label:`, track.label);
        } else {
          trackType = 'camera';
          console.log(`[${peerId}] CAMERA track detected (no screen indicators)`);
        }
      }
      
      // Store track by type
      if (trackType === 'audio') {
        if (!this.remoteAudioTracks.has(peerId)) {
          this.remoteAudioTracks.set(peerId, []);
        }
        this.remoteAudioTracks.get(peerId).push(track);
        console.log(`[${peerId}] Stored AUDIO track`);
      } else if (trackType === 'camera') {
        if (!this.remoteCameraTracks.has(peerId)) {
          this.remoteCameraTracks.set(peerId, []);
        }
        this.remoteCameraTracks.get(peerId).push(track);
        console.log(`[${peerId}] Stored CAMERA track`);
      } else if (trackType === 'screen') {
        if (!this.remoteScreenTracks.has(peerId)) {
          this.remoteScreenTracks.set(peerId, []);
        }
        this.remoteScreenTracks.get(peerId).push(track);
        console.log(`[${peerId}] Stored SCREEN track`);
      }
      
      // Rebuild streams from stored tracks
      this.rebuildPeerStreams(peerId);
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
    let pc = this.peerConnections.get(peerId);
    
    // If connection exists, this is a renegotiation
    if (pc) {
      console.log('Renegotiating connection with', peerId);
      
      try {
        await pc.setRemoteDescription(offer);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        this.send({
          type: 'webrtc-answer',
          peerId: this.localPlayer.id,
          targetPeer: peerId,
          answer: answer
        });
        
        console.log('Sent renegotiation answer to', peerId);
      } catch (error) {
        console.error('Error handling renegotiation offer:', error);
      }
      
      return;
    }
    
    console.log('Accepting connection from', peerId);

    const config = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
    
    pc = new RTCPeerConnection(config);
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

    // Add screen share tracks if currently sharing
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => {
        pc.addTrack(track, this.screenStream);
        console.log('Added screen track to new peer connection', peerId);
      });
    }

    // Handle incoming tracks with robust track type separation
    pc.ontrack = (event) => {
      const track = event.track;
      
      console.log(`[${peerId}] Received ${track.kind} track:`, {
        id: track.id,
        label: track.label,
        settings: track.getSettings()
      });
      
      // Initialize track ID set for this peer if not exists
      if (!this.remoteTrackIds.has(peerId)) {
        this.remoteTrackIds.set(peerId, new Set());
      }
      
      const seenTracks = this.remoteTrackIds.get(peerId);
      const isNewTrack = !seenTracks.has(track.id);
      
      if (!isNewTrack) {
        console.log(`[${peerId}] Track ${track.id} already processed, skipping`);
        return;
      }
      
      seenTracks.add(track.id);
      
      // ROBUST TRACK TYPE DETECTION
      // Determine track type based on multiple signals
      const settings = track.getSettings();
      const label = track.label.toLowerCase();
      
      let trackType = 'unknown';
      
      if (track.kind === 'audio') {
        trackType = 'audio';
      } else if (track.kind === 'video') {
        // Check metadata first - most reliable
        const screenTrackIds = this.remoteScreenTrackIds?.get(peerId);
        const isInMetadata = screenTrackIds?.has(track.id);
        
        // Check for screen share indicators (in priority order)
        const hasDisplaySurface = settings.displaySurface !== undefined;
        const hasScreenLabel = label.includes('screen') || label.includes('monitor') || label.includes('window');
        
        if (isInMetadata) {
          trackType = 'screen';
          console.log(`[${peerId}] SCREEN track detected via metadata:`, track.id);
        } else if (hasDisplaySurface) {
          trackType = 'screen';
          console.log(`[${peerId}] SCREEN track detected via displaySurface:`, settings.displaySurface);
        } else if (hasScreenLabel) {
          trackType = 'screen';
          console.log(`[${peerId}] SCREEN track detected via label:`, track.label);
        } else {
          trackType = 'camera';
          console.log(`[${peerId}] CAMERA track detected (no screen indicators)`);
        }
      }
      
      // Store track by type
      if (trackType === 'audio') {
        if (!this.remoteAudioTracks.has(peerId)) {
          this.remoteAudioTracks.set(peerId, []);
        }
        this.remoteAudioTracks.get(peerId).push(track);
        console.log(`[${peerId}] Stored AUDIO track`);
      } else if (trackType === 'camera') {
        if (!this.remoteCameraTracks.has(peerId)) {
          this.remoteCameraTracks.set(peerId, []);
        }
        this.remoteCameraTracks.get(peerId).push(track);
        console.log(`[${peerId}] Stored CAMERA track`);
      } else if (trackType === 'screen') {
        if (!this.remoteScreenTracks.has(peerId)) {
          this.remoteScreenTracks.set(peerId, []);
        }
        this.remoteScreenTracks.get(peerId).push(track);
        console.log(`[${peerId}] Stored SCREEN track`);
      }
      
      // Rebuild streams from stored tracks
      this.rebuildPeerStreams(peerId);
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
      
      // If we're currently screen sharing, send metadata immediately
      if (this.screenStream) {
        const screenTrackIds = this.screenStream.getTracks().map(t => t.id);
        channel.send(JSON.stringify({
          type: 'screen_track_metadata',
          trackIds: screenTrackIds
        }));
        console.log('Sent screen track metadata on channel open to', peerId, screenTrackIds);
      }
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
        } else if (message.type === 'screen_track_metadata') {
          // Store screen track IDs for this peer
          if (!this.remoteScreenTrackIds) {
            this.remoteScreenTrackIds = new Map();
          }
          const existingIds = this.remoteScreenTrackIds.get(peerId);
          this.remoteScreenTrackIds.set(peerId, new Set(message.trackIds));
          console.log(`[${peerId}] Received screen track metadata:`, message.trackIds, 
                     existingIds ? '(updating existing)' : '(new)');
          
          // Reclassify any existing tracks that match these IDs
          this.reclassifyTracksAsScreen(peerId, message.trackIds);
        }
      } catch (error) {
        console.error('Error parsing data channel message:', error);
      }
    };
  }

  // Reclassify tracks when we receive metadata about which are screen tracks
  reclassifyTracksAsScreen(peerId, screenTrackIds) {
    const cameraTracks = this.remoteCameraTracks.get(peerId) || [];
    
    // Move any camera tracks that are actually screen tracks
    const tracksToMove = cameraTracks.filter(track => screenTrackIds.includes(track.id));
    
    if (tracksToMove.length > 0) {
      console.log(`[${peerId}] Reclassifying ${tracksToMove.length} tracks as SCREEN tracks`);
      
      // Remove from camera tracks
      const remainingCameraTracks = cameraTracks.filter(track => !screenTrackIds.includes(track.id));
      if (remainingCameraTracks.length > 0) {
        this.remoteCameraTracks.set(peerId, remainingCameraTracks);
      } else {
        this.remoteCameraTracks.delete(peerId);
      }
      
      // Add to screen tracks
      if (!this.remoteScreenTracks.has(peerId)) {
        this.remoteScreenTracks.set(peerId, []);
      }
      this.remoteScreenTracks.get(peerId).push(...tracksToMove);
      
      // Rebuild streams with correct classification
      this.rebuildPeerStreams(peerId);
    }
  }

  // Rebuild camera and screen streams from stored tracks
  rebuildPeerStreams(peerId) {
    // Build camera stream (video + audio)
    const cameraTracks = this.remoteCameraTracks.get(peerId) || [];
    const audioTracks = this.remoteAudioTracks.get(peerId) || [];
    
    if (cameraTracks.length > 0 || audioTracks.length > 0) {
      const allCameraTracks = [...cameraTracks, ...audioTracks];
      const cameraStream = new MediaStream(allCameraTracks);
      
      // Only update if stream changed
      const existingStream = this.remoteStreams.get(peerId);
      const streamsMatch = existingStream && 
        existingStream.getTracks().length === allCameraTracks.length &&
        existingStream.getTracks().every(t => allCameraTracks.find(ct => ct.id === t.id));
      
      if (!streamsMatch) {
        this.remoteStreams.set(peerId, cameraStream);
        console.log(`[${peerId}] Built CAMERA stream with ${cameraTracks.length} video + ${audioTracks.length} audio tracks`);
        
        this.messageHandlers.forEach(handler => handler({
          type: 'stream_added',
          peerId: peerId,
          stream: cameraStream
        }));
      }
    }
    
    // Build screen stream (video only, no audio)
    const screenTracks = this.remoteScreenTracks.get(peerId) || [];
    
    if (screenTracks.length > 0) {
      const screenStream = new MediaStream(screenTracks);
      
      // Only update if stream changed
      const existingScreenStream = this.remoteScreenStreams.get(peerId);
      const screensMatch = existingScreenStream && 
        existingScreenStream.getTracks().length === screenTracks.length &&
        existingScreenStream.getTracks().every(t => screenTracks.find(st => st.id === t.id));
      
      if (!screensMatch) {
        this.remoteScreenStreams.set(peerId, screenStream);
        console.log(`[${peerId}] Built SCREEN stream with ${screenTracks.length} video tracks`);
        
        this.messageHandlers.forEach(handler => handler({
          type: 'screen_stream_added',
          peerId: peerId,
          stream: screenStream
        }));
      }
    }
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
    
    // Clean up all track storage
    this.remoteStreams.delete(peerId);
    this.remoteScreenStreams.delete(peerId);
    this.remoteCameraTracks.delete(peerId);
    this.remoteScreenTracks.delete(peerId);
    this.remoteAudioTracks.delete(peerId);
    this.remoteTrackIds.delete(peerId);
    this.remoteScreenTrackIds?.delete(peerId);
    
    // Notify handlers that stream was removed
    this.messageHandlers.forEach(handler => handler({
      type: 'stream_removed',
      peerId: peerId
    }));
  }

  // Check distance and disconnect video if too far
  checkProximityAndManageConnections() {
    if (!this.localPlayer) return;
    
    const MAX_VIDEO_DISTANCE = 400; // Grid squares * 10 = units
    
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

  getRemoteScreenStream(peerId) {
    return this.remoteScreenStreams.get(peerId);
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
      y: 20, // Spawn high so players drop onto the plane naturally
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

  // Start screen sharing - add screen tracks to peer connections
  async startScreenSharing(screenStream, billboardData) {
    this.screenStream = screenStream; // Store for future connections
    this.localPlayer.screenSharing = true;
    this.localPlayer.billboardData = billboardData;
    
    // Store screen track IDs for identification
    const screenTrackIds = screenStream.getTracks().map(t => t.id);
    console.log('Starting screen share with original track IDs:', screenTrackIds);
    
    // Add screen tracks to all existing peer connections and renegotiate
    const screenTracks = screenStream.getTracks();
    
    for (const [peerId, pc] of this.peerConnections) {
      // Add screen track as sender
      const addedSenders = [];
      for (const track of screenTracks) {
        const sender = pc.addTrack(track, screenStream);
        addedSenders.push(sender);
        console.log('Added screen track to peer', peerId, '- original trackId:', track.id);
      }
      
      // CRITICAL: Renegotiate the connection to send the new track
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.send({
          type: 'webrtc-offer',
          peerId: this.localPlayer.id,
          targetPeer: peerId,
          offer: offer
        });
        console.log('Sent renegotiation offer to', peerId, 'for screen track');
        
        // IMPORTANT: After renegotiation, get the ACTUAL track IDs that will be sent
        // (they might be different from the original track IDs due to transcoding/processing)
        const actualScreenTrackIds = addedSenders
          .filter(sender => sender.track && sender.track.kind === 'video')
          .map(sender => sender.track.id);
        
        console.log('Actual screen track IDs for', peerId, ':', actualScreenTrackIds);
        
        // Send screen track metadata via data channel with ACTUAL track IDs
        const channel = this.dataChannels.get(peerId);
        if (channel && channel.readyState === 'open') {
          channel.send(JSON.stringify({
            type: 'screen_track_metadata',
            trackIds: actualScreenTrackIds
          }));
          console.log('Sent screen track metadata to', peerId, actualScreenTrackIds);
        } else {
          console.warn('Data channel not ready for', peerId, '- metadata will be sent on channel open');
        }
      } catch (error) {
        console.error('Error renegotiating connection for screen share:', error);
      }
    }
    
    // Broadcast updated state
    this.broadcastPlayerState();
  }

  // Stop screen sharing - remove screen tracks from peer connections
  stopScreenSharing() {
    this.screenStream = null; // Clear stored stream
    this.localPlayer.screenSharing = false;
    this.localPlayer.billboardData = null;
    
    // Remove screen tracks from all peer connections
    this.peerConnections.forEach((pc, peerId) => {
      const senders = pc.getSenders();
      senders.forEach(sender => {
        // Remove tracks that are not from the local webcam stream
        if (sender.track && this.localStream) {
          const isWebcamTrack = this.localStream.getTracks().some(t => t.id === sender.track.id);
          if (!isWebcamTrack) {
            pc.removeTrack(sender);
            console.log('Removed screen track from peer', peerId);
          }
        }
      });
    });
    
    // Broadcast updated state
    this.broadcastPlayerState();
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

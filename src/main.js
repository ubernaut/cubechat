import './style.css';
import { P2PNetwork } from './p2p/network.js';
import { TronScene } from './renderer/scene.js';
import { PlayerController } from './controls/input.js';

class CubeChat {
  constructor() {
    this.network = null;
    this.scene = null;
    this.controller = null;
    this.remotePlayers = new Set();
  }

  async init() {
    // Show loading message
    const app = document.querySelector('#app');
    app.innerHTML = `
      <div id="loading">
        <h1>CubeChat</h1>
        <p>Initializing P2P Network...</p>
        <p style="font-size: 0.9em; color: #00ffff;">Click to start</p>
        <p style="font-size: 0.8em; color: #00cccc; max-width: 90%; margin: 0.5em auto;">WASD: Move | Mouse/Arrows: Look | Movement has momentum</p>
      </div>
      <div id="scene-container"></div>
      <div id="event-log"></div>
    `;

    // Initialize event log system
    this.initEventLog();

    try {
      // Initialize P2P network
      this.network = new P2PNetwork();
      const localPlayer = await this.network.init();

      // Initialize Three.js scene
      const container = document.querySelector('#scene-container');
      this.scene = new TronScene(container);

      // Create local player in scene
      this.scene.createPlayer(
        localPlayer.id,
        localPlayer.color,
        localPlayer.position
      );
      this.scene.setLocalPlayer(localPlayer.id);
      
      // Apply local video stream to own cube
      if (this.network.getLocalStream()) {
        this.scene.setPlayerVideoStream(localPlayer.id, this.network.getLocalStream());
      }

      // Initialize player controller
      this.controller = new PlayerController();

      // Trigger an initial jump so other players can see this player join
      setTimeout(() => {
        this.controller.triggerJump();
      }, 500); // Small delay to ensure everything is initialized

      // Set up network message handler
      this.network.onMessage((message) => {
        this.handleNetworkMessage(message);
      });

      // Detect mobile device
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      const loadingDiv = document.querySelector('#loading');
      const canvas = this.scene.renderer.domElement;
      
      if (isMobile) {
        // Mobile: just tap to start, no pointer lock
        loadingDiv.style.cursor = 'pointer';
        loadingDiv.addEventListener('click', () => {
          loadingDiv.style.display = 'none';
          this.controller.setMobileMode(true);
        });
      } else {
        // Desktop: use pointer lock
        canvas.addEventListener('click', () => {
          canvas.requestPointerLock();
        });

        loadingDiv.style.cursor = 'pointer';
        loadingDiv.addEventListener('click', () => {
          canvas.requestPointerLock();
        });

        // Remove loading screen when pointer is locked
        document.addEventListener('pointerlockchange', () => {
          if (document.pointerLockElement) {
            loadingDiv.style.display = 'none';
          }
        });
      }

      // Start game loop
      this.startGameLoop();

      console.log('Tron Overworld initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize:', error);
      app.innerHTML = `
        <div id="loading">
          <h1>Error</h1>
          <p style="max-width: 90%; margin: 0.5em auto;">Failed to initialize P2P network: ${error.message}</p>
          <p style="max-width: 90%; margin: 0.5em auto;">Please check the console for more details.</p>
        </div>
      `;
    }
  }

  handleNetworkMessage(message) {
    if (message.type === 'player_update') {
      const { peerId, data } = message;

      // Add new remote player if not already tracked
      if (!this.remotePlayers.has(peerId)) {
        this.scene.createPlayer(peerId, data.color, data.position);
        this.remotePlayers.add(peerId);
        console.log('New player joined:', peerId);
        this.logEvent(`Player joined: ${peerId.substring(0, 8)}...`, 'join');
      }

      // Update remote player position and rotation
      this.scene.updatePlayer(peerId, data.position, data.rotation);
      
      // Update proximity audio
      this.updateProximityAudio(peerId, data.position);
    } else if (message.type === 'player_leave') {
      const { peerId } = message;
      
      if (this.remotePlayers.has(peerId)) {
        this.scene.removePlayer(peerId);
        this.remotePlayers.delete(peerId);
        
        // Clean up audio element
        const audio = document.getElementById(`audio-${peerId}`);
        if (audio) {
          audio.remove();
        }
        
        console.log('Player left:', peerId);
      }
    } else if (message.type === 'stream_added') {
      // Apply video stream to player cube
      this.scene.setPlayerVideoStream(message.peerId, message.stream);
      
      // Initialize audio for this peer
      const peerData = this.network.getPeers().find(p => p.id === message.peerId);
      if (peerData) {
        this.updateProximityAudio(message.peerId, peerData.position);
      }
      
      this.logEvent(`Video connected: ${message.peerId.substring(0, 8)}...`, 'video-success');
    } else if (message.type === 'stream_removed') {
      // Remove video texture from cube (revert to colored cube)
      this.scene.removePlayerVideoStream(message.peerId);
      
      // Clean up audio element
      const audio = document.getElementById(`audio-${message.peerId}`);
      if (audio) {
        audio.remove();
      }
      
      this.logEvent(`Video disconnected: ${message.peerId.substring(0, 8)}...`, 'video-fail');
    }
  }

  updateProximityAudio(peerId, remotePosition) {
    const stream = this.network.getRemoteStream(peerId);
    if (!stream) return;

    const localPos = this.scene.getLocalPlayerPosition();
    if (!localPos) return;

    // Calculate distance between players (grid squares are 10 units)
    const dx = remotePosition.x - localPos.x;
    const dz = remotePosition.z - localPos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Get audio tracks
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    // Find or create audio element for this peer
    let audio = document.getElementById(`audio-${peerId}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `audio-${peerId}`;
      audio.srcObject = new MediaStream(audioTracks);
      audio.autoplay = true;
      document.body.appendChild(audio);
      
      // Explicitly play audio (required by browser autoplay policies)
      audio.play().catch(err => {
        console.warn('Audio autoplay blocked for', peerId, '- user interaction required:', err);
      });
    }

    // Set volume based on proximity
    const proximityRange = 100;
    if (distance <= proximityRange) {
      const volume = 1 - (distance / proximityRange);
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.muted = false;
    } else {
      audio.muted = true;
    }
  }

  startGameLoop() {
    const gameLoop = () => {
      // Update local player position based on input
      const currentPos = this.scene.getLocalPlayerPosition();
      const rotation = this.controller.getRotation();
      const pitch = this.controller.getPitch();
      const zoom = this.controller.getZoom();
      
      if (currentPos) {
        const newPos = this.controller.update(currentPos);
        
        // Check for collisions - bounce on collision
        if (this.scene.checkCollision && this.scene.checkCollision(newPos)) {
          this.controller.bounce();
        } else {
          // Update local player in scene with rotation (Doom-style)
          this.scene.updatePlayer(this.network.localPlayer.id, newPos, rotation);
          
          // Update network state
          this.network.updateLocalPlayer({
            position: newPos,
            velocity: this.controller.getVelocity(),
            rotation: rotation
          });
        }
      }

      // Render scene with current rotation, pitch, and zoom
      this.scene.render(rotation, pitch, zoom);

      // Continue loop
      requestAnimationFrame(gameLoop);
    };

    gameLoop();
  }

  initEventLog() {
    const logContainer = document.getElementById('event-log');
    logContainer.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      width: 90%;
      max-width: 600px;
      z-index: 2000;
      pointer-events: none;
      font-family: monospace;
      font-size: 14px;
    `;
  }

  logEvent(message, type = 'info') {
    const logContainer = document.getElementById('event-log');
    if (!logContainer) return;

    // Detect if mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const maxMessages = isMobile ? 1 : 5;

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    // Set color based on type
    let color = '#00ffff'; // default cyan
    let bgColor = 'rgba(0, 20, 40, 0.9)';
    
    if (type === 'join') {
      color = '#00ff00'; // green
    } else if (type === 'video-success') {
      color = '#00ffff'; // cyan
    } else if (type === 'video-fail') {
      color = '#ff6600'; // orange
    } else if (type === 'error') {
      color = '#ff0000'; // red
    }
    
    entry.style.cssText = `
      background: ${bgColor};
      color: ${color};
      padding: 8px 12px;
      margin-bottom: 5px;
      border-radius: 4px;
      border: 1px solid ${color};
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    `;
    
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.appendChild(entry);
    
    // Fade in
    setTimeout(() => {
      entry.style.opacity = '1';
    }, 10);
    
    // Fade out and remove after 5 seconds
    setTimeout(() => {
      entry.style.opacity = '0';
      setTimeout(() => {
        if (entry.parentNode) {
          entry.parentNode.removeChild(entry);
        }
      }, 300);
    }, 5000);
    
    // Keep only last N messages (1 on mobile, 5 on desktop)
    const entries = logContainer.querySelectorAll('.log-entry');
    if (entries.length > maxMessages) {
      const oldest = entries[0];
      oldest.style.opacity = '0';
      setTimeout(() => {
        if (oldest.parentNode) {
          oldest.parentNode.removeChild(oldest);
        }
      }, 300);
    }
  }

  // Clean up on page unload
  destroy() {
    if (this.network) {
      this.network.stop();
    }
  }
}

// Initialize the application
const app = new CubeChat();
app.init();

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  app.destroy();
});

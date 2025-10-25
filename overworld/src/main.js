import './style.css';
import { P2PNetwork } from './p2p/network.js';
import { TronScene } from './renderer/scene.js';
import { PlayerController } from './controls/input.js';

class TronOverworld {
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
        <h1>Overworld</h1>
        <p>Initializing P2P Network...</p>
        <p style="font-size: 0.9em; color: #00ffff;">Click to start</p>
        <p style="font-size: 0.8em; color: #00cccc; max-width: 90%; margin: 0.5em auto;">WASD: Move | Mouse/Arrows: Look | Movement has momentum</p>
      </div>
      <div id="scene-container"></div>
    `;

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
    } else if (message.type === 'stream_removed') {
      // Remove video texture from cube (revert to colored cube)
      this.scene.removePlayerVideoStream(message.peerId);
      
      // Clean up audio element
      const audio = document.getElementById(`audio-${message.peerId}`);
      if (audio) {
        audio.remove();
      }
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
    const gridDistance = distance / 10; // Convert to grid squares

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
    }

    // Set volume based on proximity (within 2 grid squares = 20 units)
    const proximityRange = 20;
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

      // Render scene with current rotation
      this.scene.render(rotation);

      // Continue loop
      requestAnimationFrame(gameLoop);
    };

    gameLoop();
  }

  // Clean up on page unload
  destroy() {
    if (this.network) {
      this.network.stop();
    }
  }
}

// Initialize the application
const app = new TronOverworld();
app.init();

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  app.destroy();
});

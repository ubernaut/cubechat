import * as THREE from 'three';

export class TronScene {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.players = new Map();
    this.localPlayerId = null;
    
    this.init();
  }

  init() {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000428); // Dark blue background
    this.scene.fog = new THREE.Fog(0x000428, 50, 200);

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 20, 30);
    this.camera.lookAt(0, 0, 0);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // Create infinite grid
    this.createGrid();

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambientLight);

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0x00ffff, 1);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());
  }

  createGrid() {
    this.gridSize = 1000;
    
    // Create shader-based grid that renders properly from all angles
    const gridShader = {
      vertexShader: `
        varying vec3 worldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          worldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 worldPosition;
        uniform float gridSize;
        uniform vec3 gridColor;
        uniform vec3 backgroundColor;
        
        float getGrid(float coord, float gridSize) {
          float line = abs(fract(coord / gridSize - 0.5) - 0.5) / fwidth(coord / gridSize);
          return min(line, 1.0);
        }
        
        void main() {
          float x = getGrid(worldPosition.x, 10.0);
          float z = getGrid(worldPosition.z, 10.0);
          float grid = 1.0 - min(x, z);
          
          // Fade grid with distance
          float dist = length(worldPosition.xz);
          float fade = 1.0 - smoothstep(300.0, 500.0, dist);
          grid *= fade;
          
          vec3 color = mix(backgroundColor, gridColor, grid);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      uniforms: {
        gridSize: { value: 10.0 },
        gridColor: { value: new THREE.Color(0x00ffff) },
        backgroundColor: { value: new THREE.Color(0x001040) }
      }
    };

    const gridMaterial = new THREE.ShaderMaterial({
      vertexShader: gridShader.vertexShader,
      fragmentShader: gridShader.fragmentShader,
      uniforms: gridShader.uniforms,
      side: THREE.DoubleSide
    });

    this.floorGeometry = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
    this.floor = new THREE.Mesh(this.floorGeometry, gridMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0;
    this.scene.add(this.floor);
  }

  expandGrid(playerPosition) {
    // Check if player is getting close to grid edge
    const distanceFromCenter = Math.sqrt(
      playerPosition.x * playerPosition.x + 
      playerPosition.z * playerPosition.z
    );
    
    // Expand if within 30% of edge
    const expansionThreshold = this.gridSize * 0.35;
    if (distanceFromCenter > expansionThreshold) {
      // Remove old floor
      this.scene.remove(this.floor);
      
      // Increase size
      this.gridSize += 200;
      
      // Create shader-based grid
      const gridShader = {
        vertexShader: `
          varying vec3 worldPosition;
          void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            worldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 worldPosition;
          uniform float gridSize;
          uniform vec3 gridColor;
          uniform vec3 backgroundColor;
          
          float getGrid(float coord, float gridSize) {
            float line = abs(fract(coord / gridSize - 0.5) - 0.5) / fwidth(coord / gridSize);
            return min(line, 1.0);
          }
          
          void main() {
            float x = getGrid(worldPosition.x, 10.0);
            float z = getGrid(worldPosition.z, 10.0);
            float grid = 1.0 - min(x, z);
            
            // Fade grid with distance
            float dist = length(worldPosition.xz);
            float fade = 1.0 - smoothstep(300.0, 500.0, dist);
            grid *= fade;
            
            vec3 color = mix(backgroundColor, gridColor, grid);
            gl_FragColor = vec4(color, 1.0);
          }
        `,
        uniforms: {
          gridSize: { value: 10.0 },
          gridColor: { value: new THREE.Color(0x00ffff) },
          backgroundColor: { value: new THREE.Color(0x001040) }
        }
      };

      const gridMaterial = new THREE.ShaderMaterial({
        vertexShader: gridShader.vertexShader,
        fragmentShader: gridShader.fragmentShader,
        uniforms: gridShader.uniforms,
        side: THREE.DoubleSide
      });

      this.floorGeometry = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
      this.floor = new THREE.Mesh(this.floorGeometry, gridMaterial);
      this.floor.rotation.x = -Math.PI / 2;
      this.floor.position.y = 0;
      this.scene.add(this.floor);
      
      console.log('Grid expanded to size:', this.gridSize);
    }
  }

  createPlayer(id, color, position) {
    // Create cube for player (6x6x6 - twice as big)
    const geometry = new THREE.BoxGeometry(6, 6, 6);
    
    // Create materials array for each face
    const materials = [];
    for (let i = 0; i < 6; i++) {
      materials.push(new THREE.MeshPhongMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5,
        shininess: 100
      }));
    }
    
    const cube = new THREE.Mesh(geometry, materials);
    cube.position.set(position.x, position.y, position.z);
    cube.userData.videoTexture = null;
    cube.userData.videoElement = null;

    // Add glow effect (proportionally bigger, offset back by 1.4 units)
    const glowGeometry = new THREE.BoxGeometry(7.2, 7.2, 7.2);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 1,
      transparent: true,
      opacity: 0.3
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    //glow.position.z = 1.4; // Offset back so front of cube sticks through
    cube.add(glow);

    this.scene.add(cube);
    this.players.set(id, cube);

    return cube;
  }

  setPlayerVideoStream(id, stream) {
    const player = this.players.get(id);
    if (!player) {
      console.error('Player not found:', id);
      return;
    }
    if (!stream) {
      console.error('No stream provided for player:', id);
      return;
    }

    console.log('Setting video stream for player', id);
    console.log('Stream video tracks:', stream.getVideoTracks().length);

    // Store original color
    if (!player.userData.originalColor) {
      const firstMaterial = Array.isArray(player.material) ? player.material[0] : player.material;
      player.userData.originalColor = firstMaterial.color.clone();
    }

    // Create video element
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true; // Important for mobile
    video.muted = true; // Will control audio separately for proximity
    
    // Wait for video metadata to load before applying texture
    video.onloadedmetadata = () => {
      console.log('Video metadata loaded for', id, 'Dimensions:', video.videoWidth, 'x', video.videoHeight);
      
      // Create video texture
      const videoTexture = new THREE.VideoTexture(video);
      videoTexture.minFilter = THREE.LinearFilter;
      videoTexture.magFilter = THREE.LinearFilter;
      videoTexture.format = THREE.RGBFormat;
      
      // Apply to all faces for testing (will show on all sides)
      const videoMaterial = new THREE.MeshBasicMaterial({
        map: videoTexture
      });
      
      // Replace all materials with video material
      if (Array.isArray(player.material)) {
        player.material = player.material.map(() => videoMaterial.clone());
        player.material[4].map = videoTexture; // Front face gets the texture
      } else {
        player.material = videoMaterial;
      }
      
      // Store references
      player.userData.videoTexture = videoTexture;
      player.userData.videoElement = video;
      
      console.log('Applied video texture to player', id);
    };
    
    // Ensure video plays
    video.play().then(() => {
      console.log('Video playing for', id);
    }).catch(err => {
      console.error('Error playing video for', id, err);
    });
  }

  removePlayerVideoStream(id) {
    const player = this.players.get(id);
    if (!player) return;

    console.log('Removing video stream from player', id);

    // Stop and clean up video element
    if (player.userData.videoElement) {
      player.userData.videoElement.pause();
      player.userData.videoElement.srcObject = null;
      player.userData.videoElement = null;
    }

    // Dispose video texture
    if (player.userData.videoTexture) {
      player.userData.videoTexture.dispose();
      player.userData.videoTexture = null;
    }

    // Restore original colored materials
    if (player.userData.originalColor) {
      const materials = [];
      for (let i = 0; i < 6; i++) {
        materials.push(new THREE.MeshPhongMaterial({
          color: player.userData.originalColor,
          emissive: player.userData.originalColor,
          emissiveIntensity: 0.5,
          shininess: 100
        }));
      }
      player.material = materials;
    }

    console.log('Restored original materials for player', id);
  }

  updatePlayer(id, position, rotation = null) {
    const player = this.players.get(id);
    if (player) {
      // For local player, use direct position (no lerp) for precise physics
      // For remote players, use lerp to smooth network jitter
      if (id === this.localPlayerId) {
        player.position.set(position.x, position.y, position.z);
      } else {
        player.position.lerp(
          new THREE.Vector3(position.x, position.y, position.z),
          0.2
        );
      }
      
      // Update rotation if provided (for local player)
      if (rotation !== null) {
        player.rotation.y = rotation;
      }
    }
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (player) {
      this.scene.remove(player);
      this.players.delete(id);
    }
  }

  setLocalPlayer(id) {
    this.localPlayerId = id;
  }

  updateCamera(rotation = 0, pitch = 0, zoom = 1.0) {
    // Follow local player with rotation, pitch, and zoom
    if (this.localPlayerId) {
      const localPlayer = this.players.get(this.localPlayerId);
      if (localPlayer) {
        const baseDistance = 15; // Base camera distance
        const distance = baseDistance * zoom; // Apply zoom to distance
        const baseHeight = 10;   // Base camera height
        
        // Calculate camera position based on rotation and pitch
        // Pitch affects the vertical position and distance
        const horizontalDistance = distance * Math.cos(pitch);
        const verticalOffset = distance * Math.sin(pitch);
        
        // Use direct positioning for immediate, smooth response
        this.camera.position.set(
          localPlayer.position.x + Math.sin(rotation) * horizontalDistance,
          localPlayer.position.y + baseHeight + verticalOffset,
          localPlayer.position.z + Math.cos(rotation) * horizontalDistance
        );
        
        // Look at a point offset from the player based on pitch
        const lookAtTarget = new THREE.Vector3(
          localPlayer.position.x,
          localPlayer.position.y - Math.tan(pitch) * 5,
          localPlayer.position.z
        );
        this.camera.lookAt(lookAtTarget);
      }
    }
  }

  render(rotation = 0, pitch = 0, zoom = 1.0) {
    this.updateCamera(rotation, pitch, zoom);
    
    // Check if grid needs expansion
    const localPlayerPos = this.getLocalPlayerPosition();
    if (localPlayerPos) {
      this.expandGrid(localPlayerPos);
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  getLocalPlayerPosition() {
    if (this.localPlayerId) {
      const player = this.players.get(this.localPlayerId);
      if (player) {
        return {
          x: player.position.x,
          y: player.position.y,
          z: player.position.z
        };
      }
    }
    return null;
  }
}

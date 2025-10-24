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
    const gridSize = 200;
    const gridDivisions = 40;
    const gridColor = 0x00ffff; // Cyan for Tron theme

    // Create main grid
    const gridHelper = new THREE.GridHelper(
      gridSize,
      gridDivisions,
      gridColor,
      gridColor
    );
    gridHelper.material.opacity = 0.3;
    gridHelper.material.transparent = true;
    this.scene.add(gridHelper);

    // Add glowing effect to grid lines
    const gridMaterial = new THREE.LineBasicMaterial({
      color: gridColor,
      opacity: 0.5,
      transparent: true
    });

    // Create floor plane for better visual effect
    const floorGeometry = new THREE.PlaneGeometry(gridSize, gridSize);
    const floorMaterial = new THREE.MeshBasicMaterial({
      color: 0x001030,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    this.scene.add(floor);
  }

  createPlayer(id, color, position) {
    // Create cube for player
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshPhongMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      shininess: 100
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(position.x, position.y, position.z);

    // Add glow effect
    const glowGeometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.3
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    cube.add(glow);

    this.scene.add(cube);
    this.players.set(id, cube);

    return cube;
  }

  updatePlayer(id, position, rotation = null) {
    const player = this.players.get(id);
    if (player) {
      // Smooth interpolation
      player.position.lerp(
        new THREE.Vector3(position.x, position.y, position.z),
        0.2
      );
      
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

  updateCamera(rotation = 0) {
    // Follow local player with rotation
    if (this.localPlayerId) {
      const localPlayer = this.players.get(this.localPlayerId);
      if (localPlayer) {
        const distance = 30;
        const height = 20;
        
        // Calculate camera position based on rotation
        const targetPos = new THREE.Vector3(
          localPlayer.position.x + Math.sin(rotation) * distance,
          localPlayer.position.y + height,
          localPlayer.position.z + Math.cos(rotation) * distance
        );
        
        this.camera.position.lerp(targetPos, 0.1);
        this.camera.lookAt(localPlayer.position);
      }
    }
  }

  render(rotation = 0) {
    this.updateCamera(rotation);
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

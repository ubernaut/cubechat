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
    this.gridSize = 1000; // Much larger initial grid
    this.gridDivisions = 100;
    const gridColor = 0x00ffff; // Cyan for Tron theme

    // Create main grid
    this.gridHelper = new THREE.GridHelper(
      this.gridSize,
      this.gridDivisions,
      gridColor,
      gridColor
    );
    this.gridHelper.material.opacity = 0.7;
    this.gridHelper.material.transparent = true;
    this.scene.add(this.gridHelper);

    // Add glowing effect to grid lines
    const gridMaterial = new THREE.LineBasicMaterial({
      color: gridColor,
      opacity: 0.8,
      transparent: true
    });

    // Create floor plane for better visual effect
    this.floorGeometry = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
    const floorMaterial = new THREE.MeshBasicMaterial({
      color: 0x002050,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7
    });
    this.floor = new THREE.Mesh(this.floorGeometry, floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.01;
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
      // Remove old grid and floor
      this.scene.remove(this.gridHelper);
      this.scene.remove(this.floor);
      
      // Increase size
      this.gridSize += 200;
      this.gridDivisions = Math.min(this.gridDivisions + 20, 200);
      
      const gridColor = 0x00ffff;
      
      // Create new larger grid
      this.gridHelper = new THREE.GridHelper(
        this.gridSize,
        this.gridDivisions,
        gridColor,
        gridColor
      );
      this.gridHelper.material.opacity = 0.7;
      this.gridHelper.material.transparent = true;
      this.scene.add(this.gridHelper);
      
      // Create new larger floor
      this.floorGeometry = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
      const floorMaterial = new THREE.MeshBasicMaterial({
        color: 0x002050,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7
      });
      this.floor = new THREE.Mesh(this.floorGeometry, floorMaterial);
      this.floor.rotation.x = -Math.PI / 2;
      this.floor.position.y = -0.01;
      this.scene.add(this.floor);
      
      console.log('Grid expanded to size:', this.gridSize);
    }
  }

  createPlayer(id, color, position) {
    // Create cube for player (3x bigger)
    const geometry = new THREE.BoxGeometry(3, 3, 3);
    const material = new THREE.MeshPhongMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      shininess: 100
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(position.x, position.y, position.z);

    // Add glow effect (proportionally bigger)
    const glowGeometry = new THREE.BoxGeometry(3.6, 3.6, 3.6);
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

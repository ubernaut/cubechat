# Tron Overworld - P2P Multiplayer Demo

A peer-to-peer multiplayer demo featuring a Tron-themed 3D environment built with Vite, Three.js, and a modular architecture designed for P2P networking.

## Features

- **Tron-Themed 3D Environment**: Dark infinite grid with cyan glowing lines
- **Player System**: Randomly colored cubes with glow effects
- **Movement Controls**: WASD for movement with rotation-relative direction
- **Camera Controls**: Arrow keys for camera rotation around the player
- **Modular Architecture**: ES6 modules with separate concerns
- **P2P Ready**: Architecture designed for libp2p integration (currently in demo mode)

## Project Structure

```
src/
├── p2p/
│   └── network.js       # P2P networking module (simplified for demo)
├── renderer/
│   └── scene.js         # Three.js scene and rendering
├── controls/
│   └── input.js         # Player input handling
├── main.js              # Main application orchestration
└── style.css            # Tron-themed styling
```

## Controls

- **W**: Move forward
- **S**: Move backward
- **A**: Strafe left
- **D**: Strafe right
- **Left Arrow**: Rotate camera left
- **Right Arrow**: Rotate camera right

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser to the local server URL (typically http://localhost:5173)

## Technical Details

### Modules

#### P2P Network Module (`src/p2p/network.js`)
- Handles player state management
- Designed for libp2p integration (currently simplified for demo)
- Manages peer discovery and message broadcasting
- Random player spawning to prevent overlap

#### Renderer Module (`src/renderer/scene.js`)
- Three.js scene setup with Tron aesthetics
- Grid generation with cyan lines
- Player cube rendering with glow effects
- Camera following system with rotation support
- Smooth interpolation for player movement

#### Input Controller (`src/controls/input.js`)
- Keyboard input handling
- Rotation-relative movement
- Camera rotation controls

### Design Principles

- **Modular ES6 Architecture**: Each major component is in its own module
- **Service Worker Ready**: Large components designed to run in separate threads
- **P2P Foundation**: Architecture built to support full libp2p integration

## Future Enhancements

To enable full P2P multiplayer:
1. Add signaling server infrastructure
2. Implement WebRTC connectivity via libp2p
3. Add peer discovery mechanisms
4. Implement state synchronization protocols

## Notes

The current demo runs in standalone mode to demonstrate the architecture and gameplay mechanics without requiring complex relay infrastructure. The P2P module is architected to be easily upgraded to full libp2p functionality when paired with appropriate signaling servers.

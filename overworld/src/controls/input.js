export class PlayerController {
  constructor() {
    this.keys = {};
    this.maxSpeed = 0.6;           // Maximum movement speed (3x faster)
    this.acceleration = 0.15;      // Acceleration rate (3x faster)
    this.friction = 0.95;          // Friction coefficient (0-1, lower = more friction)
    this.turnSpeed = 0.02;         // Arrow key turn speed
    this.mouseSensitivity = 0.002; // Mouse rotation sensitivity
    
    this.velocity = { x: 0, y: 0, z: 0 };
    this.rotation = 0; // Camera rotation around Y axis
    
    // Mobile controls
    this.isMobile = false;
    this.moveJoystick = { x: 0, y: 0 };
    this.lookJoystick = { x: 0, y: 0 };
    this.joystickElements = null;
    
    this.setupEventListeners();
  }

  setMobileMode(enabled) {
    this.isMobile = enabled;
    if (enabled) {
      this.createMobileControls();
    }
  }

  createMobileControls() {
    // Create joystick container
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'mobile-controls';
    controlsDiv.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
    `;

    // Left joystick (movement)
    const leftJoy = this.createJoystick('left', 'Move');
    leftJoy.style.cssText += 'left: 50px; bottom: 50px;';
    
    // Right joystick (look)
    const rightJoy = this.createJoystick('right', 'Look');
    rightJoy.style.cssText += 'right: 50px; bottom: 50px;';

    controlsDiv.appendChild(leftJoy);
    controlsDiv.appendChild(rightJoy);
    document.body.appendChild(controlsDiv);

    this.joystickElements = { left: leftJoy, right: rightJoy };
    this.setupJoystickListeners(leftJoy, 'move');
    this.setupJoystickListeners(rightJoy, 'look');
  }

  createJoystick(side, label) {
    const container = document.createElement('div');
    container.className = `joystick-${side}`;
    container.style.cssText = `
      position: absolute;
      width: 120px;
      height: 120px;
      pointer-events: auto;
    `;

    const base = document.createElement('div');
    base.style.cssText = `
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: rgba(0, 255, 255, 0.2);
      border: 2px solid rgba(0, 255, 255, 0.5);
    `;

    const stick = document.createElement('div');
    stick.className = 'stick';
    stick.style.cssText = `
      position: absolute;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: rgba(0, 255, 255, 0.6);
      border: 2px solid #00ffff;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      transition: all 0.1s;
    `;

    const labelDiv = document.createElement('div');
    labelDiv.textContent = label;
    labelDiv.style.cssText = `
      position: absolute;
      top: -25px;
      left: 50%;
      transform: translateX(-50%);
      color: #00ffff;
      font-size: 12px;
      font-family: monospace;
      white-space: nowrap;
    `;

    container.appendChild(base);
    container.appendChild(stick);
    container.appendChild(labelDiv);

    return container;
  }

  setupJoystickListeners(joystick, type) {
    const stick = joystick.querySelector('.stick');
    const maxDistance = 35; // Max distance stick can move from center
    let touchId = null;

    const updateStick = (clientX, clientY) => {
      const rect = joystick.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      let deltaX = clientX - centerX;
      let deltaY = clientY - centerY;
      
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      if (distance > maxDistance) {
        const angle = Math.atan2(deltaY, deltaX);
        deltaX = Math.cos(angle) * maxDistance;
        deltaY = Math.sin(angle) * maxDistance;
      }
      
      stick.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;
      
      // Normalize to -1 to 1
      const normalizedX = deltaX / maxDistance;
      const normalizedY = deltaY / maxDistance;
      
      if (type === 'move') {
        this.moveJoystick = { x: normalizedX, y: normalizedY };
      } else {
        this.lookJoystick = { x: normalizedX, y: normalizedY };
      }
    };

    const resetStick = () => {
      stick.style.transform = 'translate(-50%, -50%)';
      if (type === 'move') {
        this.moveJoystick = { x: 0, y: 0 };
      } else {
        this.lookJoystick = { x: 0, y: 0 };
      }
    };

    const getTouchInBounds = (touches) => {
      const rect = joystick.getBoundingClientRect();
      for (let touch of touches) {
        if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
            touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
          return touch;
        }
      }
      return null;
    };

    joystick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const touch = getTouchInBounds(e.touches);
      if (touch && touchId === null) {
        touchId = touch.identifier;
        updateStick(touch.clientX, touch.clientY);
      }
    });

    document.addEventListener('touchmove', (e) => {
      if (touchId !== null) {
        for (let touch of e.touches) {
          if (touch.identifier === touchId) {
            e.preventDefault();
            updateStick(touch.clientX, touch.clientY);
            break;
          }
        }
      }
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      for (let touch of e.changedTouches) {
        if (touch.identifier === touchId) {
          touchId = null;
          resetStick();
          break;
        }
      }
    });

    document.addEventListener('touchcancel', (e) => {
      for (let touch of e.changedTouches) {
        if (touch.identifier === touchId) {
          touchId = null;
          resetStick();
          break;
        }
      }
    });
  }

  setupEventListeners() {
    // Keyboard events
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    // Mouse movement for rotation (when pointer is locked)
    document.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement) {
        this.rotation -= event.movementX * this.mouseSensitivity;
      }
    });
  }

  update(currentPosition) {
    const newPosition = { ...currentPosition };
    
    // Calculate movement direction relative to camera/cube orientation
    let forwardBack = 0;
    let leftRight = 0;
    
    if (this.isMobile) {
      // Use joysticks for mobile
      // Move joystick: y-axis is forward/back, x-axis is strafe
      forwardBack = -this.moveJoystick.y;  // Inverted because joystick up is negative
      leftRight = this.moveJoystick.x;
      
      // Look joystick: x-axis rotates view
      if (Math.abs(this.lookJoystick.x) > 0.1) {
        this.rotation -= this.lookJoystick.x * this.turnSpeed * 2; // Faster rotation on mobile
      }
    } else {
      // Use keyboard for desktop
      // Forward/backward
      if (this.keys['w']) {
        forwardBack = 1;  // Move forward
      }
      if (this.keys['s']) {
        forwardBack = -1; // Move backward
      }
      
      // Left/right strafe
      if (this.keys['a']) {
        leftRight = -1;   // Strafe left
      }
      if (this.keys['d']) {
        leftRight = 1;    // Strafe right
      }
      
      // Apply rotation from arrow keys
      if (this.keys['arrowleft']) {
        this.rotation += this.turnSpeed;
      }
      if (this.keys['arrowright']) {
        this.rotation -= this.turnSpeed;
      }
    }
    
    // Apply movement relative to rotation
    if (forwardBack !== 0 || leftRight !== 0) {
      // Normalize diagonal movement
      const length = Math.sqrt(forwardBack * forwardBack + leftRight * leftRight);
      const normForward = forwardBack / length;
      const normRight = leftRight / length;
      
      // Convert to world space based on current rotation
      // Forward is -Z, Right is +X in local space
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      
      // Transform local movement to world space
      const worldX = -sin * normForward + cos * normRight;
      const worldZ = -cos * normForward - sin * normRight;
      
      // Apply acceleration
      this.velocity.x += worldX * this.acceleration;
      this.velocity.z += worldZ * this.acceleration;
    }
    
    // Apply friction
    this.velocity.x *= this.friction;
    this.velocity.z *= this.friction;
    
    // Limit max speed
    const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    if (speed > this.maxSpeed) {
      this.velocity.x = (this.velocity.x / speed) * this.maxSpeed;
      this.velocity.z = (this.velocity.z / speed) * this.maxSpeed;
    }
    
    // Stop if very slow
    if (speed < 0.001) {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
    
    // Apply velocity to position
    newPosition.x += this.velocity.x;
    newPosition.z += this.velocity.z;

    return newPosition;
  }

  getVelocity() {
    return {
      x: this.velocity.x,
      y: 0,
      z: this.velocity.z
    };
  }

  getRotation() {
    return this.rotation;
  }

  getSpeed() {
    return Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
  }

  // Bounce effect on collision
  bounce() {
    this.velocity.x *= -0.5;
    this.velocity.z *= -0.5;
  }
}

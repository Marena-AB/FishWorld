import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { generateTerrain } from './sand-generation.js';
import { Fish } from './fish.js';

// Core scene/terrain settings
const HEIGHT_SCALE = 2.5;        // vertical exaggeration of seabed
const DETAIL = 10;               // (2^detail + 1) resolution
const TILE_SEGMENTS = 2 ** DETAIL; // equals size - 1 for geometry segments
const PLANE_SIZE = 800;          // world-space span of the seabed
const SWIM_ACCEL = 45;           // swim acceleration strength
const SWIM_DRAG = 0.9;           // damping factor per frame
const MAX_SWIM_SPEED = 50;       // cap on swim speed
const CAMERA_FOLLOW_LERP = 0.1;  // smoothing for camera follow
const INITIAL_CAMERA_OFFSET = new THREE.Vector3(0, 6, -15); // closer follow start

// Day/night cycle settings
const cycleDurationMs = 60000; 
const daySkyColor = new THREE.Color(0x8cc8ff);
const nightSkyColor = new THREE.Color(0x0a1938);
const dayWaterColor = new THREE.Color(0x006994); 
const nightWaterColor = new THREE.Color(0x000510);
const dayUnderwaterFog = new THREE.Color(0x1a5f7a); 
const nightUnderwaterFog = new THREE.Color(0x0a1938);

// Scene
const scene = new THREE.Scene();
scene.background = dayUnderwaterFog.clone(); 
scene.fog = new THREE.Fog(dayUnderwaterFog.clone(), 30, 200); 

// Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 10, 50); 

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(dayUnderwaterFog);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();
const loader = new GLTFLoader();
let fish;
let mixer;
const aiFish = []; // Array to hold all AI fish
let controlledFish = null;
const fishVelocity = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();
const moveState = { forward: false, back: false, left: false, right: false, up: false, down: false };
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const upVector = new THREE.Vector3(0, 1, 0);
const tmpHeading = new THREE.Vector3();
const desiredCamPos = new THREE.Vector3();
const accel = new THREE.Vector3();

// Controls
let controls;
function initControls() {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.target.set(0, 0, 0); 
    
    controls.maxPolarAngle = Math.PI / 2 - 0.1; 
    controls.minDistance = 5; 
    controls.maxDistance = 300; 

    controls.addEventListener('change', () => {
        if (fish) {
            cameraOffset.copy(camera.position).sub(controls.target);
        }
    });
}

let ambient;
let sun;
function initLights() {
    ambient = new THREE.AmbientLight(0x4a9fb5, 0.5);
    scene.add(ambient);

    sun = new THREE.DirectionalLight(0x88c5d8, 0.8);
    sun.position.set(60, 110, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.far = 1200;
    sun.shadow.camera.left = -500;
    sun.shadow.camera.right = 500;
    sun.shadow.camera.top = 500;
    sun.shadow.camera.bottom = -500;
    scene.add(sun);
    scene.add(sun.target);
}

function buildSandDunes() {
    const roughness = 0.35;
    const heightmap = generateTerrain(DETAIL, roughness);
    const size = heightmap.length; 

    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            const v = heightmap[x][y];
            if (v < min) { min = v; }
            if (v > max) { max = v; }
        }
    }

    const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, TILE_SEGMENTS, TILE_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
        const ix = i % size;
        const iy = Math.floor(i / size);
        const normalized = (heightmap[ix][iy] - min) / (max - min);
        const duneHeight = (normalized - 0.5) * HEIGHT_SCALE;
        position.setY(i, duneHeight);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    // Sand material
    const material = new THREE.MeshStandardMaterial({
        color: 0xcbbca1, 
        roughness: 0.9,
        metalness: 0,
        flatShading: false,
    });

    const dunes = new THREE.Mesh(geometry, material);
    dunes.receiveShadow = true;
    dunes.castShadow = false;
    scene.add(dunes);
}

let water;
function addWaterSurface() {
    const waterGeometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    
    const textureLoader = new THREE.TextureLoader();
    const waterNormalsUrl = new URL('./textures/waternormals.jpg', import.meta.url).href;
    const waterNormals = textureLoader.load(waterNormalsUrl, function(texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    });
    
    water = new Water(waterGeometry, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: waterNormals,
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x006994, 
        distortionScale: 5.0,
        fog: scene.fog !== undefined,
        alpha: 0.9 
    });
    
    water.rotation.x = -Math.PI / 2;
    water.position.y = 25; 
    
    scene.add(water);
}

function loadFishPlayer() {
    loader.load(
        new URL('./assets/fish.glb', import.meta.url).href,
        (gltf) => {
            fish = gltf.scene;
            fish.position.set(0, 5, 0);
            fish.scale.setScalar(1);
            fish.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                }
            });
            scene.add(fish);
            fish.rotation.y = 0; 
            controls.target.copy(fish.position);
            cameraOffset.copy(INITIAL_CAMERA_OFFSET);
            camera.position.copy(fish.position).add(cameraOffset);

            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(fish);
                gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
            }
            
            controlledFish = fish;
            
            initPlayerFishAI();
        },
        undefined,
        (error) => console.error('Failed to load fish model', error),
    );
}

function switchControl() {
    const controllableFish = [fish, ...aiFish.filter(f => f.canMove)];
    
    if (controllableFish.length < 2) {
        console.log('Need at least 2 fish to switch');
        return;
    }
    
    const currentIndex = controllableFish.indexOf(controlledFish);
    const nextIndex = (currentIndex + 1) % controllableFish.length;
    const nextFish = controllableFish[nextIndex];
    
    if (controlledFish && controlledFish.setControlled) {
        controlledFish.setControlled(false);
    }
    if (controlledFish === fish) {
        fishVelocity.set(0, 0, 0);
    }
    
    controlledFish = nextFish;
    if (nextFish.setControlled) {
        nextFish.setControlled(true);
    }
    
    const targetPosition = nextFish.model ? nextFish.model.position : nextFish.position;
    cameraOffset.copy(camera.position).sub(targetPosition);
    if (cameraOffset.lengthSq() === 0) {
        cameraOffset.copy(INITIAL_CAMERA_OFFSET);
    }
    controls.target.copy(targetPosition);
    camera.position.copy(targetPosition).add(cameraOffset);
    
    console.log(`Switched control to fish ${nextIndex + 1} of ${controllableFish.length}`);
}

function spawnFish(config) {
    const worldBounds = {
        min: -PLANE_SIZE / 2,
        max: PLANE_SIZE / 2,
        minY: 5,
        maxY: 40
    };
    
    // Generate random starting position if not provided
    // const defaultPosition = config.position || (() => {
    //     const boundary = (worldBounds.max - worldBounds.min) * 0.3;
    //     return new THREE.Vector3(
    //         (Math.random() - 0.5) * 2 * boundary,
    //         worldBounds.minY + Math.random() * (worldBounds.maxY - worldBounds.minY),
    //         (Math.random() - 0.5) * 2 * boundary
    //     );
    // })();
    
    const fish = new Fish(scene, {
        modelPath: config.modelPath,
        modelFile: config.modelFile,
        scale: config.scale || 0.05,
        position: config.position || new THREE.Vector3(5, 5, -3),
        moveSpeed: config.moveSpeed || 3.0,
        rotationSpeed: config.rotationSpeed || 3.0,
        changeTargetDistance: config.changeTargetDistance || 10.0,
        maxTravelTime: config.maxTravelTime || 5.0,
        minTravelTime: config.minTravelTime || 2.0,
        canMove: config.canMove !== undefined ? config.canMove : true,
        rotationOffsetY: config.rotationOffsetY || 0,
        rotationOffsetX: config.rotationOffsetX || 0,
        rotationOffsetZ: config.rotationOffsetZ || 0,
        worldBounds: worldBounds
    });
    
    aiFish.push(fish);
    return fish;
}

const FISH_MODELS = [
    {
        modelPath: '/assets/fish_models/fish_animated/',
        modelFile: 'scene.gltf',
        scale: 0.05,
        moveSpeed: 3.0,
        rotationSpeed: 2.0,
        changeTargetDistance: 15.0,
        maxTravelTime: 4.0,
        minTravelTime: 1.5,
        rotationOffsetY: 0
    },
    // {
    //     modelPath: '/assets/fish_models/koi_fish/',
    //     modelFile: 'scene.gltf',
    //     scale: 0.8,
    //     moveSpeed: 3.5,
    //     rotationSpeed: 2.5,
    //     changeTargetDistance: 12.0,
    //     maxTravelTime: 5.0,
    //     minTravelTime: 2.0,
    //     rotationOffsetY: Math.PI / 2 + Math.PI
    // },
    // {
    //     modelPath: '/assets/fish_models/tuna_fish/',
    //     modelFile: 'scene.gltf',
    //     scale: 0.8,
    //     moveSpeed: 3.5,
    //     rotationSpeed: 2.5,
    //     changeTargetDistance: 12.0,
    //     maxTravelTime: 5.0,
    //     minTravelTime: 2.0,
    //     rotationOffsetY: 0
    // },
    // {
    //     modelPath: '/assets/fish_models/school_of_fish/',
    //     modelFile: 'scene.gltf',
    //     scale: 2.5,
    //     moveSpeed: 3.5,
    //     rotationSpeed: 2.5,
    //     changeTargetDistance: 20.0,
    //     maxTravelTime: 5.0,
    //     minTravelTime: 2.0,
    //     rotationOffsetY: 0
    // },
    // {
    //     modelPath: '/assets/fish_models/star_fish/',
    //     modelFile: 'scene.gltf',
    //     scale: 2.5,
    //     position: new THREE.Vector3(5, 0.5, 0),
    //     canMove: false  // Starfish don't move
    // }
];

function spawnAllFish() {
    FISH_MODELS.forEach((config) => {
        spawnFish(config);
    });
}

initControls();
initLights();
buildSandDunes();
addWaterSurface();
loadFishPlayer();
spawnAllFish();

const cycleStart = performance.now();

function updateDayNight(elapsedMs) {
    const t = ((elapsedMs % cycleDurationMs) / cycleDurationMs + 0.25) % 1; // offset start toward daytime
    const theta = t * Math.PI * 2;

    // Sun rotation
    const radius = 140;
    const sunY = Math.sin(theta) * 90;
    sun.position.set(Math.cos(theta) * radius, sunY + 10, Math.sin(theta) * radius * 0.6);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();

    // Light strengths
    const daylight = Math.max(0, sunY / 90);
    sun.intensity = 0.3 + daylight * 0.7; 
    ambient.intensity = 0.2 + daylight * 0.4; 

    // Underwater fog color
    const underwaterColor = nightUnderwaterFog.clone().lerp(dayUnderwaterFog, Math.max(0.15, daylight));
    scene.background.copy(underwaterColor);
    scene.fog.color.copy(underwaterColor);
    renderer.setClearColor(underwaterColor);
    
    if (water) {
        const sunDir = new THREE.Vector3();
        sunDir.copy(sun.position).normalize();
        water.material.uniforms['sunDirection'].value.copy(sunDir);
        
        const waterColor = nightWaterColor.clone().lerp(dayWaterColor, Math.max(0.2, daylight));
        water.material.uniforms['waterColor'].value.set(waterColor);
    }
}

function updateControlledFish(delta) {
    if (!controlledFish) return;
    
    if (controlledFish === fish) {
        updateFish(delta);
        return;
    }
    
    if (controlledFish.model && controlledFish.isControlled) {
        const tmpForward = new THREE.Vector3();
        const tmpRight = new THREE.Vector3();
        const upVector = new THREE.Vector3(0, 1, 0);
        const tmpHeading = new THREE.Vector3();
        const desiredCamPos = new THREE.Vector3();
        const accel = new THREE.Vector3();
        
        accel.set(0, 0, 0);
        camera.getWorldDirection(tmpForward);
        tmpForward.y = 0;
        if (tmpForward.lengthSq() === 0) { tmpForward.set(0, 0, -1); }
        tmpForward.normalize();
        tmpRight.crossVectors(tmpForward, upVector).normalize();

        if (moveState.forward) { accel.add(tmpForward); }
        if (moveState.back) { accel.addScaledVector(tmpForward, -1); }
        if (moveState.left) { accel.addScaledVector(tmpRight, -1); }
        if (moveState.right) { accel.add(tmpRight); }
        if (moveState.up) { accel.add(upVector); }
        if (moveState.down) { accel.addScaledVector(upVector, -1); }

        if (accel.lengthSq() > 0) {
            accel.normalize().multiplyScalar(SWIM_ACCEL);
            controlledFish.velocity.addScaledVector(accel, delta);
        }

        if (controlledFish.velocity.lengthSq() > MAX_SWIM_SPEED * MAX_SWIM_SPEED) {
            controlledFish.velocity.setLength(MAX_SWIM_SPEED);
        }
        controlledFish.velocity.multiplyScalar(Math.pow(SWIM_DRAG, delta * 60));
        controlledFish.model.position.addScaledVector(controlledFish.velocity, delta);

        tmpHeading.copy(controlledFish.velocity);
        tmpHeading.y = 0;
        if (tmpHeading.lengthSq() > 1e-4) {
            let baseRotation = Math.atan2(tmpHeading.x, tmpHeading.z);
            baseRotation += controlledFish.rotationOffsetY || 0;
            controlledFish.model.rotation.y = baseRotation;
        }

        if (cameraOffset.lengthSq() === 0) {
            cameraOffset.copy(camera.position).sub(controlledFish.model.position);
        }
        desiredCamPos.copy(cameraOffset).add(controlledFish.model.position);
        camera.position.lerp(desiredCamPos, CAMERA_FOLLOW_LERP);
        controls.target.copy(controlledFish.model.position);
    }
}

let playerFishAI = null;
function initPlayerFishAI() {
    if (!fish) return;

    playerFishAI = {
        targetPosition: new THREE.Vector3(),
        timeSinceTargetChange: 0,
        currentTargetTime: 0,
        pickRandomTarget: function() {
            const boundary = PLANE_SIZE * 0.2;
            const minY = 5;
            const maxY = 40;
            
            this.targetPosition.set(
                (Math.random() - 0.5) * 2 * boundary,
                minY + Math.random() * (maxY - minY),
                (Math.random() - 0.5) * 2 * boundary
            );
            
            this.timeSinceTargetChange = 0;
            this.currentTargetTime = 2.0 + Math.random() * 3.0;
        },
        update: function(delta) {
            if (!fish) return;
            
            this.timeSinceTargetChange += delta;
            
            const directionToTarget = new THREE.Vector3()
                .subVectors(this.targetPosition, fish.position);
            const distanceToTarget = directionToTarget.length();
            
            if (distanceToTarget < 10.0 || this.timeSinceTargetChange > this.currentTargetTime) {
                this.pickRandomTarget();
                return;
            }
            
            if (distanceToTarget > 0.001) {
                directionToTarget.normalize();
                const moveSpeed = 3.0;
                const moveDistance = moveSpeed * delta;
                fish.position.addScaledVector(directionToTarget, moveDistance);
                
                const heading = directionToTarget.clone();
                heading.y = 0;
                if (heading.lengthSq() > 1e-4) {
                    fish.rotation.y = Math.atan2(heading.x, heading.z);
                }
            }
        }
    };
    
    if (playerFishAI) {
        playerFishAI.pickRandomTarget();
    }
}

function updateFish(delta) {
    if (!fish) return;
    
    if (controlledFish === fish) {
        accel.set(0, 0, 0);
        camera.getWorldDirection(tmpForward);
        tmpForward.y = 0;
        if (tmpForward.lengthSq() === 0) { tmpForward.set(0, 0, -1); }
        tmpForward.normalize();
        tmpRight.crossVectors(tmpForward, upVector).normalize();

        if (moveState.forward) { accel.add(tmpForward); }
        if (moveState.back) { accel.addScaledVector(tmpForward, -1); }
        if (moveState.left) { accel.addScaledVector(tmpRight, -1); }
        if (moveState.right) { accel.add(tmpRight); }
        if (moveState.up) { accel.add(upVector); }
        if (moveState.down) { accel.addScaledVector(upVector, -1); }

        if (accel.lengthSq() > 0) {
            accel.normalize().multiplyScalar(SWIM_ACCEL);
            fishVelocity.addScaledVector(accel, delta);
        }

        if (fishVelocity.lengthSq() > MAX_SWIM_SPEED * MAX_SWIM_SPEED) {
            fishVelocity.setLength(MAX_SWIM_SPEED);
        }
        fishVelocity.multiplyScalar(Math.pow(SWIM_DRAG, delta * 60));
        fish.position.addScaledVector(fishVelocity, delta);

        tmpHeading.copy(fishVelocity);
        tmpHeading.y = 0;
        if (tmpHeading.lengthSq() > 1e-4) {
            fish.rotation.y = Math.atan2(tmpHeading.x, tmpHeading.z);
        }

        if (cameraOffset.lengthSq() === 0) {
            cameraOffset.copy(camera.position).sub(fish.position);
        }
        desiredCamPos.copy(cameraOffset).add(fish.position);
        camera.position.lerp(desiredCamPos, CAMERA_FOLLOW_LERP);
        controls.target.copy(fish.position);
    } else {
        // If player fish is not controlled, use AI behavior
        if (playerFishAI) {
            playerFishAI.update(delta);
        }
    }
}

function handleKey(event, isDown) {
    if (isDown && event.code === 'Tab') {
        event.preventDefault();
        switchControl();
        return;
    }
    
    switch (event.code) {
    case 'KeyW': moveState.forward = isDown; break;
    case 'KeyS': moveState.back = isDown; break;
    case 'KeyA': moveState.left = isDown; break;
    case 'KeyD': moveState.right = isDown; break;
    case 'Space': moveState.up = isDown; break;
    case 'ShiftLeft':
    case 'ShiftRight':
        moveState.down = isDown; break;
    default: break;
    }
}
window.addEventListener('keydown', (e) => handleKey(e, true));
window.addEventListener('keyup', (e) => handleKey(e, false));

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    updateDayNight(performance.now() - cycleStart);
    
    // Animate water
    if (water) {
        water.material.uniforms['time'].value += delta;
    }

    if (mixer) {
        mixer.update(delta);
    }
    
    if (controlledFish && controlledFish !== fish && controlledFish.mixer) {
        controlledFish.mixer.update(delta);
    }
    
    updateControlledFish(delta);

    updateFish(delta);
    
    aiFish.forEach((aiFish) => {
        if (!aiFish.isControlled) {
            aiFish.update(delta);
        }
    });

    if (controls) {
        controls.update();
    }

    renderer.render(scene, camera);
}
animate();

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', onWindowResize, false);

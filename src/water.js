import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
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
const CAMERA_FOLLOW_RESPONSE = 8; // smoothing speed for camera follow (per second)
const CAMERA_DISTANCE = 15;       // chase distance behind the fish
const CAMERA_HEIGHT = 6;          // chase height above the fish
const INITIAL_CAMERA_OFFSET = new THREE.Vector3(0, CAMERA_HEIGHT, -CAMERA_DISTANCE);
const BLOOM_STRENGTH = 1.15;
const BLOOM_RADIUS = 0.4;
const BLOOM_THRESHOLD = 0.1;
const SAND_COLOR = 0xd6c196;
const ROCK_COUNT = 30;
const KELP_COUNT = 18;
const PLAYER_BOUNDS = PLANE_SIZE * 0.48; // keep player over terrain
const PLAYER_MIN_Y = 3;
const PLAYER_MAX_Y = 45;
const PLAYER_RADIUS = 2.2;
const WATER_SURFACE_Y = 50;      // Y position of water surface

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
renderer.physicallyCorrectLights = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(dayUnderwaterFog);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();
const loader = new GLTFLoader();
let fish;
let mixer;
let guppyFish = [];
let nightFish = [];
let rocks = [];
let kelp = [];
const ambientActors = [];
const ambientMixers = [];
let dunes;
let composer;
let bloomPass;
let daylightFactor = 1;
let hudTimeLabel;
let hudCycleBar;
const fishVelocity = new THREE.Vector3();
const followOffset = new THREE.Vector3();
const moveState = { forward: false, back: false, left: false, right: false, up: false, down: false };
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const upVector = new THREE.Vector3(0, 1, 0);
const tmpHeading = new THREE.Vector3();
const desiredCamPos = new THREE.Vector3();
const accel = new THREE.Vector3();
const tmpCollide = new THREE.Vector3();
const tmpCollide2 = new THREE.Vector3();

// Asset URLs (must stay static for bundlers)
const SEAWEED_URL = new URL('./assets/sea_weed.glb', import.meta.url).href;
const TURTLE_URL = new URL('./assets/model_46a_-_subadult_green_sea_turtle.glb', import.meta.url).href;
const WHALE_URL = new URL('./assets/blue_whale.glb', import.meta.url).href;
const ORCA_URL = new URL('./assets/female_orca.glb', import.meta.url).href;
const SPERM_WHALE_URL = new URL('./assets/sperm_whale.glb', import.meta.url).href;
const STYLIZED_FISH_URL = new URL('./assets/stylized_fish.glb', import.meta.url).href;
const DISCUS_FISH_URL = new URL('./assets/discus_fish.glb', import.meta.url).href;
const PEEPER_URL = new URL('./assets/arctic_peeper.glb', import.meta.url).href;
const ALIEN_FISH_URL = new URL('./assets/alien_fish_animated.glb', import.meta.url).href;

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

}

let ambient;
let sun;
let causticsLight;
let causticsTexture;
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
        color: SAND_COLOR, 
        roughness: 0.9,
        metalness: 0,
        flatShading: false,
    });

    dunes = new THREE.Mesh(geometry, material);
    dunes.receiveShadow = true;
    dunes.castShadow = false;
    scene.add(dunes);
}

const terrainRaycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);
function snapToTerrain(object, offset = 0) {
    if (!dunes) { return; }
    terrainRaycaster.set(new THREE.Vector3(object.position.x, 200, object.position.z), downVector);
    const hit = terrainRaycaster.intersectObject(dunes, false)[0];
    if (hit) {
        object.position.y = hit.point.y + offset;
    }
}

function addRocksAndPlants() {
    const rockColor = new THREE.Color(0x6b6252);
    for (let i = 0; i < ROCK_COUNT; i++) {
        const geo = new THREE.DodecahedronGeometry(1 + Math.random() * 1.6, 0);
        const mat = new THREE.MeshStandardMaterial({
            color: rockColor.clone().offsetHSL((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.05),
            roughness: 0.95,
            metalness: 0.05
        });
        const rock = new THREE.Mesh(geo, mat);
        rock.scale.setScalar(2 + Math.random() * 4);
        rock.position.set((Math.random() - 0.5) * PLANE_SIZE * 0.7, 80, (Math.random() - 0.5) * PLANE_SIZE * 0.7);
        rock.castShadow = true;
        rock.receiveShadow = true;
        snapToTerrain(rock, -0.2);
        rocks.push(rock);
        scene.add(rock);
    }

    for (let i = 0; i < KELP_COUNT; i++) {
        const kelpHeight = 12 + Math.random() * 10;
        const kelpGeo = new THREE.CylinderGeometry(0.35, 0.6, kelpHeight, 6, 1);
        const kelpMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0x1f6b4a).offsetHSL((Math.random() - 0.5) * 0.05, 0.05, (Math.random() - 0.5) * 0.08),
            roughness: 0.8,
            metalness: 0.05
        });
        const kelpMesh = new THREE.Mesh(kelpGeo, kelpMat);
        kelpMesh.position.set((Math.random() - 0.5) * PLANE_SIZE * 0.65, 80, (Math.random() - 0.5) * PLANE_SIZE * 0.65);
        kelpMesh.rotation.y = Math.random() * Math.PI;
        kelpMesh.castShadow = true;
        kelpMesh.receiveShadow = true;
        snapToTerrain(kelpMesh, kelpHeight * 0.02);
        kelp.push(kelpMesh);
        scene.add(kelpMesh);
    }
}

function addSceneModel(options) {
    const { href, scale = 1, count = 1, area = 0.5, minY = 5, maxY = 35, yOffset = 0, rotation = null, snap = true } = options;
    loader.load(
        href,
        (gltf) => {
            const base = gltf.scene;
            const animations = gltf.animations || [];
            for (let i = 0; i < count; i++) {
                const instance = i === 0 ? base : base.clone(true);
                instance.traverse((obj) => {
                    if (obj.isMesh) {
                        obj.castShadow = true;
                        obj.receiveShadow = true;
                        if (obj.material) {
                            obj.material = obj.material.clone();
                        }
                    }
                });
                const pos = new THREE.Vector3(
                    (Math.random() - 0.5) * PLANE_SIZE * area,
                    minY + Math.random() * (maxY - minY),
                    (Math.random() - 0.5) * PLANE_SIZE * area
                );
                instance.position.copy(pos);
                instance.scale.setScalar(scale * (0.9 + Math.random() * 0.2));
                if (rotation !== null) {
                    instance.rotation.y = rotation;
                } else {
                    instance.rotation.y = Math.random() * Math.PI * 2;
                }
                if (snap) {
                    snapToTerrain(instance, yOffset);
                }
                scene.add(instance);
                ambientActors.push(instance);
                if (animations.length > 0) {
                    const mix = new THREE.AnimationMixer(instance);
                    animations.forEach((clip) => mix.clipAction(clip).play());
                    ambientMixers.push(mix);
                }
            }
        },
        undefined,
        (err) => console.error('Failed to load scene model', href, err)
    );
}

function addAmbientModels() {
    // Seaweed clusters for depth cues
    addSceneModel({
        href: SEAWEED_URL,
        scale: 4.5,
        count: 12,
        area: 0.55,
        minY: 5,
        maxY: 12,
        yOffset: -0.5
    });

    // Turtle drifting near the player space
    addSceneModel({
        href: TURTLE_URL,
        scale: 0.5,
        count: 1,
        area: 0.25,
        minY: 8,
        maxY: 16
    });
}

let water;
function addWaterSurface() {
    const waterGeometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    
    const textureLoader = new THREE.TextureLoader();
    const waterNormalsUrl = new URL('./textures/waternormals.jpg', import.meta.url).href;
    const waterNormals = textureLoader.load(waterNormalsUrl, function(texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(8, 8);
    });
    
    water = new Water(waterGeometry, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: waterNormals,
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x0a6cae, 
        distortionScale: 7.0,
        size: 4.0,
        fog: scene.fog !== undefined,
        alpha: 0.85 
    });
    
    water.rotation.x = -Math.PI / 2;
    water.position.y = 25; 
    
    scene.add(water);
}

function initPostProcessing() {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(window.devicePixelRatio);
    const renderPass = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    bloomPass.threshold = BLOOM_THRESHOLD;
    bloomPass.radius = BLOOM_RADIUS;
    bloomPass.strength = BLOOM_STRENGTH;
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
}

function createCausticsTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const drawFrame = (t) => {
        ctx.clearRect(0, 0, size, size);
        ctx.globalCompositeOperation = 'lighter';
        const bands = 8;
        for (let i = 0; i < bands; i++) {
            const phase = t * 0.35 + i * Math.PI / bands;
            const thickness = 8 + 6 * Math.sin(t * 0.4 + i);
            ctx.beginPath();
            for (let x = 0; x <= size; x += 6) {
                const y = size * 0.5 + Math.sin((x / size) * Math.PI * 4 + phase) * 50 + Math.sin((x / size) * Math.PI * 2 - phase * 0.7) * 35;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = `rgba(255,255,255,${0.05 + 0.08 * Math.sin(t + i)})`;
            ctx.lineWidth = thickness;
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
    };

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    texture.anisotropy = 8;
    texture.userData = { drawFrame, time: 0 };
    drawFrame(0);
    return texture;
}

function addCausticsLight() {
    causticsTexture = createCausticsTexture();
    causticsLight = new THREE.SpotLight(0xffffff, 0.45, 400, Math.PI / 3, 0.7, 1.5);
    causticsLight.position.set(0, 140, 0);
    causticsLight.target.position.set(0, 0, 0);
    causticsLight.map = causticsTexture;
    causticsLight.castShadow = false;
    scene.add(causticsLight);
    scene.add(causticsLight.target);
}

function buildHud() {
    const style = document.createElement('style');
    style.textContent = `
    .hud {
        position: fixed;
        top: 16px;
        left: 16px;
        color: #e9f7ff;
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 14px;
        backdrop-filter: blur(8px);
        background: rgba(4, 35, 60, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        padding: 10px 12px;
        pointer-events: none;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    }
    .hud h1 {
        margin: 0 0 6px 0;
        font-size: 15px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #b6e4ff;
    }
    .hud .controls {
        line-height: 1.4;
        opacity: 0.9;
    }
    .hud .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255,255,255,0.08);
        margin-bottom: 6px;
        font-weight: 600;
        letter-spacing: 0.01em;
        text-shadow: 0 1px 2px rgba(0,0,0,0.35);
    }
    .hud .indicator {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: linear-gradient(120deg, #ffe79a, #ffb347);
        box-shadow: 0 0 12px rgba(255, 215, 122, 0.8);
    }
    .hud .cycle-bar {
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: rgba(255,255,255,0.1);
        overflow: hidden;
        margin: 6px 0 10px 0;
    }
    .hud .cycle-bar .fill {
        width: 50%;
        height: 100%;
        background: linear-gradient(90deg, #ffea9a, #64c5ff, #1a5b9b);
        box-shadow: 0 0 8px rgba(100, 197, 255, 0.7);
        transition: width 0.3s ease, opacity 0.3s ease;
    }
    `;
    document.head.appendChild(style);

    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
        <h1>Swim Controls</h1>
        <div class="controls">WASD: swim · Mouse: look · Space/Shift: ascend/descend</div>
        <div class="cycle-bar"><div class="fill"></div></div>
        <div class="pill"><span class="indicator"></span><span class="label">Day</span></div>
    `;
    hudCycleBar = hud.querySelector('.fill');
    hudTimeLabel = hud.querySelector('.label');
    document.body.appendChild(hud);
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
            followOffset.copy(INITIAL_CAMERA_OFFSET);
            camera.position.copy(fish.position).add(followOffset);
            controls.update();

            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(fish);
                gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
            }
        },
        undefined,
        (error) => console.error('Failed to load fish model', error),
    );
}

function loadStaticFish() {
    const worldBounds = {
        min: -PLANE_SIZE / 2,
        max: PLANE_SIZE / 2,
        minY: 5,
        maxY: WATER_SURFACE_Y - 5  // Keep fish below water surface
    };

    const palette = [
        0x6fb4ff, 0xfbd27c, 0x7de0c5, 0xff9aad, 0xb19cd9, 0xffcc80,
        0x85e3ff, 0xffa07a, 0x98d8c8, 0xff7eb9, 0x9fd3f3, 0xf4c2c2
    ];
    
    // Define different fish types for daytime with more variety
    const fishTypes = [
        { path: '/assets/fish_animated/', file: 'scene.gltf', scale: 0.045, rotationOffsetY: 0, count: 12 },
        { path: '/assets/', file: 'arctic_peeper.glb', scale: 0.015, rotationOffsetY: Math.PI, count: 10 },
        { path: '/assets/', file: 'discus_fish.glb', scale: 0.018, rotationOffsetY: Math.PI / 2, count: 10 },
        { path: '/assets/', file: 'stylized_fish.glb', scale: 0.016, rotationOffsetY: 0, count: 8 },
    ];
    
    let colorIndex = 0;
    // Spawn multiple of each type
    fishTypes.forEach((fishType) => {
        for (let i = 0; i < fishType.count; i++) {
            const fishy = new Fish(scene, {
                modelPath: fishType.path,
                modelFile: fishType.file,
                scale: fishType.scale + Math.random() * fishType.scale * 0.4,
                color: palette[colorIndex % palette.length],
                rotationOffsetY: fishType.rotationOffsetY + (Math.random() - 0.5) * 0.3,
                position: new THREE.Vector3(
                    (Math.random() - 0.5) * PLANE_SIZE * 0.55,
                    6 + Math.random() * (WATER_SURFACE_Y - 15), // Keep below water surface
                    (Math.random() - 0.5) * PLANE_SIZE * 0.55
                ),
                moveSpeed: 2.2 + Math.random() * 2.0,
                rotationSpeed: 2.8 + Math.random() * 1.5,
                changeTargetDistance: 1.2 + Math.random() * 0.8,
                worldBounds: worldBounds,
                waterSurfaceY: WATER_SURFACE_Y,
                canJump: Math.random() < 0.3, // 30% of fish can jump
                radius: 1.5,
                materialModifier: (mat) => {
                    mat.roughness = 0.45;
                    mat.metalness = 0.08;
                }
            });
            guppyFish.push(fishy);
            colorIndex++;
        }
    });
}

function loadGlowingFish() {
    const worldBounds = {
        min: -PLANE_SIZE / 2,
        max: PLANE_SIZE / 2,
        minY: 7,
        maxY: WATER_SURFACE_Y - 5  // Keep glowing fish below water
    };
    // Expanded emissive color palette with more variety
    const emissivePalette = [
        0x64fff5, // cyan
        0x9f7bff, // purple
        0xfff89a, // yellow
        0xff6ec7, // pink
        0x7bffda, // aqua
        0xffa64d, // orange
        0x00ff88, // green
        0xff3366, // red-pink
        0x66ffff, // bright cyan
        0xcc99ff, // lavender
        0xffff66, // bright yellow
        0xff99cc  // light pink
    ];
    
    // Define different fish types with varying glow intensities
    const fishTypes = [
        // Bright glowing fish (high intensity)
        { path: '/assets/fish_animated/', file: 'scene.gltf', scale: 0.04, rotationOffsetY: 0, 
            count: 8, intensity: 2.0, pulseSpeed: 2.2 },
        { path: '/assets/', file: 'arctic_peeper.glb', scale: 0.012, rotationOffsetY: Math.PI, 
            count: 10, intensity: 1.8, pulseSpeed: 2.5 },
        { path: '/assets/', file: 'discus_fish.glb', scale: 0.014, rotationOffsetY: Math.PI / 2, 
            count: 10, intensity: 1.6, pulseSpeed: 2.0 },
        { path: '/assets/', file: 'stylized_fish.glb', scale: 0.016, rotationOffsetY: 0, 
            count: 7, intensity: 1.9, pulseSpeed: 1.8 },
        // Medium glowing fish (moderate intensity)
        { path: '/assets/fish_animated/', file: 'scene.gltf', scale: 0.035, rotationOffsetY: Math.PI / 4, 
            count: 6, intensity: 1.2, pulseSpeed: 3.0 },
        { path: '/assets/', file: 'arctic_peeper.glb', scale: 0.010, rotationOffsetY: -Math.PI / 2, 
            count: 8, intensity: 1.0, pulseSpeed: 2.8 },
    ];
    
    let colorIndex = 0;
    // Spawn multiple of each type with varied characteristics
    fishTypes.forEach((fishType) => {
        for (let i = 0; i < fishType.count; i++) {
            const glowFish = new Fish(scene, {
                modelPath: fishType.path,
                modelFile: fishType.file,
                scale: fishType.scale + Math.random() * fishType.scale * 0.35,
                color: 0x0f1c3c, // Dark base color
                emissiveColor: emissivePalette[colorIndex % emissivePalette.length],
                emissiveIntensity: fishType.intensity + Math.random() * 0.5,
                emissivePulseSpeed: fishType.pulseSpeed + Math.random() * 1.0,
                rotationOffsetY: fishType.rotationOffsetY + (Math.random() - 0.5) * 0.4,
                position: new THREE.Vector3(
                    (Math.random() - 0.5) * PLANE_SIZE * 0.5,
                    8 + Math.random() * (WATER_SURFACE_Y - 15),
                    (Math.random() - 0.5) * PLANE_SIZE * 0.5
                ),
                moveSpeed: 2.0 + Math.random() * 2.5,
                rotationSpeed: 3.2 + Math.random() * 1.5,
                changeTargetDistance: 1.5 + Math.random() * 0.8,
                worldBounds: worldBounds,
                waterSurfaceY: WATER_SURFACE_Y,
                canJump: Math.random() < 0.2, // 20% of glowing fish can jump
                radius: 1.4,
                materialModifier: (mat) => {
                    mat.roughness = 0.25 + Math.random() * 0.15;
                    mat.metalness = 0.2 + Math.random() * 0.15;
                }
            });
            nightFish.push(glowFish);
            colorIndex++;
        }
    });
}

// Large moving creatures (whales, orcas) that swim around
let largeFish = [];
function loadLargeCreatures() {
    const worldBounds = {
        min: -PLANE_SIZE / 2,
        max: PLANE_SIZE / 2,
        minY: 15,
        maxY: WATER_SURFACE_Y - 3  // Keep large creatures below water surface
    };
    
    // Blue Whale - slow, majestic
    const blueWhale = new Fish(scene, {
        modelPath: '/assets/',
        modelFile: 'blue_whale.glb',
        scale: 0.7,
        color: 0x4a7c9e,
        position: new THREE.Vector3(
            (Math.random() - 0.5) * PLANE_SIZE * 0.4,
            25 + Math.random() * 10,
            (Math.random() - 0.5) * PLANE_SIZE * 0.4
        ),
        moveSpeed: 4.0,
        rotationSpeed: 1.5,
        changeTargetDistance: 20,
        worldBounds: worldBounds,
        waterSurfaceY: WATER_SURFACE_Y,
        canJump: true,
        radius: 8,
        materialModifier: (mat) => {
            mat.roughness = 0.6;
            mat.metalness = 0.1;
        }
    });
    largeFish.push(blueWhale);
    
    // Orca - faster, more agile
    const orca = new Fish(scene, {
        modelPath: '/assets/',
        modelFile: 'female_orca.glb',
        scale: 0.8,
        color: 0x1a1a1a,
        position: new THREE.Vector3(
            (Math.random() - 0.5) * PLANE_SIZE * 0.5,
            20 + Math.random() * 8,
            (Math.random() - 0.5) * PLANE_SIZE * 0.5
        ),
        moveSpeed: 6.0,
        rotationSpeed: 2.0,
        changeTargetDistance: 15,
        worldBounds: worldBounds,
        waterSurfaceY: WATER_SURFACE_Y,
        canJump: true,
        radius: 6,
        materialModifier: (mat) => {
            mat.roughness = 0.5;
            mat.metalness = 0.15;
        }
    });
    largeFish.push(orca);
    
    // Sperm Whale - deep diver
    const spermWhale = new Fish(scene, {
        modelPath: '/assets/',
        modelFile: 'sperm_whale.glb',
        scale: 0.8,
        color: 0x5a6a7a,
        position: new THREE.Vector3(
            (Math.random() - 0.5) * PLANE_SIZE * 0.6,
            18 + Math.random() * 8,
            (Math.random() - 0.5) * PLANE_SIZE * 0.6
        ),
        moveSpeed: 3.5,
        rotationSpeed: 1.2,
        changeTargetDistance: 25,
        worldBounds: worldBounds,
        waterSurfaceY: WATER_SURFACE_Y,
        canJump: true,
        radius: 7,
        materialModifier: (mat) => {
            mat.roughness = 0.7;
            mat.metalness = 0.05;
        }
    });
    largeFish.push(spermWhale);
}

function gatherFishColliders() {
    const seen = new Set();
    const colliders = [];
    const addList = (arr) => {
        arr.forEach((f) => {
            if (!f || !f.model) { return; }
            if (seen.has(f)) { return; }
            seen.add(f);
            colliders.push(f);
        });
    };
    addList(guppyFish);
    addList(nightFish);
    addList(largeFish);
    return colliders;
}

function resolveAICollisions(colliders) {
    for (let i = 0; i < colliders.length; i++) {
        const a = colliders[i];
        const posA = a.model.position;
        const radiusA = a.radius || 1.5;
        for (let j = i + 1; j < colliders.length; j++) {
            const b = colliders[j];
            const posB = b.model.position;
            const radiusB = b.radius || 1.5;
            tmpCollide.subVectors(posA, posB);
            const distSq = tmpCollide.lengthSq();
            const minDist = radiusA + radiusB;
            if (distSq === 0 || distSq >= minDist * minDist) { continue; }
            const dist = Math.sqrt(distSq);
            const n = tmpCollide.multiplyScalar(1 / dist);
            const penetration = minDist - dist;
            const push = penetration * 0.5;
            posA.addScaledVector(n, push);
            posB.addScaledVector(n, -push);
        }
    }
}

function resolvePlayerCollisions(colliders) {
    if (!fish) { return; }
    colliders.forEach((f) => {
        const otherPos = f.model.position;
        tmpCollide.subVectors(fish.position, otherPos);
        const minDist = PLAYER_RADIUS + (f.radius || 1.5);
        const distSq = tmpCollide.lengthSq();
        if (distSq === 0 || distSq >= minDist * minDist) { return; }
        const dist = Math.sqrt(distSq);
        const n = tmpCollide.multiplyScalar(1 / dist);
        const penetration = minDist - dist;
        fish.position.addScaledVector(n, penetration);

        const vn = fishVelocity.dot(n);
        if (vn < 0) {
            fishVelocity.addScaledVector(n, -vn); // remove into-other component to slide
        }
    });
}

// Small schooling fish that move in tight groups
function loadSchoolFish() {
    const worldBounds = {
        min: -PLANE_SIZE / 2,
        max: PLANE_SIZE / 2,
        minY: 10,
        maxY: WATER_SURFACE_Y - 8  // Keep schools well below water
    };
    
    // Create several schools of small fish
    const schoolConfigs = [
        // School 1: Small cyan fish
        { 
            center: new THREE.Vector3(-80, 15, 60),
            count: 15,
            color: 0x00d4ff,
            emissive: 0x0088aa,
            emissiveIntensity: 0.3,
            spread: 20
        },
        // School 2: Small yellow fish
        { 
            center: new THREE.Vector3(70, 18, -50),
            count: 18,
            color: 0xffd700,
            emissive: 0xffaa00,
            emissiveIntensity: 0.4,
            spread: 18
        },
        // School 3: Small purple fish
        { 
            center: new THREE.Vector3(-50, 22, -80),
            count: 12,
            color: 0xaa88ff,
            emissive: 0x6644ff,
            emissiveIntensity: 0.5,
            spread: 15
        },
        // School 4: Small green fish
        { 
            center: new THREE.Vector3(90, 16, 70),
            count: 14,
            color: 0x00ffaa,
            emissive: 0x00aa66,
            emissiveIntensity: 0.35,
            spread: 22
        }
    ];
    
    schoolConfigs.forEach((config) => {
        for (let i = 0; i < config.count; i++) {
            const schoolFish = new Fish(scene, {
                modelPath: '/assets/fish_animated/',
                modelFile: 'scene.gltf',
                scale: 0.02 + Math.random() * 0.008,
                color: config.color,
                emissiveColor: config.emissive,
                emissiveIntensity: config.emissiveIntensity,
                emissivePulseSpeed: 2.5 + Math.random() * 1.0,
                position: new THREE.Vector3(
                    config.center.x + (Math.random() - 0.5) * config.spread,
                    config.center.y + (Math.random() - 0.5) * config.spread * 0.5,
                    config.center.z + (Math.random() - 0.5) * config.spread
                ),
                moveSpeed: 3.5 + Math.random() * 1.5,
                rotationSpeed: 4.5,
                changeTargetDistance: 1.0,
                worldBounds: worldBounds,
                waterSurfaceY: WATER_SURFACE_Y,
                canJump: false, // School fish don't jump
                radius: 0.9,
                materialModifier: (mat) => {
                    mat.roughness = 0.4;
                    mat.metalness = 0.15;
                }
            });
            // Add to both arrays so they're visible day and night
            guppyFish.push(schoolFish);
            nightFish.push(schoolFish);
        }
    });
}

initControls();
initLights();
buildSandDunes();
addRocksAndPlants();
addWaterSurface();
initPostProcessing();
addCausticsLight();
buildHud();
addAmbientModels();
loadFishPlayer();
loadStaticFish();
loadGlowingFish();
loadSchoolFish();
loadLargeCreatures();

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
    if (causticsLight) {
        causticsLight.position.copy(sun.position).multiplyScalar(1.1);
        causticsLight.target.position.set(0, 0, 0);
        causticsLight.target.updateMatrixWorld();
    }

    // Light strengths
    const daylight = Math.max(0, sunY / 90);
    daylightFactor = daylight;
    const nightFactor = 1 - daylightFactor;
    sun.intensity = 0.3 + daylight * 0.7; 
    ambient.intensity = 0.2 + daylight * 0.4; 
    if (causticsLight) {
        causticsLight.intensity = 0.15 + daylight * 0.65;
    }
    if (bloomPass) {
        bloomPass.strength = BLOOM_STRENGTH * (0.4 + nightFactor * 1.6);
    }
    renderer.toneMappingExposure = 0.95 + nightFactor * 0.4;
    if (hudTimeLabel && hudCycleBar) {
        hudTimeLabel.textContent = daylightFactor > 0.2 ? 'Day' : 'Night';
        hudTimeLabel.style.color = daylightFactor > 0.2 ? '#ffe79a' : '#9ecbff';
        hudCycleBar.style.width = `${t * 100}%`;
        hudCycleBar.style.opacity = 0.35 + daylightFactor * 0.45;
    }

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

function updateFish(delta) {
    if (!fish) { return; }

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

    // Speed limit and drag
    if (fishVelocity.lengthSq() > MAX_SWIM_SPEED * MAX_SWIM_SPEED) {
        fishVelocity.setLength(MAX_SWIM_SPEED);
    }
    fishVelocity.multiplyScalar(Math.pow(SWIM_DRAG, delta * 60));
    fish.position.addScaledVector(fishVelocity, delta);
    
    // Keep player fish below water surface
    if (fish.position.y > WATER_SURFACE_Y - 3) {
        fish.position.y = WATER_SURFACE_Y - 3;
        fishVelocity.y = Math.min(0, fishVelocity.y); // Stop upward movement
    }

    // Slide off other fish
    resolvePlayerCollisions(gatherFishColliders());

    // Keep player within world bounds
    const clampedX = THREE.MathUtils.clamp(fish.position.x, -PLAYER_BOUNDS, PLAYER_BOUNDS);
    const clampedY = THREE.MathUtils.clamp(fish.position.y, PLAYER_MIN_Y, PLAYER_MAX_Y);
    const clampedZ = THREE.MathUtils.clamp(fish.position.z, -PLAYER_BOUNDS, PLAYER_BOUNDS);
    if (clampedX !== fish.position.x) { fishVelocity.x = 0; fish.position.x = clampedX; }
    if (clampedY !== fish.position.y) { fishVelocity.y = 0; fish.position.y = clampedY; }
    if (clampedZ !== fish.position.z) { fishVelocity.z = 0; fish.position.z = clampedZ; }

    // Orient fish to direction of travel 
    tmpHeading.copy(fishVelocity);
    tmpHeading.y = 0;
    if (tmpHeading.lengthSq() > 1e-4) {
        fish.rotation.y = Math.atan2(tmpHeading.x, tmpHeading.z);
    }

    // Camera follow
    const followHeading = tmpHeading.lengthSq() > 1e-4 ? tmpHeading : tmpForward;
    followOffset.copy(followHeading).normalize().multiplyScalar(-CAMERA_DISTANCE);
    followOffset.y += CAMERA_HEIGHT;

    desiredCamPos.copy(fish.position).add(followOffset);
    const followLerp = 1 - Math.exp(-CAMERA_FOLLOW_RESPONSE * delta);
    camera.position.lerp(desiredCamPos, followLerp);
    controls.target.lerp(fish.position, followLerp);
}

function handleKey(event, isDown) {
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
    if (causticsTexture) {
        causticsTexture.userData.time += delta;
        causticsTexture.offset.x += delta * 0.05;
        causticsTexture.offset.y += delta * 0.03;
        causticsTexture.userData.drawFrame(causticsTexture.userData.time * 0.8);
        causticsTexture.needsUpdate = true;
    }

    if (mixer) {
        mixer.update(delta);
    }
    if (ambientMixers.length > 0) {
        ambientMixers.forEach((m) => m.update(delta));
    }
    if (kelp.length > 0) {
        const t = performance.now() * 0.001;
        kelp.forEach((k, idx) => {
            k.rotation.z = Math.sin(t * 0.8 + idx) * 0.08;
            k.rotation.x = Math.sin(t * 0.6 + idx * 1.2) * 0.05;
        });
    }

    if (guppyFish.length > 0) {
        guppyFish.forEach((g) => g.update(delta));
    }
    if (nightFish.length > 0) {
        const glow = Math.min(1.4, 0.2 + (1 - daylightFactor) * 1.4);
        nightFish.forEach((g) => {
            g.setGlowMultiplier(glow);
            g.update(delta);
        });
    }
    if (largeFish.length > 0) {
        largeFish.forEach((lf) => lf.update(delta));
    }

    const colliders = gatherFishColliders();
    if (colliders.length > 1) {
        resolveAICollisions(colliders);
    }

    updateFish(delta);

    if (controls) {
        controls.update();
    }

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}
animate();

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
}

window.addEventListener('resize', onWindowResize, false);

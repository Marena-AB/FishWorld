
/*
    Water module is the main application script for the underwater scene.
    It sets up the Three.js scene, camera, renderer, controls, lighting,
    terrain, water surface, fish models, ambient life, and handles the  
    animation loop and user input.
*/

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { generateTerrain } from './sand-generation.js';
import { Fish } from './fish.js';
import { initPhysics, getPhysicsWorld, isRapierLoaded, createTerrainCollider, createSceneColliders, createFishPhysics, updatePhysics, syncPhysicsToThreeJS, getPhysicsObjects } from './physics.js';
import { KHRMaterialsPBRSpecularGlossiness } from './pbrSpecGlossExtension.js';

// Import fish models (webpack will bundle these)
import alienFishUrl from './assets/alien_fish_animated.glb';
import blueWhaleUrl from './assets/blue_whale.glb';
import discusFishUrl from './assets/discus_fish.glb';
import femaleOrcaUrl from './assets/female_orca.glb';
import stylizedFishUrl from './assets/stylized_fish.glb';

// Core scene/terrain settings
const HEIGHT_SCALE = 2.5;        // vertical exaggeration of seabed
const DETAIL = 8;                // (2^detail + 1) resolution - further reduced for performance
const TILE_SEGMENTS = 2 ** DETAIL; // equals size - 1 for geometry segments
const PLANE_SIZE = 800;          // world-space span of the seabed
const SWIM_ACCEL = 45;           // swim acceleration strength
const SWIM_DRAG = 0.9;           // damping factor per frame
const MAX_SWIM_SPEED = 50;       // cap on swim speed
const CAMERA_DISTANCE = 12;       // chase distance behind the fish (reduced from 15)
const CAMERA_HEIGHT = 5;          // chase height above the fish (reduced from 6)
const INITIAL_CAMERA_OFFSET = new THREE.Vector3(0, CAMERA_HEIGHT, -CAMERA_DISTANCE);
const BLOOM_STRENGTH = 0.65;
const BLOOM_RADIUS = 0.25;
const BLOOM_THRESHOLD = 0.32;
const SAND_COLOR = 0xd6c196;
const ROCK_COUNT = 15;  // Reduced from 30
const KELP_COUNT = 9;   // Reduced from 18
const PLAYER_BOUNDS = PLANE_SIZE * 0.48; // keep player over terrain
const WATER_SURFACE_Y = 150;
const PLAYER_MIN_Y = 3;
const PLAYER_MAX_Y = WATER_SURFACE_Y - 3;
const PLAYER_RADIUS = 2.2;

// Day/night cycle settings
const cycleDurationMs = 60000; 
const dayWaterColor = new THREE.Color(0x006994); 
const nightWaterColor = new THREE.Color(0x000510);
const dayUnderwaterFog = new THREE.Color(0x1a6580); // Darker, more realistic (was 0x2a7fa0)
const nightUnderwaterFog = new THREE.Color(0x0d1f3a); // Darker night (was 0x152850)

// Scene
const scene = new THREE.Scene();
scene.background = dayUnderwaterFog.clone(); 
scene.fog = new THREE.Fog(dayUnderwaterFog.clone(), 80, 350); // Push fog much further back for better visibility 

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setClearColor(dayUnderwaterFog);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();
const loader = new GLTFLoader();
loader.register((parser) => new KHRMaterialsPBRSpecularGlossiness(parser));
let fish;
let mixer;
let guppyFish = [];
let nightFish = [];
let largeFish = []; // Array for large ambient fish
let rocks = [];
let kelp = [];
const ambientActors = [];
const ambientMixers = [];
const ambientDrifters = [];
let dunes;
let composer;
let bloomPass;
let daylightFactor = 1;
let hudTimeLabel;
let hudCycleBar;
const aiFish = []; // Array to hold all AI fish
let controlledFish = null;
let underwaterAmbience = null;
const fishVelocity = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();
const followOffset = new THREE.Vector3();
const moveState = { forward: false, back: false, left: false, right: false, up: false, down: false };
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const upVector = new THREE.Vector3(0, 1, 0);
const tmpHeading = new THREE.Vector3();
const playerHeading = new THREE.Vector3(0, 0, -1); // cache last heading to keep camera behind when stopped
const accel = new THREE.Vector3();
const tmpCollide = new THREE.Vector3();
const tmpStartPos = new THREE.Vector3();
const tmpDisplacement = new THREE.Vector3();
const tmpSunDir = new THREE.Vector3();
const tmpDriftDir = new THREE.Vector3();
const colliderScratch = [];
const colliderSeen = new Set();

/**
 * Utility to space out spawned fish so they don't all cluster.
 * @param {{min:number,max:number}} worldBounds - X/Z bounds.
 * @param {number} minSpacing - Minimum spacing between spawned points.
 * @param {THREE.Vector3[]} existingPositions - Positions already placed.
 * @param {{min:number,max:number}} yRange - Vertical range to spawn within.
 * @returns {THREE.Vector3} new spawn position.
 */
function getSpawnPosition(worldBounds, minSpacing, existingPositions, yRange) {
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const pos = new THREE.Vector3(
            (Math.random() - 0.5) * (worldBounds.max - worldBounds.min),
            yRange.min + Math.random() * (yRange.max - yRange.min),
            (Math.random() - 0.5) * (worldBounds.max - worldBounds.min),
        );
        let tooClose = false;
        for (const other of existingPositions) {
            if (pos.distanceToSquared(other) < minSpacing * minSpacing) {
                tooClose = true;
                break;
            }
        }
        if (!tooClose) {
            existingPositions.push(pos);
            return pos;
        }
    }
    // Fallback if we couldn't find a spaced position
    const pos = new THREE.Vector3(
        (Math.random() - 0.5) * (worldBounds.max - worldBounds.min),
        yRange.min + Math.random() * (yRange.max - yRange.min),
        (Math.random() - 0.5) * (worldBounds.max - worldBounds.min),
    );
    existingPositions.push(pos);
    return pos;
}

// Asset URLs (must stay static for bundlers)
const SEAWEED_URL = new URL('./assets/sea_weed.glb', import.meta.url).href;
const TURTLE_URL = new URL('./assets/turtle.glb', import.meta.url).href;
const WHALE_URL = new URL('./assets/blue_whale.glb', import.meta.url).href;
const ORCA_URL = new URL('./assets/female_orca.glb', import.meta.url).href;
const SPERM_WHALE_URL = new URL('./assets/sperm_whale.glb', import.meta.url).href;
const STYLIZED_FISH_URL = new URL('./assets/stylized_fish.glb', import.meta.url).href;
const DISCUS_FISH_URL = new URL('./assets/discus_fish.glb', import.meta.url).href;
const ALIEN_FISH_URL = new URL('./assets/alien_fish_animated.glb', import.meta.url).href;
const TITANIC_URL = new URL('./assets/titanic.glb', import.meta.url).href;
const BOAT_URL = new URL('./assets/a_boat_object_no3.glb', import.meta.url).href;
const LOWPOLY_CORAL_URL = new URL('./assets/lowpoly_coral_pack.glb', import.meta.url).href;
const KOI_FISH_URL = 'assets/fish_models/koi_fish/scene.gltf';
const TUNA_FISH_URL = 'assets/fish_models/tuna_fish/scene.gltf';
const SCHOOL_FISH_URL = 'assets/fish_models/school_of_fish/scene.gltf';
const STAR_FISH_URL = 'assets/fish_models/star_fish/scene.gltf';
const ANIMATED_FISH_URL = 'assets/fish_models/fish_animated/scene.gltf';
const CORAL_URL = new URL('./assets/coral_v2.0.glb', import.meta.url).href;

// Tunable scene parameters (avoid magic numbers)
const CORAL_PRIMARY_CONFIG = { scale: 9.5, count: 24, area: 0.95, minY: 5, maxY: 16, offset: 0.1 };
const CORAL_VARIANT_CONFIG = { scale: 7.0, count: 18, area: 0.95, minY: 5, maxY: 16, offset: 0.1 };
const CORAL_REEF_SCATTER_COUNT = 25;
const CORAL_REEF_SCATTER_AREA = 0.65;
const CORAL_REEF_SCALE_MIN = 0.8;
const CORAL_REEF_SCALE_RANGE = 1.2; // max = min + range
const CORAL_REEF_TERRAIN_BUFFER = 0.2;
const BOAT_SCALE = 3.0;
const BOAT_ROTATION_Y = -Math.PI * 0.25;
const BOAT_POSITION = new THREE.Vector3(25, 0, 15);
const BOAT_OFFSET_BUFFER = 0.5;
const BOW_LIGHT_INTENSITY = 2.0;
const BOW_LIGHT_DISTANCE = 100;
const BOW_LIGHT_POSITION = new THREE.Vector3(0, 6, 15);
const BLUE_WHALE_RADIUS = 30;
const ORCA_RADIUS = 22;
const SPERM_WHALE_RADIUS = 26;
const PLAYER_COLLISION_ITERATIONS = 3;
const LARGE_CREATURE_COLLISION_THRESHOLD = 15;
const LARGE_CREATURE_PUSH_MULTIPLIER = 2.5;
const DEFAULT_PUSH_MULTIPLIER = 1.0;
const LARGE_CREATURE_STOP_SCALE = 4.0;
const DEFAULT_STOP_SCALE = 1.5;

const PLAYER_FISH_MODELS = [
    { 
        name: 'Default Fish', 
        url: new URL('./assets/fish.glb', import.meta.url).href, 
        scale: 1.0, 
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Alien Fish', 
        url: alienFishUrl, 
        scale: 1.0, 
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Discus Fish', 
        url: discusFishUrl, 
        scale: 10.95, 
        rotationOffsetY: -Math.PI / 2,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Stylized Fish', 
        url: stylizedFishUrl, 
        scale: 2.5, 
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Koi Fish', 
        url: KOI_FISH_URL, 
        scale: 1.5, 
        rotationOffsetY: -Math.PI / 2,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Tuna Fish', 
        url: TUNA_FISH_URL, 
        scale: 4.25, 
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Animated Fish', 
        url: ANIMATED_FISH_URL, 
        scale: 0.08, 
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Sea Turtle', 
        url: TURTLE_URL, 
        scale: 20.5, 
        rotationOffsetY: Math.PI,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    }
];

let currentFishModelIndex = 0; // Track current fish model
let hudFishModelLabel = null; // HUD element for fish model name

// Controls
let controls;
/**
 * Configure orbit controls for the scene camera.
 */
function initControls() {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.target.set(0, 0, 0); 
    
    controls.maxPolarAngle = Math.PI / 2 - 0.1; 
    controls.minDistance = 5; 
    controls.maxDistance = 500; 

}

let ambient;
let sun;
let causticsLight;
let causticsTexture;
let cameraLight; // Add camera-mounted light for local visibility
/**
 * Create ambient, directional (sun), caustic, and camera-follow lights.
 */
function initLights() {
    ambient = new THREE.AmbientLight(0x4a9fb5, 0.5); // Reduced from 0.8 to 0.5 for realism
    scene.add(ambient);

    sun = new THREE.DirectionalLight(0x88c5d8, 0.7); // Reduced from 1.2 to 0.7
    sun.position.set(60, 110, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.far = 1200;
    sun.shadow.camera.left = -500;
    sun.shadow.camera.right = 500;
    sun.shadow.camera.top = 500;
    sun.shadow.camera.bottom = -500;
    scene.add(sun);
    scene.add(sun.target);
    
    // Add camera-mounted point light for local illumination
    cameraLight = new THREE.PointLight(0xb8e6ff, 0.4, 40, 2); // Reduced intensity from 0.6 to 0.4, range from 50 to 40
    cameraLight.position.copy(camera.position);
    scene.add(cameraLight);
}


/**
 * Generate and place the heightmapped sand terrain mesh.
 */
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
/**
 * Snap an object to the terrain and optionally lift it by offset.
 * @param {THREE.Object3D} object - Object to position.
 * @param {number} offset - Vertical offset above terrain.
 * @returns {number|null} terrain Y at the snap point, or null if terrain missing.
 */
function snapToTerrain(object, offset = 0) {
    if (!dunes) { return null; }
    terrainRaycaster.set(new THREE.Vector3(object.position.x, 200, object.position.z), downVector);
    const hit = terrainRaycaster.intersectObject(dunes, false)[0];
    if (hit) {
        object.position.y = hit.point.y + offset;
        return hit.point.y;
    }
    return null;
}

/**
 * Scatter rocks and kelp meshes, computing simple collision radii.
 */
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
        
        rock.updateMatrixWorld();
        const box = new THREE.Box3().setFromObject(rock);
        const size = new THREE.Vector3();
        box.getSize(size);
        rock.collisionRadius = Math.max(size.x, size.y, size.z) * 0.5;
        
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
        
        kelpMesh.baseRotationY = kelpMesh.rotation.y;
        kelpMesh.angularVelocityX = 0;
        kelpMesh.angularVelocityZ = 0;
        kelpMesh.targetAngularVelocityX = 0;
        kelpMesh.targetAngularVelocityZ = 0;
        kelpMesh.damping = 0.9;
        
        kelpMesh.collisionRadius = Math.max(kelpMesh.geometry.parameters.radiusTop, kelpMesh.geometry.parameters.radiusBottom) * 1.8;
        kelpMesh.collisionHeight = kelpHeight;
        
        kelp.push(kelpMesh);
        scene.add(kelpMesh);
    }
}

/**
 * Generic loader for ambient scene models (plants, fish, whales, etc.).
 * Supports cloning, optional terrain snapping, wandering, and animation mixing.
 * @param {object} options - Loader configuration.
 */
function addSceneModel(options) {
    const { href, scale = 1, count = 1, area = 0.5, minY = 5, maxY = 35, yOffset = 0, rotation = null, snap = true, wander = false, wanderSpeed = 0.6 } = options;
    const makeTarget = () => new THREE.Vector3(
        (Math.random() - 0.5) * PLANE_SIZE * area,
        minY + Math.random() * (maxY - minY),
        (Math.random() - 0.5) * PLANE_SIZE * area
    );
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
                        // Reuse materials; only clone if a subclass tweaks per instance
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
                if (wander) {
                    ambientDrifters.push({
                        mesh: instance,
                        target: makeTarget(),
                        speed: wanderSpeed * (0.7 + Math.random() * 0.6), // slight variance
                        minY,
                        maxY,
                        area
                    });
                }
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

/**
 * Populate the scene with ambient vegetation/animals (seaweed, fish variants, whales).
 */
function addAmbientModels() {

    // Seaweed clusters for depth cues
    addSceneModel({
        href: SEAWEED_URL,
        scale: 4.5,
        count: 8,  // Reduced from 16
        area: 0.55,
        minY: 5,
        maxY: 12,
        yOffset: -0.5
    });

    // Coral heads on the seafloor for more structure
    addSceneModel({
        href: CORAL_URL,
        scale: CORAL_PRIMARY_CONFIG.scale,
        count: CORAL_PRIMARY_CONFIG.count,
        area: CORAL_PRIMARY_CONFIG.area,
        minY: CORAL_PRIMARY_CONFIG.minY,
        maxY: CORAL_PRIMARY_CONFIG.maxY,
        yOffset: CORAL_PRIMARY_CONFIG.offset
    });

    // Additional coral formations for variety
    addSceneModel({
        href: LOWPOLY_CORAL_URL,
        scale: CORAL_VARIANT_CONFIG.scale,
        count: CORAL_VARIANT_CONFIG.count,
        area: CORAL_VARIANT_CONFIG.area,
        minY: CORAL_VARIANT_CONFIG.minY,
        maxY: CORAL_VARIANT_CONFIG.maxY,
        yOffset: CORAL_VARIANT_CONFIG.offset
    });

    // Additional coral variant for diversity
    addSceneModel({
        href: LOWPOLY_CORAL_URL,
        scale: 7.0,
        count: 18,
        area: 0.95,
        minY: 5,
        maxY: 16,
        yOffset: 0.1
    });

    // Stylized mid-water fish
    addSceneModel({
        href: STYLIZED_FISH_URL,
        scale: 2.5,  // Reduced so ambient stylized fish aren't oversized
        count: 6,  // Reduced from 12
        area: 0.45,
        minY: 10,
        maxY: 20,
        wander: true,
        wanderSpeed: 2.0
    });

    // Discus fish schools
    addSceneModel({
        href: DISCUS_FISH_URL,
        scale: 10.0,  
        count: 6,
        area: 0.4,
        minY: 9,
        maxY: 18,
        wander: true,
        wanderSpeed: 1.8
    });

    // Alien fish variants
    addSceneModel({
        href: ALIEN_FISH_URL,
        scale: 0.2,
        count: 4,
        area: 0.35,
        minY: 11,
        maxY: 18,
        wander: true,
        wanderSpeed: 1.6
    });

    // Turtle drifting near the player space
    addSceneModel({
        href: TURTLE_URL,
        scale: 10.5,
        count: 1,  // Keep at 1
        area: 0.25,
        minY: 8,
        maxY: 16
    });

    // Background whale for parallax
    addSceneModel({
        href: WHALE_URL,
        scale: 0.7,
        count: 1,  // Keep at 1
        area: 0.9,
        minY: 24,
        maxY: 30,
        snap: false,
        wander: true,
        wanderSpeed: 0.65
    });

    // Distant orca
    addSceneModel({
        href: ORCA_URL,
        scale: 0.8,
        count: 1,  // Keep at 1
        area: 0.85,
        minY: 22,
        maxY: 28,
        snap: false,
        wander: true,
        wanderSpeed: 0.8
    });

    // Deep sperm whale silhouette
    addSceneModel({
        href: SPERM_WHALE_URL,
        scale: 0.8,
        count: 1,  // Keep at 1
        area: 0.95,
        minY: 18,
        maxY: 26,
        snap: false,
        wander: true,
        wanderSpeed: 0.55
    });
}

/**
 * Load and place the Titanic model near the water surface.
 */
function addTitanic() {
    loader.load(
        TITANIC_URL,
        (gltf) => {
            const titanic = gltf.scene;
            
            titanic.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                    if (obj.material) {
                        const clonedMaterial = obj.material.clone();
                        if (obj.material.map) clonedMaterial.map = obj.material.map;
                        if (obj.material.normalMap) clonedMaterial.normalMap = obj.material.normalMap;
                        if (obj.material.roughnessMap) clonedMaterial.roughnessMap = obj.material.roughnessMap;
                        if (obj.material.metalnessMap) clonedMaterial.metalnessMap = obj.material.metalnessMap;
                        if (obj.material.aoMap) clonedMaterial.aoMap = obj.material.aoMap;
                        if (obj.material.emissiveMap) clonedMaterial.emissiveMap = obj.material.emissiveMap;
                        if (obj.material.alphaMap) clonedMaterial.alphaMap = obj.material.alphaMap;
                        clonedMaterial.needsUpdate = true;
                        obj.material = clonedMaterial;
                    }
                }
            });
            
            titanic.position.set(0, WATER_SURFACE_Y + 0.5, -100);
            titanic.scale.setScalar(1.0);
            titanic.rotation.y = Math.PI / 2;
            
            scene.add(titanic);
            ambientActors.push(titanic);
            
            // Handle animations if the model has any
            if (gltf.animations && gltf.animations.length > 0) {
                const mixer = new THREE.AnimationMixer(titanic);
                gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
                ambientMixers.push(mixer);
            }
            
            console.log('Titanic model loaded and positioned on water surface');
        },
        undefined,
        (err) => console.error('Failed to load Titanic model', err)
    );
}

/**
 * Load and place the boat wreck near spawn with a bow light for visibility.
 */
function addBoatWreck() {
    loader.load(
        BOAT_URL,
        (gltf) => {
            const boat = gltf.scene;
            boat.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                    if (obj.material) {
                        const clonedMaterial = obj.material.clone();
                        if (obj.material.map) clonedMaterial.map = obj.material.map;
                        if (obj.material.normalMap) clonedMaterial.normalMap = obj.material.normalMap;
                        if (obj.material.roughnessMap) clonedMaterial.roughnessMap = obj.material.roughnessMap;
                        if (obj.material.metalnessMap) clonedMaterial.metalnessMap = obj.material.metalnessMap;
                        if (obj.material.aoMap) clonedMaterial.aoMap = obj.material.aoMap;
                        if (obj.material.emissiveMap) clonedMaterial.emissiveMap = obj.material.emissiveMap;
                        if (obj.material.alphaMap) clonedMaterial.alphaMap = obj.material.alphaMap;
                        clonedMaterial.needsUpdate = true;
                        obj.material = clonedMaterial;
                    }
                }
            });
            
            // Position boat close to spawn point so player can see it immediately
            boat.scale.setScalar(BOAT_SCALE);
            boat.rotation.y = BOAT_ROTATION_Y; // Angle it toward player
            
            // Position at origin first to calculate bbox
            boat.position.set(0, 0, 0);
            boat.updateMatrixWorld(true);
            const boatBbox = new THREE.Box3().setFromObject(boat);
            
            // Move to actual position near spawn
            boat.position.copy(BOAT_POSITION);
            
            // Offset is how far below pivot the bottom is
            const boatOffset = Math.abs(boatBbox.min.y) + BOAT_OFFSET_BUFFER;
            
            snapToTerrain(boat, boatOffset);
            
            // Add a subtle glow at the bow to highlight the built-in light
            const bowLight = new THREE.PointLight(0xb8e6ff, BOW_LIGHT_INTENSITY, BOW_LIGHT_DISTANCE, 2);
            bowLight.position.copy(BOW_LIGHT_POSITION);
            boat.add(bowLight);
            
            scene.add(boat);
            ambientActors.push(boat);
            console.log('Boat wreck loaded near spawn at:', boat.position);
        },
        undefined,
        (err) => console.error('Failed to load boat model', err)
    );
}

/**
 * Scatter coral formations (mixing variants) across the seabed with color/scale variation.
 */
function addCoralReefs() {
    // Add multiple coral formations scattered around the scene
    const coralCount = CORAL_REEF_SCATTER_COUNT; // Number of coral formations to add
    const coralArea = CORAL_REEF_SCATTER_AREA; // Spread across percentage of the plane
    const coralVariants = [CORAL_URL, LOWPOLY_CORAL_URL];
    
    for (let i = 0; i < coralCount; i++) {
        const coralUrl = coralVariants[Math.floor(Math.random() * coralVariants.length)];
        loader.load(
            coralUrl,
            (gltf) => {
                const coral = gltf.scene;
                coral.traverse((obj) => {
                    if (obj.isMesh) {
                        obj.castShadow = true;
                        obj.receiveShadow = true;
                        if (obj.material) {
                            // Clone to allow per-instance tint variation
                            const clonedMaterial = obj.material.clone();
                            // Add slight color variation to corals
                            const hueShift = (Math.random() - 0.5) * 0.1;
                            clonedMaterial.color.offsetHSL(hueShift, 0, (Math.random() - 0.5) * 0.2);
                            if (obj.material.map) clonedMaterial.map = obj.material.map;
                            if (obj.material.normalMap) clonedMaterial.normalMap = obj.material.normalMap;
                            if (obj.material.roughnessMap) clonedMaterial.roughnessMap = obj.material.roughnessMap;
                            if (obj.material.metalnessMap) clonedMaterial.metalnessMap = obj.material.metalnessMap;
                            if (obj.material.aoMap) clonedMaterial.aoMap = obj.material.aoMap;
                            if (obj.material.emissiveMap) clonedMaterial.emissiveMap = obj.material.emissiveMap;
                            clonedMaterial.needsUpdate = true;
                            obj.material = clonedMaterial;
                        }
                    }
                });
                
                // Random position across the seabed
                const x = (Math.random() - 0.5) * PLANE_SIZE * coralArea;
                const z = (Math.random() - 0.5) * PLANE_SIZE * coralArea;
                
                // Vary scale for diversity - MUCH smaller now
                const scale = CORAL_REEF_SCALE_MIN + Math.random() * CORAL_REEF_SCALE_RANGE;
                coral.scale.setScalar(scale);
                
                // Random rotation for natural look
                coral.rotation.y = Math.random() * Math.PI * 2;
                
                // Position at origin first to calculate bbox
                coral.position.set(0, 0, 0);
                coral.updateMatrixWorld(true);
                const bbox = new THREE.Box3().setFromObject(coral);
                
                // Move to the actual X,Z position
                coral.position.set(x, 0, z);
                
                // The offset is how far the bottom of the model is below the pivot
                // If bbox.min.y is negative, we need to lift by that amount
                const offset = Math.abs(bbox.min.y) + CORAL_REEF_TERRAIN_BUFFER; // Small buffer to sit on terrain
                
                // Snap to terrain
                snapToTerrain(coral, offset);
                
                scene.add(coral);
                ambientActors.push(coral);
                
                // Log only the first few for confirmation
                if (i < 3) {
                    console.log(`Coral ${i + 1} loaded at:`, coral.position);
                }
            },
            undefined,
            (err) => console.error(`Failed to load coral ${i + 1}:`, err)
        );
    }
    console.log(`Loading ${coralCount} coral formations...`);
}

/**
 * Update drifting ambient actors toward wandering targets.
 * @param {number} delta - Seconds since last frame.
 */
function updateAmbientDrifters(delta) {
    for (let i = 0; i < ambientDrifters.length; i++) {
        const drift = ambientDrifters[i];
        const mesh = drift.mesh;
        if (!mesh) { continue; }
        tmpDriftDir.copy(drift.target).sub(mesh.position);
        const dist = tmpDriftDir.length();
        if (dist < 1) {
            drift.target.set(
                (Math.random() - 0.5) * PLANE_SIZE * drift.area,
                drift.minY + Math.random() * (drift.maxY - drift.minY),
                (Math.random() - 0.5) * PLANE_SIZE * drift.area
            );
            continue;
        }
        tmpDriftDir.multiplyScalar(1 / dist);
        mesh.position.addScaledVector(tmpDriftDir, drift.speed * delta);
        // Clamp to bounds and below surface
        const extent = (PLANE_SIZE * drift.area) * 0.5;
        mesh.position.x = THREE.MathUtils.clamp(mesh.position.x, -extent, extent);
        mesh.position.z = THREE.MathUtils.clamp(mesh.position.z, -extent, extent);
        mesh.position.y = THREE.MathUtils.clamp(mesh.position.y, drift.minY, Math.min(drift.maxY, WATER_SURFACE_Y - 2));
        // Face direction of travel
        const yaw = Math.atan2(tmpDriftDir.x, tmpDriftDir.z);
        mesh.rotation.y = yaw;
        mesh.updateMatrixWorld();
    }
}

let water;
/**
 * Create the animated water surface plane with normals and color controls.
 */
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
    water.position.y = WATER_SURFACE_Y; // align visual surface with gameplay surface
    
    scene.add(water);
}

/**
 * Initialize post-processing with bloom effect for emissive glow.
 * @returns {void}
 */
function initPostProcessing() {
    const ENABLE_BLOOM = true; // enable bloom so emissive fish visibly glow
    if (!ENABLE_BLOOM) {
        composer = null;
        return;
    }
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    const renderPass = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    bloomPass.threshold = BLOOM_THRESHOLD;
    bloomPass.radius = BLOOM_RADIUS;
    bloomPass.strength = BLOOM_STRENGTH;
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
}

/**
 * Create a dynamic caustics texture using canvas animation.
 * @returns {THREE.CanvasTexture} animated caustics texture.
 */
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

/**
 * Add a spotlight with caustics texture projected onto the scene.
 */
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

/**
 * Build the HUD overlay with controls, time indicator, and fish model label.
 */
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
        pointer-events: auto;
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
    .hud .back-btn {
        align-self: flex-end;
        padding: 6px 10px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.35);
        background: linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.05));
        color: #fff;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.2s ease;
    }
    .hud .back-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(0,0,0,0.25);
        background: linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08));
    }
    `;
    document.head.appendChild(style);

    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
        <button class="back-btn" type="button">← Back to Menu</button>
        <h1>Swim Controls</h1>
        <div class="controls">WASD: swim · Mouse: look · Space/Shift: ascend/descend</div>
        <div class="controls" style="margin-top: 8px; font-size: 12px; opacity: 0.8;">Press Escape to return to menu</div>
        <div class="cycle-bar"><div class="fill"></div></div>
        <div class="pill"><span class="indicator"></span><span class="label">Day</span></div>
        <div class="pill" style="margin-top: 6px;"><span style="opacity: 0.7;">Fish:</span><span class="fish-model-label" style="margin-left: 6px;">Default Fish</span></div>
    `;
    hudCycleBar = hud.querySelector('.fill');
    hudTimeLabel = hud.querySelector('.label');
    hudFishModelLabel = hud.querySelector('.fish-model-label');
    hud.querySelector('.back-btn').addEventListener('click', returnToMenu);
    document.body.appendChild(hud);
}

/**
 * Load the player-controlled fish model and initialize animations/controls.
 */
function loadFishPlayer() {
    const fishModel = PLAYER_FISH_MODELS[currentFishModelIndex];
    loader.load(
        fishModel.url,
        (gltf) => {
            fish = gltf.scene;
            fish.position.set(0, 5, 0);
            fish.scale.setScalar(fishModel.scale);
            fish.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                }
            });
            scene.add(fish);
            fish.rotation.y = Math.PI + fishModel.rotationOffsetY;
            if (fishModel.rotationOffsetX !== 0) {
                fish.rotation.x = fishModel.rotationOffsetX;
            }
            if (fishModel.rotationOffsetZ !== 0) {
                fish.rotation.z = fishModel.rotationOffsetZ;
            }
            controls.target.copy(fish.position);
            followOffset.copy(INITIAL_CAMERA_OFFSET);
            camera.position.copy(fish.position).add(followOffset);
            controls.update();

            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(fish);
                gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
            }
            
            controlledFish = fish;
            
            if (hudFishModelLabel) {
                hudFishModelLabel.textContent = fishModel.name;
            }
        },
        undefined,
        (error) => console.error('Failed to load fish model', error),
    );
}

export function switchPlayerFishModel(direction = 1) {
    if (!fish) return; // Can't switch if fish isn't loaded yet
    
    // Save current position and velocity
    const currentPosition = fish.position.clone();
    const currentRotation = fish.rotation.clone();
    const currentVelocity = fishVelocity.clone();
    const oldModelIndex = currentFishModelIndex;
    
    // Clean up old physics if it exists
    if (fish.rigidBody && isRapierLoaded()) {
        // Remove from physics objects array
        const physicsObjects = getPhysicsObjects();
        const index = physicsObjects.findIndex(obj => obj.mesh === fish);
        if (index !== -1) {
            physicsObjects.splice(index, 1);
        }
        // Remove rigid body from physics world
        const physicsWorld = getPhysicsWorld();
        if (physicsWorld && fish.rigidBody) {
            physicsWorld.removeRigidBody(fish.rigidBody);
        }
        fish.rigidBody = null;
        fish.collider = null;
    }
    
    // Remove old fish from scene
    scene.remove(fish);
    if (mixer) {
        mixer = null;
    }
    
    // Update model index
    if (direction !== 0) {
        currentFishModelIndex = (currentFishModelIndex + direction + PLAYER_FISH_MODELS.length) % PLAYER_FISH_MODELS.length;
    }
    
    // Load new fish model
    const fishModel = PLAYER_FISH_MODELS[currentFishModelIndex];
    const oldFishModel = PLAYER_FISH_MODELS[oldModelIndex];
    
    loader.load(
        fishModel.url,
        (gltf) => {
            fish = gltf.scene;
            fish.position.copy(currentPosition);
            fish.scale.setScalar(fishModel.scale);
            
            // Adjust rotation based on model differences
            fish.rotation.copy(currentRotation);
            const rotationDiff = fishModel.rotationOffsetY - oldFishModel.rotationOffsetY;
            fish.rotation.y = currentRotation.y + rotationDiff;
            
            if (fishModel.rotationOffsetX !== 0) {
                fish.rotation.x = fishModel.rotationOffsetX;
            }
            if (fishModel.rotationOffsetZ !== 0) {
                fish.rotation.z = fishModel.rotationOffsetZ;
            }
            
            fish.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                }
            });
            scene.add(fish);
            
            // Restore velocity
            fishVelocity.copy(currentVelocity);
            
            // Update animations
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(fish);
                gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
            }
            
            // Recreate physics for new fish
            if (isRapierLoaded()) {
                createFishPhysics({ model: fish, position: fish.position }, PLAYER_RADIUS, 1.5);
            }
            
            controlledFish = fish;
            
            // Update HUD
            if (hudFishModelLabel) {
                hudFishModelLabel.textContent = fishModel.name;
            }
            
            console.log(`Switched to: ${fishModel.name}`);
        },
        undefined,
        (error) => console.error('Failed to load fish model', error),
    );
}

// Get current fish model info
export function getCurrentFishModel() {
    return PLAYER_FISH_MODELS[currentFishModelIndex];
}

// Get all available fish models
export function getAvailableFishModels() {
    return PLAYER_FISH_MODELS;
}

// Set fish model by index
export function setFishModelByIndex(index) {
    if (index < 0 || index >= PLAYER_FISH_MODELS.length) {
        console.error('Invalid fish model index:', index);
        return;
    }
    
    if (index === currentFishModelIndex) return;
    
    // Use the switch function with direction 0 to use current index
    const oldIndex = currentFishModelIndex;
    currentFishModelIndex = index;
    
    if (!fish) {
        // Fish not loaded yet, just set the index
        return;
    }
    
    // Call switchPlayerFishModel with direction 0 to use current index
    switchPlayerFishModel(0);
}

/**
 * Switch control to the next controllable fish (player or AI).
 * @returns {void}
 */
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

/**
 * Load and place glowing fish with emissive materials that pulse.
 */
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
        { path: alienFishUrl, file: '', scale: 1.0, rotationOffsetY: 0, count: 6 },  // Match player scale
        { path: discusFishUrl, file: '', scale: 0.95, rotationOffsetY: Math.PI / 2, count: 5 },
        { path: stylizedFishUrl, file: '', scale: 2.0, rotationOffsetY: 0, count: 4 },
        { path: discusFishUrl, file: '', scale: 0.95, rotationOffsetY: Math.PI / 2, count: 8 },
        { path: stylizedFishUrl, file: '', scale: 2.0, rotationOffsetY: 0, count: 7 },
        // Additional creatures from fish_models
        // Models from fish_models/ come in very large world units; scale them down
        { path: KOI_FISH_URL, file: '', scale: 0.35, rotationOffsetY: 0, count: 5, yRange: { min: 6, max: 18 } },
        { path: TUNA_FISH_URL, file: '', scale: 0.28, rotationOffsetY: Math.PI / 2, count: 4, yRange: { min: 10, max: 28 } },
        { path: SCHOOL_FISH_URL, file: '', scale: 0.2, rotationOffsetY: 0, count: 3, yRange: { min: 12, max: 26 } },
        { path: ANIMATED_FISH_URL, file: '', scale: 0.08, rotationOffsetY: 0, count: 6, yRange: { min: 8, max: 24 } },  // REDUCED from 0.25 - this was too big!
        { path: STAR_FISH_URL, file: '', scale: 0.3, rotationOffsetY: 0, count: 6, yRange: { min: 5, max: 12 }, moveSpeed: 0.4, rotationSpeed: 1.2, canJump: false }
    ];
    
    let colorIndex = 0;
    const placed = [];
    // Spawn multiple of each type
    fishTypes.forEach((fishType) => {
        for (let i = 0; i < fishType.count; i++) {
            const yRange = fishType.yRange || { min: 6, max: WATER_SURFACE_Y - 15 };
            const pos = getSpawnPosition(worldBounds, 25, placed, yRange);
            const fishy = new Fish(scene, {
                modelPath: fishType.path,
                modelFile: fishType.file,
                scale: fishType.scale + Math.random() * fishType.scale * 0.15,
                color: palette[colorIndex % palette.length],
                rotationOffsetY: fishType.rotationOffsetY + (Math.random() - 0.5) * 0.3,
                position: pos,
                moveSpeed: (fishType.moveSpeed || 1.2) + Math.random() * 1.2,
                rotationSpeed: (fishType.rotationSpeed || 2.0) + Math.random() * 1.0,
                changeTargetDistance: 15.0 + Math.random() * 10.0,
                maxTravelTime: 12.0 + Math.random() * 8.0,
                minTravelTime: 6.0 + Math.random() * 4.0,
                worldBounds: worldBounds,
                waterSurfaceY: WATER_SURFACE_Y,
                canJump: fishType.canJump !== undefined ? fishType.canJump : Math.random() < 0.3,
                radius: 2.5,
                physicsWorld: getPhysicsWorld(),
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

/**
 * Load glowing fish that are more active at night with emissive materials.
 */
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
        { path: alienFishUrl, file: '', scale: 1.0, rotationOffsetY: 0, 
            count: 7, intensity: 2.4, pulseSpeed: 2.2 },
        { path: discusFishUrl, file: '', scale: 0.95, rotationOffsetY: Math.PI / 2, 
            count: 8, intensity: 1.9, pulseSpeed: 2.0 },
        { path: stylizedFishUrl, file: '', scale: 1.0, rotationOffsetY: 0, 
            count: 6, intensity: 2.3, pulseSpeed: 1.8 },
        // Medium glowing fish (moderate intensity)
        { path: alienFishUrl, file: '', scale: 0.95, rotationOffsetY: Math.PI / 4, 
            count: 5, intensity: 1.6, pulseSpeed: 3.0 },
    ];
    
    let colorIndex = 0;
    const placed = [];
    // Spawn multiple of each type with varied characteristics
    fishTypes.forEach((fishType) => {
        for (let i = 0; i < fishType.count; i++) {
            const yRange = { min: 8, max: WATER_SURFACE_Y - 15 };
            const pos = getSpawnPosition(worldBounds, 28, placed, yRange);
            const glowFish = new Fish(scene, {
                modelPath: fishType.path,
                modelFile: fishType.file,
                scale: fishType.scale + Math.random() * fishType.scale * 0.15,
                color: 0x0b1220, // Dark blue so emissive pops without flattening
                emissiveColor: emissivePalette[colorIndex % emissivePalette.length],
                emissiveIntensity: fishType.intensity + Math.random() * 0.6,
                emissivePulseSpeed: fishType.pulseSpeed + Math.random() * 1.0,
                rotationOffsetY: fishType.rotationOffsetY + (Math.random() - 0.5) * 0.4,
                position: pos,
                moveSpeed: 1.2 + Math.random() * 1.4,
                rotationSpeed: 2.4 + Math.random() * 1.1,
                changeTargetDistance: 15.0 + Math.random() * 10.0,
                maxTravelTime: 12.0 + Math.random() * 8.0,
                minTravelTime: 6.0 + Math.random() * 4.0,
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
function loadLargeCreatures() {
    const worldBounds = {
        min: -PLANE_SIZE / 2,
        max: PLANE_SIZE / 2,
        minY: 20,  // INCREASED from 15 - keep whales well above ocean floor
        maxY: WATER_SURFACE_Y - 3  // Keep large creatures below water surface
    };
    
    // Blue Whale - slow, majestic
    const blueWhale = new Fish(scene, {
        modelPath: blueWhaleUrl,
        modelFile: '',
        scale: 1.8,  // INCREASED from 1.2 - blue whales are MASSIVE in real life
        color: 0x4a7c9e,
        position: new THREE.Vector3(
            (Math.random() - 0.5) * PLANE_SIZE * 0.4,
            30 + Math.random() * 10,  // INCREASED from 25 - spawn higher to avoid terrain
            (Math.random() - 0.5) * PLANE_SIZE * 0.4
        ),
        moveSpeed: 16.0,
        rotationSpeed: 1.2,
        changeTargetDistance: 30,
        maxTravelTime: 24.0,
        minTravelTime: 12.0,
        minTargetDistance: 140,
        worldBounds: worldBounds,
        waterSurfaceY: WATER_SURFACE_Y,
        physicsWorld: getPhysicsWorld(),
        canJump: false,  // CHANGED: Whales shouldn't jump, prevents getting stuck
        radius: BLUE_WHALE_RADIUS,  // MASSIVE radius - increased from 25
        materialModifier: (mat) => {
            mat.roughness = 0.6;
            mat.metalness = 0.1;
        }
    });
    largeFish.push(blueWhale);
    
    // Orca - faster, more agile
    const orca = new Fish(scene, {
        modelPath: femaleOrcaUrl,
        modelFile: '',
        scale: 1.6,  // INCREASED from 1.3 - orcas are large predators
        color: 0x1a1a1a,
        position: new THREE.Vector3(
            (Math.random() - 0.5) * PLANE_SIZE * 0.5,
            25 + Math.random() * 10,  // INCREASED from 20 - spawn higher to avoid terrain
            (Math.random() - 0.5) * PLANE_SIZE * 0.5
        ),
        moveSpeed: 18.0,
        rotationSpeed: 1.8,
        changeTargetDistance: 26,
        maxTravelTime: 20.0,
        minTravelTime: 10.0,
        minTargetDistance: 130,
        worldBounds: worldBounds,
        waterSurfaceY: WATER_SURFACE_Y,
        physicsWorld: getPhysicsWorld(),
        canJump: false,  // CHANGED: Orcas shouldn't jump in this implementation, prevents getting stuck
        radius: ORCA_RADIUS,  // Large radius - increased from 18
        materialModifier: (mat) => {
            mat.roughness = 0.5;
            mat.metalness = 0.15;
        }
    });
    largeFish.push(orca);
    
    // Sperm Whale - deep diver
    const spermWhale = new Fish(scene, {
        modelPath: SPERM_WHALE_URL,
        modelFile: '',
        scale: 1.5,  // INCREASED from 1.1 - sperm whales are huge deep-sea giants
        color: 0x5a6a7a,
        position: new THREE.Vector3(
            (Math.random() - 0.5) * PLANE_SIZE * 0.6,
            22 + Math.random() * 10,  // INCREASED from 18 - spawn higher to avoid terrain
            (Math.random() - 0.5) * PLANE_SIZE * 0.6
        ),
        moveSpeed: 10.0,
        rotationSpeed: 1.25,
        changeTargetDistance: 28,
        maxTravelTime: 22.0,
        minTravelTime: 12.0,
        minTargetDistance: 120,
        worldBounds: worldBounds,
        waterSurfaceY: WATER_SURFACE_Y,
        physicsWorld: getPhysicsWorld(),
        canJump: false,  // CHANGED: Sperm whales shouldn't jump, prevents getting stuck
        radius: SPERM_WHALE_RADIUS,  // Large radius - increased from 22
        materialModifier: (mat) => {
            mat.roughness = 0.7;
            mat.metalness = 0.05;
        }
    });
    largeFish.push(spermWhale);
}

/**
 * Collect unique AI fish/creature instances for collision resolution.
 * @returns {Array} colliderScratch list reused per frame.
 */
function gatherFishColliders() {
    colliderSeen.clear();
    colliderScratch.length = 0;
    const addList = (arr) => {
        arr.forEach((f) => {
            if (!f || !f.model) { return; }
            if (colliderSeen.has(f)) { return; }
            colliderSeen.add(f);
            colliderScratch.push(f);
        });
    };
    addList(guppyFish);
    addList(nightFish);
    addList(largeFish);
    return colliderScratch;
}

/**
 * Separate AI-controlled fish/creatures so they glide past instead of overlapping.
 * @param {Array} colliders - List of fish/creature instances with models.
 */
function resolveAICollisions(colliders) {
    // Separate all AI-controlled fish/creatures so they glide past instead of overlapping
    for (let i = 0; i < colliders.length; i++) {
        const a = colliders[i];
        if (!a.model) { continue; }
        const posA = a.model.position;
        const radiusA = a.radius || 1.5;
        for (let j = i + 1; j < colliders.length; j++) {
            const b = colliders[j];
            if (!b.model) { continue; }
            const posB = b.model.position;
            const radiusB = b.radius || 1.5;
            tmpCollide.subVectors(posA, posB);
            const distSq = tmpCollide.lengthSq();
            const minDist = radiusA + radiusB;
            if (distSq === 0 || distSq >= minDist * minDist) { continue; }
            const dist = Math.sqrt(distSq);
            const n = tmpCollide.multiplyScalar(1 / dist);
            const penetration = minDist - dist;
            
            // Push both creatures apart equally
            // For large creatures, push MORE not less to prevent overlap
            const isLargeA = radiusA >= 15;
            const isLargeB = radiusB >= 15;
            
            // If both are large (whale vs whale), push strongly
            // If one is large and one small, push the small one more
            let pushA = penetration * 0.5;
            let pushB = penetration * 0.5;
            
            if (isLargeA && isLargeB) {
                // Both large - push both equally and strongly
                pushA = penetration * 0.6;
                pushB = penetration * 0.6;
            } else if (isLargeA && !isLargeB) {
                // A is large, B is small - push small one more
                pushA = penetration * 0.2;
                pushB = penetration * 0.8;
            } else if (!isLargeA && isLargeB) {
                // B is large, A is small - push small one more
                pushA = penetration * 0.8;
                pushB = penetration * 0.2;
            }
            
            posA.addScaledVector(n, pushA);
            posB.addScaledVector(n, -pushB);
        }
    }
}

/**
 * Resolve collisions between the player fish and AI fish/whales with strong pushback.
 * @param {Array} colliders - Fish/creature instances with model and radius.
 */
function resolvePlayerCollisions(colliders) {
    if (!fish) { return; }
    
    // Run collision resolution multiple times to ensure complete separation,
    // preventing penetration even at high speeds.
    const iterations = PLAYER_COLLISION_ITERATIONS;
    for (let iter = 0; iter < iterations; iter++) {
        colliders.forEach((f) => {
            if (!f.model) { return; }
            const otherPos = f.model.position;
            tmpCollide.subVectors(fish.position, otherPos);
            const minDist = PLAYER_RADIUS + (f.radius || 1.5);
            const distSq = tmpCollide.lengthSq();
            if (distSq === 0 || distSq >= minDist * minDist) { return; }
            const dist = Math.sqrt(distSq);
            const n = tmpCollide.multiplyScalar(1 / dist);
            const penetration = minDist - dist;
            
            // For large creatures (whales), push player much harder - make them solid walls
            const isLargeCreature = (f.radius || 1.5) >= LARGE_CREATURE_COLLISION_THRESHOLD;
            const pushMultiplier = isLargeCreature ? LARGE_CREATURE_PUSH_MULTIPLIER : DEFAULT_PUSH_MULTIPLIER;
            
            fish.position.addScaledVector(n, penetration * pushMultiplier);

            // Stop velocity going into the creature - make it feel like hitting a wall
            // Only do this on the first iteration to avoid over-correcting velocity
            if (iter === 0) {
                const vn = fishVelocity.dot(n);
                if (vn < 0) {
                    // For large creatures, completely STOP and bounce back
                    const stopScale = isLargeCreature ? LARGE_CREATURE_STOP_SCALE : DEFAULT_STOP_SCALE;
                    fishVelocity.addScaledVector(n, -vn * stopScale);
                }
            }
        });
    }
}

function resolvePlayerSceneCollisions() {
    if (!fish) { return; }
    
    rocks.forEach((rock) => {
        const rockRadius = rock.collisionRadius || rock.scale.x * 1.5;
        
        tmpCollide.subVectors(fish.position, rock.position);
        const minDist = PLAYER_RADIUS + rockRadius;
        const distSq = tmpCollide.lengthSq();
        if (distSq === 0 || distSq >= minDist * minDist) { return; }
        const dist = Math.sqrt(distSq);
        const n = tmpCollide.multiplyScalar(1 / dist);
        const penetration = minDist - dist;
        fish.position.addScaledVector(n, penetration);

        const vn = fishVelocity.dot(n);
        if (vn < 0) {
            fishVelocity.addScaledVector(n, -vn);
        }
    });
    
    kelp.forEach((k) => {
        const kelpRadius = k.collisionRadius || Math.max(k.geometry.parameters.radiusTop, k.geometry.parameters.radiusBottom) * 1.8;
        const kelpHeight = k.collisionHeight || k.geometry.parameters.height;
        
        tmpCollide.subVectors(fish.position, k.position);
        const horizontalDistSq = tmpCollide.x * tmpCollide.x + tmpCollide.z * tmpCollide.z;
        const horizontalDist = Math.sqrt(horizontalDistSq);
        
        const kelpTop = k.position.y + kelpHeight * 0.5;
        const kelpBottom = k.position.y - kelpHeight * 0.5;
        const withinHeight = fish.position.y >= kelpBottom && fish.position.y <= kelpTop;
        
        const minDist = PLAYER_RADIUS + kelpRadius * 0.5;
        if (!withinHeight || horizontalDistSq === 0 || horizontalDist >= minDist) { return; }
        
        const n = new THREE.Vector3(tmpCollide.x / horizontalDist, 0, tmpCollide.z / horizontalDist);
        const penetration = minDist - horizontalDist;
        
        const pushBackStrength = 0.15;
        fish.position.addScaledVector(n, penetration * pushBackStrength);

        const vn = fishVelocity.x * n.x + fishVelocity.z * n.z;
        if (vn < 0) {
            const resistanceStrength = 0.4;
            const penetrationFactor = Math.min(1.0, penetration / (PLAYER_RADIUS * 0.5));
            const resistanceForce = resistanceStrength * penetrationFactor;
            
            fishVelocity.x -= n.x * vn * resistanceForce;
            fishVelocity.z -= n.z * vn * resistanceForce;
        }
        
        const collisionForce = Math.abs(vn) * 0.12;
        if (collisionForce > 0.01) {
            const perpendicular = new THREE.Vector3(-n.z, 0, n.x).normalize();
            
            const targetVelX = perpendicular.x * collisionForce;
            const targetVelZ = perpendicular.z * collisionForce;
            
            const smoothFactor = 0.3;
            k.targetAngularVelocityX += (targetVelX - k.targetAngularVelocityX) * smoothFactor;
            k.targetAngularVelocityZ += (targetVelZ - k.targetAngularVelocityZ) * smoothFactor;
            
            const maxAngularVelocity = 1.2;
            k.targetAngularVelocityX = Math.max(-maxAngularVelocity, Math.min(maxAngularVelocity, k.targetAngularVelocityX));
            k.targetAngularVelocityZ = Math.max(-maxAngularVelocity, Math.min(maxAngularVelocity, k.targetAngularVelocityZ));
        }
    });
}

/**
 * Spawn small schooling fish groups with emissive accents.
 */
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
            count: 8,  // Reduced from 15
            color: 0x00d4ff,
            emissive: 0x0088aa,
            emissiveIntensity: 0.3,
            spread: 20
        },
        // School 2: Small yellow fish
        { 
            center: new THREE.Vector3(70, 18, -50),
            count: 9,  // Reduced from 18
            color: 0xffd700,
            emissive: 0xffaa00,
            emissiveIntensity: 0.4,
            spread: 18
        },
        // School 3: Small purple fish
        { 
            center: new THREE.Vector3(-50, 22, -80),
            count: 6,  // Reduced from 12
            color: 0xaa88ff,
            emissive: 0x6644ff,
            emissiveIntensity: 0.5,
            spread: 15
        },
        // School 4: Small green fish
        { 
            center: new THREE.Vector3(90, 16, 70),
            count: 7,  // Reduced from 14
            color: 0x00ffaa,
            emissive: 0x00aa66,
            emissiveIntensity: 0.35,
            spread: 22
        }
    ];
    
    schoolConfigs.forEach((config) => {
        for (let i = 0; i < config.count; i++) {
            const schoolFish = new Fish(scene, {
                modelPath: alienFishUrl,
                modelFile: '',
                scale: 0.9 + Math.random() * 0.25,  // Match player size with slight variation
                color: config.color,
                emissiveColor: config.emissive,
                emissiveIntensity: config.emissiveIntensity,
                emissivePulseSpeed: 2.5 + Math.random() * 1.0,
                position: new THREE.Vector3(
                    config.center.x + (Math.random() - 0.5) * config.spread,
                    config.center.y + (Math.random() - 0.5) * config.spread * 0.5,
                    config.center.z + (Math.random() - 0.5) * config.spread
                ),
                moveSpeed: 1.6 + Math.random() * 0.8,
                rotationSpeed: 3.0,
                changeTargetDistance: 12.0 + Math.random() * 8.0,
                maxTravelTime: 10.0 + Math.random() * 6.0,
                minTravelTime: 5.0 + Math.random() * 3.0,
                worldBounds: worldBounds,
                waterSurfaceY: WATER_SURFACE_Y,
                canJump: false, // School fish don't jump
                radius: 2.6,
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

/**
 * Initialize looping underwater ambience audio with user-gesture fallback.
 */
function initAudio() {
    try {
        const ambienceUrl = new URL('./assets/sounds/Underwater Ambient.mp3', import.meta.url).href;
        underwaterAmbience = new Audio(ambienceUrl);
        underwaterAmbience.loop = true;
        underwaterAmbience.volume = 0.25;
        underwaterAmbience.preload = 'auto';
        
        function tryPlayAudio() {
            if (underwaterAmbience && underwaterAmbience.readyState >= 2) {
                const playPromise = underwaterAmbience.play();
                if (playPromise !== undefined) {
                    playPromise.catch(err => {
                        console.log('Underwater ambience autoplay blocked, will start on user interaction');
                    });
                }
            }
        }
        
        underwaterAmbience.addEventListener('canplay', tryPlayAudio, { once: true });
        underwaterAmbience.addEventListener('loadeddata', tryPlayAudio, { once: true });
        
        document.addEventListener('click', () => {
            if (underwaterAmbience && underwaterAmbience.paused) {
                underwaterAmbience.play().catch(err => {
                    console.log('Could not play underwater ambience:', err);
                });
            }
        }, { once: true });
        
        document.addEventListener('keydown', () => {
            if (underwaterAmbience && underwaterAmbience.paused) {
                underwaterAmbience.play().catch(err => {
                    console.log('Could not play underwater ambience:', err);
                });
            }
        }, { once: true });
        
        underwaterAmbience.addEventListener('error', (e) => {
            console.log('Could not load underwater ambience audio');
        });
    } catch (e) {
        console.log('Could not initialize underwater ambience:', e);
    }
}

/**
 * Initialize physics, scene content, player fish, audio, and start the render loop.
 */
async function initScene() {
    const savedFishIndex = parseInt(localStorage.getItem('selectedFishIndex') || '0', 10);
    if (savedFishIndex >= 0 && savedFishIndex < PLAYER_FISH_MODELS.length) {
        currentFishModelIndex = savedFishIndex;
    }
    
    // Initialize physics first
    await initPhysics();
    
    // Then initialize your scene components
    initControls();
    initLights();
    buildSandDunes();
    addRocksAndPlants();
    
    // Create terrain collider after dunes are built
    if (isRapierLoaded()) {
        createTerrainCollider(dunes);
        createSceneColliders(rocks, kelp);
    }
    
    addWaterSurface();
    initPostProcessing();
    addCausticsLight();
    buildHud();
    addAmbientModels();
    addTitanic();
    addBoatWreck();
    addCoralReefs(); // Add coral formations around the scene
    
    await loadFishPlayer();
    loadStaticFish();
    loadGlowingFish();
    loadSchoolFish();
    loadLargeCreatures();
    
    initAudio();
    
    // Start animation loop
    animate();
}

const cycleStart = performance.now();

/**
 * Advance the day/night cycle, updating lighting, fog, water, and HUD.
 * @param {number} elapsedMs - Elapsed milliseconds since start.
 */
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
    sun.intensity = 0.3 + daylight * 0.6; // Reduced from 0.5 + daylight * 1.0
    ambient.intensity = 0.3 + daylight * 0.4; // Reduced from 0.4 + daylight * 0.6
    if (causticsLight) {
        causticsLight.intensity = 0.15 + daylight * 0.45; // Reduced for subtler caustics
    }
    if (bloomPass) {
        bloomPass.strength = BLOOM_STRENGTH * (0.4 + nightFactor * 1.6);
    }
    renderer.toneMappingExposure = 0.85 + nightFactor * 0.4; // Reduced base exposure from 1.0 to 0.85
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
        tmpSunDir.copy(sun.position).normalize();
        water.material.uniforms['sunDirection'].value.copy(tmpSunDir);
        
        const waterColor = nightWaterColor.clone().lerp(dayWaterColor, Math.max(0.2, daylight));
        water.material.uniforms['waterColor'].value.set(waterColor);
    }
}

/**
 * Update motion and camera follow for the currently controlled fish (AI instance).
 * @param {number} delta - Seconds since last frame.
 */
function updateControlledFish(delta) {
    if (!controlledFish) return;
    
    if (controlledFish === fish) {
        updateFish(delta);
        return;
    }
    
    if (controlledFish.model && controlledFish.isControlled) {
        tmpStartPos.copy(controlledFish.model.position);

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
        
        const verticalVelocity = controlledFish.velocity.y;
        const horizontalSpeed = Math.sqrt(controlledFish.velocity.x * controlledFish.velocity.x + controlledFish.velocity.z * controlledFish.velocity.z);
        const maxPitchAngle = Math.PI / 6;
        
        if (horizontalSpeed > 0.1) {
            const pitchRatio = verticalVelocity / (horizontalSpeed + Math.abs(verticalVelocity));
            controlledFish.model.rotation.x = -pitchRatio * maxPitchAngle;
        } else {
            controlledFish.model.rotation.x *= Math.pow(0.9, delta * 60);
        }

        if (controlledFish.rigidBody) {
            const translation = controlledFish.rigidBody.translation();
            translation.x = controlledFish.model.position.x;
            translation.y = controlledFish.model.position.y;
            translation.z = controlledFish.model.position.z;
            controlledFish.rigidBody.setNextKinematicTranslation(translation);
            
            const rotation = controlledFish.rigidBody.rotation();
            rotation.x = controlledFish.model.quaternion.x;
            rotation.y = controlledFish.model.quaternion.y;
            rotation.z = controlledFish.model.quaternion.z;
            rotation.w = controlledFish.model.quaternion.w;
            controlledFish.rigidBody.setNextKinematicRotation(rotation);
        }

        tmpDisplacement.subVectors(controlledFish.model.position, tmpStartPos);
        
        camera.position.add(tmpDisplacement);
        
        controls.target.copy(controlledFish.model.position);
    }
}

/**
 * Update the main player fish movement, collisions, and camera follow.
 * @param {number} delta - Seconds since last frame.
 */
function updateFish(delta) {
    if (!fish) return;

    tmpStartPos.copy(fish.position);

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
    } else {
        fishVelocity.multiplyScalar(Math.pow(SWIM_DRAG, delta * 60));
    }

    if (fish.position.y > WATER_SURFACE_Y - 3) {
        fish.position.y = WATER_SURFACE_Y - 3;
        fishVelocity.y = Math.min(0, fishVelocity.y);
    }

    resolvePlayerCollisions(gatherFishColliders());
    resolvePlayerSceneCollisions();

    const clampedX = THREE.MathUtils.clamp(fish.position.x, -PLAYER_BOUNDS, PLAYER_BOUNDS);
    const clampedY = THREE.MathUtils.clamp(fish.position.y, PLAYER_MIN_Y, PLAYER_MAX_Y);
    const clampedZ = THREE.MathUtils.clamp(fish.position.z, -PLAYER_BOUNDS, PLAYER_BOUNDS);
    if (clampedX !== fish.position.x) { fishVelocity.x = 0; fish.position.x = clampedX; }
    if (clampedY !== fish.position.y) { fishVelocity.y = 0; fish.position.y = clampedY; }
    if (clampedZ !== fish.position.z) { fishVelocity.z = 0; fish.position.z = clampedZ; }

    if (controlledFish === fish) {
        tmpHeading.copy(fishVelocity);
        tmpHeading.y = 0;
        if (tmpHeading.lengthSq() > 1e-4) {
            const fishModel = PLAYER_FISH_MODELS[currentFishModelIndex];
            fish.rotation.y = Math.atan2(tmpHeading.x, tmpHeading.z) + fishModel.rotationOffsetY;
            playerHeading.copy(tmpHeading).normalize();
        }

        const verticalVelocity = fishVelocity.y;
        const horizontalSpeed = Math.sqrt(fishVelocity.x * fishVelocity.x + fishVelocity.z * fishVelocity.z);
        const maxPitchAngle = Math.PI / 6;

        if (horizontalSpeed > 0.1) {
            const pitchRatio = verticalVelocity / (horizontalSpeed + Math.abs(verticalVelocity));
            fish.rotation.x = -pitchRatio * maxPitchAngle;
        } else {
            fish.rotation.x *= Math.pow(0.9, delta * 60);
        }
    }

    tmpDisplacement.subVectors(fish.position, tmpStartPos);
    
    camera.position.add(tmpDisplacement);
    
    controls.target.copy(fish.position);
}

/**
 * Return to the menu by reloading the page.
 */
function returnToMenu() {
    window.location.reload();
}

/**
 * Keyboard input handler for movement, control switching, and menu.
 * @param {KeyboardEvent} event
 * @param {boolean} isDown
 */
function handleKey(event, isDown) {
    if (isDown && event.code === 'Tab') {
        event.preventDefault();
        switchControl();
        return;
    }
    
    if (isDown && event.code === 'Escape') {
        event.preventDefault();
        returnToMenu();
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
        moveState.down = isDown;
        break;
    default: break;
    }
}
window.addEventListener('keydown', (e) => handleKey(e, true));
window.addEventListener('keyup', (e) => handleKey(e, false));

/**
 * Main render/update loop: physics, AI, player, postprocessing.
 */
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    updateDayNight(performance.now() - cycleStart);
    
    // Update physics
    updatePhysics(delta);
    
    // Update camera light position
    if (cameraLight) {
        cameraLight.position.copy(camera.position);
    }
    
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
    if (ambientDrifters.length > 0) {
        updateAmbientDrifters(delta);
    }
    if (kelp.length > 0) {
        const t = performance.now() * 0.001;
        kelp.forEach((k, idx) => {
            const baseSwayZ = Math.sin(t * 0.8 + idx) * 0.08;
            const baseSwayX = Math.sin(t * 0.6 + idx * 1.2) * 0.05;
            
            const smoothFactor = 0.15;
            k.angularVelocityX += (k.targetAngularVelocityX - k.angularVelocityX) * smoothFactor;
            k.angularVelocityZ += (k.targetAngularVelocityZ - k.angularVelocityZ) * smoothFactor;
            
            const dampingFactor = Math.pow(k.damping, delta * 60);
            k.targetAngularVelocityX *= dampingFactor;
            k.targetAngularVelocityZ *= dampingFactor;
            
            if (Math.abs(k.angularVelocityX) < 0.005) k.angularVelocityX = 0;
            if (Math.abs(k.angularVelocityZ) < 0.005) k.angularVelocityZ = 0;
            if (Math.abs(k.targetAngularVelocityX) < 0.005) k.targetAngularVelocityX = 0;
            if (Math.abs(k.targetAngularVelocityZ) < 0.005) k.targetAngularVelocityZ = 0;
            
            k.rotation.z = baseSwayZ + k.angularVelocityZ;
            k.rotation.x = baseSwayX + k.angularVelocityX;
            
            k.rotation.y = k.baseRotationY;
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

    // Resolve collisions between AI fish (whales vs whales, whales vs small fish, etc.)
    resolveAICollisions(gatherFishColliders());

    // Sync physics to Three.js (for kinematic objects)
    syncPhysicsToThreeJS();

    if (controlledFish && controlledFish !== fish && controlledFish.mixer) {
        controlledFish.mixer.update(delta);
    }

    updateControlledFish(delta);
    aiFish.forEach((ai) => {
        if (!ai.isControlled) {
            ai.update(delta);
        }
    });

    if (controls) {
        controls.update();
    }

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

/**
 * Keep camera and renderer sizes in sync with the window.
 */
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
}

initScene();

window.addEventListener('resize', onWindowResize, false);

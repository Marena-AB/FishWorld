/*
    Menu Module is responsible for creating and managing the main menu
    interface, including fish model selection with 3D previews, and
    handling transitions to the main game scene.
*/

import './menu.css';
import { initMenuBackground } from './menu-background.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { KHRMaterialsPBRSpecularGlossiness } from './pbrSpecGlossExtension.js';

import alienFishUrl from './assets/alien_fish_animated.glb';
import discusFishUrl from './assets/discus_fish.glb';
import stylizedFishUrl from './assets/stylized_fish.glb';

let gameLoaded = false;
let backgroundScene = null;

const TURTLE_URL = './assets/turtle.glb';
const KOI_FISH_URL = 'assets/fish_models/koi_fish/scene.gltf';
const TUNA_FISH_URL = 'assets/fish_models/tuna_fish/scene.gltf';
const ANIMATED_FISH_URL = 'assets/fish_models/fish_animated/scene.gltf';

const FISH_MODELS = [
    { 
        name: 'Default Fish', 
        url: new URL('./assets/fish.glb', import.meta.url).href,
        scale: 0.5,
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Alien Fish', 
        url: alienFishUrl,
        scale: 0.4,
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Discus Fish', 
        url: discusFishUrl,
        scale: 450,
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Stylized Fish', 
        url: stylizedFishUrl,
        scale: 0.5,
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Koi Fish', 
        url: KOI_FISH_URL,
        scale: 0.03,
        rotationOffsetY: -Math.PI / 2,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Tuna Fish', 
        url: TUNA_FISH_URL,
        scale: 0.85,
        rotationOffsetY: Math.PI / 2,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Animated Fish', 
        url: ANIMATED_FISH_URL,
        scale: 0.65,
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    },
    { 
        name: 'Sea Turtle', 
        url: TURTLE_URL,
        scale: 0.45,
        rotationOffsetY: 0,
        rotationOffsetX: 0,
        rotationOffsetZ: 0
    }
];

let previewScene = null;
let previewCamera = null;
let previewRenderer = null;
let previewModel = null;
let previewMixer = null;
let previewClock = null;
let previewAnimationId = null;
const previewLoader = new GLTFLoader();
previewLoader.register((parser) => new KHRMaterialsPBRSpecularGlossiness(parser));

/**
 * Set up a small Three.js scene for fish preview in the menu.
 */
function initPreview(canvasContainer) {
    previewScene = new THREE.Scene();
    previewScene.background = null;
    
    previewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    previewCamera.position.set(0, 0, 5);
    
    previewRenderer = new THREE.WebGLRenderer({ 
        canvas: canvasContainer, 
        antialias: true,
        alpha: true 
    });
    previewRenderer.setSize(200, 200);
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    previewRenderer.shadowMap.enabled = true;
    previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    const ambientLight = new THREE.AmbientLight(0x88c5d8, 0.6);
    previewScene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    previewScene.add(directionalLight);
    
    const rimLight = new THREE.DirectionalLight(0x64c5ff, 0.4);
    rimLight.position.set(-5, 0, -5);
    previewScene.add(rimLight);
    
    previewClock = new THREE.Clock();
    
    /**
     * Animate the preview scene.
     * */
    function animatePreview() {
        previewAnimationId = requestAnimationFrame(animatePreview);
        
        const delta = previewClock.getDelta();
        
        if (previewModel) {
            previewModel.rotation.y += delta * 0.5;
        }
        
        if (previewMixer) {
            previewMixer.update(delta);
        }
        
        previewRenderer.render(previewScene, previewCamera);
    }
    
    animatePreview();
}

/**
 * Load and display a preview fish model by index.
 */
function loadPreviewModel(index) {
    const fishModel = FISH_MODELS[index];
    
    if (previewModel) {
        previewScene.remove(previewModel);
        previewModel.traverse((obj) => {
            if (obj.geometry) {
                obj.geometry.dispose();
            }
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(mat => {
                        mat.dispose();
                    });
                } else {
                    obj.material.dispose();
                }
            }
        });
        previewModel = null;
    }
    if (previewMixer) {
        previewMixer = null;
    }
    
    const canvas = previewRenderer.domElement;
    canvas.style.opacity = '0.5';
    
    previewLoader.load(
        fishModel.url,
        (gltf) => {
            previewModel = clone(gltf.scene);
            
            previewModel.scale.setScalar(fishModel.scale);
            previewModel.rotation.y = fishModel.rotationOffsetY;
            previewModel.rotation.x = fishModel.rotationOffsetX;
            previewModel.rotation.z = fishModel.rotationOffsetZ;
            
            previewModel.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                }
            });
            
            const box = new THREE.Box3().setFromObject(previewModel);
            const center = box.getCenter(new THREE.Vector3());
            previewModel.position.sub(center);
            
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const distance = maxDim > 0 ? maxDim * 2.5 : 5;
            previewCamera.position.set(0, 0, distance);
            previewCamera.lookAt(0, 0, 0);
            
            previewScene.add(previewModel);
            
            if (gltf.animations && gltf.animations.length > 0) {
                previewMixer = new THREE.AnimationMixer(previewModel);
                gltf.animations.forEach((clip) => {
                    previewMixer.clipAction(clip).play();
                });
            }
            
            canvas.style.opacity = '1';
        },
        undefined,
        (error) => {
            console.error('Failed to load preview model:', error);
            canvas.style.opacity = '1';
        }
    );
}

/**
 * Build the main menu DOM, hook up events, and initialize preview.
 */
function createMenu() {
    const menuContainer = document.createElement('div');
    menuContainer.id = 'menu-container';
    
    const backgroundContainer = document.createElement('div');
    backgroundContainer.id = 'menu-background-container';
    backgroundContainer.style.position = 'fixed';
    backgroundContainer.style.top = '0';
    backgroundContainer.style.left = '0';
    backgroundContainer.style.width = '100%';
    backgroundContainer.style.height = '100%';
    backgroundContainer.style.zIndex = '1';
    document.body.appendChild(backgroundContainer);
    
    backgroundScene = initMenuBackground(backgroundContainer);
    
    menuContainer.innerHTML = `
        <div class="menu-content">
            <div class="menu-title">
                <h1 class="title-main">FishWorld</h1>
                <p class="title-subtitle">Dive into the depths</p>
            </div>
            <div class="menu-section">
                <label class="menu-label">Select Your Fish:</label>
                <div class="fish-selector">
                    <button id="fish-prev-btn" class="fish-nav-btn" title="Previous Fish">◀</button>
                    <div class="fish-display">
                        <canvas id="fish-preview-canvas" class="fish-preview-canvas"></canvas>
                        <span id="fish-name" class="fish-name">Default Fish</span>
                    </div>
                    <button id="fish-next-btn" class="fish-nav-btn" title="Next Fish">▶</button>
                </div>
            </div>
            <div class="menu-buttons">
                <button id="start-btn" class="menu-btn menu-btn-primary">
                    <span class="btn-text">Start Game</span>
                    <span class="btn-icon">🐠</span>
                </button>
                <button id="quit-btn" class="menu-btn menu-btn-secondary">
                    <span class="btn-text">Quit</span>
                    <span class="btn-icon">🚪</span>
                </button>
            </div>
            <div class="menu-footer">
                <p>Use WASD to swim • Mouse to look • Space/Shift to ascend/descend</p>
                <p style="margin-top: 8px; font-size: 0.85rem; opacity: 0.8;">Press Escape in-game to return to menu and change fish</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(menuContainer);
    
    const previewCanvas = document.getElementById('fish-preview-canvas');
    initPreview(previewCanvas);
    
    let selectedFishIndex = parseInt(localStorage.getItem('selectedFishIndex') || '0', 10);
    if (selectedFishIndex < 0 || selectedFishIndex >= FISH_MODELS.length) {
        selectedFishIndex = 0;
    }
    updateFishDisplay(selectedFishIndex);
    
    const startBtn = document.getElementById('start-btn');
    const quitBtn = document.getElementById('quit-btn');
    const fishPrevBtn = document.getElementById('fish-prev-btn');
    const fishNextBtn = document.getElementById('fish-next-btn');
    
    startBtn.addEventListener('click', startGame);
    quitBtn.addEventListener('click', quitGame);
    
    fishPrevBtn.addEventListener('click', () => {
        selectedFishIndex = (selectedFishIndex - 1 + FISH_MODELS.length) % FISH_MODELS.length;
        updateFishDisplay(selectedFishIndex);
        localStorage.setItem('selectedFishIndex', selectedFishIndex.toString());
    });
    
    fishNextBtn.addEventListener('click', () => {
        selectedFishIndex = (selectedFishIndex + 1) % FISH_MODELS.length;
        updateFishDisplay(selectedFishIndex);
        localStorage.setItem('selectedFishIndex', selectedFishIndex.toString());
    });
    
    /**
     * Update the fish name and load the corresponding preview model.
     */
    function updateFishDisplay(index) {
        const fishModel = FISH_MODELS[index];
        document.getElementById('fish-name').textContent = fishModel.name;
        loadPreviewModel(index);
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !gameLoaded) {
            startGame();
        } else if (e.key === 'Escape' && !gameLoaded) {
            quitGame();
        }
    });
}

/**
 * Fade out menu, dispose preview, and lazy-load the game module.
 */
async function startGame() {
    if (gameLoaded) return;
    
    const menuContainer = document.getElementById('menu-container');
    const backgroundContainer = document.getElementById('menu-background-container');
    const startBtn = document.getElementById('start-btn');
    
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="btn-text">Loading...</span><span class="btn-icon">⏳</span>';
    
    try {
        menuContainer.style.opacity = '0';
        menuContainer.style.transition = 'opacity 1s ease-out';
        
        if (backgroundContainer) {
            backgroundContainer.style.opacity = '0';
            backgroundContainer.style.transition = 'opacity 1s ease-out';
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (previewAnimationId) {
            cancelAnimationFrame(previewAnimationId);
            previewAnimationId = null;
        }
        if (previewRenderer) {
            previewRenderer.dispose();
            previewRenderer = null;
        }
        previewScene = null;
        previewCamera = null;
        previewModel = null;
        previewMixer = null;
        previewClock = null;
        
        if (backgroundScene && backgroundScene.dispose) {
            backgroundScene.dispose();
        }
        
        menuContainer.style.display = 'none';
        if (backgroundContainer) {
            backgroundContainer.style.display = 'none';
        }
        
        gameModule = await import('./water.js');
        gameLoaded = true;
        
    } catch (error) {
        console.error('Failed to load game:', error);
        startBtn.disabled = false;
        startBtn.innerHTML = '<span class="btn-text">Error - Click to retry</span><span class="btn-icon">⚠️</span>';
        menuContainer.style.opacity = '1';
        menuContainer.style.display = 'flex';
        if (backgroundContainer) {
            backgroundContainer.style.opacity = '1';
            backgroundContainer.style.display = 'block';
        }
    }
}

/**
 * Exit the game or navigate back; shows a thank-you fallback when blocked.
 */
function quitGame() {
    if (confirm('Are you sure you want to quit?')) {
        window.close();
        if (window.history.length > 1) {
            window.history.back();
        } else {
            document.body.innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: Arial, sans-serif; color: #fff; background: #0a1938;"><h1>Thanks for playing!</h1></div>';
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createMenu);
} else {
    createMenu();
}

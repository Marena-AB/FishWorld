/**
 * Menu Background with Animated Water Surface
 * 
 * This module sets up a Three.js scene with an animated water surface
 * to be used as a dynamic background for the main menu. It includes
 * lighting, fog, and camera animation to create an engaging visual effect.
 */

import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';

let scene, camera, renderer;
let water;
let ambientLight, directionalLight;
let clock;
let animationId;

/**
 * Initialize the menu background scene with animated water.
 * @param {*} container 
 * @returns {Object} An object with a dispose method to clean up resources.
 */
export function initMenuBackground(container) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 200, 1000);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(0, 15, 50);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '1';

    ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(50, 100, 30);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(2048, 2048);
    directionalLight.shadow.camera.left = -200;
    directionalLight.shadow.camera.right = 200;
    directionalLight.shadow.camera.top = 200;
    directionalLight.shadow.camera.bottom = -200;
    scene.add(directionalLight);

    const waterGeometry = new THREE.PlaneGeometry(800, 800, 128, 128);
    const textureLoader = new THREE.TextureLoader();
    
    let waterNormals;
    try {
        const normalMapUrl = new URL('./textures/waternormals.jpg', import.meta.url).href;
        waterNormals = textureLoader.load(
            normalMapUrl,
            (texture) => {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(8, 8);
            },
            undefined,
            () => {
                console.log('Water normal map not found, using defaults');
            }
        );
    } catch (e) {
        console.log('Could not load water normal map, Water will use defaults');
        waterNormals = null;
    }

    water = new Water(waterGeometry, {
        textureWidth: 1024,
        textureHeight: 1024,
        waterNormals: waterNormals || undefined,
        sunDirection: new THREE.Vector3(0, 1, 0),
        sunColor: 0xffffff,
        waterColor: 0x006994,
        distortionScale: 1000,
        size: 1000.5,
        fog: scene.fog !== undefined,
        alpha: 1.0
    });

    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    scene.add(water);
    console.log('Menu: Ocean surface created at sea level');

    let cameraAngle = 0;
    const cameraRadius = 60;
    const cameraHeight = 18;

    clock = new THREE.Clock();

    /**
     * Animate the scene, updating water and camera position.
     */
    function animate() {
        animationId = requestAnimationFrame(animate);

        const delta = clock.getDelta();
        const time = clock.getElapsedTime();

        cameraAngle += delta * 0.05;
        camera.position.x = Math.cos(cameraAngle) * cameraRadius;
        camera.position.z = Math.sin(cameraAngle) * cameraRadius;
        camera.position.y = cameraHeight + Math.sin(time * 0.15) * 1;
        camera.lookAt(0, 0, 0);

        if (water) {
            water.material.uniforms['time'].value += delta * 0.8;
            const sunDir = new THREE.Vector3();
            sunDir.copy(directionalLight.position).normalize();
            water.material.uniforms['sunDirection'].value.copy(sunDir);
        }

        const dayFactor = (Math.sin(time * 0.05) + 1) * 0.5;
        ambientLight.intensity = 0.5 + dayFactor * 0.2;
        directionalLight.intensity = 1.0 + dayFactor * 0.3;
        
        const skyColor = new THREE.Color(0x87ceeb).lerp(new THREE.Color(0x4682b4), dayFactor * 0.3);
        scene.fog.color.copy(skyColor);
        scene.background.copy(skyColor);

        renderer.render(scene, camera);
    }

    animate();

    /**
     * Handle window resize events to adjust camera and renderer.
     */
    function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onResize);

    return {
        dispose: () => {
            window.removeEventListener('resize', onResize);
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            renderer.dispose();
            if (container && renderer.domElement.parentNode === container) {
                container.removeChild(renderer.domElement);
            }
        }
    };
}


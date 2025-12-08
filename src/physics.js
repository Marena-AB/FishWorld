/*
    Physics Module for Underwater Scene is responsible for initializing
    and managing the Rapier physics engine, creating colliders for terrain
    and scene objects, handling fish physics bodies, and updating the
    physics simulation in sync with the Three.js rendering loop.
*/ 

import RAPIER from '@dimforge/rapier3d-compat';

let physicsWorld = null;
let rapierLoaded = false;
const physicsObjects = [];

/**
 * Initialize the Rapier physics engine
 * @returns {Promise<RAPIER.World>} The physics world instance
 */
export async function initPhysics() {
    await RAPIER.init();
    
    // Create physics world with gravity
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    physicsWorld = new RAPIER.World(gravity);
    
    rapierLoaded = true;
    console.log('Rapier physics initialized');
    
    return physicsWorld;
}

/**
 * Get the physics world instance
 * @returns {RAPIER.World|null} The physics world instance
 */
export function getPhysicsWorld() {
    return physicsWorld;
}

/**
 * Check if Rapier is loaded
 * @returns {boolean} True if Rapier is loaded
 */
export function isRapierLoaded() {
    return rapierLoaded;
}

/**
 * Create a terrain collider from the dunes geometry
 * @param {THREE.Mesh} dunes - The terrain mesh
 * @returns {RAPIER.Collider|null} The terrain collider
 */
export function createTerrainCollider(dunes) {
    if (!physicsWorld || !dunes) return null;
    
    const geometry = dunes.geometry;
    const position = geometry.attributes.position;
    
    // Extract vertices
    const vertices = [];
    for (let i = 0; i < position.count; i++) {
        vertices.push(position.getX(i));
        vertices.push(position.getY(i));
        vertices.push(position.getZ(i));
    }
    
    // Extract indices
    const indices = [];
    if (geometry.index) {
        for (let i = 0; i < geometry.index.count; i++) {
            indices.push(geometry.index.getX(i));
        }
    } else {
        // Generate indices if not present
        for (let i = 0; i < position.count; i++) {
            indices.push(i);
        }
    }
    
    // Create trimesh collider
    const terrainDesc = RAPIER.ColliderDesc.trimesh(
        new Float32Array(vertices),
        new Uint32Array(indices)
    );
    
    const terrainCollider = physicsWorld.createCollider(terrainDesc);
    console.log('Terrain collider created');
    
    return terrainCollider;
}

/**
 * Create colliders for scene objects (rocks and kelp)
 * @param {Array<THREE.Mesh>} rocks - Array of rock meshes
 * @param {Array<THREE.Mesh>} kelp - Array of kelp meshes
 */
export function createSceneColliders(rocks, kelp) {
    if (!physicsWorld) return;
    
    // Rock colliders
    rocks.forEach((rock) => {
        const radius = rock.scale.x * 1.5;

        const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(rock.position.x, rock.position.y, rock.position.z);
        const rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
        
        const rockDesc = RAPIER.ColliderDesc.ball(radius)
            .setRestitution(0.3)
            .setFriction(0.8);
        
        const collider = physicsWorld.createCollider(rockDesc, rigidBody);
        physicsObjects.push({ mesh: rock, collider: collider, rigidBody: rigidBody, isStatic: true });
    });
    
    // Kelp colliders
    kelp.forEach((k) => {
        const height = k.geometry.parameters.height;
        const radius = k.geometry.parameters.radiusTop;
        
        const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(k.position.x, k.position.y, k.position.z)
            .setRotation(k.quaternion);
        const rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
        
        const kelpDesc = RAPIER.ColliderDesc.cylinder(height / 2, radius)
            .setRestitution(0.1)
            .setFriction(0.5);
        
        const collider = physicsWorld.createCollider(kelpDesc, rigidBody);
        physicsObjects.push({ mesh: k, collider: collider, rigidBody: rigidBody, isStatic: true });
    });
    
    console.log(`Created ${rocks.length + kelp.length} static scene colliders`);
}

/**
 * Create physics body and collider for a fish
 * @param {Object} fishInstance - The fish instance
 * @param {number} radius - Collision radius
 * @param {number} mass - Mass of the fish
 * @returns {Object|null} Object with rigidBody and collider, or null if physics not initialized
 */
export function createFishPhysics(fishInstance, radius = 2.0, mass = 1.0) {
    if (!physicsWorld) return null;
    
    const position = fishInstance.model ? fishInstance.model.position : fishInstance.position;
    
    // Create rigid body descriptor
    const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(position.x, position.y, position.z);
    
    const rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
    
    // Create sphere collider
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
        .setDensity(mass)
        .setRestitution(0.2)
        .setFriction(0.3)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    
    const collider = physicsWorld.createCollider(colliderDesc, rigidBody);
    
    // Store reference
    const fishObject = fishInstance.model || fishInstance;
    physicsObjects.push({
        mesh: fishObject,
        rigidBody: rigidBody,
        collider: collider,
        fishInstance: fishInstance,
        isStatic: false
    });
    
    // Also attach to fish instance for direct access
    if (fishInstance) {
        fishInstance.rigidBody = rigidBody;
        fishInstance.collider = collider;
        fishInstance.physicsWorld = physicsWorld;
    }
    
    return { rigidBody, collider };
}

/**
 * Step the physics simulation forward
 * @param {number} delta - Time delta
 */
export function updatePhysics(delta) {
    if (!physicsWorld || !rapierLoaded) return;
    
    // Step the physics simulation
    physicsWorld.step();
}

/**
 * Sync physics bodies to Three.js meshes
 */
export function syncPhysicsToThreeJS() {
    if (!physicsWorld) return;
    
    physicsObjects.forEach((obj) => {
        if (obj.isStatic) return; // Skip static objects
        
        if (obj.fishInstance && obj.fishInstance.isControlled) return;
        
        if (obj.rigidBody && obj.mesh) {
            const position = obj.rigidBody.translation();
            const rotation = obj.rigidBody.rotation();
            
            // Update Three.js mesh position
            obj.mesh.position.set(position.x, position.y, position.z);
        
        }
    });
}

/**
 * Get the physics objects array (for debugging or advanced usage)
 * @returns {Array} Array of physics objects
 */
export function getPhysicsObjects() {
    return physicsObjects;
}


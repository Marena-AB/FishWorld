import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export class Fish {
    // Shared loader and GLTF cache so multiple fish reuse parsed scenes/animations
    static loader = new GLTFLoader();
    static gltfCache = new Map();

    static loadModel(modelPath, modelFile) {
        const fullPath = modelFile ? modelPath + modelFile : modelPath;
        const existing = Fish.gltfCache.get(fullPath);
        if (existing) {
            return existing;
        }

        const promise = Fish.loader.loadAsync(fullPath)
            .then((gltf) => {
                Fish.gltfCache.set(fullPath, Promise.resolve(gltf));
                return gltf;
            })
            .catch((err) => {
                Fish.gltfCache.delete(fullPath);
                throw err;
            });

        Fish.gltfCache.set(fullPath, promise);
        return promise;
    }

    constructor(scene, options = {}) {
        this.scene = scene;
        
        this.model = null;
        this.mixer = null;
        this.materials = [];
        
        this.modelPath = options.modelPath;
        this.modelFile = options.modelFile;
        
        this.scale = options.scale || 0.01;
        
        this.rotationOffsetY = options.rotationOffsetY || 0;
        this.rotationOffsetX = options.rotationOffsetX || 0;
        this.rotationOffsetZ = options.rotationOffsetZ || 0;
        
        this.position = options.position || new THREE.Vector3(0, 5, 0);
        
        // Physics properties (must be set before clamping position)
        this.waterSurfaceY = options.waterSurfaceY || 50;
        
        // Clamp initial position to be below water surface
        if (this.position.y > this.waterSurfaceY - 2) {
            this.position.y = this.waterSurfaceY - 2;
        }
        
        this.moveSpeed = options.moveSpeed || 5.0;
        this.rotationSpeed = options.rotationSpeed || 3.0;
        this.changeTargetDistance = options.changeTargetDistance || 25.0;
        this.maxTravelTime = options.maxTravelTime || 15.0;
        this.minTravelTime = options.minTravelTime || 8.0;
        this.canMove = options.canMove !== undefined ? options.canMove : true;
        this.worldBounds = options.worldBounds || {
            min: -400,
            max: 400,
            minY: 5,
            maxY: 45
        };
        
        this.baseColor = options.color ? new THREE.Color(options.color) : null;
        this.emissiveColor = options.emissiveColor ? new THREE.Color(options.emissiveColor) : null;
        this.emissiveIntensity = options.emissiveIntensity || 0;
        this.emissivePulseSpeed = options.emissivePulseSpeed || 2.2;
        this.glowMultiplier = 1;
        this.materialModifier = options.materialModifier;
        this.radius = options.radius || 2.0;
        
        // Physics properties (waterSurfaceY already set above)
        this.physicsWorld = options.physicsWorld || null;
        this.rigidBody = null;
        this.collider = null;
        this.canJump = options.canJump !== undefined ? options.canJump : false;
        this.jumpCooldown = 0;
        this.isJumping = false;
        this.velocity = new THREE.Vector3();
        
        this.previousPosition = new THREE.Vector3();
        this.targetPosition = new THREE.Vector3();
        this.time = 0;
        this.timeSinceTargetChange = 0;
        this.currentTargetTime = 0;
        
        this.isControlled = false;
        
        this.load();
    }
    
    setControlled(controlled) {
        this.isControlled = controlled;
        if (controlled) {
            this.velocity.set(0, 0, 0);
        }
    }
    
    async load() {
        try {
            const gltf = await Fish.loadModel(this.modelPath, this.modelFile);
            // Clone to avoid sharing skeletons/materials between fish
            this.model = clone(gltf.scene);
            
            this.model.scale.set(this.scale, this.scale, this.scale);
            
            this.model.position.copy(this.position);
            // Ensure initial position is below water surface
            if (this.model.position.y > this.waterSurfaceY - 2) {
                this.model.position.y = this.waterSurfaceY - 2;
            }
            this.previousPosition.copy(this.model.position);
            
            if (this.canMove) {
                this.pickRandomTarget();
            }
            
            this.model.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;

                    obj.material = obj.material.clone();
                    const mat = obj.material;
                    if (this.baseColor) {
                        mat.color.copy(this.baseColor);
                    }
                    if (this.emissiveColor) {
                        mat.emissive = this.emissiveColor.clone();
                        mat.emissiveIntensity = this.emissiveIntensity;
                    }
                    if (this.materialModifier) {
                        this.materialModifier(mat);
                    }
                    this.materials.push(mat);
                }
            });
            
            if (gltf.animations && gltf.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                
                gltf.animations.forEach((clip) => {
                    const action = this.mixer.clipAction(clip);
                    action.play();
                });
                
                console.log(`Fish animations loaded: ${gltf.animations.length} animation(s)`);
            } else {
                console.log('No animations found in fish model');
            }
            
            this.scene.add(this.model);
        } catch (error) {
            console.error('Error loading fish:', error);
        }
    }
    
    pickRandomTarget() {
        // Let fish roam nearly the full world bounds (leave a small margin so they don't clip the edge)
        const margin = (this.worldBounds.max - this.worldBounds.min) * 0.05;
        const minX = this.worldBounds.min + margin;
        const maxX = this.worldBounds.max - margin;
        const minZ = this.worldBounds.min + margin;
        const maxZ = this.worldBounds.max - margin;
        const minY = this.worldBounds.minY + 5;
        // Ensure target is always safely below water surface
        const maxY = Math.min(this.worldBounds.maxY - 5, this.waterSurfaceY - 5);
        
        const randomX = minX + Math.random() * (maxX - minX);
        const randomZ = minZ + Math.random() * (maxZ - minZ);
        const randomY = minY + Math.random() * (maxY - minY);
        
        this.targetPosition.set(randomX, randomY, randomZ);
        
        this.timeSinceTargetChange = 0;
        this.currentTargetTime = this.minTravelTime + Math.random() * (this.maxTravelTime - this.minTravelTime);
    }
    
    update(delta) {
        if (!this.model) return;
        this.time += delta;
        
        if (this.mixer) {
            this.mixer.update(delta);
        }
        

        // Update jump cooldown
        if (this.jumpCooldown > 0) {
            this.jumpCooldown -= delta;
        }
        
        if (this.isControlled) {
            return;
        }
        
        if (!this.canMove) {
            return;
        }
        
        this.timeSinceTargetChange += delta;
        
        const currentPosition = this.model.position.clone();
        const directionToTarget = new THREE.Vector3()
            .subVectors(this.targetPosition, currentPosition);
        
        const distanceToTarget = directionToTarget.length();
        
        if (distanceToTarget < this.changeTargetDistance || this.timeSinceTargetChange > this.currentTargetTime) {
            this.pickRandomTarget();
            return;
        }
        
        if (distanceToTarget > 0.001) {
            directionToTarget.normalize();
            
            const moveDistance = this.moveSpeed * delta;
            const newPosition = currentPosition.clone()
                .add(directionToTarget.multiplyScalar(moveDistance));
            
            // STRICT: If fish is above water and not jumping, force it down immediately
            if (currentPosition.y > this.waterSurfaceY - 2 && !this.isJumping) {
                newPosition.y = this.waterSurfaceY - 2;
                this.isJumping = false;
                this.velocity.y = 0;
                this.pickRandomTarget(); // Get a new underwater target
            }
            
            // Water surface handling - prevent going above water unless jumping
            if (newPosition.y > this.waterSurfaceY - 2) {
                if (this.canJump && !this.isJumping && this.jumpCooldown <= 0 && Math.random() < 0.02) {
                    // Initiate jump
                    this.isJumping = true;
                    this.velocity.y = 8 + Math.random() * 4; // Jump velocity
                    this.jumpCooldown = 3 + Math.random() * 2; // Cooldown before next jump
                } else if (!this.isJumping) {
                    // Keep fish below water surface
                    newPosition.y = Math.min(newPosition.y, this.waterSurfaceY - 2);
                    this.pickRandomTarget(); // Get new underwater target
                }
            }
            
            // Handle jumping physics
            if (this.isJumping) {
                this.velocity.y -= 9.8 * delta; // Gravity
                newPosition.y += this.velocity.y * delta;
                
                // Check if fish has landed back in water
                if (newPosition.y <= this.waterSurfaceY - 2) {
                    newPosition.y = this.waterSurfaceY - 2;
                    this.isJumping = false;
                    this.velocity.y = 0;
                    this.pickRandomTarget(); // Get new underwater target after landing
                }
            }
            
            const margin = (this.worldBounds.max - this.worldBounds.min) * 0.02;
            const minX = this.worldBounds.min + margin;
            const maxX = this.worldBounds.max - margin;
            const minZ = this.worldBounds.min + margin;
            const maxZ = this.worldBounds.max - margin;
            if (newPosition.x < minX) {
                newPosition.x = minX;
                this.pickRandomTarget();
            }
            if (newPosition.x > maxX) {
                newPosition.x = maxX;
                this.pickRandomTarget();
            }
            if (newPosition.z < minZ) {
                newPosition.z = minZ;
                this.pickRandomTarget();
            }
            if (newPosition.z > maxZ) {
                newPosition.z = maxZ;
                this.pickRandomTarget();
            }
            if (newPosition.y < this.worldBounds.minY + 2) {
                newPosition.y = this.worldBounds.minY + 2;
                this.pickRandomTarget();
            }
            if (newPosition.y > this.worldBounds.maxY - 2 && !this.isJumping) {
                newPosition.y = this.worldBounds.maxY - 2;
                this.pickRandomTarget();
            }
            
            const movementDirection = new THREE.Vector3()
                .subVectors(newPosition, this.previousPosition);
            
            if (movementDirection.length() > 0.001) {
                movementDirection.normalize();
                
                const tempObject = new THREE.Object3D();
                tempObject.position.copy(newPosition);
                tempObject.lookAt(newPosition.clone().add(movementDirection));
                
                // Add tilt when jumping
                if (this.isJumping) {
                    const tiltAngle = Math.atan2(this.velocity.y, this.moveSpeed) * 0.5;
                    tempObject.rotateX(tiltAngle);
                }
                
                // Apply rotation offsets for different fish models
                if (this.rotationOffsetX !== 0) {
                    tempObject.rotateX(this.rotationOffsetX);
                }
                if (this.rotationOffsetY !== 0) {
                    tempObject.rotateY(this.rotationOffsetY);
                }
                if (this.rotationOffsetZ !== 0) {
                    tempObject.rotateZ(this.rotationOffsetZ);
                }
                
                const targetQuaternion = tempObject.quaternion.clone();
                
                const rotationFactor = Math.min(this.rotationSpeed * delta, 1.0);
                this.model.quaternion.slerp(targetQuaternion, rotationFactor);
            }
            
            this.model.position.copy(newPosition);
            this.previousPosition.copy(newPosition);
            
            // Update physics body if it exists
            if (this.rigidBody && this.physicsWorld) {
                const translation = this.rigidBody.translation();
                translation.x = newPosition.x;
                translation.y = newPosition.y;
                translation.z = newPosition.z;
                this.rigidBody.setTranslation(translation, true);
            }
        }

        if (this.emissiveColor && this.materials.length > 0) {
            const pulse = 1 + 0.35 * Math.sin(this.time * this.emissivePulseSpeed);
            const intensity = this.emissiveIntensity * pulse * this.glowMultiplier;
            this.materials.forEach((mat) => {
                mat.emissive.copy(this.emissiveColor);
                mat.emissiveIntensity = intensity;
            });
        }
    }

    setGlowMultiplier(multiplier) {
        this.glowMultiplier = multiplier;
    }
}

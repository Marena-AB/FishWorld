import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Fish {
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
        
        this.moveSpeed = options.moveSpeed || 5.0;
        this.rotationSpeed = options.rotationSpeed || 3.0;
        this.changeTargetDistance = options.changeTargetDistance || 10.0;
        this.maxTravelTime = options.maxTravelTime || 5.0;
        this.minTravelTime = options.minTravelTime || 2.0;
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
        
        // Physics properties
        this.physicsWorld = options.physicsWorld || null;
        this.rigidBody = null;
        this.collider = null;
        this.waterSurfaceY = options.waterSurfaceY || 50;
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
        this.velocity = new THREE.Vector3();
        
        this.load();
    }
    
    setControlled(controlled) {
        this.isControlled = controlled;
        if (controlled) {
            this.velocity.set(0, 0, 0);
        }
    }
    
    load() {
        const loader = new GLTFLoader();
        loader.setPath(this.modelPath);
        
        loader.load(
            this.modelFile,
            (gltf) => {
                this.model = gltf.scene;
                
                this.model.scale.set(this.scale, this.scale, this.scale);
                
                
                this.model.position.copy(this.position);
                this.previousPosition.copy(this.position);
                
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
            },
            undefined,
            (error) => {
                console.error('Error loading fish:', error);
            }
        );
    }
    
    pickRandomTarget() {
        const boundary = (this.worldBounds.max - this.worldBounds.min) * 0.4;
        const minY = this.worldBounds.minY + 5;
        const maxY = this.worldBounds.maxY - 5;
        
        const randomX = (Math.random() - 0.5) * 2 * boundary;
        const randomZ = (Math.random() - 0.5) * 2 * boundary;
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
                    if (currentPosition.y > this.waterSurfaceY - 2) {
                        this.pickRandomTarget();
                    }
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
                }
            }
            
            const boundary = (this.worldBounds.max - this.worldBounds.min) * 0.45;
            if (Math.abs(newPosition.x) > boundary) {
                newPosition.x = Math.sign(newPosition.x) * boundary;
                this.pickRandomTarget();
            }
            if (Math.abs(newPosition.z) > boundary) {
                newPosition.z = Math.sign(newPosition.z) * boundary;
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
                

                const lookTarget = newPosition.clone().add(movementDirection);
                tempObject.lookAt(lookTarget);

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

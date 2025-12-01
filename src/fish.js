import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Fish {
    constructor(scene, options = {}) {
        this.scene = scene;
        
        this.model = null;
        this.mixer = null;
        
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
        
        this.previousPosition = new THREE.Vector3();
        this.targetPosition = new THREE.Vector3();
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
        
        if (this.mixer) {
            this.mixer.update(delta);
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
            if (newPosition.y > this.worldBounds.maxY - 2) {
                newPosition.y = this.worldBounds.maxY - 2;
                this.pickRandomTarget();
            }
            
            const movementDirection = new THREE.Vector3()
                .subVectors(newPosition, this.previousPosition);
            
            if (movementDirection.length() > 0.001) {
                movementDirection.normalize();
                
                const tempObject = new THREE.Object3D();
                tempObject.position.copy(newPosition);
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
        }
    }
}


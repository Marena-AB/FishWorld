import * as THREE from 'three';

/**
 * Minimal handler for KHR_materials_pbrSpecularGlossiness.
 * Approximates spec/gloss into a standard PBR material and skips unsupported maps
 * so models that declare the extension still load without errors.
 */
export class KHRMaterialsPBRSpecularGlossiness {
    constructor(parser) {
        this.parser = parser;
        this.name = 'KHR_materials_pbrSpecularGlossiness';
    }

    getMaterialType(/* materialIndex */) {
        return THREE.MeshStandardMaterial;
    }

    extendMaterialParams(materialIndex, materialParams) {
        const materialDef = this.parser.json.materials[materialIndex];
        const ext = materialDef.extensions?.[this.name];
        if (!ext) { return null; }

        // Diffuse/base color
        if (ext.diffuseFactor) {
            materialParams.color = new THREE.Color().fromArray(ext.diffuseFactor);
            materialParams.opacity = ext.diffuseFactor[3] ?? 1;
            materialParams.transparent = materialParams.opacity < 1;
        }

        // Approximate roughness from glossiness
        const glossiness = ext.glossinessFactor !== undefined ? ext.glossinessFactor : 1;
        materialParams.roughness = 1 - glossiness;
        materialParams.metalness = 0.0;

        // Approximate metalness from specular factor intensity
        if (ext.specularFactor) {
            const avg = (ext.specularFactor[0] + ext.specularFactor[1] + ext.specularFactor[2]) / 3;
            materialParams.metalness = Math.min(1, avg);
        }

        const pending = [];
        // Prefer diffuse texture, fall back to baseColor if present
        if (ext.diffuseTexture) {
            pending.push(this.parser.assignTexture(materialParams, 'map', ext.diffuseTexture));
        } else if (materialDef.pbrMetallicRoughness?.baseColorTexture) {
            pending.push(this.parser.assignTexture(materialParams, 'map', materialDef.pbrMetallicRoughness.baseColorTexture));
        }

        // Ignore specularGlossinessTexture to avoid loader errors; we already approximated values.
        return Promise.all(pending);
    }
}

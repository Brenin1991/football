import * as THREE from 'three'
import type { PlayerAppearance } from '../matchRuntime'
import { AAA_CLASSIC, boostAaaColor } from './aaaSettings'
import { applyAaaMaterialToMesh, applyAaaMeshShadows, toAaaStandard } from './aaaMaterial'
import { applyAaaGrassShader } from './aaaGrassShader'
import { addAaaPhysicalGrass } from './aaaPhysicalGrass'

type PlayerPart = 'shirt' | 'shorts' | 'socks' | 'body' | 'skin' | 'hair' | 'boots' | 'other'

function hasAlbedoMap(src: THREE.Material): boolean {
  return (
    (src instanceof THREE.MeshStandardMaterial || src instanceof THREE.MeshPhysicalMaterial) &&
    src.map != null
  )
}

function classifyPlayerMesh(name: string): PlayerPart {
  if (name.includes('Ch38_Shirt')) return 'shirt'
  if (name.includes('Ch38_Shorts')) return 'shorts'
  if (name.includes('Ch38_Socks')) return 'socks'
  if (name.includes('Ch38_Body') || name.includes('BRACO') || name.includes('Braco')) return 'body'

  const n = name.toLowerCase()
  if (n.includes('braco')) return 'body'
  if (n.includes('shirt')) return 'shirt'
  if (n.includes('short') || n.includes('pant') || n.includes('trunk')) return 'shorts'
  if (n.includes('sock')) return 'socks'
  if (n.includes('shoe') || n.includes('boot') || n.includes('sneaker')) return 'boots'
  if (n.includes('hair')) return 'hair'
  if (
    n.includes('head') ||
    n.includes('hand') ||
    n.includes('arm') ||
    n.includes('leg') ||
    n.includes('face')
  ) {
    return 'skin'
  }
  return 'other'
}

function paintMesh(mesh: THREE.Mesh, color: THREE.Color, roughness: number) {
  const boosted = boostAaaColor(color)
  const { kitEmissiveScale, kitEmissiveIntensity, envMapIntensity } = AAA_CLASSIC.material
  applyAaaMaterialToMesh(mesh, {
    matte: true,
    color: boosted,
    roughness,
    metalness: 0,
    emissive: boosted.clone().multiplyScalar(kitEmissiveScale),
    emissiveIntensity: kitEmissiveIntensity,
    envMapIntensity,
  })
}

/** Preserva cores/texturas do GLB — só converte pro pipeline AAA */
export function applyFieldGraphicsAaa(scene: THREE.Object3D) {
  const physicalGrassMeshes: THREE.Mesh[] = []

  scene.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const mesh = child as THREE.Mesh
    if (!mesh.material) return

    mesh.castShadow = true
    mesh.receiveShadow = true
    applyAaaMaterialToMesh(mesh, { matte: true })

    const meshName = mesh.name.trim().toLowerCase()
    if (meshName === 'field_area' || meshName.includes('field_area')) {
      mesh.castShadow = false
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        if (
          material instanceof THREE.MeshStandardMaterial ||
          material instanceof THREE.MeshPhysicalMaterial
        ) {
          applyAaaGrassShader(material)
        }
      }
      physicalGrassMeshes.push(mesh)
    }
  })

  // Add shells only after traversal so newly-created meshes are not processed
  // again as regular stadium geometry.
  for (const fieldMesh of physicalGrassMeshes) {
    addAaaPhysicalGrass(fieldMesh)
  }
}

export function applyPlayerMaterialsAaa(
  model: THREE.Group,
  appearance: PlayerAppearance,
  highlighted = false,
  opts?: { preserveSkin?: boolean },
) {
  const { kit, skinColor } = appearance
  const shirt = boostAaaColor(new THREE.Color(kit.shirt))
  const shorts = boostAaaColor(new THREE.Color(kit.shorts))
  const socks = boostAaaColor(new THREE.Color(kit.socks))
  const skin = boostAaaColor(new THREE.Color(skinColor))
  const { fabricRoughness, skinRoughness, envMapIntensity } = AAA_CLASSIC.material
  const preserveSkin = opts?.preserveSkin === true

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const mesh = child as THREE.Mesh
    if (!(mesh.material instanceof THREE.Material)) return

    mesh.castShadow = true
    mesh.receiveShadow = true

    const part = classifyPlayerMesh(mesh.name)

    if (part === 'shirt') {
      paintMesh(mesh, shirt, fabricRoughness)
      if (highlighted) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial) {
            m.emissive.copy(shirt).multiplyScalar(0.08)
            m.emissiveIntensity = 0.5
          }
        }
      }
      return
    }

    if (part === 'shorts') {
      paintMesh(mesh, shorts, fabricRoughness)
      return
    }

    if (part === 'socks') {
      paintMesh(mesh, socks, fabricRoughness)
      return
    }

    if (part === 'body' || part === 'skin') {
      if (preserveSkin) {
        // Mantém albedo/textura do Blender — só garante sombra
        return
      }
      if (part === 'body') {
        paintMesh(mesh, skin, skinRoughness)
        return
      }
      applyAaaMaterialToMesh(mesh, {
        matte: true,
        roughness: skinRoughness,
        metalness: 0,
        emissiveIntensity: 0,
        envMapIntensity,
      })
      return
    }

    applyAaaMaterialToMesh(mesh, { matte: true, roughness: 0.9, metalness: 0 })
  })

  applyAaaMeshShadows(model, { cast: true, receive: false })
}

export function applyRefereeMaterialsAaa(model: THREE.Group) {
  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const mesh = child as THREE.Mesh
    if (!(mesh.material instanceof THREE.Material)) return

    const part = classifyPlayerMesh(mesh.name)

    if (part === 'shirt') {
      applyAaaMaterialToMesh(mesh, {
        ...(!hasAlbedoMap(mesh.material) ? { color: new THREE.Color(0x1a1a1a) } : {}),
        roughness: 0.75,
      })
      return
    }

    if (part === 'shorts') {
      applyAaaMaterialToMesh(mesh, {
        ...(!hasAlbedoMap(mesh.material) ? { color: new THREE.Color(0x111111) } : {}),
        roughness: 0.8,
      })
      return
    }

    applyAaaMaterialToMesh(mesh)
  })

  applyAaaMeshShadows(model, { cast: true, receive: false })
}

export function createBallMaterialAaa(texture?: THREE.Texture | null): THREE.MeshStandardMaterial {
  const mat = toAaaStandard(new THREE.MeshStandardMaterial(), {
    matte: true,
    ...(texture ? {} : { color: new THREE.Color(0xfafaf8) }),
    roughness: 0.62,
    metalness: 0,
  })

  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = AAA_CLASSIC.renderer.maxAnisotropy
    texture.needsUpdate = true
    mat.map = texture
    mat.color.set(0xffffff)
    mat.needsUpdate = true
  }

  return mat
}

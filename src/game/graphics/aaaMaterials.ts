import * as THREE from 'three'
import type { PlayerAppearance } from '../matchRuntime'
import { AAA_CLASSIC, boostAaaColor } from './aaaSettings'
import { applyAaaMaterialToMesh, applyAaaMeshShadows, toAaaStandard } from './aaaMaterial'

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

function classifyFieldMesh(name: string): 'grass' | 'line' | 'metal' | 'structure' {
  const n = name.toLowerCase()
  if (n.includes('field') || n === 'field_area') return 'grass'
  if (n.includes('line') || n.includes('mark') || n.includes('circle')) return 'line'
  if (n.includes('gol') || n.includes('goal') || n.includes('post') || n.includes('net')) {
    return 'metal'
  }
  return 'structure'
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

export function applyFieldGraphicsAaa(scene: THREE.Object3D) {
  scene.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const mesh = child as THREE.Mesh
    if (!(mesh.material instanceof THREE.Material)) return

    mesh.castShadow = true
    mesh.receiveShadow = true

    const kind = classifyFieldMesh(mesh.name)

    if (kind === 'grass') {
      applyAaaMaterialToMesh(mesh, {
        matte: true,
        color: boostAaaColor(new THREE.Color(0x48b845)),
        roughness: 0.9,
        metalness: 0,
        emissive: new THREE.Color(0x1a5c18),
        emissiveIntensity: 0.12,
      })
      return
    }

    if (kind === 'line') {
      applyAaaMaterialToMesh(mesh, {
        matte: true,
        color: new THREE.Color(0xf8fcf4),
        roughness: 0.88,
        metalness: 0,
      })
      return
    }

    if (kind === 'metal') {
      applyAaaMaterialToMesh(mesh, {
        ...(!hasAlbedoMap(mesh.material) ? { color: new THREE.Color(0xd8dce2) } : {}),
        roughness: 0.35,
        metalness: 0.85,
      })
      return
    }

    applyAaaMaterialToMesh(mesh, { roughness: 0.78, metalness: 0.05 })
  })
}

export function applyPlayerMaterialsAaa(
  model: THREE.Group,
  appearance: PlayerAppearance,
  highlighted = false,
) {
  const { kit, skinColor } = appearance
  const shirt = boostAaaColor(new THREE.Color(kit.shirt))
  const shorts = boostAaaColor(new THREE.Color(kit.shorts))
  const socks = boostAaaColor(new THREE.Color(kit.socks))
  const skin = boostAaaColor(new THREE.Color(skinColor))
  const { fabricRoughness, skinRoughness, envMapIntensity } = AAA_CLASSIC.material

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

    if (part === 'body') {
      paintMesh(mesh, skin, skinRoughness)
      return
    }

    if (part === 'skin') {
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

export function createBallMaterialAaa(): THREE.MeshStandardMaterial {
  return toAaaStandard(new THREE.MeshStandardMaterial(), {
    matte: true,
    color: new THREE.Color(0xfafaf8),
    roughness: 0.62,
    metalness: 0,
  })
}

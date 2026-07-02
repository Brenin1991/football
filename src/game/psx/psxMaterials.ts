import * as THREE from 'three'
import type { TeamId, PlayerRole } from '../types'
import { GK_COLORS, TEAM_COLORS } from '../constants'
import { applyMeshShadows, applyPsxMaterialToMesh, toPsxStandard } from './psxMaterial'
import { PSX_CLASSIC } from './psxSettings'

type PlayerPart = 'shirt' | 'shorts' | 'skin' | 'hair' | 'boots' | 'other'

function hasAlbedoMap(src: THREE.Material): boolean {
  return (
    (src instanceof THREE.MeshStandardMaterial || src instanceof THREE.MeshPhysicalMaterial) &&
    src.map != null
  )
}

function classifyPlayerMesh(name: string): PlayerPart {
  const n = name.toLowerCase()
  if (n.includes('shirt')) return 'shirt'
  if (n.includes('short') || n.includes('pant') || n.includes('trunk')) return 'shorts'
  if (n.includes('shoe') || n.includes('boot') || n.includes('sneaker')) return 'boots'
  if (n.includes('hair')) return 'hair'
  if (
    n.includes('body') ||
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

function upgradeMesh(
  mesh: THREE.Mesh,
  build: (src: THREE.Material) => THREE.MeshStandardMaterial,
) {
  const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const upgraded = sources.map((src) => build(src))
  mesh.material = upgraded.length === 1 ? upgraded[0] : upgraded
}

/** Gramado, linhas e traves com material PSX matte */
export function applyFieldGraphics(scene: THREE.Object3D) {
  const fieldTexture = PSX_CLASSIC.material.texture.field

  scene.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const mesh = child as THREE.Mesh
    if (!(mesh.material instanceof THREE.Material)) return

    mesh.castShadow = true
    mesh.receiveShadow = true

    const kind = classifyFieldMesh(mesh.name)

    if (kind === 'grass') {
      upgradeMesh(mesh, (src) =>
        toPsxStandard(src, {
          textureProfile: fieldTexture,
          ...(!hasAlbedoMap(src) ? { color: new THREE.Color(0x3d8f3a) } : {}),
        }),
      )
      return
    }

    if (kind === 'line') {
      upgradeMesh(mesh, (src) =>
        toPsxStandard(src, {
          textureProfile: fieldTexture,
          ...(!hasAlbedoMap(src) ? { color: new THREE.Color(0xf5f8f2) } : {}),
        }),
      )
      return
    }

    if (kind === 'metal') {
      upgradeMesh(mesh, (src) =>
        toPsxStandard(src, {
          textureProfile: fieldTexture,
          ...(!hasAlbedoMap(src) ? { color: new THREE.Color(0xcccccc) } : {}),
        }),
      )
      return
    }

    applyPsxMaterialToMesh(mesh, false, PSX_CLASSIC.material.vertexSnap, fieldTexture)
  })
}

export function applyPlayerMaterials(
  model: THREE.Group,
  team: TeamId,
  role: PlayerRole,
  highlighted = false,
) {
  const kitColor = new THREE.Color(role === 'gk' ? GK_COLORS[team] : TEAM_COLORS[team])
  const playerSnap = PSX_CLASSIC.material.playerVertexSnap
  const characterTexture = PSX_CLASSIC.material.texture.character

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const mesh = child as THREE.Mesh
    if (!(mesh.material instanceof THREE.Material)) return

    mesh.castShadow = true
    mesh.receiveShadow = true

    const part = classifyPlayerMesh(mesh.name)

    if (part === 'shirt') {
      upgradeMesh(mesh, (src) =>
        toPsxStandard(src, {
          vertexSnap: playerSnap,
          textureProfile: characterTexture,
          color: kitColor,
          emissive: kitColor.clone().multiplyScalar(highlighted ? 0.25 : 0.06),
          emissiveIntensity: highlighted ? 0.9 : 0.45,
        }),
      )
      return
    }

    if (part === 'shorts') {
      upgradeMesh(mesh, (src) =>
        toPsxStandard(src, {
          vertexSnap: playerSnap,
          textureProfile: characterTexture,
          color: hasAlbedoMap(src)
            ? kitColor.clone().multiplyScalar(0.85)
            : kitColor.clone().multiplyScalar(0.72),
        }),
      )
      return
    }

    if (part === 'skin') {
      upgradeMesh(mesh, (src) =>
        toPsxStandard(src, { vertexSnap: playerSnap, textureProfile: characterTexture }),
      )
      return
    }

    applyPsxMaterialToMesh(mesh, false, playerSnap, characterTexture)
  })

  applyMeshShadows(model, PSX_CLASSIC.shadow.players)
}

export function applyRefereeMaterials(model: THREE.Group) {
  const characterTexture = PSX_CLASSIC.material.texture.character

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const mesh = child as THREE.Mesh
    if (!(mesh.material instanceof THREE.Material)) return

    const part = classifyPlayerMesh(mesh.name)

    if (part === 'shirt') {
      upgradeMesh(mesh, (src) =>
        toPsxStandard(src, {
          textureProfile: characterTexture,
          ...(!hasAlbedoMap(src) ? { color: new THREE.Color(0x1a1a1a) } : {}),
        }),
      )
      return
    }

    if (part === 'shorts') {
      upgradeMesh(mesh, (src) =>
        toPsxStandard(src, {
          textureProfile: characterTexture,
          ...(!hasAlbedoMap(src) ? { color: new THREE.Color(0x111111) } : {}),
        }),
      )
      return
    }

    applyPsxMaterialToMesh(mesh, false, PSX_CLASSIC.material.vertexSnap, characterTexture)
  })

  applyMeshShadows(model, PSX_CLASSIC.shadow.players)
}

export function createBallMaterial(): THREE.MeshStandardMaterial {
  return toPsxStandard(new THREE.MeshStandardMaterial(), {
    vertexSnap: PSX_CLASSIC.material.playerVertexSnap,
    color: new THREE.Color(0xf8f8f6),
  })
}

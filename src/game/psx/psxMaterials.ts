import * as THREE from 'three'
import type { PlayerAppearance } from '../matchRuntime'
import { applyMeshShadows, applyPsxMaterialToMesh, toPsxStandard } from './psxMaterial'
import { PSX_CLASSIC } from './psxSettings'

type PlayerPart = 'shirt' | 'shorts' | 'socks' | 'body' | 'skin' | 'hair' | 'boots' | 'other'

function hasAlbedoMap(src: THREE.Material): boolean {
  return (
    (src instanceof THREE.MeshStandardMaterial || src instanceof THREE.MeshPhysicalMaterial) &&
    src.map != null
  )
}

/** Meshes do modelo Ch38 — prioridade sobre classificação genérica */
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

function upgradeMesh(
  mesh: THREE.Mesh,
  build: (src: THREE.Material) => THREE.MeshStandardMaterial,
) {
  const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const upgraded = sources.map((src) => build(src))
  mesh.material = upgraded.length === 1 ? upgraded[0] : upgraded
}

function paintMesh(
  mesh: THREE.Mesh,
  color: THREE.Color,
  highlighted: boolean,
  playerSnap: number,
  characterTexture: typeof PSX_CLASSIC.material.texture.character,
  emissiveScale = 0.06,
) {
  upgradeMesh(mesh, (src) =>
    toPsxStandard(src, {
      vertexSnap: playerSnap,
      textureProfile: characterTexture,
      color,
      emissive: color.clone().multiplyScalar(highlighted ? 0.25 : emissiveScale),
      emissiveIntensity: highlighted ? 0.9 : 0.45,
    }),
  )
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
  appearance: PlayerAppearance,
  highlighted = false,
  opts?: { preserveSkin?: boolean },
) {
  const { kit, skinColor } = appearance
  const shirt = new THREE.Color(kit.shirt)
  const shorts = new THREE.Color(kit.shorts)
  const socks = new THREE.Color(kit.socks)
  const skin = new THREE.Color(skinColor)
  const playerSnap = PSX_CLASSIC.material.playerVertexSnap
  const characterTexture = PSX_CLASSIC.material.texture.character
  const preserveSkin = opts?.preserveSkin === true

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const mesh = child as THREE.Mesh
    if (!(mesh.material instanceof THREE.Material)) return

    mesh.castShadow = true
    mesh.receiveShadow = true

    const part = classifyPlayerMesh(mesh.name)

    if (part === 'shirt') {
      paintMesh(mesh, shirt, highlighted, playerSnap, characterTexture)
      return
    }

    if (part === 'shorts') {
      paintMesh(mesh, shorts, false, playerSnap, characterTexture, 0)
      return
    }

    if (part === 'socks') {
      paintMesh(mesh, socks, false, playerSnap, characterTexture, 0)
      return
    }

    if (part === 'body' || part === 'skin') {
      if (preserveSkin) return
      if (part === 'body') {
        paintMesh(mesh, skin, false, playerSnap, characterTexture, 0.02)
        return
      }
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

/**
 * Cria o material da bola. Passe uma THREE.Texture (carregada no componente,
 * via useLoader/TextureLoader) pra usar como albedo — sem ela, cai na cor
 * lisa de sempre.
 *
 * Nota sobre UV: uma esfera padrão (THREE.SphereGeometry) usa UV
 * equirretangular, então qualquer textura de bola desenhada nesse formato
 * (a maioria dos assets prontos de "soccer ball texture") encaixa direto,
 * sem precisar de unwrap especial.
 */
export function createBallMaterial(texture?: THREE.Texture | null): THREE.MeshStandardMaterial {
  const material = toPsxStandard(new THREE.MeshStandardMaterial(), {
    vertexSnap: PSX_CLASSIC.material.playerVertexSnap,
    // Sem textura, mantém a cor lisa de sempre. Com textura, deixa o
    // toPsxStandard sem cor fixa — ela é aplicada como branco puro abaixo
    // pra não tingir o albedo da imagem.
    ...(texture ? {} : { color: new THREE.Color(0xf8f8f6) }),
  })

  if (texture) {
    // Espaço de cor correto pro albedo — sem isso a textura vem lavada/clara
    // demais com o tone mapping físico do renderer.
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    texture.needsUpdate = true

    material.map = texture
    material.color.set(0xffffff)
    material.needsUpdate = true
  }

  return material
}
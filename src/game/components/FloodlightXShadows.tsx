import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'
import {
  FLOODLIGHT_X_SHADOWS,
  getKeyLightWorldPosition,
} from '../graphics/floodlightXShadowSettings'
import { ballBodyRef, ballRef, playerRegistry } from '../systems/entityRegistry'
import { getPitchGroundY, PITCH_LIMITS } from '../systems/fieldData'
import {
  getPlayerShadowAnchor,
  getPlayerShadowParts,
  type PlayerShadowPartKind,
} from '../systems/playerSkeleton'
import { useGameStore } from '../store/gameStore'

const _matrix = new THREE.Matrix4()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _euler = new THREE.Euler()

const SHADOW_PARTS_PER_PLAYER = 3
const ACTIVE_FAKE_TOWERS = 3

type Tower = { x: number; z: number }

/** alphaMap = canal verde (branco = opaco). */
function makeShadowAlphaMap(compact: boolean): THREE.CanvasTexture {
  const w = compact ? 48 : 64
  const h = compact ? 64 : 128
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)

  const cy = compact ? h * 0.38 : h * 0.42
  const g = ctx.createRadialGradient(
    w * 0.5,
    cy * 0.65,
    compact ? 1 : 2,
    w * 0.5,
    cy,
    compact ? h * 0.38 : h * 0.52,
  )
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.4, '#cccccc')
  g.addColorStop(0.75, '#555555')
  g.addColorStop(1, '#000000')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(
    w * 0.5,
    cy,
    w * (compact ? 0.32 : 0.28),
    h * (compact ? 0.38 : 0.46),
    0,
    0,
    Math.PI * 2,
  )
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

function sunShadowDirXZ(): { x: number; z: number } {
  const sun = getKeyLightWorldPosition()
  const len = Math.hypot(sun.x, sun.z) || 1
  return { x: -sun.x / len, z: -sun.z / len }
}

function buildTowers(
  centerX: number,
  centerZ: number,
  halfX: number,
  halfZ: number,
  radiusMul: number,
): Tower[] {
  const rx = Math.max(halfX, 1) * radiusMul
  const rz = Math.max(halfZ, 1) * radiusMul
  return [
    { x: centerX + rx, z: centerZ + rz },
    { x: centerX + rx, z: centerZ - rz },
    { x: centerX - rx, z: centerZ + rz },
    { x: centerX - rx, z: centerZ - rz },
  ]
}

function sunAlignedTowerIndex(towers: Tower[], cx: number, cz: number): number {
  const sun = sunShadowDirXZ()
  let best = 0
  let bestDot = -Infinity
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i]
    let dx = cx - t.x
    let dz = cz - t.z
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const dot = dx * sun.x + dz * sun.z
    if (dot > bestDot) {
      bestDot = dot
      best = i
    }
  }
  return best
}

function writeArmInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  px: number,
  pz: number,
  dirX: number,
  dirZ: number,
  length: number,
  width: number,
  y: number,
) {
  _pos.set(px + dirX * length * 0.45, y, pz + dirZ * length * 0.45)
  const yaw = Math.atan2(dirX, dirZ)
  _euler.set(-Math.PI / 2, yaw, 0, 'YXZ')
  _quat.setFromEuler(_euler)
  _scale.set(width, length, 1)
  _matrix.compose(_pos, _quat, _scale)
  mesh.setMatrixAt(index, _matrix)
}

function fallbackTowers(radiusMul: number): Tower[] {
  const halfX = (PITCH_LIMITS.maxX - PITCH_LIMITS.minX) * 0.5
  const halfZ = (PITCH_LIMITS.maxZ - PITCH_LIMITS.minZ) * 0.5
  return buildTowers(0, 0, halfX, halfZ, radiusMul)
}

function readBallXZ(): { x: number; z: number; y: number } {
  const body = ballBodyRef.current as RapierRigidBody | null
  if (body) {
    const t = body.translation()
    return { x: t.x, y: t.y, z: t.z }
  }
  const b = ballRef.current
  return { x: b.x, y: b.y, z: b.z }
}

function partSize(
  kind: PlayerShadowPartKind,
  micro: (typeof FLOODLIGHT_X_SHADOWS)['microShadows'],
  fallbackLength: number,
  fallbackWidth: number,
): { length: number; width: number } {
  if (kind === 'foot') {
    return { length: micro.footLength, width: micro.footWidth }
  }
  if (kind === 'torso') {
    return { length: micro.torsoLength, width: micro.torsoWidth }
  }
  return { length: fallbackLength, width: fallbackWidth }
}

/**
 * Híbrido PES 6: shadow map real + 3 torres fake.
 * Com microShadows: cada braço repete pé esq/dir + tronco (silhueta que mexe).
 */
export function FloodlightXShadows() {
  const cfg = FLOODLIGHT_X_SHADOWS
  const micro = cfg.microShadows
  const useMicro = micro.enabled
  const partsPerAnchor = useMicro ? SHADOW_PARTS_PER_PLAYER : 1
  const maxInstances = cfg.maxAnchors * ACTIVE_FAKE_TOWERS * partsPerAnchor

  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const { geometry, material, alphaMap } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1)
    const map = makeShadowAlphaMap(useMicro)
    const mat = new THREE.MeshBasicMaterial({
      color: cfg.color,
      alphaMap: map,
      transparent: true,
      opacity: cfg.opacity,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
    return { geometry: geo, material: mat, alphaMap: map }
  }, [cfg.color, cfg.opacity, useMicro])

  useLayoutEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
      alphaMap.dispose()
    }
  }, [geometry, material, alphaMap])

  const towersRef = useRef<Tower[]>(fallbackTowers(cfg.towerRadiusMul))
  const skipTowerRef = useRef(0)

  useLayoutEffect(() => {
    const towers = fieldBounds
      ? buildTowers(
          fieldBounds.center.x,
          fieldBounds.center.z,
          (fieldBounds.maxX - fieldBounds.minX) * 0.5,
          (fieldBounds.maxZ - fieldBounds.minZ) * 0.5,
          cfg.towerRadiusMul,
        )
      : fallbackTowers(cfg.towerRadiusMul)
    towersRef.current = towers
    const cx = fieldBounds?.center.x ?? 0
    const cz = fieldBounds?.center.z ?? 0
    skipTowerRef.current = sunAlignedTowerIndex(towers, cx, cz)
  }, [fieldBounds, cfg.towerRadiusMul])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh || !cfg.enabled) {
      if (mesh) {
        mesh.count = 0
        mesh.instanceMatrix.needsUpdate = true
      }
      return
    }

    const towers = towersRef.current
    if (towers.length < 4) {
      mesh.count = 0
      mesh.instanceMatrix.needsUpdate = true
      return
    }

    const y = getPitchGroundY() + cfg.yBias
    const skip = skipTowerRef.current
    let written = 0
    let anchors = 0

    const placeAt = (
      px: number,
      pz: number,
      length: number,
      width: number,
      lenMul = 1,
      widthMul = 1,
    ) => {
      for (let i = 0; i < towers.length; i++) {
        if (i === skip) continue
        if (written >= maxInstances) return

        const t = towers[i]
        let dx = px - t.x
        let dz = pz - t.z
        const len = Math.hypot(dx, dz)
        if (len < 0.001) continue
        dx /= len
        dz /= len

        writeArmInstance(
          mesh,
          written,
          px,
          pz,
          dx,
          dz,
          length * lenMul,
          width * widthMul,
          y,
        )
        written++
      }
    }

    const placeAnchor = (px: number, pz: number, lenMul: number, widthMul: number) => {
      if (anchors >= cfg.maxAnchors) return
      placeAt(px, pz, cfg.length, cfg.width, lenMul, widthMul)
      anchors++
    }

    const placeLimbAnchor = (playerId: string) => {
      if (anchors >= cfg.maxAnchors) return

      const parts = getPlayerShadowParts(playerId)
      if (parts.length === 0) {
        const bone = getPlayerShadowAnchor(playerId)
        if (bone) placeAnchor(bone.x, bone.z, 1, 1)
        else {
          const p = playerRegistry.get(playerId)
          if (p) placeAnchor(p.position.x, p.position.z, 1, 1)
        }
        return
      }

      for (const part of parts) {
        const size = partSize(part.kind, micro, cfg.length, cfg.width)
        placeAt(part.x, part.z, size.length, size.width)
        if (written >= maxInstances) break
      }
      anchors++
    }

    for (const p of playerRegistry.values()) {
      if (useMicro) placeLimbAnchor(p.id)
      else {
        const bone = getPlayerShadowAnchor(p.id)
        if (bone) placeAnchor(bone.x, bone.z, 1, 1)
        else placeAnchor(p.position.x, p.position.z, 1, 1)
      }
    }

    if (cfg.includeBall) {
      const b = readBallXZ()
      if (b.y < getPitchGroundY() + 0.55) {
        placeAnchor(b.x, b.z, cfg.ballLengthMul, cfg.ballWidthMul)
      }
    }

    mesh.count = written
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, 50)

  if (!cfg.enabled) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, maxInstances]}
      frustumCulled={false}
      renderOrder={2}
      castShadow={false}
      receiveShadow={false}
    />
  )
}

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type * as THREE from 'three'
import type { PowerBarMode } from '../systems/shotPower'
import { useGameStore } from '../store/gameStore'
import { getPitchGroundY } from '../systems/fieldData'

const AIM_COLORS: Record<NonNullable<PowerBarMode>, string> = {
  shot: '#fb7185',
  pass: '#38bdf8',
  through: '#fbbf24',
  cross: '#bef264',
}

const MAX_DASHES = 8

function buildAimDashes(length: number) {
  const dashes: { z: number; len: number }[] = []
  const dashLen = 0.22
  const gap = 0.16
  const step = dashLen + gap
  let z = 0.28

  while (z < length - 0.12 && dashes.length < MAX_DASHES) {
    dashes.push({ z, len: dashLen })
    z += step
  }

  return dashes
}

export function StrikeAimIndicator() {
  const groupRef = useRef<THREE.Group>(null)
  const dashMats = useRef<THREE.MeshBasicMaterial[]>([])
  const tipMat = useRef<THREE.MeshBasicMaterial>(null)
  const dashMeshRefs = useMemo(() => Array.from({ length: MAX_DASHES }, () => ({ current: null as THREE.Mesh | null })), [])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const aim = useGameStore.getState().strikeAim
    if (!aim?.charging || !aim.mode) {
      group.visible = false
      return
    }

    const y = getPitchGroundY() + 0.035
    const length = 0.9 + aim.power * 0.75
    const dashes = buildAimDashes(length)
    const color = AIM_COLORS[aim.mode]
    const dashWidth = aim.mode === 'cross' ? 0.06 : 0.05

    group.visible = true
    group.position.set(aim.originX, y, aim.originZ)
    group.rotation.set(0, aim.angle, 0)

    dashMeshRefs.forEach((ref, i) => {
      const mesh = ref.current
      if (!mesh) return
      const dash = dashes[i]
      mesh.visible = !!dash
      if (!dash) return
      mesh.position.set(0, 0, dash.z + dash.len * 0.5)
      mesh.scale.set(dashWidth / 0.05, 1, dash.len / 0.22)
    })

    const tip = group.children[MAX_DASHES] as THREE.Mesh | undefined
    if (tip) {
      tip.position.set(0, 0.002, length)
      tip.visible = true
    }

    dashMats.current.forEach((mat) => {
      if (!mat) return
      mat.color.set(color)
      mat.opacity = 0.62
    })
    if (tipMat.current) {
      tipMat.current.color.set(color)
      tipMat.current.opacity = 0.7
    }
  })

  return (
    <group ref={groupRef} visible={false}>
      {dashMeshRefs.map((ref, i) => (
        <mesh
          key={i}
          ref={ref}
          visible={false}
          renderOrder={1500}
          frustumCulled={false}
        >
          <boxGeometry args={[0.05, 0.012, 0.22]} />
          <meshBasicMaterial
            ref={(mat) => {
              if (mat) dashMats.current[i] = mat
            }}
            color="#38bdf8"
            transparent
            opacity={0.62}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh visible={false} rotation={[-Math.PI / 2, 0, Math.PI / 4]} renderOrder={1501} frustumCulled={false}>
        <ringGeometry args={[0.07, 0.11, 4]} />
        <meshBasicMaterial
          ref={tipMat}
          color="#38bdf8"
          transparent
          opacity={0.7}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

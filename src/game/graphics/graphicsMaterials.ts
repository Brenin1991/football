import * as THREE from 'three'
import type { PlayerAppearance } from '../matchRuntime'
import { getGraphicsMode } from '../../store/graphicsStore'
import {
  applyFieldGraphics as applyFieldGraphicsPsx,
  applyPlayerMaterials as applyPlayerMaterialsPsx,
  applyRefereeMaterials as applyRefereeMaterialsPsx,
  createBallMaterial as createBallMaterialPsx,
} from '../psx/psxMaterials'
import {
  applyFieldGraphicsAaa,
  applyPlayerMaterialsAaa,
  applyRefereeMaterialsAaa,
  createBallMaterialAaa,
} from './aaaMaterials'

export function applyFieldGraphics(scene: THREE.Object3D) {
  if (getGraphicsMode() === 'aaa') applyFieldGraphicsAaa(scene)
  else applyFieldGraphicsPsx(scene)
}

export type PlayerMaterialOptions = {
  /** GLB personalizado: pele/corpo já vêm do Blender — não sobrescrever */
  preserveSkin?: boolean
}

export function applyPlayerMaterials(
  model: THREE.Group,
  appearance: PlayerAppearance,
  highlighted = false,
  opts?: PlayerMaterialOptions,
) {
  if (getGraphicsMode() === 'aaa') applyPlayerMaterialsAaa(model, appearance, highlighted, opts)
  else applyPlayerMaterialsPsx(model, appearance, highlighted, opts)
}

export function applyRefereeMaterials(model: THREE.Group) {
  if (getGraphicsMode() === 'aaa') applyRefereeMaterialsAaa(model)
  else applyRefereeMaterialsPsx(model)
}

export function createBallMaterial(texture?: THREE.Texture | null): THREE.MeshStandardMaterial {
  if (getGraphicsMode() === 'aaa') return createBallMaterialAaa(texture)
  return createBallMaterialPsx(texture)
}
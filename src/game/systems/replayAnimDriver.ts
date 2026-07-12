import * as THREE from 'three'
import type { AnimationClip } from 'three'

/** Mixer isolado do replay — não toca no mixer/controller da partida. */
export class ReplayAnimDriver {
  private readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private activeAnim: string | null = null

  constructor(root: THREE.Object3D, animToClip: Map<string, AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root)
    for (const [animName, clip] of animToClip) {
      this.actions.set(animName, this.mixer.clipAction(clip, root))
    }
  }

  sync(anim: string, time: number) {
    const action = this.actions.get(anim)
    if (!action) {
      const idleName = this.actions.has('gk_idle') ? 'gk_idle' : 'player_idle'
      const idle = this.actions.get(idleName)
      if (idle) this.applyPose(idleName, idle, time)
      return
    }
    this.applyPose(anim, action, time)
  }

  private applyPose(anim: string, action: THREE.AnimationAction, time: number) {
    if (this.activeAnim !== anim) {
      for (const [name, other] of this.actions) {
        if (name === anim) continue
        other.stop()
        other.setEffectiveWeight(0)
      }
      this.activeAnim = anim
    }

    action.enabled = true
    action.play()
    action.setEffectiveWeight(1)
    action.setEffectiveTimeScale(0)

    const duration = action.getClip().duration
    action.time = duration > 0.01 ? Math.min(Math.max(0, time), duration) : Math.max(0, time)
  }

  tick() {
    this.mixer.update(0)
  }

  dispose() {
    this.mixer.stopAllAction()
    this.activeAnim = null
    this.actions.clear()
  }
}

export function createReplayAnimDriver(
  root: THREE.Object3D,
  animToClip: Map<string, AnimationClip>,
) {
  return new ReplayAnimDriver(root, animToClip)
}

import { PLAYERS_PER_TEAM } from '../constants'
import type { FieldBounds } from '../types'
import { FIELD_SCALE } from './fieldData'

export const ANTHEM_LINE_X_OFFSET = 1.6 * FIELD_SCALE
export const ANTHEM_PLAYER_SPACING = 0.52 * FIELD_SCALE
export const ANTHEM_FORMATION_MARCH = 3.4 * FIELD_SCALE

/** Layout da linha de apresentação (hino) */
export function getAnthemLineLayout(bounds: FieldBounds) {
  const lineX = bounds.center.x - ANTHEM_LINE_X_OFFSET
  const total = PLAYERS_PER_TEAM * 2
  const lineLength = (total - 1) * ANTHEM_PLAYER_SPACING
  const startZ = bounds.center.z - lineLength * 0.5
  const endZ = startZ + lineLength
  return { lineX, startZ, endZ, lineLength }
}

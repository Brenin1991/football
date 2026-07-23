import { useCallback, useEffect, useMemo, useState } from 'react'
import { EntityImage } from '../../components/EntityImage'
import { MenuPadHints } from '../../menu/components/MenuPadHints'
import { MenuShell } from '../../menu/components/MenuShell'
import { TeamManagementScreen } from '../../menu/TeamManagementScreen'
import { useMenuPad } from '../../menu/hooks/useMenuPad'
import { menuSfx } from '../../menu/menuSfx'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import {
  getMatchStadium,
  getMatchTypeLabel,
  getTeamDbId,
  getTeamName,
} from '../matchRuntime'
import {
  BROADCAST_CAMERA_PRESETS,
  type BroadcastCameraPresetId,
} from '../systems/broadcastCamera'
import { formatMatchTime, useGameStore } from '../store/gameStore'

type RootItem = 'resume' | 'replay' | 'management' | 'camera' | 'facts' | 'quit'
type Panel = 'root' | 'management' | 'camera'

const ROOT_ITEMS: Array<{ id: RootItem; label: string; enabled: boolean; hint: string }> = [
  { id: 'resume', label: 'Continuar', enabled: true, hint: 'Volta para a partida.' },
  { id: 'replay', label: 'Replay Instantâneo', enabled: false, hint: 'Em breve.' },
  { id: 'management', label: 'Gestão da Equipe', enabled: true, hint: 'Formação, táticas e elenco.' },
  { id: 'camera', label: 'Câmera', enabled: true, hint: 'Presets de transmissão.' },
  { id: 'facts', label: 'Dados da Partida', enabled: false, hint: 'Em breve.' },
  { id: 'quit', label: 'Sair da Partida', enabled: true, hint: 'Volta ao menu principal.' },
]

type PauseMenuProps = {
  onQuit: () => void
}

function kitPair(
  kits: Array<{ kitNumber: number; shirtColor: string; shortsColor: string }> | undefined,
  kitNumber: 1 | 2,
  fallbackShirt: string,
  fallbackShorts: string,
) {
  const kit = kits?.find((entry) => entry.kitNumber === kitNumber)
  return {
    shirt: kit?.shirtColor ?? fallbackShirt,
    shorts: kit?.shortsColor ?? fallbackShorts,
  }
}

export function PauseMenu({ onQuit }: PauseMenuProps) {
  const open = useGameStore((s) => s.pauseMenuOpen)
  const closePauseMenu = useGameStore((s) => s.closePauseMenu)
  const scoreHome = useGameStore((s) => s.scoreHome)
  const scoreAway = useGameStore((s) => s.scoreAway)
  const matchTime = useGameStore((s) => s.matchTime)
  const half = useGameStore((s) => s.half)
  const cameraPreset = useGameStore((s) => s.broadcastCameraPreset)
  const setBroadcastCameraPreset = useGameStore((s) => s.setBroadcastCameraPreset)
  const session = useMatchSetupStore((s) => s.session)
  const [panel, setPanel] = useState<Panel>('root')
  const [rootFocus, setRootFocus] = useState(0)
  const [cameraFocus, setCameraFocus] = useState(0)

  useEffect(() => {
    if (!open) {
      setPanel('root')
      setRootFocus(0)
      setCameraFocus(0)
    }
  }, [open])

  useEffect(() => {
    if (panel !== 'camera') return
    const idx = BROADCAST_CAMERA_PRESETS.findIndex((p) => p.id === cameraPreset)
    if (idx >= 0) setCameraFocus(idx)
  }, [panel, cameraPreset])

  const activateRoot = useCallback(
    (itemId: RootItem) => {
      const item = ROOT_ITEMS.find((entry) => entry.id === itemId)
      if (!item?.enabled) return
      if (item.id === 'resume') {
        closePauseMenu()
        return
      }
      if (item.id === 'management') {
        setPanel('management')
        menuSfx.playSelect()
        return
      }
      if (item.id === 'camera') {
        setPanel('camera')
        menuSfx.playSelect()
        return
      }
      if (item.id === 'quit') {
        closePauseMenu()
        onQuit()
      }
    },
    [closePauseMenu, onQuit],
  )

  const selectCameraPreset = useCallback(
    (id: BroadcastCameraPresetId) => {
      setBroadcastCameraPreset(id)
      menuSfx.playSelect()
    },
    [setBroadcastCameraPreset],
  )

  useMenuPad({
    enabled: open && panel === 'root',
    onUp: () => {
      setRootFocus((i) => {
        let next = i
        for (let step = 0; step < ROOT_ITEMS.length; step += 1) {
          next = (next - 1 + ROOT_ITEMS.length) % ROOT_ITEMS.length
          if (ROOT_ITEMS[next].enabled) return next
        }
        return i
      })
    },
    onDown: () => {
      setRootFocus((i) => {
        let next = i
        for (let step = 0; step < ROOT_ITEMS.length; step += 1) {
          next = (next + 1) % ROOT_ITEMS.length
          if (ROOT_ITEMS[next].enabled) return next
        }
        return i
      })
    },
    onConfirm: () => activateRoot(ROOT_ITEMS[rootFocus]?.id ?? 'resume'),
    onBack: closePauseMenu,
  })

  useMenuPad({
    enabled: open && panel === 'camera',
    onUp: () =>
      setCameraFocus(
        (i) => (i - 1 + BROADCAST_CAMERA_PRESETS.length) % BROADCAST_CAMERA_PRESETS.length,
      ),
    onDown: () =>
      setCameraFocus((i) => (i + 1) % BROADCAST_CAMERA_PRESETS.length),
    onConfirm: () => {
      const preset = BROADCAST_CAMERA_PRESETS[cameraFocus]
      if (preset) selectCameraPreset(preset.id)
    },
    onBack: () => setPanel('root'),
  })

  const backgroundColors = useMemo(() => {
    if (!session) return undefined
    const home = kitPair(session.home.kits, session.home.matchKit, '#343b46', '#111820')
    const away = kitPair(session.away.kits, session.away.matchKit, '#343b46', '#111820')
    return {
      home: home.shirt,
      homeSecondary: home.shorts,
      away: away.shirt,
      awaySecondary: away.shorts,
    }
  }, [session])

  if (!open) return null

  if (panel === 'management') {
    return (
      <TeamManagementScreen
        mode="pause"
        onClose={() => setPanel('root')}
      />
    )
  }

  const homeName = getTeamName('home')
  const awayName = getTeamName('away')
  const homeId = getTeamDbId('home')
  const awayId = getTeamDbId('away')
  const focused = ROOT_ITEMS[rootFocus] ?? ROOT_ITEMS[0]
  const focusedCamera = BROADCAST_CAMERA_PRESETS[cameraFocus] ?? BROADCAST_CAMERA_PRESETS[0]
  const activeCamera = BROADCAST_CAMERA_PRESETS.find((p) => p.id === cameraPreset)
  const subtitle = `${getMatchStadium()} · ${getMatchTypeLabel()}`

  if (panel === 'camera') {
    return (
      <MenuShell
        key="camera"
        variant="wide"
        title="Câmera"
        subtitle="Presets de transmissão"
        backgroundColors={backgroundColors}
        showStadium={false}
        animateEntrance
        entranceKey="camera"
        padEnabled={false}
        onBack={() => setPanel('root')}
        backLabel="Voltar"
        confirmLabel="Selecionar"
        footer={<MenuPadHints confirm="Selecionar" back="Voltar" />}
      >
        <div className="fifa-pause">
          <div className="fifa-pause__nav">
            <nav className="fifa-main__nav" role="menu" aria-label="Presets de câmera">
              {BROADCAST_CAMERA_PRESETS.map((preset, index) => {
                const focusedItem = index === cameraFocus
                const selected = preset.id === cameraPreset
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`fifa-trap${focusedItem ? ' fifa-trap--active' : ''}`}
                    onMouseEnter={() => setCameraFocus(index)}
                    onClick={() => {
                      setCameraFocus(index)
                      selectCameraPreset(preset.id)
                    }}
                  >
                    <span className="fifa-pause__cam-label">
                      {preset.label}
                      {selected ? <em>Ativa</em> : null}
                    </span>
                  </button>
                )
              })}
            </nav>
            <p className="fifa-main__hint">{focusedCamera.hint}</p>
          </div>

          <section className="fifa-pause__panel" aria-label="Detalhes do preset">
            <header className="fifa-pause__panel-head">
              <span>Preset</span>
              <strong>{focusedCamera.label}</strong>
            </header>
            <div className="fifa-pause__cam-detail">
              <p>{focusedCamera.hint}</p>
              <dl className="fifa-pause__facts">
                <div>
                  <dt>Ativa agora</dt>
                  <dd>{activeCamera?.label ?? 'Wide'}</dd>
                </div>
                <div>
                  <dt>FOV</dt>
                  <dd>
                    {focusedCamera.fovWide}° → {focusedCamera.fovTight}°
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      </MenuShell>
    )
  }

  return (
    <MenuShell
      key="root"
      variant="wide"
      title="Pausa"
      subtitle={subtitle}
      backgroundColors={backgroundColors}
      showStadium={false}
      animateEntrance
      entranceKey="root"
      padEnabled={false}
      onBack={closePauseMenu}
      backLabel="Continuar"
      confirmLabel="Selecionar"
      footer={<MenuPadHints confirm="Selecionar" back="Continuar" />}
    >
      <div className="fifa-pause">
        <div className="fifa-pause__nav">
          <nav className="fifa-main__nav" role="menu" aria-label="Opções de pause">
            {ROOT_ITEMS.map((item, index) => {
              const active = index === rootFocus
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={!item.enabled}
                  className={`fifa-trap${active ? ' fifa-trap--active' : ''}${!item.enabled ? ' fifa-pause__disabled' : ''}`}
                  onMouseEnter={() => item.enabled && setRootFocus(index)}
                  onClick={() => {
                    if (!item.enabled) return
                    setRootFocus(index)
                    activateRoot(item.id)
                  }}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>
          <p className="fifa-main__hint">{focused.hint}</p>
        </div>

        <section className="fifa-pause__panel" aria-label="Placar da partida">
          <header className="fifa-pause__panel-head">
            <span>Partida</span>
            <strong>{half === 1 ? '1º Tempo' : '2º Tempo'}</strong>
          </header>

          <div className="fifa-pause__scoreboard">
            <div className="fifa-pause__club">
              <EntityImage
                entityType="team"
                entityId={homeId}
                alt={homeName}
                className="fifa-pause__crest"
                fallback={null}
              />
              <span>{homeName}</span>
            </div>

            <div className="fifa-pause__score" aria-label={`${scoreHome} a ${scoreAway}`}>
              <span>{scoreHome}</span>
              <span className="fifa-pause__score-sep">-</span>
              <span>{scoreAway}</span>
            </div>

            <div className="fifa-pause__club">
              <EntityImage
                entityType="team"
                entityId={awayId}
                alt={awayName}
                className="fifa-pause__crest"
                fallback={null}
              />
              <span>{awayName}</span>
            </div>
          </div>

          <dl className="fifa-pause__facts">
            <div>
              <dt>Tempo</dt>
              <dd>{formatMatchTime(matchTime)}</dd>
            </div>
            <div>
              <dt>Câmera</dt>
              <dd>{activeCamera?.label ?? 'Wide'}</dd>
            </div>
          </dl>
        </section>
      </div>
    </MenuShell>
  )
}

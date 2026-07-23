import { useCallback, useEffect, useMemo, useState } from 'react'
import { listRoster } from '../../db/queries'
import { getDatabase } from '../../db/database'
import { useAppStore } from '../../store/appStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import { withMenuNavigate, withMenuSelect } from '../menuActions'
import { MenuPadHints } from '../components/MenuPadHints'
import { MenuShell } from '../components/MenuShell'
import { useMenuPad } from '../hooks/useMenuPad'
import { useMatchSetupData } from './useMatchSetupData'

type FocusZone = 'list' | 'continue'

const PAGE_SIZE = 8

export function MatchPlayerScreen() {
  const dbVersion = useAppStore((s) => s.dbVersion)
  const setView = useAppStore((s) => s.setView)
  const draft = useMatchSetupStore((s) => s.draft)
  const patchDraft = useMatchSetupStore((s) => s.patchDraft)
  const setSetupStep = useMatchSetupStore((s) => s.setSetupStep)
  const backSetupStep = useMatchSetupStore((s) => s.backSetupStep)
  const { teams } = useMatchSetupData()

  const playerSide = draft?.playerSide ?? 'home'
  const teamId =
    playerSide === 'home' ? (draft?.homeTeamId ?? '') : (draft?.awayTeamId ?? '')
  const proSlotIndex = draft?.proSlotIndex ?? 9
  const team = teams.find((t) => t.id === teamId) ?? null

  const roster = useMemo(() => {
    void dbVersion
    if (!teamId) return []
    return listRoster(getDatabase(), teamId)
      .filter((slot) => slot.slotIndex >= 1 && slot.slotIndex <= 10)
      .sort((a, b) => a.slotIndex - b.slotIndex)
  }, [dbVersion, teamId])

  const [focus, setFocus] = useState<FocusZone>('list')
  const [page, setPage] = useState(0)

  const pageCount = Math.max(1, Math.ceil(roster.length / PAGE_SIZE))
  const selectedIdx = Math.max(
    0,
    roster.findIndex((slot) => slot.slotIndex === proSlotIndex),
  )

  useEffect(() => {
    const nextPage = Math.floor(selectedIdx / PAGE_SIZE)
    setPage(Math.min(pageCount - 1, Math.max(0, nextPage)))
  }, [pageCount, selectedIdx])

  const pageSlots = roster.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  const confirm = useCallback(() => {
    if (roster.length === 0) return
    const slot = roster[selectedIdx] ?? roster[0]
    patchDraft({ proSlotIndex: slot.slotIndex })
    setSetupStep('loading')
  }, [patchDraft, roster, selectedIdx, setSetupStep])

  const goBack = useCallback(() => {
    if (backSetupStep() === 'menu') setView('menu')
  }, [backSetupStep, setView])

  const selectSlot = useCallback(
    (slotIndex: number) => {
      patchDraft({ proSlotIndex: slotIndex })
      setFocus('list')
    },
    [patchDraft],
  )

  const cycleSlot = useCallback(
    (direction: number) => {
      if (roster.length === 0) return
      const next = (selectedIdx + direction + roster.length) % roster.length
      patchDraft({ proSlotIndex: roster[next].slotIndex })
      setFocus('list')
    },
    [patchDraft, roster, selectedIdx],
  )

  const changePage = useCallback(
    (direction: -1 | 1) => {
      if (roster.length === 0) return
      const nextPage = (page + direction + pageCount) % pageCount
      const slot = roster[nextPage * PAGE_SIZE]
      if (slot) patchDraft({ proSlotIndex: slot.slotIndex })
      setPage(nextPage)
      setFocus('list')
    },
    [page, pageCount, patchDraft, roster],
  )

  useMenuPad({
    onUp: () => {
      if (focus === 'continue') setFocus('list')
      else cycleSlot(-2)
    },
    onDown: () => {
      if (focus === 'list') {
        const nextIdx = selectedIdx + 2
        if (nextIdx >= roster.length) setFocus('continue')
        else cycleSlot(2)
      }
    },
    onLeft: () => {
      if (focus === 'list') {
        if (selectedIdx % 2 === 0 && pageCount > 1) changePage(-1)
        else cycleSlot(-1)
      }
    },
    onRight: () => {
      if (focus === 'list') {
        if (selectedIdx % 2 === 1 && pageCount > 1) changePage(1)
        else cycleSlot(1)
      }
    },
    onConfirm: confirm,
    onBack: goBack,
  })

  return (
    <MenuShell
      variant="wide"
      title="Seu jogador"
      subtitle={`Pro · ${team?.shortName ?? team?.name ?? 'seu time'}`}
      padEnabled={false}
      onBack={goBack}
      footer={
        <>
          <MenuPadHints confirm="Jogar" back="Pre-Match" />
          <button
            type="button"
            className={`fifa-cta${focus === 'continue' ? ' fifa-cta--focused' : ''}`}
            onClick={withMenuSelect(confirm)}
          >
            Entrar em campo
          </button>
        </>
      }
    >
      <div className="fifa-players">
        <p className="fifa-players__hint">
          Modo Pro · 3ª pessoa · o resto do time é IA
        </p>
        <div
          className="fifa-players__grid"
          role="listbox"
          aria-label="Jogadores"
        >
          {pageSlots.map((slot) => {
            const active = slot.slotIndex === proSlotIndex
            return (
              <button
                key={slot.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`fifa-players__row${active ? ' fifa-players__row--active' : ''}${focus === 'list' && active ? ' fifa-players__row--focused' : ''}`}
                onClick={withMenuNavigate(() => selectSlot(slot.slotIndex))}
              >
                <span className="fifa-players__pos">{slot.positionLabel}</span>
                <span className="fifa-players__name">{slot.name}</span>
                <span className="fifa-players__num">#{slot.slotIndex}</span>
              </button>
            )
          })}
        </div>
        {pageCount > 1 ? (
          <div className="fifa-players__pager">
            <button type="button" className="fifa-cta" style={{ padding: '6px 14px', fontSize: 13 }} onClick={withMenuNavigate(() => changePage(-1))}>
              ‹
            </button>
            <span>
              {page + 1} / {pageCount}
            </span>
            <button type="button" className="fifa-cta" style={{ padding: '6px 14px', fontSize: 13 }} onClick={withMenuNavigate(() => changePage(1))}>
              ›
            </button>
          </div>
        ) : null}
      </div>
    </MenuShell>
  )
}

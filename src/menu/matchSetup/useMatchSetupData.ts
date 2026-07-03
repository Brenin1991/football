import { useMemo } from 'react'
import type { League, Team } from '../../db/types'
import { getActiveEditionId, listEditions, listLeagues, listTeams } from '../../db/queries'
import { getDatabase } from '../../db/database'
import { useAppStore } from '../../store/appStore'

export function useMatchSetupData() {
  const dbVersion = useAppStore((s) => s.dbVersion)

  return useMemo(() => {
    void dbVersion
    const db = getDatabase()
    const editionId = getActiveEditionId(db)
    const editions = listEditions(db)
    const active = editions.find((edition) => edition.id === editionId) ?? editions[0]
    if (!active) {
      return { editionId: null, editionName: 'Sem edição', leagues: [] as League[], teams: [] as Team[] }
    }
    return {
      editionId: active.id,
      editionName: active.name,
      leagues: listLeagues(db, active.id),
      teams: listTeams(db, active.id),
    }
  }, [dbVersion])
}

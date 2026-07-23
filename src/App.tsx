import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { initDatabase } from './db/database'
import { Game } from './game/Game'
import { EditorScreen } from './menu/EditorScreen'
import { MainMenu } from './menu/MainMenu'
import { MatchSetupScreen } from './menu/MatchSetupScreen'
import { TeamManagementScreen } from './menu/TeamManagementScreen'
import { ViewTransition } from './menu/components/ViewTransition'
import { useAppStore } from './store/appStore'
import { useMatchSetupStore } from './store/matchSetupStore'
import { useGameStore } from './game/store/gameStore'
import './index.css'
import './menu/fifa/fifaMenu.css'
import './menu/fifa/fifaDesignSystem.css'
import './game/hudDesignSystem.css'

function DbBootstrap({ children }: { children: ReactNode }) {
  const setDbReady = useAppStore((s) => s.setDbReady)
  const dbReady = useAppStore((s) => s.dbReady)

  useEffect(() => {
    let cancelled = false
    initDatabase()
      .then(() => {
        if (!cancelled) setDbReady(true)
      })
      .catch((err) => {
        console.error('Falha ao iniciar SQLite', err)
      })
    return () => {
      cancelled = true
    }
  }, [setDbReady])

  if (!dbReady) {
    return (
      <div className="menu-screen menu-screen--loading">
        <div className="menu-screen__bg" aria-hidden />
        <div className="menu-loading pes-hud-surface menu-loading--pulse">
          <p>Carregando edição...</p>
        </div>
      </div>
    )
  }

  return children
}

function AppViewRouter() {
  const view = useAppStore((s) => s.view)
  const gameSessionKey = useAppStore((s) => s.gameSessionKey)
  const setView = useAppStore((s) => s.setView)
  const clearSession = useMatchSetupStore((s) => s.clearSession)
  const clearSetup = useMatchSetupStore((s) => s.clearSetup)

  const exitGame = () => {
    clearSession()
    clearSetup()
    useGameStore.getState().setUserTeam('home')
    setView('menu')
  }

  return (
    <ViewTransition view={view}>
      {(activeView) => {
        switch (activeView) {
          case 'menu':
            return <MainMenu />
          case 'match-setup':
            return <MatchSetupScreen />
          case 'team-management':
            return <TeamManagementScreen />
          case 'editor':
            return <EditorScreen />
          case 'game':
            return <Game key={gameSessionKey} onExit={exitGame} />
          default:
            return null
        }
      }}
    </ViewTransition>
  )
}

export default function App() {
  return (
    <DbBootstrap>
      <AppViewRouter />
    </DbBootstrap>
  )
}

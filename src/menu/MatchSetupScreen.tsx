import { useEffect } from 'react'
import { useMatchSetupStore } from '../store/matchSetupStore'
import { MatchLoadingScreen } from './matchSetup/MatchLoadingScreen'
import { MatchPlayerScreen } from './matchSetup/MatchPlayerScreen'
import { MatchPreMatchScreen } from './matchSetup/MatchPreMatchScreen'
import { MatchSideScreen } from './matchSetup/MatchSideScreen'
import { MatchTeamScreen } from './matchSetup/MatchTeamScreen'
import { SetupStepTransition } from './matchSetup/SetupStepTransition'

export function MatchSetupScreen() {
  const draft = useMatchSetupStore((s) => s.draft)
  const startSetup = useMatchSetupStore((s) => s.startSetup)

  useEffect(() => {
    if (!draft) startSetup()
  }, [draft, startSetup])

  const step = draft?.step ?? 'side'

  return (
    <SetupStepTransition step={step}>
      {step === 'side' && <MatchSideScreen />}
      {step === 'team' && <MatchTeamScreen />}
      {step === 'prematch' && <MatchPreMatchScreen />}
      {step === 'player' && <MatchPlayerScreen />}
      {step === 'loading' && <MatchLoadingScreen />}
    </SetupStepTransition>
  )
}

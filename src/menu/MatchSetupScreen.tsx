import { useEffect } from 'react'
import { useMatchSetupStore } from '../store/matchSetupStore'
import { MatchKitScreen } from './matchSetup/MatchKitScreen'
import { MatchLoadingScreen } from './matchSetup/MatchLoadingScreen'
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
      {step === 'kit' && <MatchKitScreen />}
      {step === 'loading' && <MatchLoadingScreen />}
    </SetupStepTransition>
  )
}

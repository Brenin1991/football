import type { ReactNode } from 'react'
import type { MatchSetupStep } from '../../store/matchSetupStore'

type SetupStepTransitionProps = {
  step: MatchSetupStep
  children: ReactNode
}

export function SetupStepTransition({ step, children }: SetupStepTransitionProps) {
  return (
    <div key={step} className="setup-step setup-step--enter">
      {children}
    </div>
  )
}

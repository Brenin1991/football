export function MenuPadHints({ confirm = 'Confirmar', back = 'Voltar' }: { confirm?: string; back?: string }) {
  return (
    <div className="menu-pad-hints" aria-hidden>
      <span>
        <kbd className="menu-pad-hints__btn">A</kbd> {confirm}
      </span>
      <span>
        <kbd className="menu-pad-hints__btn">B</kbd> {back}
      </span>
    </div>
  )
}

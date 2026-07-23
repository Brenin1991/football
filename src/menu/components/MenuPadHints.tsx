export function MenuPadHints({
  confirm = 'Confirmar',
  back = 'Voltar',
  y,
  x,
}: {
  confirm?: string
  back?: string
  y?: string
  x?: string
}) {
  return (
    <div className="menu-pad-hints" aria-hidden>
      <span>
        <kbd className="menu-pad-hints__btn menu-pad-hints__btn--a">A</kbd> {confirm}
      </span>
      {x ? (
        <span>
          <kbd className="menu-pad-hints__btn menu-pad-hints__btn--x">X</kbd> {x}
        </span>
      ) : null}
      {y ? (
        <span>
          <kbd className="menu-pad-hints__btn menu-pad-hints__btn--y">Y</kbd> {y}
        </span>
      ) : null}
      <span>
        <kbd className="menu-pad-hints__btn menu-pad-hints__btn--b">B</kbd> {back}
      </span>
    </div>
  )
}

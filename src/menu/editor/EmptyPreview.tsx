export function EmptyPreview({ hint }: { hint: string }) {
  return (
    <div className="ed-preview ed-preview--empty">
      <div className="ed-preview__placeholder" aria-hidden />
      <p>{hint}</p>
    </div>
  )
}

export function pickRandomClip<T>(items: T[]): T | null {
  if (items.length === 0) return null
  return items[Math.floor(Math.random() * items.length)]
}

export function resolveClipUrl(basePath: string, category: string, file: string): string {
  if (file.startsWith('/') || file.startsWith('http')) return file
  if (file.includes('/')) return `${basePath}/${file}`
  return `${basePath}/${category}/${file}`
}

export async function loadAudioManifest<T extends string>(
  basePath: string,
): Promise<Partial<Record<T, string[]>> | null> {
  try {
    const res = await fetch(`${basePath}/manifest.json`, { cache: 'no-store' })
    if (!res.ok) return null
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    if (ct.includes('text/html')) return null
    return (await res.json()) as Partial<Record<T, string[]>>
  } catch {
    return null
  }
}

/** Converte entradas do manifest (qualquer nome de arquivo) em URLs prontas para tocar */
export function manifestFilesToUrls(
  basePath: string,
  category: string,
  files: string[] | null | undefined,
): string[] {
  if (!files?.length) return []
  return files.map((file) => resolveClipUrl(basePath, category, file))
}

export async function discoverCategoryClips(
  basePath: string,
  category: string,
  manifestFiles?: string[] | null,
): Promise<string[]> {
  return manifestFilesToUrls(basePath, category, manifestFiles)
}

export async function discoverAllCategories(
  basePath: string,
  categories: readonly string[],
): Promise<Record<string, string[]>> {
  const manifest = await loadAudioManifest<string>(basePath)
  const manifestKeys = manifest ? Object.keys(manifest) : []
  const allCategories = [...new Set([...categories, ...manifestKeys])]

  const entries = allCategories.map(
    (category) =>
      [
        category,
        manifestFilesToUrls(basePath, category, manifest?.[category]),
      ] as const,
  )

  return Object.fromEntries(entries)
}

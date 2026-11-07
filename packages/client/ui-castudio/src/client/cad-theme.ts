/** Host-owned semantic tokens passed to the embedded engineering surface. */
const tokens = {
  '--embed-bg': '--dsw-alias-bg-base',
  '--embed-panel': '--dsw-alias-bg-layer-2',
  '--embed-surface': '--dsw-alias-bg-module-platform',
  '--embed-border': '--dsw-alias-border-l2',
  '--embed-text': '--dsw-alias-label-primary',
  '--embed-muted': '--dsw-alias-label-secondary',
  '--embed-subtle': '--dsw-alias-label-tertiary',
  '--embed-hover': '--dsw-alias-interactive-bg-hover',
  '--embed-active': '--dsw-alias-interactive-bg-active',
  '--embed-accent': '--dsw-alias-state-business-primary',
  '--embed-primary': '--dsw-alias-button-primary-fill',
  '--embed-primary-text': '--dsw-alias-label-primary-foreground',
  '--embed-radius': '--dsw-radius-md',
  '--embed-control-radius': '--dsw-radius-sm',
} as const

/**
 * Resolve the current DSH appearance without copying a second palette into the iframe.
 * @param element - native workbench host.
 * @returns resolved CSS variables consumed by the embedded workbench.
 */
export function cadThemeTokens(element: Element): Record<string, string> {
  const style = getComputedStyle(element)
  const result: Record<string, string> = { '--embed-font': style.fontFamily }
  for (const [target, source] of Object.entries(tokens)) {
    const value = style.getPropertyValue(source).trim()
    if (value) result[target] = value
  }
  return result
}

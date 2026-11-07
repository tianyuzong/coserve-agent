import type { IconProps } from './icons/props.ts'
import { COSERVE_LOGO } from './coserve-brand.ts'
import clsx from 'clsx'
import styles from './CoServeBrand.module.css'
import { useId } from 'react'

/** CoServe AI compact mark, using the original wordmark's C.
 * @param props - existing brand size and layout class.
 * @returns decorative brand artwork.
 */
export function FishLogo({ size = 24, className }: IconProps) {
  const filterId = `coserve-${useId().replaceAll(':', '')}`
  return <svg width={size} height={size} className={clsx(styles['artwork'], className)} viewBox="70 70 125 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <filter id={filterId} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 -1 -1 3 0" />
      </filter>
    </defs>
    <image href={COSERVE_LOGO} width="1034" height="298" filter={`url(#${filterId})`} />
  </svg>
}

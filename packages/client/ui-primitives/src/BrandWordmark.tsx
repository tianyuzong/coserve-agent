import type { IconProps } from './icons/props.ts'
import { COSERVE_LOGO } from './coserve-brand.ts'
import clsx from 'clsx'
import styles from './CoServeBrand.module.css'
import { useId } from 'react'

/** Retains the existing caller contract; the company artwork is one complete wordmark. */
export interface BrandWordmarkProps extends IconProps { includeMark?: boolean | undefined }

/** Render the original CoServe AI wordmark.
 * @param props - requested height and layout class.
 * @returns decorative company artwork.
 */
export function BrandWordmark({ size = 24, className }: BrandWordmarkProps) {
  const filterId = `coserve-${useId().replaceAll(':', '')}`
  return <svg width={size * 6} height={size} className={clsx(styles['artwork'], className)} viewBox="60 65 900 150" aria-hidden="true">
    <defs>
      <filter id={filterId} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 -1 -1 3 0" />
      </filter>
    </defs>
    <image href={COSERVE_LOGO} width="1034" height="298" filter={`url(#${filterId})`} />
  </svg>
}

/** CoServe AI Desktop uses local identity; standalone Web retains cloud accounts. */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyCloudAccount } from './cloud-account.ts'
import { registerLocalAccount } from './LocalAccount.tsx'
export { inject } from './cloud-account.ts'
export type { AccountSectionInjected, AccountSectionProps, AccountMenuProps, AccountSnapshot, AccountKey } from './cloud-account.ts'

/** Select the account surface owned by this application. @param ctx - client plugin context. */
export function apply(ctx: Context): void {
  if ('dshDesktop' in globalThis) registerLocalAccount(ctx)
  else applyCloudAccount(ctx)
}

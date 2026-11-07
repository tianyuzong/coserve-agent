/** Desktop identity UI with no remote account reads or sign-in operations. */
import type { Context } from '@deepseek-ai/cordis'
import { FishLogo, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { localAccountLocales } from './local-account-locales.ts'
import menuCss from './AccountMenu.module.css'
import sectionCss from './AccountSection.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'coserve.localAccount': keyof typeof localAccountLocales.en }
}

function LocalAccountMenu({ wide, openSettings, settingsShortcut, t }: PropsRuntime<'settings.launcher'> & PropsLocale<'coserve.localAccount'>) {
  return <div className={menuCss.root}>
    <button type="button" className={menuCss.trigger} data-collapsed={!wide}
      aria-label={t('settings')} aria-keyshortcuts={settingsShortcut?.aria} onClick={openSettings}>
      <FishLogo size={24} />
      {wide && <><span className={menuCss.label}>{t('name')}</span><IconSettingsOutlineMedium size={16} /></>}
    </button>
  </div>
}

function LocalAccountSection({ t }: PropsRuntime<'settings.section'> & PropsLocale<'coserve.localAccount'>) {
  return <section className={sectionCss.section}>
    <div className={sectionCss.card}><span className={sectionCss.identity}><FishLogo size={32} />{t('name')}</span></div>
    <p>{t('description')}</p>
  </section>
}

/** Register local identity and settings navigation without installing cloud account subscriptions.
 * @param ctx - the account UI plugin context.
 */
export function registerLocalAccount(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('coserve.localAccount', localAccountLocales), 'CoServe AI: local account copy')
  const t = ctx.locale.bind('coserve.localAccount')
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({ name: 'settings.launcher', locale: 'coserve.localAccount' }, LocalAccountMenu))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'account', order: -10, label: () => t('nav'), locale: 'coserve.localAccount',
  }, LocalAccountSection))
}

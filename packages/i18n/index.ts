// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { t as tBuilt } from './lib/i18n';
import type { t as tDev } from './lib/i18n-dev';

export const t = tBuilt as unknown as typeof tDev;

export {
  browserLocaleToDevLocale,
  getResolvedUiLocale,
  getUiLocalePreference,
  isUiLocalePreference,
  setUiLocalePreference,
  subscribeUiLocaleChange,
  UI_DEV_LOCALES,
} from './lib/uiLocale';
export type { UiLocalePreference } from './lib/uiLocale';
export type { DevLocale, MessageKey } from './lib/type';

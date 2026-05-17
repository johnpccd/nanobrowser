import type { DevLocale, MessageKey } from './type';
import { translateMessage } from './translateMessage';
import { getResolvedUiLocale, setUiLocalePreference, type UiLocalePreference } from './uiLocale';

export function t(key: MessageKey, substitutions?: string | string[]) {
  return translateMessage(key, substitutions);
}

Object.defineProperty(t, 'devLocale', {
  get(): DevLocale {
    return getResolvedUiLocale();
  },
  set(value: DevLocale | UiLocalePreference) {
    setUiLocalePreference(value === 'auto' ? 'auto' : value);
  },
});

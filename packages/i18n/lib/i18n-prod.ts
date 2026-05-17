import type { DevLocale, MessageKey } from './type';
import { translateMessage } from './translateMessage';
import { getResolvedUiLocale, getUiLocalePreference, setUiLocalePreference, type UiLocalePreference } from './uiLocale';

export function t(key: MessageKey, substitutions?: string | string[]) {
  if (getUiLocalePreference() !== 'auto') {
    return translateMessage(key, substitutions);
  }
  const chromeMessage = chrome.i18n.getMessage(key, substitutions);
  if (chromeMessage) {
    return chromeMessage;
  }
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

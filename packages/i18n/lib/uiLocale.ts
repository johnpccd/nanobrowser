import type { DevLocale } from './type';

export type UiLocalePreference = 'auto' | DevLocale;

export const UI_DEV_LOCALES: DevLocale[] = ['de', 'en', 'fr', 'it'];

const listeners = new Set<() => void>();

let preference: UiLocalePreference = 'auto';

export function getUiLocalePreference(): UiLocalePreference {
  return preference;
}

export function setUiLocalePreference(next: UiLocalePreference): void {
  if (preference === next) {
    return;
  }
  preference = next;
  listeners.forEach(listener => listener());
}

export function subscribeUiLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readBrowserLocaleTag(): string {
  if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
    return chrome.i18n.getUILanguage().replace('-', '_');
  }
  return Intl.DateTimeFormat().resolvedOptions().locale.replace('-', '_');
}

export function browserLocaleToDevLocale(): DevLocale {
  const tag = readBrowserLocaleTag();
  if (UI_DEV_LOCALES.includes(tag as DevLocale)) {
    return tag as DevLocale;
  }
  const language = tag.split('_')[0];
  if (UI_DEV_LOCALES.includes(language as DevLocale)) {
    return language as DevLocale;
  }
  return 'en';
}

export function getResolvedUiLocale(): DevLocale {
  if (preference !== 'auto') {
    return preference;
  }
  return browserLocaleToDevLocale();
}

export function isUiLocalePreference(value: string): value is UiLocalePreference {
  return value === 'auto' || UI_DEV_LOCALES.includes(value as DevLocale);
}

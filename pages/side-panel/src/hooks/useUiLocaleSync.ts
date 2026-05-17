import { useEffect, useState } from 'react';
import { generalSettingsStore } from '@extension/storage';
import { setUiLocalePreference, subscribeUiLocaleChange } from '@extension/i18n';

/** Applies stored UI locale and re-renders when it changes. */
export function useUiLocaleSync(): void {
  const [, setTick] = useState(0);

  useEffect(() => {
    const applyFromStorage = async () => {
      const settings = await generalSettingsStore.getSettings();
      setUiLocalePreference(settings.uiLocale);
      setTick(n => n + 1);
    };

    void applyFromStorage();
    const unsubStorage = generalSettingsStore.subscribe(() => {
      void applyFromStorage();
    });
    const unsubLocale = subscribeUiLocaleChange(() => {
      setTick(n => n + 1);
    });

    return () => {
      unsubStorage();
      unsubLocale();
    };
  }, []);
}

import type { GeneralSettingsConfig } from './generalSettings';
import { clampOptionalFontSize, normalizeHexColor, sanitizeQaFontFamily } from './qaAppearanceUtils';

/** Resolved theme for QA mode side panel (only non-default overrides). */
export type ResolvedQaUiTheme = {
  fontFamily?: string;
  /** Set when user chooses a non-zero UI font size in settings. */
  chromeFontSizePx?: number;
  inputFontSizePx: number;
  panelBg?: string;
  chatBg?: string;
  messageText?: string;
  headingText?: string;
  mutedText?: string;
  linkColor?: string;
  separatorColor?: string;
  inputSurface?: string;
  inputBorder?: string;
  inputText?: string;
  accentColor?: string;
};

export function resolveQaUiTheme(cfg: GeneralSettingsConfig): ResolvedQaUiTheme {
  const pick = (v: string) => {
    const n = normalizeHexColor(v);
    return n || undefined;
  };

  const chromeRaw = clampOptionalFontSize(cfg.qaChromeFontSize, 10, 22);
  const chromeFontSizePx = chromeRaw > 0 ? chromeRaw : undefined;

  const inputRaw = clampOptionalFontSize(cfg.qaInputFontSize, 10, 28);
  const inputFontSizePx = inputRaw > 0 ? inputRaw : clampOptionalFontSize(cfg.fontSize, 10, 28) || 14;

  return {
    fontFamily: sanitizeQaFontFamily(cfg.qaFontFamily) || undefined,
    chromeFontSizePx,
    inputFontSizePx,
    panelBg: pick(cfg.qaColorPanelBg),
    chatBg: pick(cfg.qaColorChatBg),
    messageText: pick(cfg.qaColorMessageText),
    headingText: pick(cfg.qaColorHeadingText),
    mutedText: pick(cfg.qaColorMutedText),
    linkColor: pick(cfg.qaColorLink),
    separatorColor: pick(cfg.qaColorSeparator),
    inputSurface: pick(cfg.qaColorInputSurface),
    inputBorder: pick(cfg.qaColorInputBorder),
    inputText: pick(cfg.qaColorInputText),
    accentColor: pick(cfg.qaColorAccent),
  };
}

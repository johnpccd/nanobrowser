import type { MessageKey } from './type';
import { getMessageFromLocale } from './getMessageFromLocale';
import { getResolvedUiLocale } from './uiLocale';

type I18nValue = {
  message: string;
  placeholders?: Record<string, { content?: string; example?: string }>;
};

function applyPlaceholderDefinitions(message: string, placeholders?: I18nValue['placeholders']): string {
  if (!placeholders) {
    return message;
  }
  let result = message;
  for (const [name, { content }] of Object.entries(placeholders)) {
    if (!content) {
      continue;
    }
    result = result.replace(new RegExp(`\\$${name}\\$`, 'gi'), content);
  }
  return result;
}

function applySubstitutions(message: string, substitutions?: string | string[]): string {
  if (!substitutions) {
    return message;
  }
  if (Array.isArray(substitutions)) {
    return substitutions.reduce((acc, cur, idx) => acc.replace(`$${idx + 1}`, cur), message);
  }
  return message.replace(/\$(\d+)/, substitutions);
}

function removeNumberPlaceholders(message: string): string {
  return message.replace(/\$\d+/g, '');
}

export function translateMessage(key: MessageKey, substitutions?: string | string[]): string {
  const value = getMessageFromLocale(getResolvedUiLocale())[key] as I18nValue;
  let message = applyPlaceholderDefinitions(value.message, value.placeholders);
  message = applySubstitutions(message, substitutions);
  return removeNumberPlaceholders(message);
}

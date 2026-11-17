import type { Lang } from '../types/interfaces';

/**
 * Turns any thrown value into a short, user-facing message.
 * Engine input errors (StatInputError) carry bilingual messages; they are
 * detected by shape so this helper does not depend on the error class.
 */
export function errorMessage(err: unknown, lang: Lang): string {
  if (err && typeof err === 'object') {
    const e = err as { messageTr?: unknown; messageEn?: unknown; message?: unknown };
    const localized = lang === 'tr' ? e.messageTr : e.messageEn;
    if (typeof localized === 'string' && localized.length > 0) return localized;
    if (typeof e.message === 'string' && e.message.length > 0) return e.message;
  }
  if (typeof err === 'string' && err.length > 0) return err;
  return lang === 'tr' ? 'Analiz çalıştırılamadı.' : 'The analysis could not be run.';
}

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@laundry/shared/locales/en.json';

/**
 * All UI strings live in packages/shared/locales/en.json (shared with the
 * server's PDFs/receipts). Arabic is added later by dropping in ar.json and
 * switching `lng` + `dir` — no component changes needed.
 */
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;

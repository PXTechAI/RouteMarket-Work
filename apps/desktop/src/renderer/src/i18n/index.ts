import { useEffect, useState } from "react";
import { enUS } from "./messages/en-US";
import { zhCN } from "./messages/zh-CN";
import { jaJP } from "./messages/ja-JP";
import { esES } from "./messages/es-ES";
import { ptBR } from "./messages/pt-BR";
import { thTH } from "./messages/th-TH";
import { koKR } from "./messages/ko-KR";
import { APP_LOCALES, type AppLocale, type LocalePreference } from "./locales";

const STORAGE_KEY = "routemarket.work.locale";
const CHANGE_EVENT = "routemarket:locale-change";
export type MessageKey = keyof typeof enUS;
const messages: Record<AppLocale, Partial<Record<MessageKey, string>>> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "ja-JP": jaJP,
  "es-ES": esES,
  "pt-BR": ptBR,
  "th-TH": thTH,
  "ko-KR": koKR
};
let activePreference = readPreference();
let activeLocale = resolveLocale(activePreference);

export function tr(key: MessageKey, values: readonly unknown[] = []): string {
  const template = messages[activeLocale][key] ?? messages["en-US"][key] ?? key;
  return template.replace(/\{(\d+)\}/g, (_match, index: string) => String(values[Number(index)] ?? ""));
}

export function getLocalePreference(): LocalePreference { return activePreference; }
export function getActiveLocale(): AppLocale { return activeLocale; }

export function setLocalePreference(preference: LocalePreference): void {
  activePreference = preference;
  activeLocale = resolveLocale(preference);
  window.localStorage.setItem(STORAGE_KEY, preference);
  void window.routeMarketWork?.updatePreferences({ locale: preference });
  applyDocumentLocale(activeLocale);
  syncMainLocale(activeLocale);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function initializeLocale(preference?: LocalePreference): void {
  if (preference) {
    activePreference = preference;
    activeLocale = resolveLocale(preference);
  }
  applyDocumentLocale(activeLocale);
  syncMainLocale(activeLocale);
}

export function useLocale() {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((current) => current + 1);
    const onSystemLanguageChange = () => {
      if (activePreference !== "system") return;
      activeLocale = resolveLocale("system");
      applyDocumentLocale(activeLocale);
      syncMainLocale(activeLocale);
      onChange();
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("languagechange", onSystemLanguageChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("languagechange", onSystemLanguageChange);
    };
  }, []);
  return { locale: activeLocale, preference: activePreference, setPreference: setLocalePreference };
}

function readPreference(): LocalePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "system" || APP_LOCALES.includes(stored as AppLocale) ? stored as LocalePreference : "system";
}

function resolveLocale(preference: LocalePreference): AppLocale {
  if (preference !== "system") return preference;
  if (typeof navigator === "undefined") return "zh-CN";
  const language = navigator.language.toLocaleLowerCase();
  if (language.startsWith("zh")) return "zh-CN";
  if (language.startsWith("ja")) return "ja-JP";
  if (language.startsWith("es")) return "es-ES";
  if (language.startsWith("pt")) return "pt-BR";
  if (language.startsWith("th")) return "th-TH";
  if (language.startsWith("ko")) return "ko-KR";
  return "en-US";
}

function applyDocumentLocale(locale: AppLocale): void { document.documentElement.lang = locale; }

function syncMainLocale(locale: AppLocale): void {
  void window.routeMarketWork?.setLocale(locale);
}

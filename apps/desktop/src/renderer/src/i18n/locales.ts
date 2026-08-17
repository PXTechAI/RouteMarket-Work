export const APP_LOCALES = ["en-US", "zh-CN", "ja-JP", "es-ES", "pt-BR", "th-TH", "ko-KR"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export type LocalePreference = "system" | AppLocale;

export const LOCALE_OPTIONS: ReadonlyArray<{ value: LocalePreference }> = [
  { value: "system" },
  { value: "en-US" },
  { value: "zh-CN" },
  { value: "ja-JP" },
  { value: "es-ES" },
  { value: "pt-BR" },
  { value: "th-TH" },
  { value: "ko-KR" }
];

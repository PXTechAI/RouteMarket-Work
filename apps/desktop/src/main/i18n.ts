import { enUS } from "../renderer/src/i18n/messages/en-US";
import { zhCN } from "../renderer/src/i18n/messages/zh-CN";
import { jaJP } from "../renderer/src/i18n/messages/ja-JP";
import { esES } from "../renderer/src/i18n/messages/es-ES";
import { ptBR } from "../renderer/src/i18n/messages/pt-BR";
import { thTH } from "../renderer/src/i18n/messages/th-TH";
import { koKR } from "../renderer/src/i18n/messages/ko-KR";
import type { DesktopLocale } from "../shared/desktop-api";

type MainMessageKey = keyof typeof enUS;

const messages: Record<DesktopLocale, Partial<Record<MainMessageKey, string>>> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "ja-JP": jaJP,
  "es-ES": esES,
  "pt-BR": ptBR,
  "th-TH": thTH,
  "ko-KR": koKR
};

let activeLocale: DesktopLocale = "zh-CN";

export function setMainLocale(locale: DesktopLocale): void {
  activeLocale = locale;
}

export function trMain(key: MainMessageKey, values: readonly unknown[] = []): string {
  const template = messages[activeLocale][key] ?? messages["en-US"][key] ?? key;
  return template.replace(/\{(\d+)\}/g, (_match, index: string) => String(values[Number(index)] ?? ""));
}

import { describe, expect, it } from "vitest";
import { enUS } from "./messages/en-US";
import { zhCN } from "./messages/zh-CN";
import { jaJP } from "./messages/ja-JP";
import { esES } from "./messages/es-ES";
import { ptBR } from "./messages/pt-BR";
import { thTH } from "./messages/th-TH";
import { koKR } from "./messages/ko-KR";

const locales = { zhCN, jaJP, esES, ptBR, thTH, koKR };

describe("desktop locale resources", () => {
  it("keeps the same message keys in every locale", () => {
    for (const messages of Object.values(locales)) {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(enUS).sort());
    }
  });

  it("keeps interpolation placeholders aligned", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      for (const key of Object.keys(enUS) as Array<keyof typeof enUS>) {
        expect(placeholders(messages[key]), `${locale}:${key}`).toEqual(placeholders(enUS[key]));
      }
    }
  });

  it("does not ship Chinese fallback text in the English locale", () => {
    const untranslated = Object.entries(enUS).filter(([, value]) => /[\u3400-\u9fff]/u.test(value));
    expect(untranslated).toEqual([]);
  });
});

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\d+\}/g)].map(([placeholder]) => placeholder).sort();
}

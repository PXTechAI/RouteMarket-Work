import { tr } from "./i18n";
export function parseCommandLine(value: string): {
    executable: string;
    args: string[];
} {
    const tokens: string[] = [];
    let token = "";
    let quote: "'" | '"' | null = null;
    let tokenStarted = false;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index]!;
        if (quote) {
            if (character === quote) {
                quote = null;
            }
            else if (character === "\\" && value[index + 1] === quote) {
                token += quote;
                index += 1;
            }
            else {
                token += character;
            }
            tokenStarted = true;
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
            tokenStarted = true;
        }
        else if (/\s/.test(character)) {
            if (tokenStarted) {
                tokens.push(token);
                token = "";
                tokenStarted = false;
            }
        }
        else {
            token += character;
            tokenStarted = true;
        }
    }
    if (quote)
        throw new Error(tr("ui.4cd1875aba30"));
    if (tokenStarted)
        tokens.push(token);
    const [executable, ...args] = tokens;
    if (!executable)
        throw new Error(tr("ui.2e1b3bd23ec5"));
    return { executable, args };
}

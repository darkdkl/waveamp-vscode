const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const cp1251Decoder = new TextDecoder("windows-1251");

// Tags decoded as latin1 may really be UTF-8 ("FÃ¼r") or old Russian cp1251 ("Êèíî").
// Valid UTF-8 wins; cp1251 only when high-byte characters outnumber ASCII letters.
export function fixMojibake(text: string | null | undefined): string | null | undefined {
  if (!text || /[^\x00-\xff]/.test(text)) return text;
  const high = (text.match(/[\x80-\xff]/g) || []).length;
  if (high === 0) return text;
  const bytes = Buffer.from(text, "latin1");
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    const asciiLetters = (text.match(/[a-z]/gi) || []).length;
    return high < asciiLetters ? text : cp1251Decoder.decode(bytes);
  }
}

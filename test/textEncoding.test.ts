import { describe, expect, it } from "vitest";
import { fixMojibake } from "../src/textEncoding";

describe("fixMojibake", () => {
  it("repairs UTF-8 that was read as latin1", () => {
    expect(fixMojibake("FÃ¼r Elise")).toBe("Für Elise");
    expect(fixMojibake(Buffer.from("Тихая гавань — Маяк", "utf8").toString("latin1"))).toBe("Тихая гавань — Маяк");
  });

  it("repairs cp1251 that was read as latin1", () => {
    expect(fixMojibake("Ìàÿê")).toBe("Маяк");
  });

  it("keeps real latin1 text with a few accents", () => {
    expect(fixMojibake("Café du Port")).toBe("Café du Port");
  });

  it("leaves ASCII, proper Unicode and empty values untouched", () => {
    expect(fixMojibake("Plain title")).toBe("Plain title");
    expect(fixMojibake("Уже нормально")).toBe("Уже нормально");
    expect(fixMojibake("")).toBe("");
    expect(fixMojibake(null)).toBeNull();
    expect(fixMojibake(undefined)).toBeUndefined();
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectDateFormat, parseDate } from "../src";

describe("parseDate", () => {
  it.each([
    ["2026-04-03", "YMD", "2026-04-03"],
    ["2026/4/3", "YMD", "2026-04-03"],
    ["20260403", "YMD", "2026-04-03"],
    ["2026-04-03T14:22:10Z", "YMD", "2026-04-03"],
    ["2026-04-03 14:22:10", "DMY", "2026-04-03"],
    ["03/04/2026", "DMY", "2026-04-03"],
    ["03/04/2026", "MDY", "2026-03-04"],
    ["3.4.26", "DMY", "2026-04-03"],
    ["03-04-99", "DMY", "1999-04-03"],
    ["3 Apr 2026", "MDY", "2026-04-03"],
    ["03-Apr-26", "MDY", "2026-04-03"],
    ["Apr 3, 2026", "DMY", "2026-04-03"],
    ["April 3rd 2026", "DMY", "2026-04-03"],
    ["3. März 2026", "DMY", "2026-03-03"],
    ["12 déc. 2026", "DMY", "2026-12-12"],
    ["1 juil 2026", "DMY", "2026-07-01"],
    ["1 juin 2026", "DMY", "2026-06-01"],
    ["15 okt 2026", "DMY", "2026-10-15"],
    ["5 mei 2026", "DMY", "2026-05-05"],
    ["29/02/2028", "DMY", "2028-02-29"],
  ] as const)("%s (%s) → %s", (raw, f, want) => {
    expect(parseDate(raw, f)).toBe(want);
  });

  it.each([
    ["31/04/2026", "DMY"],
    ["29/02/2026", "DMY"],
    ["13/13/2026", "MDY"],
    ["Total", "MDY"],
    ["", "MDY"],
    ["2026-13-01", "YMD"],
    ["3 Foo 2026", "DMY"],
  ] as const)("rejects %s", (raw, f) => {
    expect(parseDate(raw, f)).toBeNull();
  });

  it("round-trips every real date in every numeric style", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("1971-01-01"), max: new Date("2099-12-31"), noInvalidDate: true }), (d) => {
        const iso = d.toISOString().slice(0, 10);
        const [y, m, day] = iso.split("-");
        expect(parseDate(iso)).toBe(iso);
        expect(parseDate(`${day}/${m}/${y}`, "DMY")).toBe(iso);
        expect(parseDate(`${m}/${day}/${y}`, "MDY")).toBe(iso);
        expect(parseDate(`${day}.${m}.${y}`, "DMY")).toBe(iso);
        expect(parseDate(`${y}${m}${day}`)).toBe(iso);
      }),
    );
  });
});

describe("detectDateFormat", () => {
  it("uses days above 12 when there are any", () => {
    expect(detectDateFormat(["01/02/2026", "25/02/2026"])).toMatchObject({ format: "DMY", basis: "votes" });
    expect(detectDateFormat(["01/02/2026", "02/25/2026"])).toMatchObject({ format: "MDY", basis: "votes" });
  });
  it("doesn't let one typo flip the file", () => {
    expect(detectDateFormat(["13/01/2026", "14/01/2026", "15/01/2026", "01/16/2026"]).format).toBe("DMY");
  });
  it("falls back to row order, then to the hint", () => {
    expect(detectDateFormat(["01/10/2026", "01/12/2026", "02/03/2026", "02/07/2026"])).toMatchObject({ format: "MDY", basis: "order" });
    expect(detectDateFormat(["01/02/2026", "01/02/2026"], "DMY")).toMatchObject({ format: "DMY", basis: "hint" });
  });
  it("reports YMD for files without numeric day/month dates", () => {
    expect(detectDateFormat(["2026-01-02", "3 Jan 2026"]).format).toBe("YMD");
  });
});

import { expect, it } from "vitest";
import { searchRules, splitSections } from "./rules";

it("splits on paragraphs and finds inflected words", () => {
  const s = splitSections("Regulamin\n§ 1. Postanowienia ogólne.\n§ 2\nZarząd rozpatruje zgłoszenia w terminie 14 dni.\n§3. Odwołanie do Rady Nadzorczej.");
  expect(s.map((x) => x.ref)).toEqual(["Wstęp", "§ 1", "§ 2", "§ 3"]);
  const hits = searchRules([{ id: "a", title: "R", kind: "rules", importedAt: "", sections: s }], "terminu rozpatrzenia");
  expect(hits[0].ref).toBe("§ 2");
});

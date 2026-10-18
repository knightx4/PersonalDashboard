import { describe, expect, it } from "vitest";
import { joinNotes } from "./join-notes";

const DATE = "2026-10-18";

describe("joinNotes", () => {
  it("adds the incoming text at the end under a dated heading", () => {
    const out = joinNotes("First line.\n", "More.", "Other note", DATE);
    expect(out).toBe("First line.\n\n## 2026-10-18 · Other note\n\nMore.\n");
  });

  it("keeps one blank line between the parts however the receiving text ends", () => {
    for (const tail of ["", "\n", "\n\n\n", "  \n"]) {
      const out = joinNotes(`Body${tail}`, "More", "T", DATE);
      expect(out).toBe("Body\n\n## 2026-10-18 · T\n\nMore\n");
    }
  });

  it("leaves existing text and frontmatter untouched", () => {
    const receiving = "---\ntitle: A\ntags: [x]\n---\n\n# A\n\nSome text.\n";
    const out = joinNotes(receiving, "More", "B", DATE);
    expect(out.startsWith(receiving.trimEnd())).toBe(true);
    expect(out.startsWith("---\ntitle: A\ntags: [x]\n---\n")).toBe(true);
  });

  it("adds after a note that is only frontmatter", () => {
    const out = joinNotes("---\na: 1\n---\n", "More", "B", DATE);
    expect(out).toBe("---\na: 1\n---\n\n## 2026-10-18 · B\n\nMore\n");
  });

  it("starts from the block when the receiving text is empty", () => {
    expect(joinNotes("", "More", "B", DATE)).toBe("## 2026-10-18 · B\n\nMore\n");
  });

  it("drops the incoming text's own frontmatter", () => {
    const out = joinNotes("A", "---\nk: v\n---\nBody", "B", DATE);
    expect(out).toBe("A\n\n## 2026-10-18 · B\n\nBody\n");
  });

  it("gives the same result joined twice as once", () => {
    const once = joinNotes("---\nx: 1\n---\nHello", "Incoming\n\nparagraph", "B", DATE);
    expect(joinNotes(once, "Incoming\n\nparagraph", "B", DATE)).toBe(once);
    expect(joinNotes(once, "Incoming\n\nparagraph", "B", "2026-10-19")).toBe(once);
  });

  it("returns the receiving text unchanged when there is nothing to add", () => {
    expect(joinNotes("Keep\n", "  \n", "B", DATE)).toBe("Keep\n");
    expect(joinNotes("Keep\n", "---\nk: v\n---\n", "B", DATE)).toBe("Keep\n");
  });

  it("falls back to Untitled for a blank title", () => {
    expect(joinNotes("A", "B", "  ", DATE)).toContain("## 2026-10-18 · Untitled");
  });
});

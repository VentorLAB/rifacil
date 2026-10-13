import { describe, expect, it } from "vitest";
import { DEFAULT_CONTACT_SORT, formatUsd, sortArrow, sortBySpent, toggleContactSort } from "./contact-sort";

describe("toggleContactSort", () => {
  it("starts on Total gastado, highest first", () => {
    expect(DEFAULT_CONTACT_SORT).toEqual({ by: "totalSpent", dir: "desc" });
  });

  it("clicking the active column flips the direction", () => {
    expect(toggleContactSort({ by: "totalSpent", dir: "desc" }, "totalSpent")).toEqual({ by: "totalSpent", dir: "asc" });
    expect(toggleContactSort({ by: "totalSpent", dir: "asc" }, "totalSpent")).toEqual({ by: "totalSpent", dir: "desc" });
  });

  it("a new column starts A-Z for Nombre and highest first for Compras", () => {
    expect(toggleContactSort(DEFAULT_CONTACT_SORT, "name")).toEqual({ by: "name", dir: "asc" });
    expect(toggleContactSort({ by: "name", dir: "asc" }, "name")).toEqual({ by: "name", dir: "desc" });
    expect(toggleContactSort({ by: "name", dir: "asc" }, "purchases")).toEqual({ by: "purchases", dir: "desc" });
  });
});

describe("sortArrow", () => {
  it("shows ▼ / ▲ only on the active column", () => {
    expect(sortArrow({ by: "totalSpent", dir: "desc" }, "totalSpent")).toBe("▼");
    expect(sortArrow({ by: "name", dir: "asc" }, "name")).toBe("▲");
    expect(sortArrow({ by: "name", dir: "asc" }, "purchases")).toBe("");
  });
});

describe("sortBySpent", () => {
  const rows = [
    { id: "c", name: "Carla", spentUsd: 0 },
    { id: "a", name: "Álvaro", spentUsd: 120.5 },
    { id: "b", name: "beatriz", spentUsd: 0 },
    { id: "d", name: "Diego", spentUsd: 980 },
  ];

  it("desc puts the biggest customers first and breaks ties by name A-Z", () => {
    expect(sortBySpent(rows, "desc").map((r) => r.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("asc puts the smallest first, ties still A-Z (accents and case ignored)", () => {
    expect(sortBySpent(rows, "asc").map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("does not mutate the input", () => {
    const copy = [...rows];
    sortBySpent(rows, "desc");
    expect(rows).toEqual(copy);
  });
});

describe("formatUsd", () => {
  it("formats like the sales table", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

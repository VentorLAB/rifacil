/**
 * Sorting rules for the Contacts admin table, shared by the API (server-side
 * order, so the first page really holds the top customers) and the UI
 * (header clicks and ▼/▲ arrows).
 */

export type ContactSortColumn = "name" | "purchases" | "totalSpent";
export type SortDirection = "asc" | "desc";
export interface ContactSort {
  by: ContactSortColumn;
  dir: SortDirection;
}

/** Opening state: the customers who invested the most first. */
export const DEFAULT_CONTACT_SORT: ContactSort = { by: "totalSpent", dir: "desc" };

/** First click on a column: A-Z for names, highest first for numbers. */
const FIRST_DIRECTION: Record<ContactSortColumn, SortDirection> = {
  name: "asc",
  purchases: "desc",
  totalSpent: "desc",
};

/** Header click: same column flips the direction, another column starts fresh. */
export function toggleContactSort(current: ContactSort, column: ContactSortColumn): ContactSort {
  if (current.by === column) return { by: column, dir: current.dir === "asc" ? "desc" : "asc" };
  return { by: column, dir: FIRST_DIRECTION[column] };
}

/** Arrow shown next to a header: only on the active column. */
export function sortArrow(current: ContactSort, column: ContactSortColumn): "▼" | "▲" | "" {
  if (current.by !== column) return "";
  return current.dir === "desc" ? "▼" : "▲";
}

const byName = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });

/**
 * Orders contacts by total spent. Ties (e.g. everyone at $0) fall back to name
 * A-Z and then id, so pages are stable between requests.
 */
export function sortBySpent<T extends { id: string; name: string; spentUsd: number }>(
  rows: T[],
  dir: SortDirection,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) => sign * (a.spentUsd - b.spentUsd) || byName(a.name, b.name) || a.id.localeCompare(b.id),
  );
}

/** "$1,234.50" — the format the sales table already uses. */
export function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

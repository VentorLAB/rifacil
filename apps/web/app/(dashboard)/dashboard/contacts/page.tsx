"use client";
import { useMemo, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import {
  DEFAULT_CONTACT_SORT,
  formatUsd,
  parseGoogleContacts,
  sortArrow,
  toggleContactSort,
  type ContactSort,
  type ContactSortColumn,
  type ParseResult,
} from "@riffas/shared";
import { Plus, Upload, Check, X, Trash2, AlertTriangle } from "lucide-react";

type ListFilter = {
  source?: string;
  tags?: string[];
};

export default function ContactsPage() {
  const [filter, setFilter] = useState<ListFilter>({});
  // Server-side order (the page shows 50): first the customers who invested the most.
  const [sort, setSort] = useState<ContactSort>(DEFAULT_CONTACT_SORT);
  const { data, refetch, isFetching } = api.contact.list.useQuery(
    { limit: 50, ...filter, sortBy: sort.by, sortOrder: sort.dir },
    { keepPreviousData: true },
  );
  const utils = api.useContext();

  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // Selección para borrado en lote
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<null | {
    ids: string[];
    strong: boolean; // confirmación reforzada (bulk grande / select all matching)
  }>(null);
  const [strongConfirmText, setStrongConfirmText] = useState("");

  const createContact = api.contact.create.useMutation({
    onSuccess: () => {
      toast.success("Contacto agregado");
      setNewOpen(false);
      setNewName("");
      setNewPhone("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const importCSV = api.contact.importCSV.useMutation({
    onSuccess: (res) => {
      const parts = [`${res.imported} nuevos`];
      if (res.updated) parts.push(`${res.updated} actualizados`);
      if (res.skipped) parts.push(`${res.skipped} omitidos`);
      if (res.errors.length) parts.push(`${res.errors.length} con error`);
      toast.success(`Importación lista: ${parts.join(", ")}`);
      setPreview(null);
      setFileName("");
      refetch();
    },
    onError: (e) => toast.error(e.message || "No se pudo importar"),
  });

  const deleteOne = api.contact.delete.useMutation({
    onSuccess: () => {
      toast.success("Contacto borrado");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMany = api.contact.deleteMany.useMutation({
    onSuccess: (res) => {
      const lines: string[] = [];
      lines.push(`Borrados: ${res.deleted}`);
      if (res.blocked.length > 0) lines.push(`Bloqueados con ventas: ${res.blocked.length}`);
      if (res.notOwnedCount > 0) lines.push(`Ajenos (ignorados): ${res.notOwnedCount}`);
      toast.success(lines.join(" — "));
      // Si hubo bloqueados, los mostramos en consola para debugging del rifero
      if (res.blocked.length > 0) {
        console.warn("[deleteMany] contactos no borrados por tener ventas:", res.blocked);
      }
      setSelectedIds(new Set());
      setConfirmDelete(null);
      setStrongConfirmText("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Resolver IDs que matchean el filtro actual (para "Seleccionar todos los que matchean").
  const fetchAllMatchingIds = async () => {
    const result = await utils.contact.listIds.fetch(filter);
    return result.ids;
  };

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    const result = parseGoogleContacts(text, { tag: "Importados" });
    setPreview(result);
  }

  function confirmImport() {
    if (!preview) return;
    importCSV.mutate({
      format: "google_contacts",
      data: preview.contacts.map((c) => ({
        name: c.name,
        phone: c.phone,
        email: c.email ?? undefined,
        city: c.city ?? undefined,
        tags: c.tags,
        notes: c.notes ?? undefined,
      })),
    });
  }

  const visibleIds = useMemo(() => data?.contacts.map((c) => c.id) ?? [], [data]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handleSelectAllMatching() {
    try {
      const ids = await fetchAllMatchingIds();
      setSelectedIds(new Set(ids));
      toast.success(`${ids.length} contactos seleccionados`);
    } catch {
      toast.error("No se pudo obtener la lista completa");
    }
  }

  function askDeleteOne(id: string) {
    setConfirmDelete({ ids: [id], strong: false });
  }

  function askDeleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Reforzar confirmación si son muchos (más que la página visible).
    setConfirmDelete({ ids, strong: ids.length > 50 });
  }

  // Filtro rápido por tag v1_import
  const v1FilterActive = filter.tags?.includes("v1_import") ?? false;
  function toggleV1Filter() {
    setFilter((prev) =>
      v1FilterActive ? { ...prev, tags: undefined } : { ...prev, tags: ["v1_import"] }
    );
    setSelectedIds(new Set());
  }

  const strongConfirmExpected = `BORRAR ${confirmDelete?.ids.length ?? 0}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Contactos</h1>
        <div className="flex gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-slate-700 dark:text-slate-200">
            <Upload className="h-5 w-5" /> Importar Google
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFile}
            />
          </label>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            <Plus className="h-5 w-5" /> Nuevo
          </button>
        </div>
      </div>

      {/* Filtros rápidos por tag */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">Filtros:</span>
        <button
          onClick={toggleV1Filter}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            v1FilterActive
              ? "border-purple-500 bg-purple-50 text-purple-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Importados de v1 {v1FilterActive && "✓"}
        </button>
        {v1FilterActive && (
          <button
            onClick={() => {
              setFilter({});
              setSelectedIds(new Set());
            }}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Limpiar filtro
          </button>
        )}
      </div>

      {/* Barra de acción cuando hay selección */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <div className="text-sm font-medium text-red-900">
            {selectedIds.size} seleccionado{selectedIds.size === 1 ? "" : "s"}
          </div>
          <div className="flex gap-2">
            {Object.keys(filter).length > 0 && (
              <button
                onClick={handleSelectAllMatching}
                className="rounded-xl border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Seleccionar todos los que matchean el filtro
              </button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="rounded-xl border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Limpiar
            </button>
            <button
              onClick={askDeleteSelected}
              className="flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              <Trash2 className="h-4 w-4" /> Borrar seleccionados
            </button>
          </div>
        </div>
      )}

      {/* Vista previa de la importación */}
      {preview && (
        <div className="rounded-xl border bg-white p-4 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium text-slate-900 dark:text-white">
              Vista previa — {fileName}
            </p>
            <button
              onClick={() => {
                setPreview(null);
                setFileName("");
              }}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Cancelar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Filas" value={preview.stats.totalRows} />
            <Stat label="Con teléfono" value={preview.stats.withValidPhone} />
            <Stat label="Duplicados" value={preview.stats.duplicatesMerged} />
            <Stat label="Inválidos" value={preview.stats.invalid} />
            <Stat label="Tel. extra" value={preview.stats.extraPhonesFound} />
          </div>

          <div className="mt-4 max-h-48 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {preview.contacts.slice(0, 10).map((c, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2 text-slate-500">{c.phone}</td>
                    <td className="px-3 py-2 text-slate-400">{c.country}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.contacts.length > 10 && (
            <p className="mt-2 text-xs text-slate-400">
              …y {preview.contacts.length - 10} más
            </p>
          )}

          <button
            onClick={confirmImport}
            disabled={importCSV.isLoading || preview.stats.withValidPhone === 0}
            className="mt-4 flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-white disabled:opacity-50"
          >
            <Check className="h-5 w-5" />
            {importCSV.isLoading
              ? "Importando…"
              : `Importar ${preview.stats.withValidPhone} contactos`}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-white dark:bg-slate-900">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="w-10 px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Seleccionar todos los visibles"
                  className="h-4 w-4 cursor-pointer rounded border-slate-300"
                />
              </th>
              <SortableTh label="Nombre" column="name" sort={sort} onSort={setSort} />
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Teléfono</th>
              <SortableTh label="Compras" column="purchases" sort={sort} onSort={setSort} />
              <SortableTh label="Total gastado" column="totalSpent" sort={sort} onSort={setSort} align="right" />
              <th className="w-16 px-4 py-3 text-left text-xs font-medium text-slate-500">Acción</th>
            </tr>
          </thead>
          <tbody className={`divide-y transition-opacity ${isFetching ? "opacity-60" : ""}`}>
            {data?.contacts.map((c) => {
              const hasSales = (c._count?.sales ?? 0) > 0;
              const checked = selectedIds.has(c.id);
              return (
                <tr key={c.id} className={checked ? "bg-red-50/40" : ""}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(c.id)}
                      aria-label={`Seleccionar ${c.name}`}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3 font-mono text-sm">{c.phone}</td>
                  <td className="px-4 py-3">{c._count?.sales ?? 0}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatUsd(c.spentUsd ?? 0)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => askDeleteOne(c.id)}
                      disabled={hasSales}
                      title={
                        hasSales
                          ? "No se puede borrar: tiene ventas. Cancelá las ventas primero."
                          : "Borrar contacto"
                      }
                      className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                      aria-label={`Borrar ${c.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {data?.contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  No hay contactos que matcheen el filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de confirmación de borrado */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full space-y-4 rounded-t-2xl border bg-white p-6 sm:max-w-md sm:rounded-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-slate-900">
                  {confirmDelete.strong
                    ? `Borrado masivo: ${confirmDelete.ids.length} contactos`
                    : `¿Borrar ${confirmDelete.ids.length === 1 ? "el contacto" : `${confirmDelete.ids.length} contactos`}?`}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {confirmDelete.strong
                    ? "Vas a borrar muchos contactos de un golpe. Esta acción NO se puede deshacer. Los contactos con ventas se saltarán automáticamente."
                    : confirmDelete.ids.length === 1
                    ? "Esta acción no se puede deshacer. Si el contacto tiene ventas asociadas, no se borrará."
                    : "Esta acción no se puede deshacer. Los que tengan ventas se saltarán."}
                </p>
              </div>
            </div>

            {confirmDelete.strong && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Para confirmar, escribe: <span className="font-mono">{strongConfirmExpected}</span>
                </label>
                <input
                  value={strongConfirmText}
                  onChange={(e) => setStrongConfirmText(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900"
                  placeholder={strongConfirmExpected}
                  autoFocus
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmDelete(null);
                  setStrongConfirmText("");
                }}
                className="flex-1 rounded-xl border px-4 py-3 font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!confirmDelete) return;
                  if (confirmDelete.strong && strongConfirmText !== strongConfirmExpected) {
                    toast.error("Texto de confirmación no coincide");
                    return;
                  }
                  if (confirmDelete.ids.length === 1) {
                    deleteOne.mutate({ id: confirmDelete.ids[0] });
                    setConfirmDelete(null);
                    setStrongConfirmText("");
                  } else {
                    deleteMany.mutate({ ids: confirmDelete.ids });
                  }
                }}
                disabled={
                  deleteOne.isLoading ||
                  deleteMany.isLoading ||
                  (confirmDelete.strong && strongConfirmText !== strongConfirmExpected)
                }
                className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteOne.isLoading || deleteMany.isLoading
                  ? "Borrando…"
                  : `Borrar ${confirmDelete.ids.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full space-y-4 rounded-t-2xl border bg-white p-6 sm:max-w-md sm:rounded-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Nuevo contacto</h2>
              <button
                onClick={() => setNewOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim() || !newPhone.trim()) {
                  toast.error("Completa nombre y teléfono");
                  return;
                }
                createContact.mutate({ name: newName.trim(), phone: newPhone.trim() });
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                  placeholder="Ej: Carlos Rodríguez"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">WhatsApp</label>
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                  placeholder="0424..."
                  required
                />
              </div>
              <button
                type="submit"
                disabled={createContact.isLoading}
                className="w-full rounded-xl bg-blue-600 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createContact.isLoading ? "Guardando…" : "Agregar contacto"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** Clickable header: toggles ▼/▲ on its column (see toggleContactSort). */
function SortableTh({
  label,
  column,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  column: ContactSortColumn;
  sort: ContactSort;
  onSort: (next: ContactSort) => void;
  align?: "left" | "right";
}) {
  const active = sort.by === column;
  const arrow = sortArrow(sort, column);
  const hint = column === "name" ? (sort.dir === "asc" ? "A-Z" : "Z-A") : sort.dir === "desc" ? "mayor a menor" : "menor a mayor";
  return (
    <th
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-3 text-xs font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(toggleContactSort(sort, column))}
        title={active ? `Ordenado ${hint}. Clic para invertir.` : `Ordenar por ${label}`}
        className={`inline-flex items-center gap-1 rounded transition hover:text-slate-900 dark:hover:text-white ${
          active ? "text-slate-900 dark:text-white" : "text-slate-500"
        }`}
      >
        {label}
        <span aria-hidden className="w-3 text-[10px]">{arrow}</span>
      </button>
    </th>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800">
      <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

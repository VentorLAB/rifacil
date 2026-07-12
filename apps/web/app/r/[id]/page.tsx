"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import {
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Trophy,
  Receipt,
  CheckCircle2,
  Ticket,
  Upload,
} from "lucide-react";

const PAGE_SIZE = 120;

const METHOD_LABELS: Record<string, string> = {
  PAGO_MOVIL: "Pago Móvil",
  BINANCE: "Binance / USDT",
  ZELLE: "Zelle",
  EFECTIVO_USD: "Efectivo USD",
  EFECTIVO_VES: "Efectivo Bs",
  TRANSFERENCIA_VES: "Transferencia Bs",
  NEQUI: "Nequi",
  DAVIPLATA: "Daviplata",
  PSE: "PSE",
  BANK_TRANSFER: "Transferencia",
  MERCADOPAGO: "MercadoPago",
  STRIPE: "Stripe",
  WOMPI: "Wompi",
  CASH: "Efectivo",
  ZINLI: "Zinli",
  BANCOLOMBIA: "Bancolombia",
};

const PILL: Record<string, string> = {
  AVAILABLE: "bg-slate-100 text-slate-700 border border-slate-200",
  RESERVED: "bg-orange-400 text-white",
  SOLD: "bg-yellow-300 text-yellow-900",
  PAID: "bg-green-500 text-white",
};

const money = (v: number) =>
  `$${Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function PublicRafflePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: raffle, isLoading, error } = api.public.getRaffle.useQuery({ id }, { enabled: !!id });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checkout, setCheckout] = useState(false);
  const [vendorCode, setVendorCode] = useState<string | undefined>(undefined);

  // Atribución de referido: captura ?ref= y la persiste por rifa.
  useEffect(() => {
    const key = `ref_${id}`;
    const fromUrl = new URLSearchParams(window.location.search).get("ref");
    if (fromUrl) {
      localStorage.setItem(key, fromUrl);
      setVendorCode(fromUrl);
    } else {
      const stored = localStorage.getItem(key);
      if (stored) setVendorCode(stored);
    }
  }, [id]);
  const [done, setDone] = useState<null | {
    numbers: string[];
    amountPaid: number;
    debt: number;
  }>(null);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }
  if (error || !raffle) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-slate-500">
        <div>
          <p className="text-lg font-semibold text-slate-700">Rifa no encontrada</p>
          <p className="mt-1 text-sm">El enlace no es válido o la rifa ya no está disponible.</p>
        </div>
      </div>
    );
  }

  // Identidad del negocio: priorizar colores de marca del rifero; la rifa los
  // complementa. Secundario para degradados/acentos.
  const color = raffle.brand.color || raffle.color || "#7c3aed";
  const color2 = raffle.brand.colorSecondary || color;
  const total = raffle.pricePerNumber * selected.size;

  function toggle(n: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  if (done) {
    return (
      <SuccessScreen
        color={color}
        brandName={raffle.brand.name}
        contactWhatsapp={raffle.contactWhatsapp}
        result={done}
        onReset={() => {
          setDone(null);
          setSelected(new Set());
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      {/* Banner / encabezado de marca */}
      <header className="relative">
        {raffle.bannerUrl || raffle.bannerMobileUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={raffle.bannerMobileUrl || raffle.bannerUrl!}
            alt={raffle.title}
            className="h-44 w-full object-cover sm:h-60"
          />
        ) : (
          <div className="h-32 w-full" style={{ background: `linear-gradient(135deg, ${color}, ${color2})` }} />
        )}
        <div className="mx-auto -mt-8 max-w-2xl px-4">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              {raffle.brand.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={raffle.brand.logo} alt={raffle.brand.name} className="h-10 w-10 rounded-lg object-cover" />
              )}
              <div className="min-w-0">
                <p className="text-xs text-slate-500">{raffle.brand.name}</p>
                <h1 className="truncate text-xl font-bold text-slate-900">{raffle.title}</h1>
              </div>
            </div>
            {raffle.description && <p className="mt-2 text-sm text-slate-600">{raffle.description}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {raffle.loteria && <span>Lotería: {raffle.loteria}</span>}
              {raffle.drawDate && (
                <span>Sorteo: {new Date(raffle.drawDate).toLocaleDateString("es-VE")}</span>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-5">
        {/* Ganador (si ya se sorteó) */}
        {raffle.winner && (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-5 text-center">
            <Trophy className="mx-auto h-8 w-8 text-amber-500" />
            <p className="mt-1 text-sm text-amber-700">¡Número ganador!</p>
            <p className="font-mono text-4xl font-extrabold text-slate-900">{raffle.winner.number}</p>
            {raffle.winner.holder && <p className="mt-1 text-sm text-slate-600">{raffle.winner.holder}</p>}
          </div>
        )}

        {/* Precio + % vendido */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border bg-white p-4 text-center">
            <p className="text-2xl font-bold" style={{ color }}>
              {money(raffle.pricePerNumber)}
            </p>
            <p className="text-xs text-slate-500">por número</p>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Vendido</span>
              <span className="font-semibold text-slate-900">{raffle.soldPct}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${raffle.soldPct}%`, backgroundColor: color }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {raffle.counts.available} disponibles de {raffle.counts.total}
            </p>
          </div>
        </div>

        {/* Premios */}
        {raffle.prizes.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Trophy className="h-4 w-4 text-amber-500" /> Premios
            </h2>
            <ul className="space-y-2">
              {raffle.prizes.map((p, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl border bg-white p-3">
                  <span
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {i + 1}º
                  </span>
                  {p.imagenUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imagenUrl} alt={p.titulo} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{p.titulo}</p>
                    {p.descripcion && <p className="truncate text-sm text-slate-500">{p.descripcion}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Tablero de números */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Elige tu número</h2>
          <NumberPicker raffleId={id} color={color} selected={selected} onToggle={toggle} canBuy={raffle.canBuy} />
        </section>

        {!raffle.canBuy && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
            Esta rifa no está recibiendo ventas en este momento.
          </div>
        )}

        {/* Verificar mi número */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Verificar mi número</h2>
          <VerifySection raffleId={id} color={color} />
        </section>
      </main>

      {/* Barra de acción fija */}
      {raffle.canBuy && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500">{selected.size} número(s) · {money(total)}</p>
              <p className="truncate font-mono text-sm text-slate-700">{[...selected].join(", ")}</p>
            </div>
            <button
              onClick={() => setCheckout(true)}
              className="rounded-xl px-5 py-3 font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              Apartar
            </button>
          </div>
        </div>
      )}

      {checkout && (
        <CheckoutSheet
          raffleId={id}
          color={color}
          numbers={[...selected]}
          pricePerNumber={raffle.pricePerNumber}
          paymentAccounts={raffle.paymentAccounts}
          vendorCode={vendorCode}
          onClose={() => setCheckout(false)}
          onDone={(res) => {
            setCheckout(false);
            setDone(res);
          }}
        />
      )}
    </div>
  );
}

function NumberPicker({
  raffleId,
  color,
  selected,
  onToggle,
  canBuy,
}: {
  raffleId: string;
  color: string;
  selected: Set<string>;
  onToggle: (n: string) => void;
  canBuy: boolean;
}) {
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(0), [onlyAvailable]);

  const { data, isLoading, isFetching } = api.public.listNumbers.useQuery({
    raffleId,
    status: onlyAvailable ? "AVAILABLE" : "ALL",
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
            className="h-4 w-4"
          />
          Solo disponibles
        </label>
        {isFetching && <Loader2 className="ml-auto h-4 w-4 animate-spin text-slate-400" />}
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar número…"
          inputMode="numeric"
          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-4 text-slate-900"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !data || data.numbers.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">No hay números para mostrar.</p>
      ) : (
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
          {data.numbers.map((n) => {
            const isSel = selected.has(n.number);
            const available = n.status === "AVAILABLE";
            return (
              <button
                key={n.id}
                disabled={!available || !canBuy}
                onClick={() => onToggle(n.number)}
                className={`min-h-[44px] rounded-lg py-2 text-center font-mono text-xs font-semibold transition ${
                  isSel ? "text-white ring-2 ring-offset-1" : PILL[n.status] ?? PILL.AVAILABLE
                } ${!available ? "cursor-not-allowed opacity-90" : ""}`}
                style={isSel ? { backgroundColor: color } : undefined}
              >
                {n.number}
              </button>
            );
          })}
        </div>
      )}

      {data && data.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0}
            className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm text-slate-600 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <span className="text-sm text-slate-500">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm text-slate-600 disabled:opacity-40"
          >
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function VerifySection({ raffleId, color }: { raffleId: string; color: string }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data, isFetching } = api.public.verify.useQuery(
    { raffleId, query: submitted },
    { enabled: submitted.length >= 2 }
  );

  const STATUS_COLOR: Record<string, string> = {
    Apartado: "bg-orange-100 text-orange-700",
    "Por confirmar": "bg-yellow-100 text-yellow-800",
    Pagado: "bg-green-100 text-green-700",
  };

  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="mb-2 text-xs text-slate-500">
        Ingresa tu teléfono o un número de boleto para ver tus apartados y su estado.
      </p>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSubmitted(query.trim())}
          placeholder="Teléfono o número de boleto"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900"
        />
        <button
          onClick={() => setSubmitted(query.trim())}
          className="whitespace-nowrap rounded-xl px-4 py-2 font-medium text-white"
          style={{ backgroundColor: color }}
        >
          Verificar
        </button>
      </div>

      {submitted.length >= 2 && (
        <div className="mt-4">
          {isFetching ? (
            <div className="flex justify-center py-6 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !data || !data.found ? (
            <p className="rounded-xl bg-slate-50 px-4 py-4 text-center text-sm text-slate-500">
              No encontramos números con ese dato en esta rifa.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">
                  Titular: <span className="font-medium text-slate-800">{data.holder}</span>
                </span>
                <span className="text-slate-500">{data.totals.numbers} número(s)</span>
              </div>

              <ul className="divide-y rounded-xl border">
                {data.items.map((it) => (
                  <li key={it.number} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="font-mono font-semibold text-slate-900">{it.number}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLOR[it.estado] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {it.estado}
                    </span>
                    <span className="ml-auto text-right text-xs">
                      <span className="block text-green-600">Abonado {money(it.abonado)}</span>
                      {it.deuda > 0 && <span className="block text-red-600">Deuda {money(it.deuda)}</span>}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <span className="font-medium text-slate-700">Total</span>
                <span className="text-right">
                  <span className="block font-semibold text-green-600">Abonado {money(data.totals.abonado)}</span>
                  {data.totals.deuda > 0 && (
                    <span className="block font-semibold text-red-600">Deuda {money(data.totals.deuda)}</span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CheckoutSheet({
  raffleId,
  color,
  numbers,
  pricePerNumber,
  paymentAccounts,
  vendorCode,
  onClose,
  onDone,
}: {
  raffleId: string;
  color: string;
  numbers: string[];
  pricePerNumber: number;
  paymentAccounts: any[];
  vendorCode?: string;
  onClose: () => void;
  onDone: (res: { numbers: string[]; amountPaid: number; debt: number }) => void;
}) {
  const total = pricePerNumber * numbers.length;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<string>(paymentAccounts[0]?.method ?? "PAGO_MOVIL");
  const [amount, setAmount] = useState(String(total));
  const [reference, setReference] = useState("");
  const [proofUrl, setProofUrl] = useState<string>("");
  const [uploadingProof, setUploadingProof] = useState(false);

  const paid = Number(amount) || 0;
  const willReserve = paid > 0 && paid < total;

  const uploadProof = api.public.uploadProof.useMutation();

  async function handleProof(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("El comprobante debe ser una imagen");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("La imagen no puede superar 8 MB");
      return;
    }
    try {
      setUploadingProof(true);
      const dataUri = await fileToDataUri(file);
      const { url } = await uploadProof.mutateAsync({ dataUri });
      setProofUrl(url);
      toast.success("Comprobante subido");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo subir el comprobante");
    } finally {
      setUploadingProof(false);
    }
  }

  const create = api.public.createSale.useMutation({
    onSuccess: (res) => {
      toast.success("¡Apartado registrado!");
      onDone({ numbers: res.numbers, amountPaid: res.amountPaid, debt: res.debt });
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedAccount = paymentAccounts.find((a) => a.method === method);

  function submit() {
    if (!name.trim() || !phone.trim()) {
      toast.error("Completa tu nombre y teléfono");
      return;
    }
    if (paid - total > 0.001) {
      toast.error(`El monto supera el total (${money(total)})`);
      return;
    }
    create.mutate({
      raffleId,
      numbers,
      name: name.trim(),
      phone: phone.trim(),
      paymentMethod: method as any,
      amountPaid: Number(paid.toFixed(2)),
      paymentReference: reference.trim() || undefined,
      paymentProof: proofUrl || undefined,
      vendorCode: vendorCode || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white sm:max-w-lg sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Apartar números</h2>
            <p className="font-mono text-xs text-slate-500">{numbers.join(", ")}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-xl border p-4 text-center">
            <p className="text-sm text-slate-500">Total ({numbers.length} número(s))</p>
            <p className="text-2xl font-bold" style={{ color }}>
              {money(total)}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Tu nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre y apellido"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Tu WhatsApp</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0424 123 4567"
              inputMode="tel"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>

          {/* Método de pago */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">¿Cómo pagaste?</label>
            {paymentAccounts.length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                El organizador aún no configuró medios de pago. Contáctalo para coordinar.
              </p>
            ) : (
              <div className="space-y-2">
                {paymentAccounts.map((a) => (
                  <label
                    key={a.method}
                    className={`block cursor-pointer rounded-xl border p-3 ${
                      method === a.method ? "border-2" : "border-slate-200"
                    }`}
                    style={method === a.method ? { borderColor: color } : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="method"
                        checked={method === a.method}
                        onChange={() => setMethod(a.method)}
                        className="h-4 w-4"
                      />
                      <span className="font-medium text-slate-900">
                        {METHOD_LABELS[a.method] ?? a.method}
                      </span>
                    </div>
                    {method === a.method && <AccountDetails account={a} />}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Monto que pagaste (USD)</label>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                max={total}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
              />
              <button
                type="button"
                onClick={() => setAmount(String(total))}
                className="whitespace-nowrap rounded-xl border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Pagar todo
              </button>
            </div>
            {willReserve && (
              <p className="mt-1 text-xs font-medium text-orange-600">
                Apartado · deuda {money(total - paid)}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Referencia (opcional)</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Nº de operación, últimos dígitos…"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>

          {/* Comprobante de pago (captura) */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Comprobante de pago</label>
            {proofUrl ? (
              <div className="relative h-40 overflow-hidden rounded-xl border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proofUrl} alt="Comprobante" className="h-full w-full object-contain bg-slate-50" />
                <button
                  type="button"
                  onClick={() => setProofUrl("")}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
                  aria-label="Quitar comprobante"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 py-6 text-sm text-slate-500">
                {uploadingProof ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                <span>{uploadingProof ? "Subiendo…" : "Subir captura del pago"}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingProof}
                  onChange={(e) => handleProof(e.target.files?.[0])}
                />
              </label>
            )}
          </div>

          <button
            onClick={submit}
            disabled={create.isLoading || uploadingProof}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: color }}
          >
            {create.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Ticket className="h-5 w-5" />}
            Confirmar apartado
          </button>
          <p className="text-center text-xs text-slate-400">
            Tu apartado quedará <b>por confirmar</b> hasta que el organizador verifique el pago.
          </p>
        </div>
      </div>
    </div>
  );
}

function AccountDetails({ account: a }: { account: any }) {
  const rows: [string, string | null][] = [
    ["Banco", a.bankName],
    ["Teléfono", a.phone],
    ["Cédula/RIF", a.idDocument],
    ["Correo", a.email],
    ["Wallet", a.wallet],
    ["Titular", a.holderName],
    ["Cuenta", a.accountNumber],
    ["Nota", a.note],
  ];
  const present = rows.filter(([, v]) => v);
  if (present.length === 0) return null;
  return (
    <div className="mt-2 space-y-0.5 border-t pt-2 text-sm">
      {present.map(([label, v]) => (
        <div key={label} className="flex justify-between gap-2">
          <span className="text-slate-500">{label}</span>
          <span className="text-right font-medium text-slate-800">{v}</span>
        </div>
      ))}
    </div>
  );
}

function SuccessScreen({
  color,
  brandName,
  contactWhatsapp,
  result,
  onReset,
}: {
  color: string;
  brandName: string;
  contactWhatsapp?: string | null;
  result: { numbers: string[]; amountPaid: number; debt: number };
  onReset: () => void;
}) {
  const waLink = contactWhatsapp
    ? `https://wa.me/${contactWhatsapp.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
        `Hola ${brandName}, aparté el/los número(s) ${result.numbers.join(", ")}.` +
          (result.debt > 0 ? ` Aboné ${money(result.amountPaid)} (resta ${money(result.debt)}).` : "")
      )}`
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <div className="w-full max-w-md space-y-5 rounded-2xl border bg-white p-6 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14" style={{ color }} />
        <div>
          <h1 className="text-xl font-bold text-slate-900">¡Apartado registrado!</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tu apartado está <b>por confirmar</b>. El organizador verificará tu pago.
          </p>
        </div>

        <div className="rounded-xl border p-4 text-left text-sm">
          <div className="flex justify-between py-1">
            <span className="text-slate-500">Números</span>
            <span className="font-mono font-medium text-slate-900">{result.numbers.join(", ")}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-500">Abonado</span>
            <span className="font-medium text-green-600">{money(result.amountPaid)}</span>
          </div>
          {result.debt > 0 && (
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Deuda</span>
              <span className="font-medium text-red-600">{money(result.debt)}</span>
            </div>
          )}
        </div>

        {/* El comprobante oficial NO existe aún: se emite cuando el organizador
            confirma el pago (los montos de aquí son auto-reportados). */}
        <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
          <Receipt className="h-4 w-4" />
          Recibirás tu comprobante oficial por WhatsApp al confirmarse tu pago.
        </p>
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl border py-3 font-medium text-slate-700 hover:bg-slate-50"
          >
            Escribir al organizador
          </a>
        )}
        <button onClick={onReset} className="text-sm text-slate-500 hover:underline">
          Apartar más números
        </button>
      </div>
    </div>
  );
}

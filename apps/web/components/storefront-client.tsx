"use client";

// Piezas interactivas de la landing de marca /d/[host]. La página es server
// component (datos server-side); estos widgets necesitan estado/cliente:
//  - PaymentAccounts: botón "Copiar datos" por método.
//  - VerifyWidget: consulta public.verify (con selector de rifa).
//  - Faq: acordeón.
import { useMemo, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { Copy, Check, Search, Loader2, ChevronDown, ShieldCheck } from "lucide-react";

const METHOD_LABEL: Record<string, string> = {
  PAGO_MOVIL: "Pago Móvil",
  BINANCE: "Binance / USDT",
  ZELLE: "Zelle",
  ZINLI: "Zinli",
  EFECTIVO_USD: "Efectivo USD",
  EFECTIVO_VES: "Efectivo Bs",
  TRANSFERENCIA_VES: "Transferencia Bs",
  BANCOLOMBIA: "Bancolombia",
  STRIPE: "Stripe",
  WOMPI: "Wompi",
  CASH: "Efectivo",
};

const FIELD_LABEL: Record<string, string> = {
  bankName: "Banco",
  phone: "Teléfono",
  idDocument: "Cédula/RIF",
  email: "Correo",
  wallet: "Wallet/Correo",
  holderName: "Titular",
  accountNumber: "N° de cuenta",
  note: "Nota",
};

type PaymentAccount = {
  method: string;
  bankName: string | null;
  phone: string | null;
  idDocument: string | null;
  email: string | null;
  wallet: string | null;
  holderName: string | null;
  accountNumber: string | null;
  note: string | null;
};

const FIELD_ORDER: (keyof PaymentAccount)[] = [
  "bankName",
  "phone",
  "idDocument",
  "email",
  "wallet",
  "holderName",
  "accountNumber",
  "note",
];

export function PaymentAccountsSection({
  accounts,
  color,
}: {
  accounts: PaymentAccount[];
  color: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  if (!accounts || accounts.length === 0) {
    return (
      <p className="text-center text-sm text-slate-400">
        El organizador aún no cargó sus cuentas de pago.
      </p>
    );
  }

  function copy(a: PaymentAccount) {
    const lines = FIELD_ORDER.filter((f) => a[f])
      .map((f) => `${FIELD_LABEL[f as string]}: ${a[f]}`);
    const text = `${METHOD_LABEL[a.method] ?? a.method}\n${lines.join("\n")}`;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(a.method);
        toast.success("Datos copiados");
        setTimeout(() => setCopied((c) => (c === a.method ? null : c)), 2000);
      },
      () => toast.error("No se pudo copiar")
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {accounts.map((a) => {
        const fields = FIELD_ORDER.filter((f) => a[f]);
        return (
          <div key={a.method} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-white">{METHOD_LABEL[a.method] ?? a.method}</h3>
              <button
                onClick={() => copy(a)}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white transition"
                style={{ backgroundColor: copied === a.method ? "#16a34a" : color }}
              >
                {copied === a.method ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === a.method ? "Copiado" : "Copiar datos"}
              </button>
            </div>
            <dl className="space-y-1 text-sm">
              {fields.map((f) =>
                f === "note" ? (
                  // La nota suele ser una instrucción para el comprador → envolver,
                  // nunca truncar.
                  <div key={f as string} className="pt-1">
                    <dt className="text-slate-400">{FIELD_LABEL[f as string]}</dt>
                    <dd className="font-medium leading-snug text-slate-100">{a[f]}</dd>
                  </div>
                ) : (
                  <div key={f as string} className="flex justify-between gap-3">
                    <dt className="shrink-0 text-slate-400">{FIELD_LABEL[f as string]}</dt>
                    <dd className="truncate text-right font-medium text-slate-100">{a[f]}</dd>
                  </div>
                )
              )}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

type RaffleOpt = { id: string; title: string };

export function VerifyWidget({
  raffles,
  color,
}: {
  raffles: RaffleOpt[];
  color: string;
}) {
  const utils = api.useContext();
  const [raffleId, setRaffleId] = useState<string>(raffles[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [searched, setSearched] = useState(false);

  const money = (v: number) => `$${Number(v ?? 0).toFixed(2)}`;

  async function submit() {
    const q = query.trim();
    if (q.length < 2) return toast.error("Escribe tu teléfono o número de boleto");
    if (!raffleId) return toast.error("Elegí una rifa");
    setLoading(true);
    setSearched(true);
    try {
      const r = await utils.public.verify.fetch({ raffleId, query: q });
      setResult(r);
    } catch {
      toast.error("No se pudo verificar. Probá de nuevo.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  if (raffles.length === 0) {
    return (
      <p className="text-center text-sm text-slate-400">
        No hay rifas activas para verificar en este momento.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-3">
      {raffles.length > 1 && (
        <select
          value={raffleId}
          onChange={(e) => setRaffleId(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white"
        >
          {raffles.map((r) => (
            <option key={r.id} value={r.id} className="bg-slate-900">
              {r.title}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Tu teléfono o número de boleto"
          inputMode="tel"
          className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500"
        />
        <button
          onClick={submit}
          disabled={loading}
          className="flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: color }}
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          <span className="hidden sm:inline">Buscar</span>
        </button>
      </div>

      {searched && !loading && result && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          {result.found ? (
            <>
              <p className="text-sm text-slate-300">
                Titular: <span className="font-semibold text-white">{result.holder}</span>
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <Stat label="Números" value={result.totals.numbers} />
                <Stat label="Abonado" value={money(result.totals.abonado)} />
                <Stat label="Deuda" value={money(result.totals.deuda)} />
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {result.items.map((it: any) => (
                  <li
                    key={it.number}
                    className="rounded-md bg-white/10 px-2 py-1 text-xs text-white"
                    title={it.estado}
                  >
                    {it.number} · {it.estado}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-center text-sm text-slate-400">
              No encontramos boletos con ese dato. Verificá el teléfono o número.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-white/[0.05] p-2">
      <p className="font-bold text-white">{value}</p>
      <p className="text-slate-400">{label}</p>
    </div>
  );
}

const FAQ_ITEMS = [
  {
    q: "¿Cómo sé que la rifa es real?",
    a: "Los sorteos se transmiten en vivo por Instagram y los premios juegan hasta que haya ganador. Cada compra queda registrada y podés verificar tus boletos arriba en cualquier momento.",
  },
  {
    q: "¿Cómo elijo y aparto mis números?",
    a: "Entrá a la rifa, elegí tus números (manual o al azar), completá tus datos y subí el comprobante de pago. Tu apartado queda reservado al instante.",
  },
  {
    q: "¿Qué métodos de pago aceptan?",
    a: "Pago Móvil, Binance/USDT, Zelle, Zinli, Bancolombia y efectivo. En la sección 'Cuentas de pago' tenés todos los datos con botón para copiarlos.",
  },
  {
    q: "¿Cómo recibo mi comprobante?",
    a: "Apenas confirmamos tu pago te enviamos el comprobante por WhatsApp. También podés consultar tus números cuando quieras con el verificador.",
  },
  {
    q: "¿Qué pasa si se agotan los números?",
    a: "Los números son por orden de compra. Si una rifa se agota, abrimos la siguiente — seguinos para no perderte ninguna.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mx-auto max-w-2xl divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      {FAQ_ITEMS.map((item, i) => (
        <div key={i}>
          <button
            onClick={() => setOpen((o) => (o === i ? null : i))}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <span className="font-medium text-white">{item.q}</span>
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open === i ? "rotate-180" : ""}`}
            />
          </button>
          {open === i && <p className="px-5 pb-4 text-sm leading-relaxed text-slate-300">{item.a}</p>}
        </div>
      ))}
    </div>
  );
}

export function TrustBadges() {
  const badges = [
    { icon: ShieldCheck, label: "Sorteos transparentes" },
    { icon: Check, label: "Múltiples métodos de pago" },
    { icon: Check, label: "Confirmación inmediata" },
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {badges.map((b) => (
        <span
          key={b.label}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-slate-200"
        >
          <b.icon className="h-3.5 w-3.5" />
          {b.label}
        </span>
      ))}
    </div>
  );
}

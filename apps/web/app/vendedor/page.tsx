"use client";

import { useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { buildReceiptWaLink } from "@riffas/shared";
import { Loader2, LogOut, Wallet, Receipt, Copy, Link2, Store, ShoppingBag, Plus, DollarSign, MessageCircle } from "lucide-react";

const money = (v: number) =>
  `$${Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_ES: Record<string, string> = {
  PENDING: "Por confirmar",
  RESERVED: "Apartada",
  PAID: "Pagada",
};

// Métodos del negocio (mismos labels que el panel admin).
const METHODS: { value: string; label: string }[] = [
  { value: "PAGO_MOVIL", label: "Pago Móvil" },
  { value: "BINANCE", label: "Binance / USDT" },
  { value: "ZELLE", label: "Zelle" },
  { value: "ZINLI", label: "Zinli" },
  { value: "EFECTIVO_USD", label: "Efectivo USD" },
  { value: "EFECTIVO_VES", label: "Efectivo Bs" },
  { value: "BANCOLOMBIA", label: "Bancolombia" },
];

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleString("es-VE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function VendorPortalPage() {
  const utils = api.useContext();
  const { data: me, isLoading } = api.vendorPortal.me.useQuery();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!me) {
    return <VendorLogin onLoggedIn={() => utils.vendorPortal.me.invalidate()} />;
  }

  return <VendorPanel me={me} onLogout={() => utils.vendorPortal.invalidate()} />;
}

function VendorLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!phone.trim() || !code.trim()) return toast.error("Ingresa teléfono y código");
    try {
      setLoading(true);
      const res = await fetch("/api/vendor/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo entrar");
      toast.success("¡Bienvenido!");
      onLoggedIn();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border bg-white p-6">
        <div className="text-center">
          <Store className="mx-auto h-10 w-10 text-blue-600" />
          <h1 className="mt-2 text-xl font-bold text-slate-900">Mi panel de vendedor</h1>
          <p className="text-sm text-slate-500">Entra con tu teléfono y código de acceso.</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0424 123 4567"
            inputMode="tel"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Código de acceso</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Ej: A1B2C3"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono uppercase text-slate-900"
          />
        </div>
        <button
          onClick={submit}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Entrar"}
        </button>
        <p className="text-center text-xs text-slate-400">¿No tienes código? Pídeselo al organizador.</p>
      </div>
    </div>
  );
}

function VendorPanel({ me, onLogout }: { me: any; onLogout: () => void }) {
  const [tab, setTab] = useState<"vender" | "ventas">("vender");
  const { data: sales } = api.vendorPortal.sales.useQuery();
  const color = me.brand.color || "#3b82f6";
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function logout() {
    await fetch("/api/vendor/logout", { method: "POST" });
    onLogout();
  }

  function copyRef(raffleId: string) {
    const link = `${origin}/r/${raffleId}?ref=${me.vendor.code}`;
    navigator.clipboard?.writeText(link);
    toast.success("Enlace de referido copiado");
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <header className="px-4 py-4 text-white" style={{ background: `linear-gradient(135deg, ${color}, ${me.brand.colorSecondary || color})` }}>
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <div className="flex items-center gap-2">
            {me.brand.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.brand.logo} alt={me.brand.name} className="h-9 w-9 rounded-lg bg-white/90 object-contain p-0.5" />
            )}
            <div>
              <p className="text-xs opacity-90">{me.brand.name}</p>
              <p className="font-bold">
                {me.vendor.name} {me.vendor.lastName || ""}
              </p>
            </div>
          </div>
          <button onClick={logout} className="rounded-lg bg-white/20 p-2 hover:bg-white/30" aria-label="Salir">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-5 px-4 py-5">
        {/* Resumen */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Ventas" value={String(sales?.totals.count ?? 0)} icon={<ShoppingBag className="h-4 w-4" />} />
          <Stat label="Recaudado" value={money(sales?.totals.collected ?? 0)} icon={<Receipt className="h-4 w-4" />} />
          <Stat
            label={`Comisión (${me.vendor.commissionRate}%)`}
            value={money(sales?.totals.commission ?? 0)}
            icon={<Wallet className="h-4 w-4" />}
            highlight
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
          <TabBtn active={tab === "vender"} onClick={() => setTab("vender")} color={color}>Vender</TabBtn>
          <TabBtn active={tab === "ventas"} onClick={() => setTab("ventas")} color={color}>Mis ventas</TabBtn>
        </div>

        {tab === "vender" ? (
          <SellSection me={me} color={color} origin={origin} onCopyRef={copyRef} />
        ) : (
          <MySales sales={sales} color={color} />
        )}
      </main>
    </div>
  );
}

function SellSection({ me, color, origin, onCopyRef }: { me: any; color: string; origin: string; onCopyRef: (id: string) => void }) {
  const utils = api.useContext();
  const raffles: any[] = me.raffles ?? [];
  const [raffleId, setRaffleId] = useState<string>(raffles[0]?.id ?? "");
  const [numbers, setNumbers] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState("PAGO_MOVIL");
  const [abono, setAbono] = useState("");

  // Resultado de la última venta para ofrecer el envío del recibo por wa.me.
  const [lastSale, setLastSale] = useState<{ waLink: string | null; receiptUrl: string | null } | null>(null);

  const live = api.vendorPortal.numbers.useQuery({ raffleId }, { enabled: !!raffleId });
  const register = api.vendorPortal.registerSale.useMutation({
    onSuccess: (r) => {
      toast.success(r.debt > 0 ? `Apartada. Resta ${money(r.debt)}` : "¡Venta registrada y pagada!");
      const waLink = r.contactPhone
        ? buildReceiptWaLink({
            phone: r.contactPhone,
            contactName: r.contactName,
            brandName: me?.brand?.name,
            raffleTitle: r.raffleTitle,
            numbers: r.numbers,
            total: r.finalAmount,
            paid: r.amountPaid,
            receiptUrl: r.receiptUrl,
          })
        : null;
      setLastSale({ waLink, receiptUrl: r.receiptUrl ?? null });
      setNumbers(""); setName(""); setPhone(""); setAbono("");
      utils.vendorPortal.numbers.invalidate();
      utils.vendorPortal.sales.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (raffles.length === 0) {
    return <p className="rounded-xl border border-dashed bg-white px-4 py-8 text-center text-sm text-slate-500">No hay rifas activas ahora mismo.</p>;
  }

  function submit() {
    const nums = numbers.split(/[\s,]+/).map((n) => n.trim()).filter(Boolean);
    if (nums.length === 0) return toast.error("Escribe al menos un número");
    if (name.trim().length < 2) return toast.error("Nombre del cliente requerido");
    if (phone.trim().length < 7) return toast.error("Teléfono del cliente requerido");
    register.mutate({
      raffleId,
      numbers: nums,
      name: name.trim(),
      phone: phone.trim(),
      paymentMethod: method as any,
      amountPaid: abono === "" ? undefined : Number(abono),
    });
  }

  return (
    <div className="space-y-4">
      {/* Selección de rifa + disponibilidad EN VIVO */}
      <section className="rounded-xl border bg-white p-4 space-y-3">
        <label className="block text-xs font-medium text-slate-500">Rifa</label>
        <select value={raffleId} onChange={(e) => setRaffleId(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900">
          {raffles.map((r) => (
            <option key={r.id} value={r.id}>{r.title} — {money(r.pricePerNumber)}/número</option>
          ))}
        </select>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          {live.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : (
            <>
              <span className="text-slate-600">Disponibles en vivo</span>
              <span className="font-bold" style={{ color }}>{live.data?.available ?? 0} / {live.data?.total ?? 0}</span>
            </>
          )}
        </div>
        {/* Enlace de referido (venta online) */}
        <button onClick={() => onCopyRef(raffleId)} className="flex w-full items-center justify-center gap-2 rounded-xl border py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <Link2 className="h-4 w-4" /> Copiar mi enlace de venta
        </button>
      </section>

      {/* Registrar venta directa */}
      <section className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Plus className="h-4 w-4" /> Registrar venta</h2>
        <Field label="Número(s) — separa con comas">
          <input value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="Ej: 045, 102, 333" className={inputCls} />
        </Field>
        <Field label="Nombre del cliente">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" className={inputCls} />
        </Field>
        <Field label="WhatsApp del cliente">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0424 123 4567" inputMode="tel" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Método de pago">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
              {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Abono (opcional)">
            <input value={abono} onChange={(e) => setAbono(e.target.value)} inputMode="decimal" placeholder="Total si vacío" className={inputCls} />
          </Field>
        </div>
        <button onClick={submit} disabled={register.isLoading} className="flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium text-white disabled:opacity-50" style={{ backgroundColor: color }}>
          {register.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Registrar venta"}
        </button>

        {/* Envío del comprobante por WhatsApp (wa.me) tras registrar */}
        {lastSale && (
          <div className="space-y-2 rounded-xl border border-green-200 bg-green-50 p-3">
            <p className="text-sm font-medium text-green-800">Venta registrada. Envíale el recibo al cliente:</p>
            {lastSale.waLink ? (
              <a href={lastSale.waLink} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700">
                <MessageCircle className="h-4 w-4" /> Enviar recibo por WhatsApp
              </a>
            ) : (
              <p className="text-xs text-amber-700">No se pudo armar el WhatsApp (teléfono inválido).</p>
            )}
            {lastSale.receiptUrl && (
              <a href={lastSale.receiptUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 text-xs text-blue-600 hover:underline">
                <Receipt className="h-3.5 w-3.5" /> Ver recibo
              </a>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function MySales({ sales, color }: { sales: any; color: string }) {
  if (!sales) {
    return <div className="flex justify-center py-8 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (sales.items.length === 0) {
    return <p className="rounded-xl border border-dashed bg-white px-4 py-8 text-center text-sm text-slate-500">Aún no tienes ventas.</p>;
  }
  return (
    <ul className="space-y-2">
      {sales.items.map((s: any) => <SaleRow key={s.id} s={s} color={color} />)}
    </ul>
  );
}

function SaleRow({ s, color }: { s: any; color: string }) {
  const utils = api.useContext();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(s.debt || ""));
  const [method, setMethod] = useState("PAGO_MOVIL");

  const pay = api.vendorPortal.addPayment.useMutation({
    onSuccess: (r) => {
      toast.success(r.isFullyPaid ? "¡Saldada!" : `Abono registrado. Resta ${money(r.debt)}`);
      setOpen(false);
      utils.vendorPortal.sales.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <li className="rounded-xl border bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{s.contactName}</p>
          <p className="truncate text-xs text-slate-500">{s.raffleTitle} · {fmtDate(s.createdAt)}</p>
          <p className="mt-0.5 font-mono text-xs text-slate-600">{s.numbers.join(", ")}</p>
        </div>
        <div className="shrink-0 text-right">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{STATUS_ES[s.status] ?? s.status}</span>
          {s.debt > 0 && <p className="mt-1 text-xs font-medium text-amber-600">Resta {money(s.debt)}</p>}
          <p className="mt-0.5 text-sm font-semibold text-green-600">+{money(s.commission)}</p>
        </div>
      </div>
      {s.debt > 0 && (
        <div className="mt-2 border-t pt-2">
          {open ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Monto" className={inputCls} />
                <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="flex-1 rounded-xl border py-2 text-sm text-slate-600">Cancelar</button>
                <button
                  onClick={() => { const a = Number(amount); if (!a || a <= 0) return toast.error("Monto inválido"); pay.mutate({ saleId: s.id, amount: a, paymentMethod: method as any }); }}
                  disabled={pay.isLoading}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: color }}
                >
                  {pay.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cobrar"}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-1 rounded-xl bg-green-50 py-2 text-sm font-medium text-green-700 hover:bg-green-100">
              <DollarSign className="h-4 w-4" /> Cobrar abono
            </button>
          )}
        </div>
      )}
    </li>
  );
}

const inputCls = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}

function TabBtn({ active, onClick, color, children }: { active: boolean; onClick: () => void; color: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${active ? "bg-white shadow text-slate-900" : "text-slate-500"}`}
      style={active ? { color } : undefined}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, icon, highlight }: { label: string; value: string; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${highlight ? "bg-green-50 border-green-200" : "bg-white"}`}>
      <div className="mx-auto mb-1 flex w-fit items-center gap-1 text-slate-400">{icon}</div>
      <p className={`text-base font-bold ${highlight ? "text-green-700" : "text-slate-900"}`}>{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

"use client";

// Piezas CLIENTE de la landing de marca /d/[host] (la página es server component).
// Efectos portados 1:1 de rifas-hp/assets/js/effects.js a React, respetando
// prefers-reduced-motion:
//   - MoneyRain: lluvia de billetes/monedas en canvas (#money-rain).
//   - JackpotStats: contadores animados (countUp) al entrar en viewport.
//   - RevealInit: fade/slide de [data-reveal] al hacer scroll.
// Más los widgets interactivos: PaymentAccounts (copiar datos), VerifyWidget
// (public.verify) y WhatsAppFloat (selector de contactos).

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";

const prefersReduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ───────────────────── BannerImage (foto del premio + tap para ampliar) ─────
   La card recorta el flyer (object-fit: cover, foco en el premio); al tocar se
   abre el flyer COMPLETO en un lightbox (object-fit: contain). Mobile-first. */
export function BannerImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={className} loading="lazy" style={{ cursor: "zoom-in" }} onClick={() => setOpen(true)} />
      {open && (
        <div className="sf-flyer" role="dialog" aria-modal="true" aria-label={`Flyer ${alt}`} onClick={() => setOpen(false)}>
          <button className="sf-flyer-x" aria-label="Cerrar" onClick={() => setOpen(false)}>✕</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

/* ───────────────────── MoneyRain (canvas) ───────────────────── */
export function MoneyRain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || prefersReduced()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0, h = 0, raf = 0;
    let parts: any[] = [];

    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.clientWidth; h = canvas!.clientHeight;
      canvas!.width = w * dpr; canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    window.addEventListener("resize", size);

    const COUNT = Math.min(46, Math.round(w / 26));
    const mk = (y?: number) => {
      const coin = Math.random() > 0.5;
      return {
        x: Math.random() * w, y: y ?? -Math.random() * h,
        r: coin ? 9 + Math.random() * 9 : 14 + Math.random() * 12,
        coin, vy: 0.5 + Math.random() * 1.4, vx: -0.4 + Math.random() * 0.8,
        rot: Math.random() * Math.PI, vr: -0.04 + Math.random() * 0.08,
        sway: Math.random() * Math.PI * 2, alpha: 0.35 + Math.random() * 0.5,
      };
    };
    for (let i = 0; i < COUNT; i++) parts.push(mk());

    const roundRect = (c: CanvasRenderingContext2D, x: number, y: number, ww: number, hh: number, r: number) => {
      c.beginPath(); c.moveTo(x + r, y);
      c.arcTo(x + ww, y, x + ww, y + hh, r); c.arcTo(x + ww, y + hh, x, y + hh, r);
      c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + ww, y, r); c.closePath();
    };
    const drawCoin = (p: any) => {
      ctx!.save(); ctx!.translate(p.x, p.y); ctx!.rotate(p.rot);
      ctx!.scale(Math.cos(p.sway) * 0.6 + 0.4, 1);
      const g = ctx!.createRadialGradient(-p.r * 0.3, -p.r * 0.3, 1, 0, 0, p.r);
      g.addColorStop(0, "#FFE9A8"); g.addColorStop(.55, "#F7B733"); g.addColorStop(1, "#B97E00");
      ctx!.globalAlpha = p.alpha;
      ctx!.beginPath(); ctx!.arc(0, 0, p.r, 0, Math.PI * 2); ctx!.fillStyle = g; ctx!.fill();
      ctx!.lineWidth = 1.5; ctx!.strokeStyle = "rgba(255,240,200,.7)"; ctx!.stroke();
      ctx!.fillStyle = "#8a5e00"; ctx!.font = `bold ${p.r}px Outfit, sans-serif`;
      ctx!.textAlign = "center"; ctx!.textBaseline = "middle"; ctx!.fillText("$", 0, 1);
      ctx!.restore();
    };
    const drawBill = (p: any) => {
      ctx!.save(); ctx!.translate(p.x, p.y); ctx!.rotate(p.rot);
      ctx!.scale(1, Math.cos(p.sway) * 0.5 + 0.5);
      ctx!.globalAlpha = p.alpha;
      const bw = p.r * 2.1, bh = p.r * 1.05;
      const g = ctx!.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      g.addColorStop(0, "#1f8a4c"); g.addColorStop(.5, "#36c172"); g.addColorStop(1, "#1f8a4c");
      ctx!.fillStyle = g; roundRect(ctx!, -bw / 2, -bh / 2, bw, bh, 3); ctx!.fill();
      ctx!.strokeStyle = "rgba(220,255,230,.6)"; ctx!.lineWidth = 1; ctx!.stroke();
      ctx!.beginPath(); ctx!.arc(0, 0, bh * 0.32, 0, Math.PI * 2);
      ctx!.strokeStyle = "rgba(230,255,235,.7)"; ctx!.stroke();
      ctx!.fillStyle = "rgba(230,255,235,.85)"; ctx!.font = `bold ${bh * 0.5}px Outfit`;
      ctx!.textAlign = "center"; ctx!.textBaseline = "middle"; ctx!.fillText("$", 0, 1);
      ctx!.restore();
    };
    const tick = () => {
      ctx!.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.y += p.vy; p.sway += 0.05; p.rot += p.vr; p.x += p.vx + Math.sin(p.sway) * 0.5;
        if (p.y - p.r > h) { Object.assign(p, mk(-20)); p.x = Math.random() * w; }
        p.coin ? drawCoin(p) : drawBill(p);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, []);
  return <canvas id="money-rain" ref={ref} aria-hidden />;
}

/* ───────────────────── JackpotStats (countUp) ───────────────────── */
type Stat = { value: number; prefix?: string; suffix?: string; label: string };
export function JackpotStats({ stats }: { stats: Stat[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = prefersReduced();
    const fmt = (n: number) => n.toLocaleString("es-VE");
    const nums = Array.from(root.querySelectorAll<HTMLElement>(".n"));
    nums.forEach((el, i) => {
      const st = stats[i];
      if (!st) return;
      const run = () => {
        if (reduce) { el.textContent = (st.prefix ?? "") + fmt(st.value) + (st.suffix ?? ""); return; }
        const dur = 1800, start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / dur);
          const e = 1 - Math.pow(1 - t, 3);
          el.textContent = (st.prefix ?? "") + fmt(Math.round(st.value * e)) + (st.suffix ?? "");
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
      if (reduce || !("IntersectionObserver" in window)) { run(); return; }
      const io = new IntersectionObserver((ents, o) => {
        if (ents[0].isIntersecting) { run(); o.disconnect(); }
      }, { threshold: 0.4 });
      io.observe(el);
    });
  }, [stats]);

  return (
    <div className="jackpot" ref={ref}>
      {stats.map((s, i) => (
        <div className="jp" key={i}>
          <div className="n">0</div>
          <div className="l">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────── RevealInit (scroll) ───────────────────── */
export function RevealInit() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".sf [data-reveal]"));
    if (prefersReduced() || !("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return null;
}

/* ───────────────────── Payment accounts (copiar) ───────────────────── */
const METHOD_LABEL: Record<string, string> = {
  PAGO_MOVIL: "Pago Móvil", BINANCE: "Binance / USDT", ZELLE: "Zelle", ZINLI: "Zinli",
  EFECTIVO_USD: "Efectivo USD", EFECTIVO_VES: "Efectivo Bs", TRANSFERENCIA_VES: "Transferencia Bs",
  BANCOLOMBIA: "Bancolombia", STRIPE: "Stripe", WOMPI: "Wompi", CASH: "Efectivo",
};
const METHOD_ICON: Record<string, string> = {
  PAGO_MOVIL: "📲", BINANCE: "🪙", ZELLE: "💵", ZINLI: "💳", BANCOLOMBIA: "🏦",
  EFECTIVO_USD: "💵", EFECTIVO_VES: "💵", TRANSFERENCIA_VES: "🏦", STRIPE: "💳", WOMPI: "💳", CASH: "💵",
};
const FIELD_LABEL: Record<string, string> = {
  bankName: "Banco", phone: "Teléfono", idDocument: "Cédula/RIF", email: "Correo",
  wallet: "Wallet/Correo", holderName: "Titular", accountNumber: "N° de cuenta",
};
type PaymentAccount = {
  method: string; bankName: string | null; phone: string | null; idDocument: string | null;
  email: string | null; wallet: string | null; holderName: string | null;
  accountNumber: string | null; note: string | null;
};
const FIELD_ORDER: (keyof PaymentAccount)[] = ["bankName", "phone", "idDocument", "email", "wallet", "holderName", "accountNumber"];

export function PaymentAccountsSection({ accounts }: { accounts: PaymentAccount[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!accounts?.length) {
    return <p className="lead center">El organizador aún no cargó sus cuentas de pago.</p>;
  }
  const copy = (a: PaymentAccount) => {
    const lines = FIELD_ORDER.filter((f) => a[f]).map((f) => `${FIELD_LABEL[f as string]}: ${a[f]}`);
    const text = `${METHOD_LABEL[a.method] ?? a.method}\n${lines.join("\n")}`;
    navigator.clipboard.writeText(text).then(
      () => { setCopied(a.method); toast.success("Datos copiados"); setTimeout(() => setCopied((c) => (c === a.method ? null : c)), 2000); },
      () => toast.error("No se pudo copiar")
    );
  };
  return (
    <div className="pay-grid">
      {accounts.map((a) => {
        const fields = FIELD_ORDER.filter((f) => a[f]);
        return (
          <div className="pay" key={a.method}>
            <div className="pay-top">
              <div className="ic">{METHOD_ICON[a.method] ?? "💳"}</div>
              <h4>{METHOD_LABEL[a.method] ?? a.method}</h4>
            </div>
            {fields.map((f) => (
              <div className="row" key={f as string}>
                <span className="k">{FIELD_LABEL[f as string]}</span>
                <span className="v">{a[f]}</span>
              </div>
            ))}
            {a.note && <div className="pay-note"><span>⚠️ {a.note}</span></div>}
            <button className="copy-btn" onClick={() => copy(a)}>
              {copied === a.method ? "✓ Copiado" : "📋 Copiar datos"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────── Verify widget (public.verify) ───────────────────── */
type RaffleOpt = { id: string; title: string };
export function VerifyWidget({ raffles }: { raffles: RaffleOpt[] }) {
  const utils = api.useContext();
  const [raffleId, setRaffleId] = useState(raffles[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const money = (v: number) => `$${Number(v ?? 0).toFixed(2)}`;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) return toast.error("Escribe tu teléfono o número de boleto");
    if (!raffleId) return toast.error("Elegí una rifa");
    setLoading(true);
    try { setResult(await utils.public.verify.fetch({ raffleId, query: q })); }
    catch { toast.error("No se pudo verificar"); setResult(null); }
    finally { setLoading(false); }
  };

  if (!raffles.length) return <p className="lead center">No hay rifas activas para verificar ahora.</p>;

  return (
    <div className="verify">
      <div className="box">
        <form className="verify-form" onSubmit={submit}>
          {raffles.length > 1 && (
            <select className="input" value={raffleId} onChange={(e) => setRaffleId(e.target.value)} style={{ flexBasis: "100%" }}>
              {raffles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          )}
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Tu teléfono o número de boleto" inputMode="tel" />
          <button className="btn btn-gold" type="submit" disabled={loading}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
        </form>
        {result && (
          <div style={{ marginTop: 18, textAlign: "left" }}>
            {result.found ? (
              <>
                <p className="lead" style={{ margin: "0 0 12px" }}>
                  Titular: <b style={{ color: "var(--gold-2)" }}>{result.holder}</b> · {result.totals.numbers} número(s) · Abonado {money(result.totals.abonado)} · Deuda {money(result.totals.deuda)}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {result.items.map((it: any) => (
                    <span key={it.number} style={{ background: "rgba(255,255,255,.08)", borderRadius: 8, padding: "5px 10px", fontSize: ".82rem" }}>
                      {it.number} · {it.estado}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="lead center" style={{ margin: 0 }}>No encontramos boletos con ese dato. Verificá el teléfono o número.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── WhatsApp float ───────────────────── */
type Contact = { name: string; phone: string };
const WA_SVG = (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="#fff" aria-hidden>
    <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.985zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
  </svg>
);

/* ───────────────────── Countdown (al sorteo) ───────────────────── */
function pad(n: number) { return String(n).padStart(2, "0"); }
export function Countdown({ target }: { target: string | Date }) {
  const tgt = useMemo(() => new Date(target).getTime(), [target]);
  // now=null en SSR/primer render → evita mismatch de hidratación (el reloj
  // arranca en el cliente).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) {
    return <div className="countdown" suppressHydrationWarning aria-hidden />;
  }
  const diff = tgt - now;
  if (diff <= 0) return <div className="countdown done">🔴 ¡Sorteo en curso!</div>;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000) % 24;
  const m = Math.floor(diff / 60000) % 60;
  const s = Math.floor(diff / 1000) % 60;
  const Unit = ({ n, l }: { n: number; l: string }) => (
    <div className="cd-u"><span className="cd-n">{pad(n)}</span><span className="cd-l">{l}</span></div>
  );
  return (
    <div className="countdown" aria-label="Tiempo restante para el sorteo">
      <Unit n={d} l="días" /><span className="cd-sep">:</span>
      <Unit n={h} l="hrs" /><span className="cd-sep">:</span>
      <Unit n={m} l="min" /><span className="cd-sep">:</span>
      <Unit n={s} l="seg" />
    </div>
  );
}

/* ───────────────────── Exit-intent popup (mobile-first) ─────────────────────
   Aversión a la pérdida, una vez por sesión, fácil de cerrar. Triggers pensados
   para CELULAR (la mayoría compra desde el teléfono), no solo mouseleave:
     - scroll-up RÁPIDO cerca del tope (gesto de "me voy"),
     - inactividad (sin scroll/touch) tras haber bajado algo,
     - mouseleave por arriba (desktop). */
export function ExitIntentPopup({
  raffleId, remaining, prizeShort, drawLabel, whatsapp,
}: {
  raffleId: string; remaining: number; prizeShort: string; drawLabel: string; whatsapp?: string | null;
}) {
  const [show, setShow] = useState(false);
  const fired = useRef(false);

  // QA/demo: ?exitpreview=1 fuerza el popup (para previsualizarlo sin esperar el
  // gesto de salida). No marca la sesión, así se puede repetir.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).has("exitpreview")) setShow(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { if (sessionStorage.getItem("sf_exit_shown")) return; } catch {}
    let lastY = window.scrollY, lastT = Date.now();
    let idle: ReturnType<typeof setTimeout> | undefined;

    const fire = () => {
      if (fired.current) return;
      fired.current = true;
      try { sessionStorage.setItem("sf_exit_shown", "1"); } catch {}
      setShow(true);
      cleanup();
    };
    const onMouseOut = (e: MouseEvent) => { if (!e.relatedTarget && e.clientY <= 0) fire(); };
    const onScroll = () => {
      const y = window.scrollY, t = Date.now();
      const v = (y - lastY) / Math.max(1, t - lastT); // px/ms; <0 = subiendo
      const atBottom = window.innerHeight + y >= document.body.scrollHeight - 4;
      // scroll-up rápido cerca del tope, habiendo bajado antes (no al cargar).
      if (v < -1.1 && y < 500 && lastY > 300 && !atBottom) fire();
      lastY = y; lastT = t;
      resetIdle();
    };
    const resetIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => { if (window.scrollY > 250) fire(); }, 25000);
    };

    document.addEventListener("mouseout", onMouseOut);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchmove", resetIdle, { passive: true });
    resetIdle();
    function cleanup() {
      document.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchmove", resetIdle);
      if (idle) clearTimeout(idle);
    }
    return cleanup;
  }, []);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShow(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show]);

  if (!show) return null;
  const wa = whatsapp
    ? `https://wa.me/${whatsapp.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
        "Quiero apartar números antes de que se agoten 🎟️"
      )}`
    : null;

  return (
    <div className="sf-exit" role="dialog" aria-modal="true" aria-label="Oferta">
      <div className="sf-exit-bg" onClick={() => setShow(false)} />
      <div className="sf-exit-card" data-reveal-static>
        <button className="sf-exit-x" onClick={() => setShow(false)} aria-label="Cerrar">✕</button>
        <div className="sf-exit-emoji">🎁</div>
        <h3 className="sf-exit-h">¡Espera!</h3>
        <p className="sf-exit-p">
          El <b>{prizeShort}</b> puede ser tuyo.{" "}
          {remaining > 0 && <>Solo quedan <b>{remaining}</b> números</>}
          {drawLabel && <>, sorteo el <b>{drawLabel}</b></>}. No dejes pasar tu oportunidad.
        </p>
        <a className="btn btn-gold btn-lg sf-exit-cta" href={`/r/${raffleId}`} onClick={() => setShow(false)}>
          🎟️ Apartar mis números ahora
        </a>
        {wa && (
          <a className="sf-exit-wa" href={wa} target="_blank" rel="noopener noreferrer">
            💬 Escríbenos por WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}

export function WhatsAppFloat({ contacts, text }: { contacts: Contact[]; text?: string }) {
  const [open, setOpen] = useState(false);
  if (!contacts?.length) return null;
  const msg = encodeURIComponent(text || "Hola, quiero participar en una rifa 🎟️");
  return (
    <div className="sf-wa-wrap">
      {open && (
        <div className="sf-wa-menu">
          <div className="sf-wa-menu-head">Escríbenos por WhatsApp</div>
          {contacts.map((c) => (
            <a key={c.phone} className="sf-wa-contact" href={`https://wa.me/${c.phone}?text=${msg}`} target="_blank" rel="noopener noreferrer">
              <span className="wa-ic">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" aria-hidden><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24z"/></svg>
              </span>
              <span className="wa-info"><b>{c.name}</b><small>{c.phone}</small></span>
            </a>
          ))}
        </div>
      )}
      <button className="sf-wa-float" onClick={() => setOpen((o) => !o)} aria-label="WhatsApp">
        {WA_SVG}
      </button>
    </div>
  );
}

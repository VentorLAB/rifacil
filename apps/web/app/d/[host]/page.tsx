// Landing de marca del rifero, servida en SU dominio propio (rifashermanospernia.com).
// El middleware reescribe "/" → /d/<host>. Server component: resuelve el rifero por
// customDomain y arma la landing 1:1 del diseño rifas-hp (data-driven, reusable).
// SIN redirect: siempre muestra la landing. Listado = SOLO rifas ACTIVE.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicCaller } from "@/lib/server-trpc";
import {
  MoneyRain,
  JackpotStats,
  RevealInit,
  PaymentAccountsSection,
  VerifyWidget,
  WhatsAppFloat,
  Countdown,
  ExitIntentPopup,
} from "@/components/storefront-client";
import { storefrontFontVars } from "./fonts";
import "./storefront.css";

export const dynamic = "force-dynamic";

// Audiencia VE: formatear SIEMPRE en hora de Caracas (UTC-4), independiente del
// TZ del servidor (Vercel corre en UTC; sin esto el sorteo se vería un día corrido).
const VE_TZ = "America/Caracas";
const money = (v: number, c = "$") =>
  `${c}${Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtDate = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("es-VE", { timeZone: VE_TZ, day: "2-digit", month: "short", year: "numeric" }) : "";
const fmtDateShort = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("es-VE", { timeZone: VE_TZ, day: "2-digit", month: "short" }) : "";

// Packs como AHORRO. discountPackages = [{qty, discountPercent}]; se calcula el
// precio total del pack y cuánto ahorra vs comprar suelto. qty 1 = base.
function computePacks(dp: unknown, price: number) {
  const base = { qty: 1, price, save: 0 };
  const extra = (Array.isArray(dp) ? dp : [])
    .map((p: any) => {
      const qty = Number(p?.qty) || 0;
      const pct = Number(p?.discountPercent) || 0;
      const full = qty * price;
      const packPrice = Math.round(full * (1 - pct / 100));
      return { qty, price: packPrice, save: Math.round(full - packPrice) };
    })
    .filter((p) => p.qty > 1 && p.save > 0);
  return [base, ...extra];
}

// Nombre corto del premio principal (para el CTA "Quiero ganar el …").
function shortPrize(prizes: { titulo: string }[], fallback: string) {
  const t = prizes?.[0]?.titulo || fallback || "";
  return t.split(/ \+ | \(/)[0].trim();
}

const DEFAULT_FAQS = [
  { q: "¿Cómo participo en una rifa?", a: "Entrá a la rifa que quieras, elegí tus números, completá tus datos, pagá por el método que prefieras y subí tu comprobante. Confirmamos tu boleto por WhatsApp." },
  { q: "¿Cómo sé que mis números quedaron reservados?", a: "Apenas confirmás, recibís tu comprobante por WhatsApp. También podés consultarlos en el verificador con tu teléfono o número de boleto." },
  { q: "¿Cuándo y cómo se realiza el sorteo?", a: "El sorteo se transmite EN VIVO por nuestras redes en la fecha indicada de cada rifa. Jugamos con la lotería para total transparencia." },
  { q: "¿Cómo recibo mi premio si gano?", a: "Te contactamos de inmediato por WhatsApp para coordinar la entrega. Los premios en efectivo se pagan por el método que prefieras." },
];

export async function generateMetadata({ params }: { params: { host: string } }) {
  const host = decodeURIComponent(params.host);
  try {
    const data = await getPublicCaller().public.getStorefrontByDomain({ host });
    return {
      title: data.brand.name,
      description: `${data.brand.name} — Premios reales, sorteos en vivo. Elegí tus números y participá.`,
    };
  } catch {
    return { title: "Tienda" };
  }
}

export default async function BrandLanding({ params }: { params: { host: string } }) {
  const host = decodeURIComponent(params.host);

  let data: Awaited<ReturnType<ReturnType<typeof getPublicCaller>["public"]["getStorefrontByDomain"]>>;
  try {
    data = await getPublicCaller().public.getStorefrontByDomain({ host });
  } catch {
    notFound();
  }

  const { brand, config, raffles, winners, paymentAccounts } = data;
  const tagline = config?.tagline || "Grandes Rifas";
  const stats = config?.stats ?? [];
  const faqs = config?.faqs?.length ? config.faqs : DEFAULT_FAQS;
  const contacts = config?.contacts ?? [];
  const instagram = config?.instagram || null;
  const instagramHandle = config?.instagramHandle || null;
  const testimonials = config?.testimonials ?? [];
  // Rifa principal (la más vendida) para el popup de salida.
  const featured = [...raffles].sort((a, b) => b.soldPct - a.soldPct)[0];

  return (
    <div className={`sf ${storefrontFontVars}`}>
      {/* ───────── HERO ───────── */}
      <section className="hero">
        <MoneyRain />
        <div className="hero-glow" />
        <div className="wrap">
          <div className="hero-inner">
            <div className="hero-copy">
              <span className="kicker">🏆 Premios reales · Sorteos en vivo</span>
              <span className="eyebrow">{tagline}</span>
              {/* Con logo (logotipo completo) NO repetimos el nombre como h1. */}
              {!brand.logo && <h1 className="h-xl">{brand.name}</h1>}
              <p className="lead">
                Carros, motos y efectivo que cambian vidas. Elegí tus números, pagá seguro y participá.{" "}
                <b style={{ color: "var(--text)" }}>Nuestros premios juegan hasta que haya ganador.</b>
              </p>
              <div className="hero-cta">
                <a className="btn btn-gold btn-lg" href="#rifas">🎟️ Ver rifas disponibles</a>
                <a className="btn btn-ghost btn-lg" href="#participar">¿Cómo participar?</a>
              </div>
              <div className="trust">
                <span className="t"><span className="dot" /> Sorteos transparentes</span>
                <span className="t">💳 <b>Múltiples</b> métodos de pago</span>
                <span className="t">⚡ Confirmación inmediata</span>
              </div>
              {stats.length > 0 && <JackpotStats stats={stats} />}
            </div>
            <div className="hero-logo">
              {brand.logo ? (
                <div className="ring">
                  <div className="disc">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={brand.logo} alt={brand.name} />
                  </div>
                </div>
              ) : (
                <div className="ring"><div className="disc" style={{ fontSize: "3rem" }}>🎟️</div></div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ───────── RIFAS ───────── */}
      <section className="section" id="rifas">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">🎯 En juego ahora</span>
            <h2 className="h-lg">Rifas <span className="gold-text">disponibles</span></h2>
            <p className="lead">Elegí tu rifa, apartá tus números antes de que se agoten y preparate para ganar.</p>
          </div>
          {raffles.length === 0 ? (
            <p className="lead center">No hay rifas activas en este momento. ¡Volvé pronto!</p>
          ) : (
            <div className="grid-rifas">
              {raffles.map((r) => {
                const pct = Math.min(100, Math.round(r.soldPct));
                const remaining = r.available;
                const almostGone = pct >= 80;
                const img = r.bannerUrl || r.bannerMobileUrl || r.iconUrl;
                const packs = computePacks(r.discountPackages, r.pricePerNumber);
                const sp = shortPrize(r.prizes, r.prize);
                const isObject = !/^\$/.test(sp); // premio "objeto" (carro/moto) vs efectivo
                const ctaText = isObject ? `Quiero ganar el ${sp}` : "Apartá tus números";
                return (
                  <article className="rifa-card" data-reveal key={r.id}>
                    <div className="rifa-media">
                      {almostGone && <span className="rifa-badge hot">🔥 Casi agotada</span>}
                      <span className="rifa-price">{money(r.pricePerNumber)} <small>x número</small></span>
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={r.title} />
                      ) : (
                        <div className="ph">🎁</div>
                      )}
                    </div>
                    <div className="rifa-body">
                      <h3>{r.title}</h3>
                      {r.prize && <p className="rifa-prize">{r.prize}</p>}

                      {r.drawDate && (
                        <div className="rifa-count">
                          <span className="rifa-count-l">⏳ Sorteo en</span>
                          <Countdown target={r.drawDate as unknown as string} />
                        </div>
                      )}

                      {/* Escasez REAL: quedan N + barra casi llena */}
                      <div className="scarcity">
                        <div className="scarcity-row">
                          <span className={`remaining ${almostGone ? "hot" : ""}`}>🔥 ¡Solo quedan {remaining}!</span>
                          <span className="scarcity-pct">{pct}% vendido</span>
                        </div>
                        <div className="progress"><i style={{ width: `${pct}%` }} /></div>
                      </div>

                      {/* Packs como ahorro */}
                      {packs.length > 1 && (
                        <div className="packs">
                          {packs.map((p) => (
                            <div className={`pack ${p.save > 0 ? "save" : ""}`} key={p.qty}>
                              <span className="pack-q">{p.qty} {p.qty === 1 ? "número" : "números"}</span>
                              <span className="pack-p">{money(p.price)}</span>
                              {p.save > 0 ? <span className="pack-s">ahorrás {money(p.save)}</span> : <span className="pack-s base">precio normal</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Badges de confianza */}
                      <div className="rifa-badges">
                        <span className="tb">🏆 Juega hasta que haya ganador</span>
                        <span className="tb">🔴 EN VIVO por Instagram{r.loteria ? ` · ${r.loteria}` : ""}</span>
                      </div>

                      <Link className="btn btn-gold btn-block btn-lg" href={`/r/${r.id}`}>🎟️ {ctaText}</Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ───────── GANADORES / SORTEOS CUMPLIDOS ───────── */}
      {winners.length > 0 && (
        <section className="section" id="ganadores" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">🏆 Sorteos cumplidos</span>
              <h2 className="h-lg">Nuestros <span className="gold-text">ganadores</span></h2>
              <p className="lead">Premios entregados de verdad. El próximo podés ser vos.</p>
            </div>
            <div className="grid-winners">
              {winners.map((w) => {
                const img = w.winnerPhotoUrl || w.bannerUrl || w.iconUrl;
                return (
                  <article className="winner-card" data-reveal key={w.id}>
                    <div className="winner-media">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={w.title} />
                      ) : (
                        <div className="ph">🏆</div>
                      )}
                      <span className="winner-tag">✓ Entregado</span>
                    </div>
                    <div className="winner-body">
                      <h3>{w.title}</h3>
                      <p className="winner-prize">{w.prize}</p>
                      <div className="winner-meta">
                        <span>🗓️ {fmtDate(w.drawDate)}</span>
                        {w.winnerNumber && <span>· N° {w.winnerNumber}</span>}
                      </div>
                      <div className="winner-who">
                        {w.winnerName ? (
                          <b>🎉 {w.winnerName}</b>
                        ) : (
                          <span className="winner-soon">🎉 Ganador anunciado en nuestro Instagram</span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ───────── PARTICIPAR ───────── */}
      <section className="section" id="participar" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">🪙 Súper fácil</span>
            <h2 className="h-lg">Participar en <span className="gold-text">3 pasos</span></h2>
          </div>
          <div className="steps">
            <div className="step" data-reveal><h3>Elegí tus números</h3><p>Entrá a la rifa, escogé tus boletos a mano o al azar. Mientras más lleves, menos pagás por cada uno.</p></div>
            <div className="step" data-reveal><h3>Pagá y subí tu comprobante</h3><p>Pago Móvil, Binance, Zelle, Zinli, Bancolombia o efectivo. Subí la captura o envíala por WhatsApp.</p></div>
            <div className="step" data-reveal><h3>Confirmamos y jugás</h3><p>Recibís tu comprobante al instante por WhatsApp. El sorteo se transmite en vivo. ¡Mucha suerte!</p></div>
          </div>
        </div>
      </section>

      {/* ───────── PAGOS ───────── */}
      <section className="section" id="pagos" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">💳 Paga seguro</span>
            <h2 className="h-lg">Cuentas de <span className="gold-text">pago</span></h2>
            <p className="lead">Elegí el método que más te convenga. Tocá “Copiar datos” para no equivocarte.</p>
          </div>
          <PaymentAccountsSection accounts={paymentAccounts} />
        </div>
      </section>

      {/* ───────── VERIFICADOR ───────── */}
      <section className="section" id="verificador" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">🔎 Tranquilidad total</span>
            <h2 className="h-lg">Verificá tus <span className="gold-text">boletos</span></h2>
            <p className="lead">Consultá tus números con tu teléfono o número de boleto.</p>
          </div>
          <VerifyWidget raffles={raffles.map((r) => ({ id: r.id, title: r.title }))} />
        </div>
      </section>

      {/* ───────── TESTIMONIOS (estructura lista; se llena vía storefrontConfig.testimonials) ───────── */}
      {testimonials.length > 0 && (
        <section className="section" id="testimonios" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">💬 Lo que dicen</span>
              <h2 className="h-lg">Testimonios de <span className="gold-text">ganadores</span></h2>
            </div>
            <div className="grid-testi">
              {testimonials.map((t, i) => (
                <figure className="testi" data-reveal key={i}>
                  <blockquote>“{t.text}”</blockquote>
                  <figcaption>
                    {t.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.photoUrl} alt={t.name} />
                    ) : (
                      <span className="testi-ava">🧑</span>
                    )}
                    <span className="testi-who"><b>{t.name}</b>{t.detail && <small>{t.detail}</small>}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───────── FAQ ───────── */}
      <section className="section" id="faq" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">❓ Dudas frecuentes</span>
            <h2 className="h-lg">Preguntas <span className="gold-text">frecuentes</span></h2>
          </div>
          <div className="faq">
            {faqs.map((f, i) => (
              <details key={i} open={i === 0}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── FOOTER ───────── */}
      <footer className="site-footer">
        <div className="wrap">
          <div className="foot-grid">
            <div className="foot-brand">
              {brand.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo} alt={brand.name} />
              ) : (
                <h3 className="h-lg">{brand.name}</h3>
              )}
              <p className="lead">Premios reales, sorteos transparentes en vivo. {config?.organizer ? `Organiza: ${config.organizer}.` : ""}</p>
              {(instagram || contacts.length > 0) && (
                <div className="socials">
                  {instagram && (
                    <a href={instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
                    </a>
                  )}
                  {contacts[0] && (
                    <a href={`https://wa.me/${contacts[0].phone}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24z"/></svg>
                    </a>
                  )}
                </div>
              )}
            </div>
            <div className="foot-col">
              <h5>Enlaces</h5>
              <a href="#rifas">Rifas disponibles</a>
              <a href="#participar">Cómo participar</a>
              <a href="#pagos">Cuentas de pago</a>
              <a href="#verificador">Verificar boletos</a>
            </div>
            <div className="foot-col">
              <h5>Contacto</h5>
              {instagramHandle && <p>{instagramHandle}</p>}
              {config?.email && <p>{config.email}</p>}
              {config?.location && <p>{config.location}</p>}
              {config?.nit && <p>NIT: {config.nit}</p>}
            </div>
          </div>
          <div className="foot-bottom">
            <span>© {brand.name}</span>
            <span>Sistema de rifas · Rifácil</span>
          </div>
        </div>
      </footer>

      <WhatsAppFloat contacts={contacts} text={config?.whatsappText} />
      {featured && (
        <ExitIntentPopup
          raffleId={featured.id}
          remaining={featured.available}
          prizeShort={shortPrize(featured.prizes, featured.prize)}
          drawLabel={fmtDateShort(featured.drawDate)}
          whatsapp={config?.whatsapp ?? contacts[0]?.phone ?? null}
        />
      )}
      <RevealInit />
    </div>
  );
}

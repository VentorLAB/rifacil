"use client";

// Acciones de envío del comprobante — UN solo componente para panel, detalle de
// venta y portal del vendedor, para que el recibo llegue IGUAL de bonito desde
// cualquier flujo:
//   1. WhatsApp (wa.me): mensaje listo + enlace a /c/[saleId]. WhatsApp muestra
//      el recibo como preview de imagen en el chat (no un link de descarga).
//   2. "Enviar la imagen": Web Share API con el PNG real (si el dispositivo lo
//      soporta) → el recibo llega como FOTO dentro del chat. El PNG se precarga
//      vía /api/receipt/[id] (same-origin) para compartir al instante y no
//      perder el gesto del usuario en iOS.
//   3. Ver recibo: abre la página pública /c/[saleId].
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { buildReceiptWaLink, buildReceiptMessage } from "@riffas/shared";
import { MessageCircle, Receipt, Loader2 } from "lucide-react";

export interface SendReceiptActionsProps {
  saleId: string;
  phone?: string | null;
  contactName?: string | null;
  brandName?: string | null;
  raffleTitle: string;
  numbers: string[];
  total: unknown;
  paid?: unknown;
  /** Sale.status: "PAGADO" en el mensaje solo se afirma con "PAID". */
  status?: string | null;
  receiptUrl?: string | null;
  /** Dominio propio del rifero (CTA "mira todas nuestras rifas" en el wa.me). */
  brandUrl?: string | null;
  /** Versión reducida (portal del vendedor). */
  compact?: boolean;
}

export function SendReceiptActions({
  saleId,
  phone,
  contactName,
  brandName,
  raffleTitle,
  numbers,
  total,
  paid,
  status,
  receiptUrl,
  brandUrl,
  compact = false,
}: SendReceiptActionsProps) {
  // Origen leído tras montar (nunca en render: evita mismatch de hidratación
  // si el sheet llegara a renderizarse en servidor).
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  // La página /c/ solo existe si hay recibo generado.
  const pageUrl = useMemo(() => {
    if (!receiptUrl || !origin) return null;
    return `${origin}/c/${saleId}`;
  }, [receiptUrl, origin, saleId]);

  const waLink = useMemo(
    () =>
      phone
        ? buildReceiptWaLink({
            phone,
            contactName,
            brandName,
            raffleTitle,
            numbers,
            total,
            paid,
            status,
            receiptUrl,
            receiptPageUrl: pageUrl,
            brandUrl,
          })
        : null,
    [phone, contactName, brandName, raffleTitle, numbers, total, paid, status, receiptUrl, pageUrl, brandUrl]
  );

  // Caption del share nativo: mismos datos, pero SIN el enlace a la imagen
  // (la imagen viaja adjunta como foto real), y con el CTA de marca.
  const shareCaption = useMemo(
    () =>
      buildReceiptMessage({
        phone: phone ?? "",
        contactName,
        brandName,
        raffleTitle,
        numbers,
        total,
        paid,
        status,
        brandUrl,
        omitImageLink: true,
      }),
    [phone, contactName, brandName, raffleTitle, numbers, total, paid, status, brandUrl]
  );

  // Precarga del PNG para compartirlo como imagen nativa (solo si el navegador
  // soporta compartir archivos: iOS Safari y Android Chrome sí).
  const fileRef = useRef<File | null>(null);
  const [shareReady, setShareReady] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!receiptUrl) return;
    try {
      const probe = new File([new Uint8Array(1)], "r.png", { type: "image/png" });
      if (!navigator.canShare?.({ files: [probe] })) return;
    } catch {
      return;
    }
    let cancelled = false;
    fetch(`/api/receipt/${saleId}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("fetch"))))
      .then((blob) => {
        if (cancelled) return;
        fileRef.current = new File([blob], "recibo.png", {
          type: blob.type || "image/png",
        });
        setShareReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [saleId, receiptUrl]);

  async function shareImage() {
    const file = fileRef.current;
    if (!file || sharing) return;
    setSharing(true);
    try {
      // Adjunta la foto del recibo + el texto como caption. El cliente elige el
      // contacto y el recibo llega como IMAGEN dentro del chat (no un enlace).
      await navigator.share({
        files: [file],
        text: shareCaption,
        title: brandName ? `Recibo · ${brandName}` : "Tu recibo",
      });
      toast.success("Recibo compartido 🧾✨");
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast.error("No se pudo compartir la imagen. Probá “enviar solo el texto”.");
      }
    } finally {
      setSharing(false);
    }
  }

  const btnBase = compact ? "py-2.5 text-sm" : "py-3.5";

  // El ÚNICO modo de que la foto del recibo quede INCRUSTADA en el chat (no un
  // enlace) es compartir el archivo por la Web Share API — soportado en móvil
  // (iOS Safari / Android Chrome). Cuando está disponible, es la acción primaria.
  const canSharePhoto = shareReady && !!receiptUrl;

  return (
    <div className="space-y-2">
      {canSharePhoto ? (
        <>
          <button
            type="button"
            onClick={shareImage}
            disabled={sharing}
            className={`flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 font-medium text-white hover:bg-green-700 disabled:opacity-60 ${btnBase}`}
          >
            {sharing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <MessageCircle className="h-5 w-5" />
            )}
            Enviar recibo por WhatsApp
          </button>
          {!compact && (
            <p className="text-center text-xs text-slate-400">
              El recibo llega como imagen dentro del chat 📸
            </p>
          )}
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs text-slate-400 hover:underline"
            >
              o enviar solo el texto
            </a>
          )}
        </>
      ) : waLink ? (
        <>
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 font-medium text-white hover:bg-green-700 ${btnBase}`}
          >
            <MessageCircle className="h-5 w-5" />
            {receiptUrl ? "Enviar recibo por WhatsApp" : "Enviar confirmación por WhatsApp"}
          </a>
          {receiptUrl && !compact && (
            // Escritorio (WhatsApp Web no acepta adjuntar la foto desde la web):
            // se manda el texto; para incrustar la imagen hay que usar el móvil.
            <p className="text-center text-xs text-slate-400">
              Para que el recibo llegue como imagen 📸, envíalo desde tu teléfono.
            </p>
          )}
        </>
      ) : phone ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          No se pudo armar el WhatsApp (teléfono inválido).
        </p>
      ) : null}

      {pageUrl && (
        <a
          href={pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          <Receipt className="h-4 w-4" /> Ver recibo
        </a>
      )}
    </div>
  );
}

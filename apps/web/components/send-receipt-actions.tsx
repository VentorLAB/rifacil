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
import { buildReceiptWaLink } from "@riffas/shared";
import { MessageCircle, Image as ImageIcon, Receipt, Loader2 } from "lucide-react";

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
          })
        : null,
    [phone, contactName, brandName, raffleTitle, numbers, total, paid, status, receiptUrl, pageUrl]
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
      await navigator.share({ files: [file] });
      toast.success("Recibo compartido 🧾✨");
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast.error("No se pudo compartir la imagen. Usa el botón verde de WhatsApp.");
      }
    } finally {
      setSharing(false);
    }
  }

  const btnBase = compact ? "py-2.5 text-sm" : "py-3.5";

  return (
    <div className="space-y-2">
      {waLink ? (
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
          {pageUrl && !compact && (
            <p className="text-center text-xs text-slate-400">
              El cliente ve el recibo directo en el chat 😎
            </p>
          )}
        </>
      ) : phone ? (
        // Hay teléfono pero no se pudo armar el wa.me → avisar. Sin teléfono
        // no hay nada que avisar: quedan las demás acciones (imagen / ver recibo).
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          No se pudo armar el WhatsApp (teléfono inválido).
        </p>
      ) : null}

      {shareReady && (
        <button
          type="button"
          onClick={shareImage}
          disabled={sharing}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 ${btnBase}`}
        >
          {sharing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ImageIcon className="h-5 w-5" />
          )}
          Enviar la imagen del recibo
        </button>
      )}

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

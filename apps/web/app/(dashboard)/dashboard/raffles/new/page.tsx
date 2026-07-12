"use client";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc";
import { useForm } from "react-hook-form";
import { toast } from "react-hot-toast";
import { celebrateBig } from "@/lib/celebrate";
import { ArrowLeft, Loader2, ImagePlus, X } from "lucide-react";
import { useState } from "react";
import { PrizesEditor, type PrizeDraft } from "@/components/prizes-editor";

// Estilos reutilizables — contraste legible (ver globals.css: input/label fuerzan
// texto oscuro sobre fondo blanco incluso en iOS Safari).
const inputCls =
  "w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500";
const labelCls = "block text-sm font-medium mb-1 text-slate-700";
const sectionCls = "pt-2 mt-2 border-t border-slate-200 text-sm font-semibold text-slate-900";

type ImageKind = "bannerUrl" | "bannerMobileUrl" | "iconUrl";

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function NewRafflePage() {
  const router = useRouter();

  const [color, setColor] = useState("#7c3aed");
  const [totalNumbers, setTotalNumbers] = useState(1000);
  const [images, setImages] = useState<Record<ImageKind, string>>({
    bannerUrl: "",
    bannerMobileUrl: "",
    iconUrl: "",
  });
  const [uploading, setUploading] = useState<ImageKind | null>(null);
  const [prizes, setPrizes] = useState<PrizeDraft[]>([]);

  const uploadImage = api.raffle.uploadImage.useMutation();

  const createRaffle = api.raffle.create.useMutation({
    onSuccess: (data) => {
      celebrateBig();
      toast.success("🚀 ¡Tu rifa está lista! Actívala y empieza a vender.", {
        duration: 5000,
      });
      router.push(`/dashboard/raffles/${data.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<any>();

  async function handleImage(kind: ImageKind, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("El archivo debe ser una imagen");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("La imagen no puede superar 8 MB");
      return;
    }
    try {
      setUploading(kind);
      const dataUri = await fileToDataUri(file);
      const { url } = await uploadImage.mutateAsync({ dataUri });
      setImages((prev) => ({ ...prev, [kind]: url }));
      toast.success("Imagen subida");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo subir la imagen");
    } finally {
      setUploading(null);
    }
  }

  const toISO = (v?: string) => (v ? new Date(v).toISOString() : undefined);

  const onSubmit = (data: any) => {
    if (totalNumbers < 100 || totalNumbers > 10000) {
      toast.error("El total de números debe estar entre 100 y 10.000");
      return;
    }
    const startISO = toISO(data.startDate) ?? new Date().toISOString();

    // Premios con título no vacío (el orden es la posición en el array).
    const cleanPrizes = prizes
      .filter((p) => p.titulo.trim())
      .map((p) => ({
        titulo: p.titulo.trim(),
        descripcion: p.descripcion?.trim() || undefined,
        imagenUrl: p.imagenUrl || undefined,
      }));

    createRaffle.mutate({
      title: data.title,
      description: data.description || undefined,
      prize: data.prize,
      prizeValue: Number(data.prizeValue),
      totalNumbers,
      pricePerNumber: Number(data.pricePerNumber),
      color,
      representanteLegal: data.representanteLegal || undefined,
      representanteCedula: data.representanteCedula || undefined,
      loteria: data.loteria || undefined,
      contactWhatsapp: data.contactWhatsapp || undefined,
      startDate: startISO,
      drawDate: toISO(data.drawDate),
      buyDeadline: toISO(data.buyDeadline),
      bannerUrl: images.bannerUrl || undefined,
      bannerMobileUrl: images.bannerMobileUrl || undefined,
      iconUrl: images.iconUrl || undefined,
      prizes: cleanPrizes.length > 0 ? cleanPrizes : undefined,
    });
  };

  const busy = createRaffle.isLoading || uploading !== null;

  return (
    <div className="max-w-2xl mx-auto pb-16">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-slate-100 rounded-lg"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5 text-slate-700" />
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Nueva Rifa</h1>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-white rounded-xl border border-slate-200 p-6 space-y-4"
      >
        {/* --- Datos básicos --- */}
        <div className={sectionCls}>Datos de la rifa</div>

        <div>
          <label className={labelCls}>Título</label>
          <input
            {...register("title", { required: "El título es obligatorio", minLength: { value: 3, message: "Mínimo 3 caracteres" } })}
            className={inputCls}
            placeholder="Ej: Rifa Moto 0km"
          />
          {errors.title && <p className="text-sm text-red-600 mt-1">{String(errors.title.message)}</p>}
        </div>

        <div>
          <label className={labelCls}>Descripción</label>
          <textarea
            {...register("description")}
            className={inputCls}
            rows={3}
            placeholder="Detalles, condiciones, cómo se juega…"
          />
        </div>

        <div>
          <label className={labelCls}>Premio</label>
          <input
            {...register("prize", { required: "El premio es obligatorio", minLength: { value: 3, message: "Mínimo 3 caracteres" } })}
            className={inputCls}
            placeholder="Ej: Moto Yamaha"
          />
          {errors.prize && <p className="text-sm text-red-600 mt-1">{String(errors.prize.message)}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Valor del premio (USD)</label>
            <input
              type="number"
              step="0.01"
              {...register("prizeValue", { required: "Obligatorio", min: { value: 0.01, message: "Debe ser mayor a 0" } })}
              className={inputCls}
              placeholder="15000"
            />
            {errors.prizeValue && <p className="text-sm text-red-600 mt-1">{String(errors.prizeValue.message)}</p>}
          </div>
          <div>
            <label className={labelCls}>Precio por número (USD)</label>
            <input
              type="number"
              step="0.01"
              {...register("pricePerNumber", { required: "Obligatorio", min: { value: 0.01, message: "Debe ser mayor a 0" } })}
              className={inputCls}
              placeholder="2"
            />
            {errors.pricePerNumber && <p className="text-sm text-red-600 mt-1">{String(errors.pricePerNumber.message)}</p>}
          </div>
        </div>

        {/* --- Total de números (slider) --- */}
        <div>
          <label className={labelCls}>
            Total de números: <span className="font-bold text-slate-900">{totalNumbers.toLocaleString("es")}</span>
          </label>
          <input
            type="range"
            min={100}
            max={10000}
            step={100}
            value={totalNumbers}
            onChange={(e) => setTotalNumbers(Number(e.target.value))}
            className="w-full accent-violet-600"
          />
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>100</span>
            <span>10.000</span>
          </div>
        </div>

        {/* --- Color de marca --- */}
        <div>
          <label className={labelCls}>Color de la rifa</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-11 w-14 rounded-lg border border-slate-300 bg-white cursor-pointer"
              aria-label="Selector de color"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className={inputCls + " font-mono"}
              placeholder="#7c3aed"
            />
          </div>
        </div>

        {/* --- Organizador / sorteo --- */}
        <div className={sectionCls}>Organizador y sorteo</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Representante legal</label>
            <input {...register("representanteLegal")} className={inputCls} placeholder="Nombre y apellido" />
          </div>
          <div>
            <label className={labelCls}>Cédula del representante</label>
            <input {...register("representanteCedula")} className={inputCls} placeholder="V-12.345.678" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Lotería</label>
            <input {...register("loteria")} className={inputCls} placeholder="Ej: Lotería del Táchira" />
          </div>
          <div>
            <label className={labelCls}>WhatsApp de contacto</label>
            <input {...register("contactWhatsapp")} className={inputCls} placeholder="0424 123 4567" inputMode="tel" />
          </div>
        </div>

        {/* min-w-0 en celda e input: en Safari los datetime-local tienen ancho
            intrínseco mínimo y, como los grid items son min-width:auto, desbordan
            y se solapan. min-w-0 les permite encogerse a la celda. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="min-w-0">
            <label className={labelCls}>Inicio</label>
            <input type="datetime-local" {...register("startDate")} className={`${inputCls} min-w-0 max-w-full box-border`} />
          </div>
          <div className="min-w-0">
            <label className={labelCls}>Fecha del sorteo</label>
            <input type="datetime-local" {...register("drawDate")} className={`${inputCls} min-w-0 max-w-full box-border`} />
          </div>
          <div className="min-w-0">
            <label className={labelCls}>Límite de compra</label>
            <input type="datetime-local" {...register("buyDeadline")} className={`${inputCls} min-w-0 max-w-full box-border`} />
          </div>
        </div>

        {/* --- Imágenes --- */}
        <div className={sectionCls}>Imágenes</div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ImageField label="Banner" kind="bannerUrl" url={images.bannerUrl} uploading={uploading === "bannerUrl"} onPick={handleImage} onClear={(k) => setImages((p) => ({ ...p, [k]: "" }))} />
          <ImageField label="Banner móvil" kind="bannerMobileUrl" url={images.bannerMobileUrl} uploading={uploading === "bannerMobileUrl"} onPick={handleImage} onClear={(k) => setImages((p) => ({ ...p, [k]: "" }))} />
          <ImageField label="Icono" kind="iconUrl" url={images.iconUrl} uploading={uploading === "iconUrl"} onPick={handleImage} onClear={(k) => setImages((p) => ({ ...p, [k]: "" }))} />
        </div>

        {/* --- Premios --- */}
        <div className={sectionCls}>Premios</div>
        <PrizesEditor value={prizes} onChange={setPrizes} />

        <button
          type="submit"
          disabled={busy}
          className="w-full py-3 text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ backgroundColor: color }}
        >
          {createRaffle.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Crear Rifa"}
        </button>
      </form>
    </div>
  );
}

function ImageField({
  label,
  kind,
  url,
  uploading,
  onPick,
  onClear,
}: {
  label: string;
  kind: ImageKind;
  url: string;
  uploading: boolean;
  onPick: (kind: ImageKind, file?: File) => void;
  onClear: (kind: ImageKind) => void;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="relative aspect-video rounded-xl border border-dashed border-slate-300 bg-slate-50 overflow-hidden flex items-center justify-center">
        {url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={label} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onClear(kind)}
              className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white"
              aria-label={`Quitar ${label}`}
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <label className="cursor-pointer flex flex-col items-center gap-1 text-slate-500 text-xs p-2 text-center">
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
            <span>{uploading ? "Subiendo…" : "Subir"}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => onPick(kind, e.target.files?.[0])}
            />
          </label>
        )}
      </div>
    </div>
  );
}

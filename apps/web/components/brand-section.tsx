"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { Store, Loader2, ImagePlus, X } from "lucide-react";

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const HEX = /^#([0-9a-fA-F]{6})$/;

export function BrandSection() {
  const utils = api.useContext();
  const { data: me, isLoading } = api.auth.me.useQuery();

  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [colorSecondary, setColorSecondary] = useState("#1e293b");
  const [domain, setDomain] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!me) return;
    setName(me.brandName ?? "");
    setLogo(me.brandLogo ?? "");
    setColor(me.brandColor ?? "#3b82f6");
    setColorSecondary(me.brandColorSecondary ?? "#1e293b");
    setDomain(me.customDomain ?? "");
  }, [me]);

  const upload = api.raffle.uploadImage.useMutation();
  const save = api.auth.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Marca guardada");
      utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  async function handleLogo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Debe ser una imagen");
    if (file.size > 8 * 1024 * 1024) return toast.error("Máximo 8 MB");
    try {
      setUploading(true);
      const dataUri = await fileToDataUri(file);
      const { url } = await upload.mutateAsync({ dataUri });
      setLogo(url);
      toast.success("Logo subido");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo subir el logo");
    } finally {
      setUploading(false);
    }
  }

  function handleSave() {
    if (!HEX.test(color) || !HEX.test(colorSecondary)) {
      return toast.error("Los colores deben ser hex (#rrggbb)");
    }
    save.mutate({
      brandName: name.trim() || null,
      brandLogo: logo || null,
      brandColor: color,
      brandColorSecondary: colorSecondary,
      customDomain: domain.trim() || null,
    });
  }

  return (
    <div className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <Store className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">Mi negocio / Marca</h2>
      </div>
      <p className="-mt-2 text-sm text-slate-500">
        Tu logo y colores se aplican en tu página pública, el verificador y los recibos.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-6 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* Vista previa de marca */}
          <div
            className="flex items-center gap-3 rounded-xl p-4"
            style={{ background: `linear-gradient(135deg, ${color}, ${colorSecondary})` }}
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="logo" className="h-12 w-12 rounded-lg bg-white/90 object-contain p-1" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/90 text-xs text-slate-400">
                logo
              </div>
            )}
            <span className="text-lg font-bold text-white drop-shadow">{name || "Mi negocio"}</span>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre del negocio</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Rifas La Suerte"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>

          {/* Logo */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Logo</label>
            {logo ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo} alt="logo" className="h-20 w-20 rounded-xl border object-contain" />
                <button
                  onClick={() => setLogo("")}
                  className="absolute -right-2 -top-2 rounded-full bg-black/60 p-1 text-white"
                  aria-label="Quitar logo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {uploading ? "Subiendo…" : "Subir logo"}
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => handleLogo(e.target.files?.[0])} />
              </label>
            )}
          </div>

          {/* Colores */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ColorField label="Color primario" value={color} onChange={setColor} />
            <ColorField label="Color secundario" value={colorSecondary} onChange={setColorSecondary} />
          </div>

          {/* Dominio propio */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Dominio propio <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="rifashermanospernia.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-slate-900"
            />
            <p className="mt-2 text-xs text-slate-500">
              Tu tienda se verá en tu propio dominio. Pasos:
            </p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-slate-500">
              <li>Escribe tu dominio acá (sin <span className="font-mono">https://</span> ni <span className="font-mono">www.</span>) y guardá.</li>
              <li>En tu proveedor de DNS, apuntá un registro <span className="font-mono">CNAME</span> a <span className="font-mono">cname.vercel-dns.com</span>.</li>
              <li>Avisanos para activar el dominio en el servidor (puede tardar unos minutos en propagar).</li>
            </ol>
            {me?.customDomain && (
              <p className="mt-2 text-xs text-slate-600">
                Activo:{" "}
                <a
                  href={`https://${me.customDomain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-600 underline"
                >
                  {me.customDomain}
                </a>
              </p>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={save.isLoading || uploading}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {save.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar marca"}
          </button>
        </>
      )}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white"
          aria-label={label}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-mono text-slate-900"
          placeholder="#3b82f6"
        />
      </div>
    </div>
  );
}

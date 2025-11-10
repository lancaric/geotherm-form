// frontend/src/components/QuoteForm.tsx
import React, { useEffect, useState } from "react";
import axios from "axios";

type BuildingType = "dom" | "byt" | "objekt" | "";
type Phase = "idle" | "submitting" | "success" | "error";

type UploadStatus = "idle" | "uploading" | "done" | "error" | "deleting";
type ServerFile = {
  filename: string;   // dôležité na mazanie (DELETE /api/upload/:filename)
  originalname: string;
  mimetype: string;
  size: number;
  path: string;       // server path (pre e-mailové attachments, ak chceš)
  url: string;        // verejný link (ak v e-maile posielaš iba odkazy)
};
type UploadItem = {
  localId: string;
  file: File;
  progress: number;   // 0–100
  status: UploadStatus;
  controller?: AbortController;
  server?: ServerFile;
};

const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/jpg",
  "image/png",
];
const MAX_FILE_SIZE = 5 * 1024 * 1024;     // 5 MB / súbor
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;   // 20 MB spolu

function uploadSingleFile(
  apiUrl: string,
  file: File,
  controller: AbortController,
  onProgress: (pct: number) => void
): Promise<ServerFile> {
  const fd = new FormData();
  fd.append("file", file);
  return axios
    .post(`${apiUrl}/api/upload`, fd, {
      signal: controller.signal,
      onUploadProgress: (e) => {
        if (!e.total) return;
        const pct = Math.round((e.loaded * 100) / e.total);
        onProgress(pct);
      },
    })
    .then((r) => {
      if (!r.data?.success) throw new Error("Upload sa nepodaril");
      return r.data.file as ServerFile;
    });
}

export default function QuoteForm() {
  const [form, setForm] = useState({
    // základ
    name: "",
    phone: "",
    email: "",
    place: "",
    buildingType: "" as BuildingType,
    installTime: "",
    gdpr: false,

    // voliteľné sekcie (prepínače)
    newBuild: false,
    reconstruction: false,

    // === NOVOSTAVBA ===
    nb_heatedArea: "",
    nb_floors: "",
    nb_heatLoss: "",
    nb_actualState: "", // projektová príprava | stavebné povolenie | ...
    nb_sourceInfo: "",  // Google | Google reklama | Facebook | Odporúčanie | Iné
    // zdroj vykurovania/chladenia/vetrania
    nb_hp: "",          // "zem-voda (plošný kolektor)" | "zem-voda (hlbinný vrt)" | "voda-voda" | "vzduch-voda" | "ventilačné" | "chcem poradiť"
    nb_boiler: "",      // "plynový kondenzačný" | "elektrický"
    nb_solar: "",       // "áno" | "nie"
    nb_rekuperacia: "", // "áno" | "nie"
    nb_fv: "",          // "áno" | "nie"
    // plánované využitie
    nb_plannedUse: [] as string[], // vykurovanie | chladenie | vetranie | ohrev TV | ohrev bazéna
    // systém
    nb_systemHeating: "", // podlahové | stenové | radiátorové | kombinované (podlahové/radiátorové)
    nb_systemCooling: "", // stropné | podlahové | stenové | klimatizácia | nie
    nb_zoneControl: "",   // áno | nie | inteligentná elektroinštalácia / nadradená regulácia
    nb_note: "",

    // === REKONŠTRUKCIA ===
    rec_heatedArea: "",
    rec_floors: "",
    rec_heatLoss: "",
    rec_annualConsumption: "", // plyn/drevo/peliet
    rec_constructionYear: "",
    rec_sourceInfo: "",        // Google | Google reklama | Facebook | Odporúčanie | Iné
    // zateplenie
    rec_insulation: "",        // áno | nie
    rec_insulationWalls: "",
    rec_insulationFloor: "",
    rec_insulationCeiling: "",
    // zdroje a systémy
    rec_currentHeatSource: "",        // tepelné čerpadlo | ... | iné
    rec_currentHeatSource_other: "",  // text ak "iné"
    rec_keepCurrentHeatSource: "",    // áno | nie
    rec_currentHeatingSystem: "",     // podlahové | stenové | radiátorové | kombinované (podlahové/radiátorové)
    rec_maxHeatingTemp: "",           // do 40°C | do 50°C | do 65°C | viac ako 65°C
    rec_currentCooling: "",           // stropné | podlahové | stenové | klimatizácia | nie
    rec_zoneControl: "",              // áno | nie | inteligentná elektroinštalácia / nadradená regulácia
    rec_plannedUse: [] as string[],   // vykurovanie | chladenie | vetranie | ohrev TV | ohrev bazéna
    rec_newSource: "",                // tepelné zem-voda (plošný kolektor) | ... | kotol elektrický
    rec_rekuperacia: "",              // áno | nie
    rec_fotovoltaika: "",             // áno | nie
    rec_note: "",
  });

  // upload stavy
  const [nbUploads, setNbUploads] = useState<UploadItem[]>([]);
  const [recUploads, setRecUploads] = useState<UploadItem[]>([]);

  // validácia + UI stavy
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeExtra, setActiveExtra] = useState<"new" | "recon" | null>(null);

  // async job (okamžitá success obrazovka + pozadie)
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"pending" | "sent_firm" | "sent_user" | "error" | null>(null);

  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:4000";

  // === validácie základných povinných polí ===
  const validateField = (name: string, value: any) => {
    switch (name) {
      case "name":
        if (!value.trim()) return "Prosím, zadajte meno a priezvisko.";
        return "";
      case "phone":
        if (!value.trim()) return "Prosím, zadajte telefón.";
        if (!/^[0-9 +()/.\-]{7,}$/.test(value)) return "Zadajte platné telefónne číslo.";
        return "";
      case "email":
        if (!value.trim()) return "Prosím, zadajte e-mail.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Zadajte platný e-mail.";
        return "";
      case "place":
        if (!value.trim()) return "Prosím, zadajte obec alebo miesto stavby.";
        return "";
      case "gdpr":
        if (!value) return "Pre odoslanie je potrebný súhlas so spracovaním údajov.";
        return "";
      default:
        return "";
    }
  };

  const validateAll = () => {
    const newErrors: Record<string, string> = {};
    ["name", "phone", "email", "place", "gdpr"].forEach((k) => {
      // @ts-ignore
      const err = validateField(k, form[k]);
      if (err) newErrors[k] = err;
    });
    return newErrors;
  };

  // === change handler ===
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type, checked } = e.target as HTMLInputElement;

    // multi-checkbox polia (plánované využitie)
    if (name === "nb_plannedUse" || name === "rec_plannedUse") {
      setForm((prev) => {
        const current = [...(prev[name] as string[])];
        if (checked) {
          if (!current.includes(value)) current.push(value);
        } else {
          const i = current.indexOf(value);
          if (i !== -1) current.splice(i, 1);
        }
        return { ...prev, [name]: current };
      });
      return;
    }

    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));

    // exkluzívne prepínače sekcií
    if (name === "newBuild") {
      setActiveExtra(checked ? "new" : null);
      if (checked) setForm((p) => ({ ...p, reconstruction: false }));
    }
    if (name === "reconstruction") {
      setActiveExtra(checked ? "recon" : null);
      if (checked) setForm((p) => ({ ...p, newBuild: false }));
    }

    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type, checked } = e.target;
    const err = validateField(name, type === "checkbox" ? checked : value);
    if (err) setErrors((p) => ({ ...p, [name]: err }));
    else {
      const copy = { ...errors };
      delete copy[name];
      setErrors(copy);
    }
  };

  // === výpočet už nahratej veľkosti (pre 20 MB limit) ===
  const currentTotalBytes = () =>
    [...nbUploads, ...recUploads].reduce((s, u) => s + (u.file?.size || 0), 0);

  // === pridanie súborov (validácie + spustenie uploadu s percentami) ===
  const handleAddFiles = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: "nb" | "rec"
  ) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;

    // FE limit 20 MB spolu (pred uploadom)
    const newFilesTotal = files.reduce((s, f) => s + f.size, 0);
    if (currentTotalBytes() + newFilesTotal > MAX_TOTAL_SIZE) {
      alert("Celkový limit príloh je 20 MB. Zmenšite alebo odstráňte niektoré súbory.");
      e.currentTarget.value = "";
      return;
    }

    // typ + 5 MB / súbor
    for (const f of files) {
      if (!ALLOWED_FILE_TYPES.includes(f.type)) {
        alert("Povolené formáty: PDF, DOC, DOCX, JPG, PNG.");
        e.currentTarget.value = "";
        return;
      }
      if (f.size > MAX_FILE_SIZE) {
        alert(`Súbor ${f.name} je väčší ako 5 MB.`);
        e.currentTarget.value = "";
        return;
      }
    }

    // priprav položky a spusti upload s AbortControllerom
    const items: UploadItem[] = files.map((f) => {
      const c = new AbortController();
      return {
        localId:
          (crypto as any).randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        progress: 0,
        status: "uploading",
        controller: c,
      };
    });

    if (target === "nb") setNbUploads((prev) => [...prev, ...items]);
    else setRecUploads((prev) => [...prev, ...items]);

    items.forEach((item) => {
      uploadSingleFile(apiUrl, item.file, item.controller!, (pct) => {
        if (target === "nb") {
          setNbUploads((prev) =>
            prev.map((x) => (x.localId === item.localId ? { ...x, progress: pct } : x))
          );
        } else {
          setRecUploads((prev) =>
            prev.map((x) => (x.localId === item.localId ? { ...x, progress: pct } : x))
          );
        }
      })
        .then((serverFile) => {
          if (target === "nb") {
            setNbUploads((prev) =>
              prev.map((x) =>
                x.localId === item.localId ? { ...x, status: "done", progress: 100, server: serverFile } : x
              )
            );
          } else {
            setRecUploads((prev) =>
              prev.map((x) =>
                x.localId === item.localId ? { ...x, status: "done", progress: 100, server: serverFile } : x
              )
            );
          }
        })
        .catch((err) => {
          if (axios.isCancel?.(err) || err?.name === "CanceledError") return;
          if (target === "nb") {
            setNbUploads((prev) =>
              prev.map((x) => (x.localId === item.localId ? { ...x, status: "error" } : x))
            );
          } else {
            setRecUploads((prev) =>
              prev.map((x) => (x.localId === item.localId ? { ...x, status: "error" } : x))
            );
          }
        });
    });

    e.currentTarget.value = "";
  };

  // === odstránenie / zrušenie uploadu ===
  const handleRemoveUpload = async (localId: string, target: "nb" | "rec") => {
    const list = target === "nb" ? nbUploads : recUploads;
    const item = list.find((x) => x.localId === localId);
    if (!item) return;

    // zrušenie rozbehnutého uploadu
    if (item.status === "uploading" && item.controller) {
      try { item.controller.abort(); } catch {}
      if (target === "nb") setNbUploads((prev) => prev.filter((x) => x.localId !== localId));
      else setRecUploads((prev) => prev.filter((x) => x.localId !== localId));
      return;
    }

    // vymazanie hotového súboru na serveri
    if (item.status === "done" && item.server) {
      if (target === "nb") setNbUploads((prev) => prev.map((x) => (x.localId === localId ? { ...x, status: "deleting" } : x)));
      else setRecUploads((prev) => prev.map((x) => (x.localId === localId ? { ...x, status: "deleting" } : x)));

      try {
        await fetch(`${apiUrl}/api/upload/${encodeURIComponent(item.server.filename)}`, { method: "DELETE" });
      } catch {}
      if (target === "nb") setNbUploads((prev) => prev.filter((x) => x.localId !== localId));
      else setRecUploads((prev) => prev.filter((x) => x.localId !== localId));
    }
  };

  // === submit: okamžitá „prijaté“ obrazovka + jobId, e-maily bežia v pozadí ===
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors = validateAll();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const first = Object.keys(newErrors)[0];
      document.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }

    const uploadsAll = [...nbUploads, ...recUploads];
    const hasUploading = uploadsAll.some((u) => u.status === "uploading");
    const hasError = uploadsAll.some((u) => u.status === "error");
    const hasDeleting = uploadsAll.some((u) => u.status === "deleting");
    if (hasUploading) { alert("Počkajte prosím, kým sa prílohy do-nahrajú."); return; }
    if (hasError) { alert("Jedna alebo viac príloh sa nepodarilo nahrať. Odstráňte ich alebo skúste znova."); return; }
    if (hasDeleting) { alert("Príloha sa odstraňuje. Skúste odoslať o chvíľu."); return; }

    // FE poistka 20 MB spolu
    if (currentTotalBytes() > MAX_TOTAL_SIZE) {
      alert("Celkový limit príloh je 20 MB.");
      return;
    }

    const uploadedFilesPayload: ServerFile[] = uploadsAll
      .filter((u) => u.status === "done" && u.server)
      .map((u) => u.server!) as ServerFile[];

    try {
      setPhase("submitting");

      const res = await fetch(`${apiUrl}/api/form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, uploadedFiles: uploadedFilesPayload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.message || "Chyba pri odoslaní formulára.");

      setJobId(data.jobId || null);
      setJobStatus("pending");
      setPhase("success"); // hneď informujeme: „prijaté – e-maily sa odosielajú v pozadí“
    } catch (err) {
      console.error(err);
      setPhase("error");
    }
  };

  // === polling stavu jobu (voliteľné) ===
  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${apiUrl}/api/form-status/${jobId}`);
        const j = await r.json();
        if (j?.success && j?.status) {
          setJobStatus(j.status);
          if (j.status === "sent_user" || j.status === "error") clearInterval(t);
        }
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [jobId, apiUrl]);

  const isBusy = phase === "submitting";
  const allUploads = [...nbUploads, ...recUploads];
  const hasUploading = allUploads.some((u) => u.status === "uploading");
  const hasError = allUploads.some((u) => u.status === "error");
  const hasDeleting = allUploads.some((u) => u.status === "deleting");
  const canSubmit = !hasUploading && !hasError && !hasDeleting;

  // ————————————————————————————— UI —————————————————————————————
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center py-10 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-3xl bg-white rounded-2xl shadow-xl p-6 md:p-8 space-y-8 relative">

        {/* overlay len počas POST /api/form (kým získame jobId) */}
        {isBusy && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-3 z-10">
            <span className="h-10 w-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-700 font-medium">Spracúvam žiadosť…</p>
          </div>
        )}

        {/* success – informačná obrazovka s live stavom */}
        {phase === "success" && (
          <div className="absolute inset-0 bg-white/90 rounded-2xl flex flex-col items-center justify-center gap-4 z-10 text-center p-6">
            <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg className="h-9 w-9 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <path d="m9 11 3 3L22 4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-800">Žiadosť prijatá 👌</h3>

            {jobStatus === "pending" && (
              <p className="text-sm text-slate-500 max-w-sm">
                Môžete stránku pokojne zatvoriť. E-maily sa odosielajú na pozadí. Očakávajte potvrdenie do 5 minút.
              </p>
            )}
            {jobStatus === "sent_firm" && (
              <p className="text-sm text-slate-500 max-w-sm">
                Správa bola doručená firme. Posielame potvrdenie na váš e-mail…
              </p>
            )}
            {jobStatus === "sent_user" && (
              <p className="text-sm text-emerald-600 max-w-sm">
                Hotovo — potvrdzujúci e-mail bol odoslaný. Ďakujeme!
              </p>
            )}
            {jobStatus === "error" && (
              <p className="text-sm text-red-600 max-w-sm">
                Prijali sme vašu žiadosť, ale nastala chyba pri doručení do firmy.
                Skúste to, prosím, znova alebo nás kontaktujte telefonicky.
              </p>
            )}

            {jobId && (
              <p className="text-xs text-slate-400">ID žiadosti: <span className="font-mono">{jobId}</span></p>
            )}

            <button type="button" onClick={() => setPhase("idle")} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition">
              Zavrieť
            </button>
          </div>
        )}

        {/* error */}
        {phase === "error" && (
          <div className="absolute inset-0 bg-white/90 rounded-2xl flex flex-col items-center justify-center gap-4 z-10 text-center p-6">
            <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="h-9 w-9 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-800">Ajaj, niečo sa pokazilo 😕</h3>
            <p className="text-sm text-slate-500 max-w-sm">Skúste to, prosím, znova alebo nám údaje pošlite e-mailom.</p>
            <button type="button" onClick={() => setPhase("idle")} className="px-4 py-2 bg-slate-400 text-white rounded-lg text-sm font-medium hover:bg-slate-500 transition">
              Skúsiť znova
            </button>
          </div>
        )}

        {/* HLAVIČKA */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-900">Vyplňte formulár a my vám pripravíme návrh a cenovú ponuku</h1>
          <p className="text-sm text-slate-500">vykurovanie · vetranie · chladenie</p>
        </div>

        {/* KONTAKTNÉ ÚDAJE */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-slate-800 border-b border-slate-100 pb-2">Kontaktné údaje</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="name">Meno a priezvisko *</label>
              <input id="name" name="name" value={form.name} onChange={handleChange} onBlur={handleBlur} disabled={phase!=="idle"} className={`input ${errors.name ? "input-error" : ""}`} placeholder="napr. Ján Novák" />
              {errors.name && <p className="error-text">{errors.name}</p>}
            </div>

            {/* honeypot */}
            <input type="text" name="hp_company" tabIndex={-1} autoComplete="off" className="hidden" />

            <div>
              <label className="label" htmlFor="phone">Telefón *</label>
              <input id="phone" name="phone" value={form.phone} onChange={handleChange} onBlur={handleBlur} disabled={phase!=="idle"} className={`input ${errors.phone ? "input-error" : ""}`} placeholder="+421 ..." />
              {errors.phone && <p className="error-text">{errors.phone}</p>}
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="email">E-mail *</label>
              <input id="email" name="email" type="email" value={form.email} onChange={handleChange} onBlur={handleBlur} disabled={phase!=="idle"} className={`input ${errors.email ? "input-error" : ""}`} placeholder="napr. info@vasmail.sk" />
              {errors.email && <p className="error-text">{errors.email}</p>}
            </div>
          </div>
        </section>

        {/* INFO O STAVBE */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-slate-800 border-b border-slate-100 pb-2">Informácie o stavbe</h2>
          <p className="text-sm text-slate-500">Riešime vykurovanie ako funkčný celok a používame kvalitné tepelné čerpadlá, cena kotolne sa zvyčajne pohybuje od 9 800 €.</p>
          <div className="flex flex-wrap gap-3">
            <label className="radio"><input type="radio" name="buildingType" value="dom" checked={form.buildingType==="dom"} onChange={handleChange} />Rodinný dom</label>
            <label className="radio"><input type="radio" name="buildingType" value="byt" checked={form.buildingType==="byt"} onChange={handleChange} />Byt</label>
            <label className="radio"><input type="radio" name="buildingType" value="objekt" checked={form.buildingType==="objekt"} onChange={handleChange} />Podnikateľský objekt</label>
          </div>

          <div>
            <label className="label" htmlFor="place">Obec / miesto stavby *</label>
            <input id="place" name="place" value={form.place} onChange={handleChange} onBlur={handleBlur} className={`input ${errors.place ? "input-error" : ""}`} placeholder="napr. Nitra, okres Nitra" />
            {errors.place && <p className="error-text">{errors.place}</p>}
          </div>
        </section>

        {/* TERMÍN */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-slate-800 border-b border-slate-100 pb-2">Predpokladaný termín inštalácie</h2>
          <div className="flex flex-wrap gap-2">
            {["Ihneď","Do 3 mesiacov","Do 6 mesiacov","Do 12 mesiacov","Viac ako 12 mesiacov"].map((label) => (
              <label key={label} className="chip">
                <input type="radio" name="installTime" value={label} checked={form.installTime===label} onChange={handleChange} />
                {label}
              </label>
            ))}
          </div>
        </section>

        {/* VOLITEĽNÉ SEKCIE – prepínače */}
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <h3 className="text-slate-800 font-medium">Chcem vyplniť podrobné informácie o stavbe</h3>
          <p className="text-sm text-slate-500">Nepovinné, ale pomôže to pri presnejšej cenovej ponuke.</p>
          <div className="flex flex-wrap gap-4">
            <label className="checkbox"><input type="checkbox" name="newBuild" checked={form.newBuild} onChange={handleChange} />Novostavba</label>
            <label className="checkbox"><input type="checkbox" name="reconstruction" checked={form.reconstruction} onChange={handleChange} />Rekonštrukcia</label>
          </div>
        </section>

        {/* === NOVOSTAVBA === */}
        <div className={`transition-all duration-300 overflow-hidden ${activeExtra==="new" ? "max-h-[4000px] opacity-100 mt-2" : "max-h-0 opacity-0"}`}>
          <section className="bg-slate-50 border rounded-xl p-5 mt-2 space-y-4">
            <h3 className="text-base font-semibold text-slate-700">Podrobné informácie o stavbe – novostavba</h3>
            <p className="text-sm text-slate-500">Vyplňte, čo poznáte. Všetky polia sú nepovinné.</p>

            <div className="grid md:grid-cols-2 gap-4">
              <div><label className="label">Vykurovaná plocha (m²)</label><input name="nb_heatedArea" value={form.nb_heatedArea} onChange={handleChange} className="input" /></div>
              <div><label className="label">Počet poschodí</label><input name="nb_floors" value={form.nb_floors} onChange={handleChange} className="input" /></div>
              <div><label className="label">Tepelná strata [kW]</label><input name="nb_heatLoss" value={form.nb_heatLoss} onChange={handleChange} className="input" /></div>
              <div>
                <label className="label">Aktuálny stav</label>
                <select name="nb_actualState" value={form.nb_actualState} onChange={handleChange} className="input">
                  <option value="">-- vyberte --</option>
                  <option value="projektová príprava">projektová príprava</option>
                  <option value="stavebné povolenie">stavebné povolenie</option>
                  <option value="základy">základy</option>
                  <option value="hrubá stavba bez okien">hrubá stavba bez okien</option>
                  <option value="hrubá stavba s oknami">hrubá stavba s oknami</option>
                  <option value="pred dokončením">pred dokončením</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Ako ste sa o nás dozvedeli?</label>
              <div className="flex flex-wrap gap-3 text-sm">
                {["Google","Google reklama","Facebook","Odporúčanie","Iné"].map((item) => (
                  <label key={item} className="chip">
                    <input type="radio" name="nb_sourceInfo" value={item} checked={form.nb_sourceInfo===item} onChange={handleChange} />
                    {item}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="label">Tepelné čerpadlo</label>
                <select name="nb_hp" value={form.nb_hp} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="zem-voda (plošný kolektor)">zem-voda (plošný kolektor)</option>
                  <option value="zem-voda (hlbinný vrt)">zem-voda (hlbinný vrt)</option>
                  <option value="voda-voda">voda-voda</option>
                  <option value="vzduch-voda">vzduch-voda</option>
                  <option value="ventilačné">ventilačné</option>
                  <option value="chcem poradiť">chcem poradiť</option>
                </select>
              </div>
              <div>
                <label className="label">Kotol</label>
                <select name="nb_boiler" value={form.nb_boiler} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="plynový kondenzačný">plynový kondenzačný</option>
                  <option value="elektrický">elektrický</option>
                </select>
              </div>
              <div>
                <label className="label">Solárny systém</label>
                <select name="nb_solar" value={form.nb_solar} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="áno">áno</option>
                  <option value="nie">nie</option>
                </select>
              </div>
              <div>
                <label className="label">Rekuperácia</label>
                <select name="nb_rekuperacia" value={form.nb_rekuperacia} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="áno">áno</option>
                  <option value="nie">nie</option>
                </select>
              </div>
              <div>
                <label className="label">Fotovoltaika</label>
                <select name="nb_fv" value={form.nb_fv} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="áno">áno</option>
                  <option value="nie">nie</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Plánované využitie zdroja</label>
              <div className="flex flex-wrap gap-3 text-sm">
                {["vykurovanie","chladenie","vetranie","ohrev teplej vody","ohrev bazénovej vody"].map((item) => (
                  <label key={item} className="checkbox">
                    <input type="checkbox" name="nb_plannedUse" value={item} checked={form.nb_plannedUse.includes(item)} onChange={handleChange} />
                    {item}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="label">Vykurovanie domu</label>
                <select name="nb_systemHeating" value={form.nb_systemHeating} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="podlahové">podlahové</option>
                  <option value="stenové">stenové</option>
                  <option value="radiátorové">radiátorové</option>
                  <option value="kombinované (podlahové/radiátorové)">kombinované (podlahové/radiátorové)</option>
                </select>
              </div>
              <div>
                <label className="label">Chladenie domu</label>
                <select name="nb_systemCooling" value={form.nb_systemCooling} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="stropné">stropné</option>
                  <option value="podlahové">podlahové</option>
                  <option value="stenové">stenové</option>
                  <option value="klimatizácia">klimatizácia</option>
                  <option value="nie">nie</option>
                </select>
              </div>
              <div>
                <label className="label">Priestorová / zónová regulácia</label>
                <select name="nb_zoneControl" value={form.nb_zoneControl} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="áno">áno</option>
                  <option value="nie">nie</option>
                  <option value="inteligentná elektroinštalácia / nadradená regulácia">inteligentná elektroinštalácia / nadradená regulácia</option>
                </select>
              </div>
            </div>

            {/* upload – novostavba */}
            <div>
              <label className="label">Zašlite nám pôdorysy / technickú správu</label>
              <input type="file" multiple onChange={(e) => handleAddFiles(e, "nb")} className="input file:mr-3 file:py-2 file:px-3 file:border-0 file:bg-amber-100 file:text-amber-900" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
              <p className="text-xs text-slate-400 mt-1">Povolené: PDF, DOC, DOCX, JPG, PNG. Max. 5 MB/súbor. Limit spolu 20 MB.</p>

              {nbUploads.length > 0 && (
                <ul className="space-y-2 mt-2">
                  {nbUploads.map((u) => (
                    <li key={u.localId} className="flex items-center gap-3">
                      <button type="button" onClick={() => handleRemoveUpload(u.localId, "nb")} className="shrink-0 h-6 w-6 rounded-full border border-slate-300 hover:bg-slate-100 text-slate-500 flex items-center justify-center" title={u.status==="uploading" ? "Zrušiť nahrávanie" : "Odstrániť prílohu"}>×</button>
                      <div className="min-w-0 text-sm text-slate-700 truncate">{u.file.name}</div>
                      {u.status === "uploading" && (
                        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-2 bg-amber-500 transition-all" style={{ width: `${u.progress}%` }} />
                        </div>
                      )}
                      {u.status === "done" && <span className="text-emerald-600 text-sm">✓</span>}
                      {u.status === "error" && <span className="text-red-600 text-sm">✕</span>}
                      {u.status === "deleting" && <span className="text-slate-400 text-xs">odstraňujem…</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="label">Poznámky a iné požiadavky</label>
              <textarea name="nb_note" value={form.nb_note} onChange={handleChange} className="input min-h-[80px]" />
            </div>
          </section>
        </div>

        {/* === REKONŠTRUKCIA === */}
        <div className={`transition-all duration-300 overflow-hidden ${activeExtra==="recon" ? "max-h-[4000px] opacity-100 mt-2" : "max-h-0 opacity-0"}`}>
          <section className="bg-slate-50 border rounded-xl p-5 mt-2 space-y-4">
            <h3 className="text-base font-semibold text-slate-700">Podrobné informácie o stavbe – rekonštrukcia</h3>
            <p className="text-sm text-slate-500">Vyplňte, čo poznáte. Všetko je nepovinné.</p>

            <div className="grid md:grid-cols-2 gap-4">
              <div><label className="label">Vykurovaná plocha (m²)</label><input name="rec_heatedArea" value={form.rec_heatedArea} onChange={handleChange} className="input" /></div>
              <div><label className="label">Počet poschodí</label><input name="rec_floors" value={form.rec_floors} onChange={handleChange} className="input" /></div>
              <div><label className="label">Tepelná strata [kW]</label><input name="rec_heatLoss" value={form.rec_heatLoss} onChange={handleChange} className="input" /></div>
              <div><label className="label">Ročná spotreba (plyn/drevo/peliet)</label><input name="rec_annualConsumption" value={form.rec_annualConsumption} onChange={handleChange} className="input" placeholder="napr. 1500 m³ plynu" /></div>
              <div><label className="label">Rok výstavby</label><input name="rec_constructionYear" value={form.rec_constructionYear} onChange={handleChange} className="input" /></div>
            </div>

            <div>
              <label className="label">Ako ste sa o nás dozvedeli?</label>
              <div className="flex flex-wrap gap-3 text-sm">
                {["Google","Google reklama","Facebook","Odporúčanie","Iné"].map((item) => (
                  <label key={item} className="chip">
                    <input type="radio" name="rec_sourceInfo" value={item} checked={form.rec_sourceInfo===item} onChange={handleChange} />
                    {item}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Zateplenie</label>
              <select name="rec_insulation" value={form.rec_insulation} onChange={handleChange} className="input">
                <option value="">-</option>
                <option value="áno">áno</option>
                <option value="nie">nie</option>
              </select>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div><label className="label">Zateplenie steny (typ a hrúbka)</label><input name="rec_insulationWalls" value={form.rec_insulationWalls} onChange={handleChange} className="input" /></div>
              <div><label className="label">Zateplenie podlahy (typ a hrúbka)</label><input name="rec_insulationFloor" value={form.rec_insulationFloor} onChange={handleChange} className="input" /></div>
              <div><label className="label">Zateplenie stropu (typ a hrúbka)</label><input name="rec_insulationCeiling" value={form.rec_insulationCeiling} onChange={handleChange} className="input" /></div>
            </div>

            <div>
              <label className="label">Aktuálny/existujúci zdroj tepla</label>
              <select name="rec_currentHeatSource" value={form.rec_currentHeatSource} onChange={handleChange} className="input">
                <option value="">-</option>
                <option value="tepelné čerpadlo">tepelné čerpadlo</option>
                <option value="plynový kotol (nekondenzačný)">plynový kotol (nekondenzačný)</option>
                <option value="plynový kotol (kondenzačný)">plynový kotol (kondenzačný)</option>
                <option value="elektrický kotol">elektrický kotol</option>
                <option value="kotol na tuhé palivo (bez akumulačného zásobníka)">kotol na tuhé palivo (bez akumulačného zásobníka)</option>
                <option value="kotol na tuhé palivo (s akumulačným zásobníkom)">kotol na tuhé palivo (s akumulačným zásobníkom)</option>
                <option value="teplovodný krb">teplovodný krb</option>
                <option value="iné">iné...</option>
              </select>
              {form.rec_currentHeatSource === "iné" && (
                <input name="rec_currentHeatSource_other" value={form.rec_currentHeatSource_other} onChange={handleChange} className="input mt-2" placeholder="Uveďte aký zdroj tepla" />
              )}
            </div>

            <div>
              <label className="label">Aktuálny zdroj tepla plánujem zachovať</label>
              <select name="rec_keepCurrentHeatSource" value={form.rec_keepCurrentHeatSource} onChange={handleChange} className="input">
                <option value="">-</option>
                <option value="áno">áno</option>
                <option value="nie">nie</option>
              </select>
            </div>

            <div>
              <label className="label">Aktuálny/existujúci systém vykurovania</label>
              <select name="rec_currentHeatingSystem" value={form.rec_currentHeatingSystem} onChange={handleChange} className="input">
                <option value="">-</option>
                <option value="podlahové">podlahové</option>
                <option value="stenové">stenové</option>
                <option value="radiátorové">radiátorové</option>
                <option value="kombinované (podlahové/radiátorové)">kombinované (podlahové/radiátorové)</option>
              </select>
            </div>

            <div>
              <label className="label">Max. teplota vykurovacej vody</label>
              <div className="flex flex-wrap gap-3 text-sm">
                {["do 40°C","do 50°C","do 65°C","viac ako 65°C"].map((item) => (
                  <label key={item} className="chip">
                    <input type="radio" name="rec_maxHeatingTemp" value={item} checked={form.rec_maxHeatingTemp===item} onChange={handleChange} />
                    {item}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Aktuálny/existujúci systém chladenia</label>
              <select name="rec_currentCooling" value={form.rec_currentCooling} onChange={handleChange} className="input">
                <option value="">-</option>
                <option value="stropné">stropné</option>
                <option value="podlahové">podlahové</option>
                <option value="stenové">stenové</option>
                <option value="klimatizácia">klimatizácia</option>
                <option value="nie">nie</option>
              </select>
            </div>

            <div>
              <label className="label">Priestorová / zónová regulácia</label>
              <select name="rec_zoneControl" value={form.rec_zoneControl} onChange={handleChange} className="input">
                <option value="">-</option>
                <option value="áno">áno</option>
                <option value="nie">nie</option>
                <option value="inteligentná elektroinštalácia / nadradená regulácia">inteligentná elektroinštalácia / nadradená regulácia</option>
              </select>
            </div>

            <div>
              <label className="label">Plánované využitie zdroja</label>
              <div className="flex flex-wrap gap-3 text-sm">
                {["vykurovanie","chladenie","vetranie","ohrev teplej vody","ohrev bazénovej vody"].map((item) => (
                  <label key={item} className="checkbox">
                    <input type="checkbox" name="rec_plannedUse" value={item} checked={form.rec_plannedUse.includes(item)} onChange={handleChange} />
                    {item}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Nový/uvažovaný zdroj</label>
              <select name="rec_newSource" value={form.rec_newSource} onChange={handleChange} className="input">
                <option value="">-</option>
                <option value="tepelné zem-voda (plošný kolektor)">tepelné zem-voda (plošný kolektor)</option>
                <option value="tepelné zem-voda (hlbinný vrt)">tepelné zem-voda (hlbinný vrt)</option>
                <option value="tepelné voda-voda">tepelné voda-voda</option>
                <option value="tepelné vzduch-voda">tepelné vzduch-voda</option>
                <option value="tepelné ventilačné">tepelné ventilačné</option>
                <option value="kotol plynový kondenzačný">kotol plynový kondenzačný</option>
                <option value="kotol elektrický">kotol elektrický</option>
              </select>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="label">Rekuperácia</label>
                <select name="rec_rekuperacia" value={form.rec_rekuperacia} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="áno">áno</option>
                  <option value="nie">nie</option>
                </select>
              </div>
              <div>
                <label className="label">Fotovoltaika</label>
                <select name="rec_fotovoltaika" value={form.rec_fotovoltaika} onChange={handleChange} className="input">
                  <option value="">-</option>
                  <option value="áno">áno</option>
                  <option value="nie">nie</option>
                </select>
              </div>
            </div>

            {/* upload – rekonštrukcia */}
            <div>
              <label className="label">Zašlite nám pôdorysy / technickú správu</label>
              <input type="file" multiple onChange={(e) => handleAddFiles(e, "rec")} className="input file:mr-3 file:py-2 file:px-3 file:border-0 file:bg-amber-100 file:text-amber-900" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
              <p className="text-xs text-slate-400 mt-1">Povolené: PDF, DOC, DOCX, JPG, PNG. Max. 5 MB/súbor. Limit spolu 20 MB.</p>

              {recUploads.length > 0 && (
                <ul className="space-y-2 mt-2">
                  {recUploads.map((u) => (
                    <li key={u.localId} className="flex items-center gap-3">
                      <button type="button" onClick={() => handleRemoveUpload(u.localId, "rec")} className="shrink-0 h-6 w-6 rounded-full border border-slate-300 hover:bg-slate-100 text-slate-500 flex items-center justify-center" title={u.status==="uploading" ? "Zrušiť nahrávanie" : "Odstrániť prílohu"}>×</button>
                      <div className="min-w-0 text-sm text-slate-700 truncate">{u.file.name}</div>
                      {u.status === "uploading" && (
                        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-2 bg-amber-500 transition-all" style={{ width: `${u.progress}%` }} />
                        </div>
                      )}
                      {u.status === "done" && <span className="text-emerald-600 text-sm">✓</span>}
                      {u.status === "error" && <span className="text-red-600 text-sm">✕</span>}
                      {u.status === "deleting" && <span className="text-slate-400 text-xs">odstraňujem…</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="label">Poznámky a iné požiadavky</label>
              <textarea name="rec_note" value={form.rec_note} onChange={handleChange} className="input min-h-[80px]" />
            </div>
          </section>
        </div>

        {/* GDPR + SUBMIT */}
        <section className="space-y-4">
          <label className="flex gap-3 items-start text-sm text-slate-600">
            <input type="checkbox" name="gdpr" checked={form.gdpr} onChange={handleChange} onBlur={handleBlur} className="mt-1" />
            Súhlasím so spracovaním osobných údajov na účely spracovania mojej požiadavky <a className="underline" href="https://www.geotherm.sk/o-nas/ochrana-osobnych-udajov/">(OOÚ)</a>.
          </label>
          {errors.gdpr && <p className="error-text">{errors.gdpr}</p>}

          <button type="submit" disabled={phase==="submitting" || !canSubmit} className={`w-full inline-flex justify-center items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition ${phase==="submitting" || !canSubmit ? "opacity-80 cursor-not-allowed" : ""}`}>
            {hasUploading ? "Čakám na nahratie príloh…" : hasDeleting ? "Odstraňujem prílohu…" : "Odoslať formulár"}
          </button>
          {hasError && <p className="error-text mt-1">Skontrolujte neúspešné prílohy a skúste ich znova nahrať.</p>}
        </section>

        <footer className="text-center text-xs text-slate-400 pt-4 border-t">
          Ak by sa formulár nepodarilo odoslať, kontaktujte nás na <span className="text-slate-500 font-medium">+421 905 665 755</span> alebo <a href="mailto:sturdik@geotherm.sk" className="underline">sturdik@geotherm.sk</a>.
        </footer>
      </form>

      <style>{`
        .label { display:block; font-size:0.75rem; font-weight:500; margin-bottom:0.25rem; color:#0f172a; }
        .input { width:100%; background:#fff; border:1px solid #e2e8f0; border-radius:0.75rem; padding:0.55rem 0.9rem; font-size:0.9rem; transition:all .15s; }
        .input:focus { outline:none; border-color:#f59e0b; box-shadow:0 0 0 3px rgba(245,158,11,.1); }
        .input-error { border-color:#f43f5e; }
        .error-text { margin-top:0.3rem; font-size:0.75rem; color:#be123c; }
        .radio,.checkbox { display:inline-flex; gap:.4rem; align-items:center; font-size:.85rem; color:#0f172a; }
        .chip { display:inline-flex; align-items:center; gap:.4rem; background:#f8fafc; border:1px solid transparent; padding:.4rem .7rem; border-radius:9999px; font-size:.8rem; cursor:pointer; transition:all .15s; }
        .chip input { accent-color:#f59e0b; }
        .chip:hover { border-color:#facc15; background:#fff; }
      `}</style>
    </div>
  );
}

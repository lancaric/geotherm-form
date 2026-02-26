// backend/server.js
import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";
import crypto from "crypto";

dotenv.config();

const app = express();

/* ---------------- Security (CSP, headers) ---------------- */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", process.env.FRONTEND_URL, process.env.BACKEND_URL],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        mediaSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        manifestSrc: ["'self'"],
      },
    },
  })
);

// CORS (vývoj voľný; v produkcii zúžte na FE doménu)
app.use(cors({ origin: true }));
// app.use(cors({ origin: "https://tvoja-domena.sk" }));

app.use(express.json({ limit: "1mb" }));

/* ---------------- Rate limit iba na form submit ---------------- */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/form", limiter);

/* ---------------- Upload úložisko ---------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use("/uploads", express.static(UPLOAD_DIR));

const okTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/jpg",
  "image/png",
];

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    cb(null, `${uuid()}${ext}`);
  },
});
const diskUpload = multer({
  storage: diskStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB / súbor
  fileFilter(req, file, cb) {
    if (!okTypes.includes(file.mimetype)) return cb(new Error("Nepovolený typ súboru."));
    cb(null, true);
  },
});

function isSafeUploadPath(p) {
  try {
    const resolved = path.resolve(p);
    const base = path.resolve(UPLOAD_DIR) + path.sep;
    return resolved.startsWith(base);
  } catch {
    return false;
  }
}

/* ---------------- SMTP ---------------- */
const {
  PORT = 4000,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  FROM_EMAIL,
  FIRM_EMAILS,
  BACKEND_URL,
  RETAIN_UPLOADS, // "true" = nenechávať cleanup po odoslaní (debug)
} = process.env;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT) || 587,
  secure: SMTP_SECURE === "true",
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  // zrýchlenie: držíme spojenia
  pool: true,
  maxConnections: 2,
  maxMessages: 50,
});

/* ---------------- In-memory job storage (pre produkciu: Redis/BullMQ) ---------------- */
const jobs = new Map(); // jobId -> { status: "pending"|"sent_firm"|"sent_user"|"error", error?: string }
function newJobId() {
  return crypto.randomBytes(8).toString("hex");
}

/* ---------------- Helpers ---------------- */
function parseMaybeJSON(v) {
  if (typeof v === "string" && (v.trim().startsWith("[") || v.trim().startsWith("{"))) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}
function onlyFilled(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    const val = Array.isArray(v) ? v.filter(Boolean).join(", ") : v;
    if (val !== undefined && val !== null && String(val).trim() !== "") out[k] = val;
  });
  return out;
}

const BodySchema = z
  .object({
    name: z.string().min(2, "Meno je povinné"),
    phone: z.string().regex(/^[0-9 +()/.\-]{7,}$/, "Telefón nie je platný"),
    email: z.string().email("E-mail nie je platný"),
    place: z.string().min(2, "Miesto je povinné"),
    buildingType: z.string().optional(),
    installTime: z.string().optional(),
    gdpr: z.union([z.literal("true"), z.literal(true)]),
    hp_company: z.string().max(0).optional(),
    uploadedFiles: z
      .array(
        z.object({
          filename: z.string(),
          originalname: z.string(),
          mimetype: z.string(),
          size: z.number(),
          path: z.string(),
          url: z.string().optional(),
        })
      )
      .optional(),
  })
  .passthrough();

const section = (title, obj) =>
  Object.keys(obj).length
    ? `<h3 style="margin:16px 0 8px">${title}</h3>
       <table style="border-collapse:collapse;width:100%">${Object.entries(obj)
         .map(
           ([k, v]) =>
             `<tr>
                <td style="border:1px solid #eee;padding:6px 8px;width:40%"><strong>${k}</strong></td>
                <td style="border:1px solid #eee;padding:6px 8px">${v}</td>
              </tr>`
         )
         .join("")}
       </table>`
    : "";

/* ---------------- API: upload jednej prílohy ---------------- */
app.post("/api/upload", diskUpload.single("file"), (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ success: false, message: "Súbor sa neuložil." });

  const filename = path.basename(f.path);
  const fileRef = {
    filename,
    originalname: f.originalname,
    mimetype: f.mimetype,
    size: f.size,
    path: f.path,
    url: `${BACKEND_URL || ""}/uploads/${filename}`,
  };
  return res.status(200).json({ success: true, file: fileRef });
});

/* ---------------- API: zmazanie nahratého súboru ---------------- */
app.delete("/api/upload/:filename", (req, res) => {
  const name = path.basename(req.params.filename || "");
  const full = path.join(UPLOAD_DIR, name);
  if (!isSafeUploadPath(full)) return res.status(400).json({ success: false, message: "Neplatná cesta." });

  fs.unlink(full, (err) => {
    if (err && err.code !== "ENOENT") {
      console.error("Delete error:", err);
      return res.status(500).json({ success: false });
    }
    return res.json({ success: true });
  });
});

/* ---------------- API: submit formulára (vracia jobId a spúšťa pozadie) ---------------- */
app.post("/api/form", async (req, res) => {
  try {
    const raw = { ...req.body };
    const data = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, parseMaybeJSON(v)]));

    // honeypot
    if (data.hp_company) {
      return res.status(400).json({ success: false, message: "Zamietnuté." });
    }

    const parsed = BodySchema.safeParse(data);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Neplatné údaje.";
      return res.status(400).json({ success: false, message: msg });
    }

    // celkový limit 20 MB (bezpečnostná poistka)
    const uploaded = Array.isArray(data.uploadedFiles) ? data.uploadedFiles : [];
    const totalBytes = uploaded.reduce((s, f) => s + (Number(f.size) || 0), 0);
    if (totalBytes > 40 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: "Súbory spolu môžu mať max. 40 MB." });
    }

    // attachments (ak ich chceš posielať priamo v e-maile)
    const attachments = uploaded.map((f) => ({
      filename: f.originalname || "priloha",
      path: f.path,
      contentType: f.mimetype,
    }));

    const basics = onlyFilled({
      "Meno": data.name,
      "Telefón": data.phone,
      "E-mail": data.email,
      "Miesto stavby": data.place,
      "Typ budovy": data.buildingType,
      "Termín inštalácie": data.installTime,
      "GDPR súhlas": data.gdpr === true || data.gdpr === "true" ? "áno" : "nie",
    });

    const nb = onlyFilled({
      "Vykurovaná plocha": data.nb_heatedArea,
      "Poschodí": data.nb_floors,
      "Tepelná strata [kW]": data.nb_heatLoss,
      "Aktuálny stav": data.nb_actualState,
      "Ako ste sa dozvedeli": data.nb_sourceInfo,
      "Tepelné čerpadlo": data.nb_hp,
      "Kotol": data.nb_boiler,
      "Solárny systém": data.nb_solar,
      "Rekuperácia": data.nb_rekuperacia,
      "Fotovoltaika": data.nb_fv,
      "Plánované využitie": data.nb_plannedUse,
      "Vykurovanie domu": data.nb_systemHeating,
      "Chladenie domu": data.nb_systemCooling,
      "Zónová regulácia": data.nb_zoneControl,
      "Poznámky": data.nb_note,
    });

    const rec = onlyFilled({
      "Vykurovaná plocha": data.rec_heatedArea,
      "Poschodí": data.rec_floors,
      "Tepelná strata [kW]": data.rec_heatLoss,
      "Ročná spotreba": data.rec_annualConsumption,
      "Rok výstavby": data.rec_constructionYear,
      "Ako ste sa dozvedeli": data.rec_sourceInfo,
      "Zateplenie": data.rec_insulation,
      "Zateplenie steny": data.rec_insulationWalls,
      "Zateplenie podlahy": data.rec_insulationFloor,
      "Zateplenie stropu": data.rec_insulationCeiling,
      "Aktuálny zdroj tepla":
        data.rec_currentHeatSource === "iné"
          ? `iné – ${data.rec_currentHeatSource_other || ""}`.trim()
          : data.rec_currentHeatSource,
      "Zdroj tepla plánujem zachovať": data.rec_keepCurrentHeatSource,
      "Aktuálny systém vykurovania": data.rec_currentHeatingSystem,
      "Max. teplota vykurovacej vody": data.rec_maxHeatingTemp,
      "Aktuálny systém chladenia": data.rec_currentCooling,
      "Zónová regulácia": data.rec_zoneControl,
      "Plánované využitie": data.rec_plannedUse,
      "Nový/uvažovaný zdroj": data.rec_newSource,
      "Rekuperácia": data.rec_rekuperacia,
      "Fotovoltaika": data.rec_fotovoltaika,
      "Poznámky": data.rec_note,
    });

    const linksHtml =
      uploaded.length > 0
        ? `<h3 style="margin:16px 0 8px">Prílohy (online)</h3><ul>${uploaded
            .map(
              (f, i) =>
                `<li><a href="${f.url}" target="_blank" rel="noopener">Príloha ${i + 1} – ${f.originalname}</a></li>`
            )
            .join("")}</ul>`
        : "";

    const formType =
      data.reconstruction === true || data.reconstruction === "true"
        ? "Rekonštrukcia"
        : data.newBuild === true || data.newBuild === "true"
        ? "Novostavba"
        : "Novostavba";
    const firmSubject = `GEOTHERM Formulár ${data.name}, ${data.place}, ${formType}`;

    const firmHtml = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
        <h2 style="margin:0 0 12px">Geotherm – nový dopyt z webu</h2>
        ${section("Kontaktné údaje", basics)}
        ${section("Novostavba – podrobnosti", nb)}
        ${section("Rekonštrukcia – podrobnosti", rec)}
        ${linksHtml}
        ${attachments.length ? `<p style="margin-top:12px"><strong>Prílohy v správe:</strong> ${attachments.length} ks</p>` : ""}
      </div>
    `;

    // ---------- Pozadie: pošli maily v poradí firma → užívateľ ----------
    const jobId = newJobId();
    jobs.set(jobId, { status: "pending" });

    // odpoveď pre FE okamžite
    res.status(200).json({ success: true, jobId });

    (async () => {
      try {
        // 1) e-mail firme
        await transporter.sendMail({
          from: FROM_EMAIL || SMTP_USER,
          to: FIRM_EMAILS || SMTP_USER,
          subject: firmSubject,
          html: firmHtml,
          attachments, // ak chceš len linky: []
        });
        jobs.set(jobId, { status: "sent_firm" });

        // 2) e-mail zákazníkovi (potvrdenie)
        await transporter.sendMail({
          from: FROM_EMAIL || SMTP_USER,
          to: data.email,
          subject: "Vaša požiadavka bola prijatá",
          html: `
            <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">
              <p><strong>Dobrý deň p. ${data.name}.</strong></p>
              <p>Vašu žiadosť sme prijali a čoskoro Vás budeme kontaktovať.</p>
              <p>Ďakujeme Vám za záujem o naše služby. Ihneď ako to bude možné sa Vám ozveme pre spresnenie informácií na uvedený telefonický kontakt a navrhneme najvhodnejšie riešenie.</p>
              <p>
                Ak by ste mali nejaké otázky, <a href="https://www.geotherm.sk/kontakt">kontaktujte nás prosím</a>.
                Pre informácie o OOU: <a href="https://www.geotherm.sk/o-nas/ochrana-osobnych-udajov/">Ochrana osobných údajov.</a>
              </p>
              <p>
                Ak práve porovnávate viac ponúk a hlava sa vám točí z technických výrazov, naše články vám
                <strong> ľudskou rečou vysvetlia základné rozdiely a úskalia pri návrhu vykurovania, vetrania a chladenia domu.</strong>
                <a href="https://www.geotherm.sk/odborne-clanky"> Zobraziť odborné články.</a>
              </p>
              <p><strong>GEOTHERM Slovakia – váš partner pre komfortný a úsporný domov</strong></p>
              <p>Už viac ako 19 rokov navrhujeme a montujeme tepelné čerpadlá Vaillant a NIBE, podlahové vykurovanie, stropné chladenie a vetranie Zehnder, ktoré spolu tvoria tichý a úsporný systém pre váš dom. <strong>Každé riešenie robíme na mieru vášmu domu a štýlu bývania, aby ste mali komfort, nižšie účty a istotu spoľahlivej techniky.</strong></p>
              <p>S GEOTHERMOM nezískavate len technológiu, ale partnera, ktorému môžete veriť. Viac o nás sa dozviete na: <a href="https://www.geotherm.sk">www.geotherm.sk</a></p>
              <p>S pozdravom</p>
              <p><strong>Tím spoločnosti GEOTHERM Slovakia s.r.o.</strong></p>
            </div>
          `,
        });
        jobs.set(jobId, { status: "sent_user" });

        // 3) cleanup súborov po úspechu
        if (RETAIN_UPLOADS !== "true") {
          for (const f of uploaded) {
            const full = path.resolve(f.path);
            if (isSafeUploadPath(full)) {
              try {
                fs.unlinkSync(full);
              } catch (e) {
                console.warn("Cleanup error:", e?.message || e);
              }
            }
          }
        }
      } catch (err) {
        console.error("BG mail error:", err);

        // pokus informovať užívateľa o chybe pri doručení do firmy
        try {
        await transporter.sendMail({
          from: FROM_EMAIL || SMTP_USER,
          to: data.email,
          subject: "Odoslanie žiadosti – chyba",
            html: `
              <p>Dobrý deň, ${data.name},</p>
              <p>vašu žiadosť sme prijali, ale pri doručení správy do firmy nastala dočasná chyba.</p>
              <p>Skúste to prosím znova, alebo nás kontaktujte telefonicky.</p>
            `,
          });
        } catch {}

        jobs.set(jobId, { status: "error", error: err?.message || "Mail error" });
      }
    })();
  } catch (err) {
    console.error("Form submit error:", err);
    return res.status(500).json({ success: false, message: "Nepodarilo sa prijať žiadosť." });
  }
});

/* ---------------- API: zistenie statusu jobu (voliteľné) ---------------- */
app.get("/api/form-status/:id", (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ success: false });
  res.json({ success: true, ...j });
});

/* ---------------- Štart ---------------- */
const port = Number(PORT) || 4000;
app.listen(port, () => console.log(`✅ Server beží na http://localhost:${port}`));

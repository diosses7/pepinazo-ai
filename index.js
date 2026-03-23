require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// MIDDLEWARES
// =========================
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// =========================
// VARIABLES DE ENTORNO
// =========================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// =========================
// CONFIG TABLAS
// =========================
const SHORT_MEMORY_TABLE = "memoria";
const LONG_MEMORY_TABLE = "memoria_larga";
const PROFILE_TABLE = "perfil_usuario";

const USER_COLUMN = "id_usuario";
const MESSAGE_COLUMN = "mensaje";

// =========================
// EXCEL FINANZAS
// =========================
const EXCEL_PATH = path.join(__dirname, "Excel gastos.xlsx");

// =========================
// HELPERS GENERALES
// =========================
function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function nowISO() {
  return new Date().toISOString();
}

function normalizeText(value = "") {
  return String(value).trim();
}

function sanitizeForDb(value = "") {
  return String(value || "").replace(/\u0000/g, "").trim();
}

// =========================
// FILTROS DE MEMORIA
// =========================
function shouldSaveMemory(message) {
  if (!message) return false;

  const text = message.toLowerCase().trim();

  const blacklist = [
    "hola",
    "ok",
    "oki",
    "okey",
    "gracias",
    "vale",
    "bueno",
    "listo",
    "perfecto",
    "dale",
    "ya",
    "jaj",
    "jaja",
    "jeje",
    "jj",
    "👍",
    "👌",
    "test",
    "probando",
    "123",
    "hi",
    "hello"
  ];

  if (text.length < 12) return false;
  if (blacklist.includes(text)) return false;

  const junkPatterns = [
    /^ok+$/i,
    /^j+a+j+a*$/i,
    /^j+e+j+e*$/i,
    /^[0-9\s]+$/,
    /^[\W_]+$/
  ];

  if (junkPatterns.some((pattern) => pattern.test(text))) return false;

  return true;
}

function shouldPromoteToLongMemory(message) {
  if (!message) return false;

  const text = message.toLowerCase();

  const triggers = [
    "recuerda",
    "guardar",
    "guarda esto",
    "importante",
    "desde ahora",
    "a futuro",
    "mi objetivo",
    "mi plan",
    "quiero que recuerdes",
    "no olvides",
    "pepínazo",
    "pepinazo ai",
    "proyecto",
    "roadmap",
    "estrategia",
    "inversión",
    "inmobiliaria",
    "barf",
    "mavencia"
  ];

  return triggers.some((t) => text.includes(t)) || text.length > 180;
}

function summarizeUserMessage(message) {
  const clean = sanitizeForDb(message);
  if (clean.length <= 220) return clean;
  return clean.slice(0, 217) + "...";
}

// =========================
// HELPERS OPENAI
// =========================
async function callOpenAIResponsesAPI(userMessage, contextText = "") {
  if (!OPENAI_API_KEY) {
    return "Falta configurar OPENAI_API_KEY en variables de entorno.";
  }

  const systemPrompt = `
Eres Pepinazo AI, un asistente útil, claro, inteligente y directo.
Tu estilo debe ser profesional pero cercano.
Responde en español.
Si existe contexto del usuario, úsalo sin inventar información.
No digas que tienes memoria infinita.
No uses formato JSON salvo que se te pida.
${contextText ? `\nContexto disponible:\n${contextText}` : ""}
`;

  const payload = {
    model: "gpt-5",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userMessage }]
      }
    ]
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Error OpenAI:", data);
    const msg =
      data?.error?.message ||
      "Error consultando OpenAI. Revisa la API key y el endpoint.";
    throw new Error(msg);
  }

  // Compatibilidad flexible con posibles formatos de salida
  const outputText =
    data?.output_text ||
    data?.output?.map((item) => {
      if (!item?.content) return "";
      return item.content
        .map((c) => c?.text || c?.value || "")
        .join(" ");
    }).join(" ").trim();

  return outputText || "No pude generar una respuesta en este momento.";
}

// =========================
// HELPERS SUPABASE
// =========================
function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
}

async function supabaseSelect(table, query = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;

  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders()
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`Supabase SELECT error (${table}):`, data);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function supabaseInsert(table, rows) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;

  const response = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify(rows)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(`Supabase INSERT error (${table}):`, data);
    return null;
  }

  return data;
}

async function supabaseUpsert(table, rows, onConflict) {
  const headers = {
    ...supabaseHeaders(),
    Prefer: "resolution=merge-duplicates,return=representation"
  };

  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(
    onConflict
  )}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(rows)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(`Supabase UPSERT error (${table}):`, data);
    return null;
  }

  return data;
}

async function getShortMemory(userId = "default") {
  if (!hasSupabaseConfig()) return [];

  const query = `?select=id,${USER_COLUMN},${MESSAGE_COLUMN},created_at&${USER_COLUMN}=eq.${encodeURIComponent(
    userId
  )}&order=created_at.desc&limit=12`;

  return await supabaseSelect(SHORT_MEMORY_TABLE, query);
}

async function getLongMemory(userId = "default") {
  if (!hasSupabaseConfig()) return [];

  const query = `?select=id,${USER_COLUMN},${MESSAGE_COLUMN},created_at&${USER_COLUMN}=eq.${encodeURIComponent(
    userId
  )}&order=created_at.desc&limit=12`;

  return await supabaseSelect(LONG_MEMORY_TABLE, query);
}

async function getProfile(userId = "default") {
  if (!hasSupabaseConfig()) return null;

  const query = `?select=*&${USER_COLUMN}=eq.${encodeURIComponent(
    userId
  )}&limit=1`;

  const rows = await supabaseSelect(PROFILE_TABLE, query);
  return rows[0] || null;
}

async function saveShortMemory(userId, message) {
  if (!hasSupabaseConfig()) return null;
  if (!shouldSaveMemory(message)) return null;

  const clean = summarizeUserMessage(message);

  return await supabaseInsert(SHORT_MEMORY_TABLE, [
    {
      [USER_COLUMN]: userId,
      [MESSAGE_COLUMN]: clean,
      created_at: nowISO()
    }
  ]);
}

async function saveLongMemory(userId, message) {
  if (!hasSupabaseConfig()) return null;
  if (!shouldPromoteToLongMemory(message)) return null;

  const clean = summarizeUserMessage(message);

  return await supabaseInsert(LONG_MEMORY_TABLE, [
    {
      [USER_COLUMN]: userId,
      [MESSAGE_COLUMN]: clean,
      created_at: nowISO()
    }
  ]);
}

async function updateProfileFromMessage(userId, message) {
  if (!hasSupabaseConfig()) return null;
  if (!message || message.trim().length < 20) return null;

  const currentProfile = await getProfile(userId);

  const existingNotes = currentProfile?.notas || "";
  const newNote = summarizeUserMessage(message);

  const mergedNotes = [existingNotes, newNote]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 1500);

  return await supabaseUpsert(
    PROFILE_TABLE,
    [
      {
        [USER_COLUMN]: userId,
        notas: mergedNotes,
        updated_at: nowISO()
      }
    ],
    USER_COLUMN
  );
}

function buildContextText(profile, shortMemory, longMemory) {
  const parts = [];

  if (profile) {
    parts.push(
      `Perfil del usuario: ${JSON.stringify(profile, null, 2)}`
    );
  }

  if (Array.isArray(shortMemory) && shortMemory.length) {
    const lines = shortMemory
      .map((m, i) => `${i + 1}. ${m[MESSAGE_COLUMN]}`)
      .join("\n");
    parts.push(`Memoria reciente:\n${lines}`);
  }

  if (Array.isArray(longMemory) && longMemory.length) {
    const lines = longMemory
      .map((m, i) => `${i + 1}. ${m[MESSAGE_COLUMN]}`)
      .join("\n");
    parts.push(`Memoria importante:\n${lines}`);
  }

  return parts.join("\n\n");
}

// =========================
// HELPERS EXCEL
// =========================
function excelValueToDate(value) {
  if (!value) return null;

  if (value instanceof Date && !isNaN(value)) {
    return value;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d);
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) return null;

  return date;
}

function normalizeMoney(value) {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const cleaned = value
      .replace(/\$/g, "")
      .replace(/\./g, "")
      .replace(/,/g, ".")
      .replace(/[^\d.-]/g, "");

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function readExcelSheet(sheetName) {
  if (!fs.existsSync(EXCEL_PATH)) {
    return [];
  }

  const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) return [];

  return XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false
  });
}

function readExcelData() {
  try {
    return readExcelSheet("Gastos diarios");
  } catch (error) {
    console.error("Error leyendo hoja Gastos diarios:", error);
    return [];
  }
}

function buildFinancialSummary(rows) {
  if (!Array.isArray(rows)) return [];

  return rows.map((row, index) => {
    const keys = Object.keys(row);
    const lowerMap = {};

    keys.forEach((k) => {
      lowerMap[k.toLowerCase()] = row[k];
    });

    const fechaRaw =
      lowerMap["fecha"] ||
      lowerMap["día"] ||
      lowerMap["dia"] ||
      lowerMap["date"] ||
      "";

    const categoria =
      lowerMap["categoría"] ||
      lowerMap["categoria"] ||
      lowerMap["tipo"] ||
      lowerMap["item"] ||
      "Sin categoría";

    const descripcion =
      lowerMap["descripción"] ||
      lowerMap["descripcion"] ||
      lowerMap["detalle"] ||
      lowerMap["concepto"] ||
      "";

    const montoRaw =
      lowerMap["monto"] ||
      lowerMap["valor"] ||
      lowerMap["total"] ||
      lowerMap["gasto"] ||
      0;

    const fechaDate = excelValueToDate(fechaRaw);
    const monto = normalizeMoney(montoRaw);

    return {
      id: index + 1,
      fecha: fechaDate ? fechaDate.toISOString().slice(0, 10) : String(fechaRaw || ""),
      categoria: String(categoria || "Sin categoría"),
      descripcion: String(descripcion || ""),
      monto
    };
  });
}

// =========================
// RUTA RAÍZ
// =========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =========================
// HEALTHCHECK
// =========================
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Pepinazo AI",
    time: nowISO(),
    openaiConfigured: Boolean(OPENAI_API_KEY),
    supabaseConfigured: hasSupabaseConfig(),
    excelFound: fs.existsSync(EXCEL_PATH)
  });
});

// =========================
// API CHAT
// =========================
app.post("/api/chat", async (req, res) => {
  try {
    const { message, userId = "default" } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        ok: false,
        reply: "Mensaje inválido."
      });
    }

    const cleanMessage = normalizeText(message);

    let shortMemory = [];
    let longMemory = [];
    let profile = null;

    if (hasSupabaseConfig()) {
      try {
        [shortMemory, longMemory, profile] = await Promise.all([
          getShortMemory(userId),
          getLongMemory(userId),
          getProfile(userId)
        ]);
      } catch (memoryError) {
        console.error("Error cargando contexto:", memoryError);
      }
    }

    const contextText = buildContextText(profile, shortMemory, longMemory);
    const reply = await callOpenAIResponsesAPI(cleanMessage, contextText);

    if (hasSupabaseConfig()) {
      try {
        await saveShortMemory(userId, cleanMessage);
        await saveLongMemory(userId, cleanMessage);
        await updateProfileFromMessage(userId, cleanMessage);
      } catch (saveError) {
        console.error("Error guardando memoria/perfil:", saveError);
      }
    }

    return res.json({
      ok: true,
      reply
    });
  } catch (error) {
    console.error("Error en /api/chat:", error);

    return res.status(500).json({
      ok: false,
      reply: error.message || "Error interno del servidor."
    });
  }
});

// =========================
// API MEMORIA
// =========================
app.get("/api/memory", async (req, res) => {
  try {
    const userId = req.query.userId || "default";

    if (!hasSupabaseConfig()) {
      return res.json({
        ok: true,
        shortMemory: [],
        longMemory: [],
        profile: null,
        warning: "Supabase no está configurado."
      });
    }

    const [shortMemory, longMemory, profile] = await Promise.all([
      getShortMemory(userId),
      getLongMemory(userId),
      getProfile(userId)
    ]);

    res.json({
      ok: true,
      shortMemory,
      longMemory,
      profile
    });
  } catch (error) {
    console.error("Error en /api/memory:", error);
    res.status(500).json({
      ok: false,
      error: "No se pudo obtener la memoria."
    });
  }
});

// =========================
// API PERFIL
// =========================
app.get("/api/profile", async (req, res) => {
  try {
    const userId = req.query.userId || "default";

    if (!hasSupabaseConfig()) {
      return res.json({
        ok: true,
        profile: null,
        warning: "Supabase no está configurado."
      });
    }

    const profile = await getProfile(userId);

    res.json({
      ok: true,
      profile
    });
  } catch (error) {
    console.error("Error en /api/profile:", error);
    res.status(500).json({
      ok: false,
      error: "No se pudo obtener el perfil."
    });
  }
});

// =========================
// API EXCEL RAW
// =========================
app.get("/api/excel", (req, res) => {
  try {
    const rows = readExcelData();

    res.json({
      ok: true,
      fileFound: fs.existsSync(EXCEL_PATH),
      rowsCount: rows.length,
      data: rows
    });
  } catch (error) {
    console.error("Error en /api/excel:", error);
    res.status(500).json({
      ok: false,
      error: "Error leyendo Excel."
    });
  }
});

// =========================
// API RESUMEN FINANCIERO
// =========================
app.get("/api/financial-summary", (req, res) => {
  try {
    const rows = readExcelData();
    const normalized = buildFinancialSummary(rows);

    const total = normalized.reduce((acc, row) => acc + row.monto, 0);

    const byCategoryMap = {};
    const byMonthMap = {};

    for (const row of normalized) {
      const category = row.categoria || "Sin categoría";
      byCategoryMap[category] = (byCategoryMap[category] || 0) + row.monto;

      const month = row.fecha ? String(row.fecha).slice(0, 7) : "Sin fecha";
      byMonthMap[month] = (byMonthMap[month] || 0) + row.monto;
    }

    const byCategory = Object.entries(byCategoryMap)
      .map(([categoria, monto]) => ({ categoria, monto }))
      .sort((a, b) => b.monto - a.monto);

    const byMonth = Object.entries(byMonthMap)
      .map(([mes, monto]) => ({ mes, monto }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    res.json({
      ok: true,
      fileFound: fs.existsSync(EXCEL_PATH),
      total,
      movimientos: normalized.length,
      byCategory,
      byMonth,
      items: normalized
    });
  } catch (error) {
    console.error("Error en /api/financial-summary:", error);
    res.status(500).json({
      ok: false,
      error: "No se pudo generar el resumen financiero."
    });
  }
});

// =========================
// 404 API
// =========================
app.use("/api/*", (req, res) => {
  res.status(404).json({
    ok: false,
    error: "Ruta API no encontrada."
  });
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`✅ Pepinazo AI corriendo en puerto ${PORT}`);
  console.log(`🧠 Supabase: ${hasSupabaseConfig() ? "configurado" : "no configurado"}`);
  console.log(`🤖 OpenAI: ${OPENAI_API_KEY ? "configurado" : "no configurado"}`);
  console.log(`📊 Excel: ${fs.existsSync(EXCEL_PATH) ? "encontrado" : "no encontrado"}`);
});

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// MIDDLEWARES
// =========================
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// =========================
// VARIABLES DE ENTORNO
// =========================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// =========================
// CONFIG
// =========================
const SHORT_MEMORY_TABLE = "memoria";
const LONG_MEMORY_TABLE = "memoria_larga";
const PROFILE_TABLE = "perfil_usuario";

const USER_COLUMN = "id_usuario";
const MESSAGE_COLUMN = "mensaje";

const DATA_DIR = path.join(__dirname, "data");
const SHORT_MEMORY_FILE = path.join(DATA_DIR, "memoria.json");
const LONG_MEMORY_FILE = path.join(DATA_DIR, "memoria_larga.json");
const PROFILE_FILE = path.join(DATA_DIR, "perfil_usuario.json");
const FINANCE_FILE = path.join(DATA_DIR, "finance_data.json");

// =========================
// HELPERS GENERALES
// =========================
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureJsonFile(filePath, defaultValue = []) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
  }
}

function readJsonFile(filePath, defaultValue = []) {
  try {
    ensureJsonFile(filePath, defaultValue);
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Error leyendo ${filePath}:`, error.message);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error(`Error escribiendo ${filePath}:`, error.message);
    return false;
  }
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function nowISO() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getStorageFileByTable(tableName) {
  if (tableName === SHORT_MEMORY_TABLE) return SHORT_MEMORY_FILE;
  if (tableName === LONG_MEMORY_TABLE) return LONG_MEMORY_FILE;
  if (tableName === PROFILE_TABLE) return PROFILE_FILE;
  return null;
}

function getKindFromTable(tableName) {
  if (tableName === SHORT_MEMORY_TABLE) return "short";
  if (tableName === LONG_MEMORY_TABLE) return "long";
  if (tableName === PROFILE_TABLE) return "profile";
  return "unknown";
}

function getTableFromKind(kind) {
  const safeKind = String(kind || "").toLowerCase().trim();

  if (safeKind === "short" || safeKind === "recent" || safeKind === "memoria") {
    return SHORT_MEMORY_TABLE;
  }

  if (safeKind === "long" || safeKind === "larga" || safeKind === "memoria_larga") {
    return LONG_MEMORY_TABLE;
  }

  if (safeKind === "profile" || safeKind === "perfil") {
    return PROFILE_TABLE;
  }

  return SHORT_MEMORY_TABLE;
}

function sortByDateDesc(items) {
  return [...items].sort((a, b) => {
    const ad = new Date(a.updated_at || a.created_at || 0).getTime();
    const bd = new Date(b.updated_at || b.created_at || 0).getTime();
    return bd - ad;
  });
}

// =========================
// FILTRO DE MEMORIA
// =========================
function shouldSaveMemory(message) {
  if (!message) return false;

  const text = normalizeText(message).toLowerCase();

  const blacklist = [
    "hola",
    "ok",
    "oki",
    "gracias",
    "vale",
    "listo",
    "dale",
    "ya",
    "jaja",
    "jeje",
    "jj",
    "👍",
    "👌",
    "probando",
    "test",
    "123",
    "hi",
    "hello"
  ];

  if (text.length < 8) return false;
  if (blacklist.includes(text)) return false;

  return true;
}

function detectProfileMessage(message) {
  const text = normalizeText(message).toLowerCase();

  const profilePatterns = [
    "me gusta",
    "prefiero",
    "quiero que",
    "recuerda que",
    "acuérdate que",
    "mi objetivo",
    "mi meta",
    "desde ahora",
    "a futuro",
    "para futuras conversaciones",
    "guarda esto",
    "guarda esta info",
    "mi estilo",
    "mi preferencia"
  ];

  return profilePatterns.some((pattern) => text.includes(pattern));
}

function detectLongMemoryMessage(message) {
  const text = normalizeText(message).toLowerCase();

  const longPatterns = [
    "proyecto",
    "roadmap",
    "estrategia",
    "plan",
    "negocio",
    "inversión",
    "app",
    "pepinazo ai",
    "objetivo",
    "aprendizaje",
    "continuar mañana",
    "guardar esto",
    "guardar toda esta info",
    "retomar",
    "siguiente paso"
  ];

  return longPatterns.some((pattern) => text.includes(pattern));
}

function classifyMemoryType(message, explicitKind = "") {
  const safeKind = String(explicitKind || "").toLowerCase().trim();

  if (safeKind === "profile" || safeKind === "perfil") return PROFILE_TABLE;
  if (safeKind === "long" || safeKind === "larga") return LONG_MEMORY_TABLE;
  if (safeKind === "short" || safeKind === "recent") return SHORT_MEMORY_TABLE;

  if (detectProfileMessage(message)) return PROFILE_TABLE;
  if (detectLongMemoryMessage(message)) return LONG_MEMORY_TABLE;
  return SHORT_MEMORY_TABLE;
}

// =========================
// SUPABASE HELPERS
// =========================
async function supabaseRequest(endpoint, options = {}) {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase no configurado");
  }

  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${endpoint.replace(/^\//, "")}`;

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const json = safeJsonParse(text, text);

  if (!response.ok) {
    throw new Error(
      typeof json === "string" ? json : JSON.stringify(json)
    );
  }

  return json;
}

async function dbList(tableName, userId, limit = 50) {
  if (hasSupabaseConfig()) {
    const endpoint =
      `${tableName}?select=*&${USER_COLUMN}=eq.${encodeURIComponent(userId)}&order=updated_at.desc.nullslast,created_at.desc&limit=${limit}`;
    return await supabaseRequest(endpoint);
  }

  const file = getStorageFileByTable(tableName);
  const items = readJsonFile(file, []);
  return sortByDateDesc(items.filter((item) => item[USER_COLUMN] === userId)).slice(0, limit);
}

async function dbInsert(tableName, payload) {
  if (hasSupabaseConfig()) {
    const rows = await supabaseRequest(tableName, {
      method: "POST",
      body: payload
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  const file = getStorageFileByTable(tableName);
  const items = readJsonFile(file, []);
  const newItem = {
    id: payload.id || createId(tableName),
    created_at: payload.created_at || nowISO(),
    updated_at: payload.updated_at || nowISO(),
    ...payload
  };
  items.push(newItem);
  writeJsonFile(file, items);
  return newItem;
}

async function dbUpdate(tableName, id, updates) {
  if (hasSupabaseConfig()) {
    const endpoint = `${tableName}?id=eq.${encodeURIComponent(id)}`;
    const rows = await supabaseRequest(endpoint, {
      method: "PATCH",
      body: {
        ...updates,
        updated_at: nowISO()
      }
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  const file = getStorageFileByTable(tableName);
  const items = readJsonFile(file, []);
  const index = items.findIndex((item) => String(item.id) === String(id));

  if (index === -1) return null;

  items[index] = {
    ...items[index],
    ...updates,
    updated_at: nowISO()
  };

  writeJsonFile(file, items);
  return items[index];
}

async function dbDelete(tableName, id) {
  if (hasSupabaseConfig()) {
    const endpoint = `${tableName}?id=eq.${encodeURIComponent(id)}`;
    await supabaseRequest(endpoint, {
      method: "DELETE",
      prefer: "return=minimal"
    });
    return true;
  }

  const file = getStorageFileByTable(tableName);
  const items = readJsonFile(file, []);
  const filtered = items.filter((item) => String(item.id) !== String(id));
  writeJsonFile(file, filtered);
  return filtered.length !== items.length;
}

async function dbUpsertProfile(userId, payload) {
  if (hasSupabaseConfig()) {
    const existing = await dbList(PROFILE_TABLE, userId, 1);

    if (existing.length > 0) {
      return await dbUpdate(PROFILE_TABLE, existing[0].id, payload);
    }

    return await dbInsert(PROFILE_TABLE, {
      id: createId("profile"),
      [USER_COLUMN]: userId,
      ...payload
    });
  }

  const items = readJsonFile(PROFILE_FILE, []);
  const index = items.findIndex((item) => item[USER_COLUMN] === userId);

  if (index >= 0) {
    items[index] = {
      ...items[index],
      ...payload,
      updated_at: nowISO()
    };
    writeJsonFile(PROFILE_FILE, items);
    return items[index];
  }

  const record = {
    id: createId("profile"),
    [USER_COLUMN]: userId,
    created_at: nowISO(),
    updated_at: nowISO(),
    ...payload
  };

  items.push(record);
  writeJsonFile(PROFILE_FILE, items);
  return record;
}

async function getSingleProfile(userId) {
  const rows = await dbList(PROFILE_TABLE, userId, 1);
  return rows[0] || null;
}

// =========================
// PERFIL INTELIGENTE
// =========================
function buildProfileFromMemories(shortMemories, longMemories, profileRecord) {
  const explicitProfile = profileRecord?.perfil_texto || profileRecord?.perfil || "";
  const recentTexts = shortMemories.map((m) => m[MESSAGE_COLUMN]).filter(Boolean);
  const longTexts = longMemories.map((m) => m[MESSAGE_COLUMN]).filter(Boolean);

  return {
    explicitProfile,
    recentCount: shortMemories.length,
    longCount: longMemories.length,
    recentHighlights: recentTexts.slice(0, 6),
    longHighlights: longTexts.slice(0, 8),
    summary:
      explicitProfile ||
      [
        ...longTexts.slice(0, 4),
        ...recentTexts.slice(0, 3)
      ].join(" | ")
  };
}

// =========================
// OPENAI HELPERS
// =========================
async function callOpenAIChat({ message, profile, shortMemories, longMemories }) {
  if (!OPENAI_API_KEY) {
    return "OPENAI_API_KEY no configurada. El chat está operativo, pero sin conexión a OpenAI todavía.";
  }

  const systemPrompt = `
Eres Pepinazo AI.
Responde en español.
Sé claro, útil, directo y con tono humano.
Usa el perfil y memorias del usuario cuando aporten contexto real.
No inventes datos.
`;

  const memoryContext = `
PERFIL:
${profile?.summary || "Sin perfil consolidado todavía."}

MEMORIA RECIENTE:
${shortMemories.map((m) => `- ${m[MESSAGE_COLUMN]}`).slice(0, 8).join("\n") || "Sin memoria reciente."}

MEMORIA LARGA:
${longMemories.map((m) => `- ${m[MESSAGE_COLUMN]}`).slice(0, 8).join("\n") || "Sin memoria larga."}
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt
            }
          ]
        },
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: memoryContext
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: message
            }
          ]
        }
      ]
    })
  });

  const raw = await response.text();
  const data = safeJsonParse(raw, null);

  if (!response.ok) {
    throw new Error(raw || "Error desconocido en OpenAI");
  }

  if (data?.output_text) return data.output_text;

  if (Array.isArray(data?.output)) {
    const texts = [];

    for (const item of data.output) {
      if (!item?.content) continue;
      for (const part of item.content) {
        if (part?.text) texts.push(part.text);
      }
    }

    if (texts.length > 0) return texts.join("\n").trim();
  }

  return "Recibí tu mensaje, pero no logré extraer una respuesta de OpenAI.";
}

// =========================
// FINANZAS / DASHBOARD LOCAL
// =========================
function readFinanceData() {
  return readJsonFile(FINANCE_FILE, {
    entries: []
  });
}

function writeFinanceData(data) {
  return writeJsonFile(FINANCE_FILE, data);
}

function computeFinanceSummary(entries = []) {
  let ingresos = 0;
  let gastos = 0;

  const categories = {};

  for (const entry of entries) {
    const amount = toNumber(entry.amount, 0);
    const type = String(entry.type || "").toLowerCase();
    const category = normalizeText(entry.category || "Sin categoría");

    if (!categories[category]) {
      categories[category] = 0;
    }

    if (type === "income" || type === "ingreso") {
      ingresos += amount;
      categories[category] += amount;
    } else {
      gastos += amount;
      categories[category] -= amount;
    }
  }

  return {
    ingresos,
    gastos,
    balance: ingresos - gastos,
    categories
  };
}

// =========================
// RUTAS BÁSICAS
// =========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Pepinazo AI",
    time: nowISO(),
    supabase: hasSupabaseConfig(),
    openai: Boolean(OPENAI_API_KEY)
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    config: {
      supabase: hasSupabaseConfig(),
      openai: Boolean(OPENAI_API_KEY),
      tables: {
        short: SHORT_MEMORY_TABLE,
        long: LONG_MEMORY_TABLE,
        profile: PROFILE_TABLE
      }
    }
  });
});

// =========================
// MEMORIA - LISTAR
// =========================
app.get("/api/memories", async (req, res) => {
  try {
    const userId = normalizeText(req.query.userId || "default_user");
    const kind = normalizeText(req.query.kind || "all").toLowerCase();
    const limit = Math.min(toNumber(req.query.limit, 50), 200);

    const shortMemories = await dbList(SHORT_MEMORY_TABLE, userId, limit);
    const longMemories = await dbList(LONG_MEMORY_TABLE, userId, limit);
    const profile = await getSingleProfile(userId);

    const response = {
      ok: true,
      userId,
      profile,
      short: shortMemories,
      long: longMemories,
      all: sortByDateDesc([
        ...shortMemories.map((item) => ({ ...item, memory_kind: "short" })),
        ...longMemories.map((item) => ({ ...item, memory_kind: "long" }))
      ])
    };

    if (kind === "short" || kind === "recent") {
      return res.json({ ok: true, memories: shortMemories, kind: "short" });
    }

    if (kind === "long") {
      return res.json({ ok: true, memories: longMemories, kind: "long" });
    }

    if (kind === "profile" || kind === "perfil") {
      return res.json({ ok: true, profile, kind: "profile" });
    }

    return res.json(response);
  } catch (error) {
    console.error("Error /api/memories:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudieron cargar las memorias."
    });
  }
});

// Alias por compatibilidad
app.get("/api/memory", async (req, res) => {
  req.query.kind = req.query.kind || "all";
  return app._router.handle(req, res, () => {}, "get", "/api/memories");
});

// =========================
// MEMORIA - CREAR
// =========================
app.post("/api/memories", async (req, res) => {
  try {
    const userId = normalizeText(req.body.userId || "default_user");
    const message = normalizeText(req.body.message || req.body.mensaje);
    const explicitKind = normalizeText(req.body.kind || req.body.tipo);
    const category = normalizeText(req.body.category || req.body.categoria || "general");
    const importance = toNumber(req.body.importance, 1);

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "Mensaje vacío."
      });
    }

    if (!shouldSaveMemory(message) && !explicitKind) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "Mensaje demasiado corto o irrelevante para memoria."
      });
    }

    const table = classifyMemoryType(message, explicitKind);

    if (table === PROFILE_TABLE) {
      const savedProfile = await dbUpsertProfile(userId, {
        perfil_texto: message,
        categoria: category,
        updated_at: nowISO()
      });

      return res.json({
        ok: true,
        saved: savedProfile,
        kind: "profile"
      });
    }

    const saved = await dbInsert(table, {
      id: createId(table),
      [USER_COLUMN]: userId,
      [MESSAGE_COLUMN]: message,
      categoria: category,
      importance,
      created_at: nowISO(),
      updated_at: nowISO()
    });

    return res.json({
      ok: true,
      saved,
      kind: getKindFromTable(table)
    });
  } catch (error) {
    console.error("Error POST /api/memories:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo guardar la memoria."
    });
  }
});

// Alias por compatibilidad
app.post("/api/memory", async (req, res) => {
  try {
    const userId = normalizeText(req.body.userId || "default_user");
    const message = normalizeText(req.body.message || req.body.mensaje);
    const kind = normalizeText(req.body.kind || req.body.tipo || "");

    if (!message) {
      return res.status(400).json({ ok: false, error: "Mensaje vacío." });
    }

    const table = classifyMemoryType(message, kind);

    if (table === PROFILE_TABLE) {
      const savedProfile = await dbUpsertProfile(userId, {
        perfil_texto: message,
        categoria: normalizeText(req.body.category || "general"),
        updated_at: nowISO()
      });

      return res.json({ ok: true, saved: savedProfile, kind: "profile" });
    }

    const saved = await dbInsert(table, {
      id: createId(table),
      [USER_COLUMN]: userId,
      [MESSAGE_COLUMN]: message,
      categoria: normalizeText(req.body.category || "general"),
      importance: toNumber(req.body.importance, 1),
      created_at: nowISO(),
      updated_at: nowISO()
    });

    return res.json({ ok: true, saved, kind: getKindFromTable(table) });
  } catch (error) {
    console.error("Error POST /api/memory:", error.message);
    res.status(500).json({ ok: false, error: "No se pudo guardar la memoria." });
  }
});

// =========================
// MEMORIA - ACTUALIZAR
// =========================
app.put("/api/memories/:id", async (req, res) => {
  try {
    const id = normalizeText(req.params.id);
    const kind = normalizeText(req.body.kind || req.body.tipo || "short");
    const table = getTableFromKind(kind);

    const updates = {};

    if (req.body.message !== undefined || req.body.mensaje !== undefined) {
      updates[MESSAGE_COLUMN] = normalizeText(req.body.message || req.body.mensaje);
    }

    if (req.body.category !== undefined || req.body.categoria !== undefined) {
      updates.categoria = normalizeText(req.body.category || req.body.categoria);
    }

    if (req.body.importance !== undefined) {
      updates.importance = toNumber(req.body.importance, 1);
    }

    if (table === PROFILE_TABLE) {
      updates.perfil_texto = updates[MESSAGE_COLUMN] || normalizeText(req.body.perfil_texto || "");
      delete updates[MESSAGE_COLUMN];
    }

    const updated = await dbUpdate(table, id, updates);

    if (!updated) {
      return res.status(404).json({
        ok: false,
        error: "Registro no encontrado."
      });
    }

    res.json({
      ok: true,
      updated
    });
  } catch (error) {
    console.error("Error PUT /api/memories/:id:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo actualizar la memoria."
    });
  }
});

// Alias por compatibilidad
app.put("/api/memory/:id", async (req, res) => {
  try {
    const id = normalizeText(req.params.id);
    const kind = normalizeText(req.body.kind || req.body.tipo || "short");
    const table = getTableFromKind(kind);

    const updates = {};

    if (req.body.message !== undefined || req.body.mensaje !== undefined) {
      updates[MESSAGE_COLUMN] = normalizeText(req.body.message || req.body.mensaje);
    }

    if (req.body.category !== undefined || req.body.categoria !== undefined) {
      updates.categoria = normalizeText(req.body.category || req.body.categoria);
    }

    if (req.body.importance !== undefined) {
      updates.importance = toNumber(req.body.importance, 1);
    }

    if (table === PROFILE_TABLE) {
      updates.perfil_texto = updates[MESSAGE_COLUMN] || normalizeText(req.body.perfil_texto || "");
      delete updates[MESSAGE_COLUMN];
    }

    const updated = await dbUpdate(table, id, updates);

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Registro no encontrado." });
    }

    res.json({ ok: true, updated });
  } catch (error) {
    console.error("Error PUT /api/memory/:id:", error.message);
    res.status(500).json({ ok: false, error: "No se pudo actualizar la memoria." });
  }
});

// =========================
// MEMORIA - ELIMINAR
// =========================
app.delete("/api/memories/:id", async (req, res) => {
  try {
    const id = normalizeText(req.params.id);
    const kind = normalizeText(req.query.kind || req.body?.kind || "short");
    const table = getTableFromKind(kind);

    const deleted = await dbDelete(table, id);

    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: "Registro no encontrado."
      });
    }

    res.json({
      ok: true,
      deleted: true
    });
  } catch (error) {
    console.error("Error DELETE /api/memories/:id:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo eliminar la memoria."
    });
  }
});

// Alias por compatibilidad
app.delete("/api/memory/:id", async (req, res) => {
  try {
    const id = normalizeText(req.params.id);
    const kind = normalizeText(req.query.kind || req.body?.kind || "short");
    const table = getTableFromKind(kind);

    const deleted = await dbDelete(table, id);

    if (!deleted) {
      return res.status(404).json({ ok: false, error: "Registro no encontrado." });
    }

    res.json({ ok: true, deleted: true });
  } catch (error) {
    console.error("Error DELETE /api/memory/:id:", error.message);
    res.status(500).json({ ok: false, error: "No se pudo eliminar la memoria." });
  }
});

// =========================
// PERFIL
// =========================
app.get("/api/profile", async (req, res) => {
  try {
    const userId = normalizeText(req.query.userId || "default_user");

    const shortMemories = await dbList(SHORT_MEMORY_TABLE, userId, 50);
    const longMemories = await dbList(LONG_MEMORY_TABLE, userId, 50);
    const profileRecord = await getSingleProfile(userId);

    const profile = buildProfileFromMemories(shortMemories, longMemories, profileRecord);

    res.json({
      ok: true,
      userId,
      profileRecord,
      profile
    });
  } catch (error) {
    console.error("Error /api/profile:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo cargar el perfil."
    });
  }
});

app.get("/api/perfil", async (req, res) => {
  try {
    const userId = normalizeText(req.query.userId || "default_user");

    const shortMemories = await dbList(SHORT_MEMORY_TABLE, userId, 50);
    const longMemories = await dbList(LONG_MEMORY_TABLE, userId, 50);
    const profileRecord = await getSingleProfile(userId);

    const profile = buildProfileFromMemories(shortMemories, longMemories, profileRecord);

    res.json({
      ok: true,
      userId,
      profileRecord,
      profile
    });
  } catch (error) {
    console.error("Error /api/perfil:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo cargar el perfil."
    });
  }
});

app.post("/api/profile", async (req, res) => {
  try {
    const userId = normalizeText(req.body.userId || "default_user");
    const perfilTexto = normalizeText(
      req.body.perfil_texto || req.body.profileText || req.body.message || req.body.mensaje
    );

    if (!perfilTexto) {
      return res.status(400).json({
        ok: false,
        error: "Perfil vacío."
      });
    }

    const saved = await dbUpsertProfile(userId, {
      perfil_texto: perfilTexto,
      categoria: normalizeText(req.body.category || "perfil"),
      updated_at: nowISO()
    });

    res.json({
      ok: true,
      saved
    });
  } catch (error) {
    console.error("Error POST /api/profile:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo guardar el perfil."
    });
  }
});

// =========================
// DASHBOARD
// =========================
app.get("/api/dashboard", async (req, res) => {
  try {
    const userId = normalizeText(req.query.userId || "default_user");

    const shortMemories = await dbList(SHORT_MEMORY_TABLE, userId, 100);
    const longMemories = await dbList(LONG_MEMORY_TABLE, userId, 100);
    const profileRecord = await getSingleProfile(userId);
    const profile = buildProfileFromMemories(shortMemories, longMemories, profileRecord);

    const financeData = readFinanceData();
    const summary = computeFinanceSummary(financeData.entries || []);

    res.json({
      ok: true,
      cards: {
        recentMemories: shortMemories.length,
        longMemories: longMemories.length,
        hasProfile: Boolean(profileRecord),
        financeEntries: (financeData.entries || []).length
      },
      profile,
      finance: {
        entries: financeData.entries || [],
        summary
      }
    });
  } catch (error) {
    console.error("Error /api/dashboard:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo cargar el dashboard."
    });
  }
});

app.get("/api/dashboard/finance", (req, res) => {
  try {
    const financeData = readFinanceData();
    const entries = Array.isArray(financeData.entries) ? financeData.entries : [];
    const summary = computeFinanceSummary(entries);

    res.json({
      ok: true,
      entries,
      summary
    });
  } catch (error) {
    console.error("Error /api/dashboard/finance:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo cargar finanzas."
    });
  }
});

app.post("/api/dashboard/finance", (req, res) => {
  try {
    const current = readFinanceData();
    const entries = Array.isArray(current.entries) ? current.entries : [];
    const incoming = req.body.entry || req.body;

    const newEntry = {
      id: createId("fin"),
      date: normalizeText(incoming.date || nowISO().slice(0, 10)),
      type: normalizeText(incoming.type || "expense"),
      category: normalizeText(incoming.category || "general"),
      description: normalizeText(incoming.description || ""),
      amount: toNumber(incoming.amount, 0),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    entries.push(newEntry);
    writeFinanceData({ entries });

    res.json({
      ok: true,
      saved: newEntry,
      summary: computeFinanceSummary(entries)
    });
  } catch (error) {
    console.error("Error POST /api/dashboard/finance:", error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo guardar movimiento financiero."
    });
  }
});

// =========================
// CHAT
// =========================
app.post("/api/chat", async (req, res) => {
  try {
    const userId = normalizeText(req.body.userId || "default_user");
    const message = normalizeText(req.body.message);
    const provider = normalizeText(req.body.provider || "openai").toLowerCase();

    if (!message) {
      return res.status(400).json({
        ok: false,
        reply: "Mensaje inválido."
      });
    }

    const shortMemories = await dbList(SHORT_MEMORY_TABLE, userId, 12);
    const longMemories = await dbList(LONG_MEMORY_TABLE, userId, 12);
    const profileRecord = await getSingleProfile(userId);
    const profile = buildProfileFromMemories(shortMemories, longMemories, profileRecord);

    let reply = "";

    if (provider === "openai") {
      reply = await callOpenAIChat({
        message,
        profile,
        shortMemories,
        longMemories
      });
    } else {
      reply = "Proveedor no soportado aún. Usa 'openai'.";
    }

    if (shouldSaveMemory(message)) {
      const table = classifyMemoryType(message);
      if (table === PROFILE_TABLE) {
        await dbUpsertProfile(userId, {
          perfil_texto: message,
          categoria: "auto_profile",
          updated_at: nowISO()
        });
      } else {
        await dbInsert(table, {
          id: createId(table),
          [USER_COLUMN]: userId,
          [MESSAGE_COLUMN]: message,
          categoria: "chat",
          importance: 1,
          created_at: nowISO(),
          updated_at: nowISO()
        });
      }
    }

    res.json({
      ok: true,
      reply,
      profile
    });
  } catch (error) {
    console.error("Error /api/chat:", error.message);
    res.status(500).json({
      ok: false,
      reply: "Hubo un error al procesar el mensaje.",
      error: error.message
    });
  }
});

// =========================
// MANEJO DE 404 API
// =========================
app.use("/api/*", (req, res) => {
  res.status(404).json({
    ok: false,
    error: "Ruta API no encontrada."
  });
});

// =========================
// FALLBACK FRONTEND
// =========================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`✅ Pepinazo AI corriendo en puerto ${PORT}`);
  console.log(`🌐 URL local: http://localhost:${PORT}`);
  console.log(`🧠 Supabase: ${hasSupabaseConfig() ? "conectado/configurado" : "modo local fallback"}`);
  console.log(`🤖 OpenAI: ${OPENAI_API_KEY ? "configurado" : "no configurado"}`);
});

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    fetchFn = require("node-fetch");
  } catch (error) {
    fetchFn = null;
  }
}

let XLSX = null;
try {
  XLSX = require("xlsx");
} catch (error) {
  XLSX = null;
}

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
// ENV
// =========================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// =========================
// STORAGE PATHS
// =========================
const DATA_DIR = path.join(__dirname, "data");

const MEMORY_FILE = path.join(DATA_DIR, "memoria.json");
const LONG_MEMORY_FILE = path.join(DATA_DIR, "memoria_larga.json");
const PROFILE_FILE = path.join(DATA_DIR, "perfil_usuario.json");
const FINANCE_FILE = path.join(DATA_DIR, "finance_data.json");
const INVESTMENTS_FILE = path.join(DATA_DIR, "investments_data.json");
const OPPORTUNITIES_FILE = path.join(DATA_DIR, "business_opportunities.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "ecommerce_products.json");

// =========================
// CONSTANTS
// =========================
const DEFAULT_USER_ID = "usuario1";

const DEFAULT_FINANCE_CATEGORIES = {
  incomes: [
    "sueldo Diego",
    "sueldo Claudia",
    "boleta honorarios Diego",
    "arriendo depto Diego",
    "arriendo depto Claudia",
    "otros ingresos"
  ],
  expenses: [
    "bencina",
    "supermercado",
    "colegio",
    "jardín Maxi",
    "crédito hipotecario casa",
    "crédito hipotecario depto Claudia",
    "crédito hipotecario depto Diego",
    "autopista central",
    "vespucio sur",
    "vespucio norte",
    "costanera",
    "el sol",
    "otras autopistas",
    "clases particulares",
    "clases Maxi",
    "feria",
    "piscinero",
    "salud",
    "seguros",
    "luz",
    "agua",
    "gas",
    "internet",
    "telefonía",
    "mantención auto",
    "mascotas",
    "ocio",
    "otros gastos"
  ],
  investments: [
    "AFP",
    "APV",
    "VOO",
    "QQQ",
    "Bitcoin",
    "Ethereum",
    "efectivo",
    "otro activo"
  ]
};

const TYPE_LABELS = {
  proyecto: "proyecto",
  objetivo: "objetivo",
  preferencia: "preferencia",
  perfil: "perfil",
  contexto: "contexto"
};

// =========================
// BASE HELPERS
// =========================
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureJsonFile(filePath, defaultValue) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
  }
}

function readJsonFile(filePath, defaultValue) {
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

function nowISO() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const cleaned = String(value ?? "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function sortByDateDesc(items) {
  return [...items].sort((a, b) => {
    const aDate = new Date(a.updated_at || a.created_at || 0).getTime();
    const bDate = new Date(b.updated_at || b.created_at || 0).getTime();
    return bDate - aDate;
  });
}

function formatCurrencyCLP(value) {
  return Number(value || 0).toLocaleString("es-CL");
}

function getUserIdFromReq(req) {
  return normalizeText(
    req.query.userId ||
      req.body?.userId ||
      req.headers["x-user-id"] ||
      DEFAULT_USER_ID
  );
}

function isShortNoise(text) {
  const t = lowerText(text);
  const blacklist = new Set([
    "hola",
    "ok",
    "oki",
    "dale",
    "gracias",
    "vale",
    "listo",
    "ya",
    "jaja",
    "jeje",
    "jj",
    "👍",
    "👌",
    "test",
    "probando",
    "123"
  ]);

  return t.length < 4 || blacklist.has(t);
}

// =========================
// DATA LOADERS
// =========================
function getMemoriesAll() {
  return readJsonFile(MEMORY_FILE, []);
}

function saveMemoriesAll(data) {
  return writeJsonFile(MEMORY_FILE, data);
}

function getLongMemoriesAll() {
  return readJsonFile(LONG_MEMORY_FILE, []);
}

function saveLongMemoriesAll(data) {
  return writeJsonFile(LONG_MEMORY_FILE, data);
}

function getProfilesAll() {
  return readJsonFile(PROFILE_FILE, []);
}

function saveProfilesAll(data) {
  return writeJsonFile(PROFILE_FILE, data);
}

function getFinanceData() {
  return readJsonFile(FINANCE_FILE, {
    categories: DEFAULT_FINANCE_CATEGORIES,
    entries: []
  });
}

function saveFinanceData(data) {
  return writeJsonFile(FINANCE_FILE, data);
}

function getInvestmentsData() {
  return readJsonFile(INVESTMENTS_FILE, {
    assets: [],
    contributions: []
  });
}

function saveInvestmentsData(data) {
  return writeJsonFile(INVESTMENTS_FILE, data);
}

function getOpportunitiesData() {
  return readJsonFile(OPPORTUNITIES_FILE, {
    items: []
  });
}

function saveOpportunitiesData(data) {
  return writeJsonFile(OPPORTUNITIES_FILE, data);
}

function getProductsData() {
  return readJsonFile(PRODUCTS_FILE, {
    items: []
  });
}

function saveProductsData(data) {
  return writeJsonFile(PRODUCTS_FILE, data);
}

// =========================
// MEMORY / PROFILE LOGIC
// =========================
function inferTypeFromText(text) {
  const t = lowerText(text);

  const projectHints = [
    "proyecto",
    "roadmap",
    "app",
    "pepinazo ai",
    "negocio",
    "ecommerce",
    "shopify",
    "dropi",
    "render",
    "supabase",
    "deploy",
    "web"
  ];

  const objectiveHints = [
    "mi objetivo",
    "mi meta",
    "quiero lograr",
    "quiero alcanzar",
    "apuntar a",
    "objetivo",
    "meta"
  ];

  const preferenceHints = [
    "me gusta",
    "prefiero",
    "quiero que",
    "desde ahora",
    "a futuro",
    "para futuras conversaciones",
    "mi preferencia",
    "mi estilo"
  ];

  const profileHints = [
    "recuerda que",
    "acuérdate que",
    "guarda esto",
    "guarda esta info",
    "recuérdame",
    "soy",
    "trabajo",
    "vivo"
  ];

  if (projectHints.some((w) => t.includes(w))) return TYPE_LABELS.proyecto;
  if (objectiveHints.some((w) => t.includes(w))) return TYPE_LABELS.objetivo;
  if (preferenceHints.some((w) => t.includes(w))) return TYPE_LABELS.preferencia;
  if (profileHints.some((w) => t.includes(w))) return TYPE_LABELS.perfil;
  return TYPE_LABELS.contexto;
}

function maybeProfileItemFromText(userId, text) {
  const t = lowerText(text);
  const tipo = inferTypeFromText(text);

  if (
    t.includes("me gusta") ||
    t.includes("prefiero") ||
    t.includes("mi preferencia") ||
    t.includes("quiero que") ||
    t.includes("desde ahora")
  ) {
    return {
      id: createId("perfil"),
      userId,
      clave: "preferencia",
      valor: normalizeText(text),
      tipo: TYPE_LABELS.preferencia,
      created_at: nowISO(),
      updated_at: nowISO()
    };
  }

  if (t.includes("mi objetivo") || t.includes("mi meta") || t.includes("quiero lograr")) {
    return {
      id: createId("perfil"),
      userId,
      clave: "objetivo",
      valor: normalizeText(text),
      tipo: TYPE_LABELS.objetivo,
      created_at: nowISO(),
      updated_at: nowISO()
    };
  }

  if (
    t.includes("proyecto") ||
    t.includes("pepinazo ai") ||
    t.includes("negocio") ||
    t.includes("ecommerce")
  ) {
    return {
      id: createId("perfil"),
      userId,
      clave: "proyecto",
      valor: normalizeText(text),
      tipo: TYPE_LABELS.proyecto,
      created_at: nowISO(),
      updated_at: nowISO()
    };
  }

  if (tipo === TYPE_LABELS.perfil) {
    return {
      id: createId("perfil"),
      userId,
      clave: "perfil",
      valor: normalizeText(text),
      tipo: TYPE_LABELS.perfil,
      created_at: nowISO(),
      updated_at: nowISO()
    };
  }

  return null;
}

function getUserProfiles(userId) {
  return sortByDateDesc(
    getProfilesAll().filter((item) => item.userId === userId)
  );
}

function getUserMemories(userId) {
  return sortByDateDesc(
    getMemoriesAll().filter((item) => item.userId === userId)
  );
}

function getUserLongMemories(userId) {
  return sortByDateDesc(
    getLongMemoriesAll().filter((item) => item.userId === userId)
  );
}

function addMemory(userId, text, forcedType = "") {
  const message = normalizeText(text);
  if (!message || isShortNoise(message)) return null;

  const all = getMemoriesAll();
  const record = {
    id: createId("mem"),
    userId,
    mensaje: message,
    tipo: forcedType || inferTypeFromText(message),
    created_at: nowISO(),
    updated_at: nowISO()
  };

  all.push(record);
  saveMemoriesAll(all);
  return record;
}

function addLongMemory(userId, text, forcedType = "") {
  const message = normalizeText(text);
  if (!message || isShortNoise(message)) return null;

  const all = getLongMemoriesAll();
  const record = {
    id: createId("mlong"),
    userId,
    mensaje: message,
    tipo: forcedType || inferTypeFromText(message),
    created_at: nowISO(),
    updated_at: nowISO()
  };

  all.push(record);
  saveLongMemoriesAll(all);
  return record;
}

function addProfileItem(record) {
  const all = getProfilesAll();
  all.push(record);
  saveProfilesAll(all);
  return record;
}

function buildProfileSummary(userId) {
  const profiles = getUserProfiles(userId).slice(0, 12);
  const recent = getUserMemories(userId).slice(0, 8);
  const important = getUserLongMemories(userId).slice(0, 8);

  const blocks = [];

  if (profiles.length) {
    blocks.push("Perfil estable:");
    for (const item of profiles.slice(0, 6)) {
      blocks.push(`- ${item.clave}: ${item.valor}`);
    }
  }

  if (important.length) {
    if (blocks.length) blocks.push("");
    blocks.push("Memoria importante:");
    for (const item of important.slice(0, 5)) {
      blocks.push(`- [${item.tipo || "contexto"}] ${item.mensaje}`);
    }
  }

  if (recent.length) {
    if (blocks.length) blocks.push("");
    blocks.push("Memoria reciente:");
    for (const item of recent.slice(0, 5)) {
      blocks.push(`- [${item.tipo || "contexto"}] ${item.mensaje}`);
    }
  }

  if (!blocks.length) {
    return "Sin perfil consolidado todavía.";
  }

  return blocks.join("\n");
}

function buildMemoryPanel(userId) {
  const perfiles = getUserProfiles(userId);
  const recientes = getUserMemories(userId);
  const importantes = getUserLongMemories(userId);

  return {
    ok: true,
    userId,
    perfil_resumen: {
      resumen: buildProfileSummary(userId)
    },
    perfil_usuario: perfiles.map((item) => ({
      id: item.id,
      clave: item.clave || "perfil",
      valor: item.valor || "",
      tipo: item.tipo || "perfil",
      created_at: item.created_at,
      updated_at: item.updated_at
    })),
    memoria_reciente: recientes.map((item) => ({
      id: item.id,
      mensaje: item.mensaje,
      tipo: item.tipo || "contexto",
      created_at: item.created_at,
      updated_at: item.updated_at
    })),
    memoria_importante: importantes.map((item) => ({
      id: item.id,
      mensaje: item.mensaje,
      tipo: item.tipo || "contexto",
      created_at: item.created_at,
      updated_at: item.updated_at
    }))
  };
}

function clearUserData(userId) {
  const memories = getMemoriesAll().filter((item) => item.userId !== userId);
  const longMemories = getLongMemoriesAll().filter((item) => item.userId !== userId);
  const profiles = getProfilesAll().filter((item) => item.userId !== userId);

  saveMemoriesAll(memories);
  saveLongMemoriesAll(longMemories);
  saveProfilesAll(profiles);
}

function deleteFromTable(tableName, userId, id) {
  const table = normalizeText(tableName);
  if (!id) return false;

  if (table === "memoria") {
    const current = getMemoriesAll();
    const next = current.filter(
      (item) => !(item.userId === userId && String(item.id) === String(id))
    );
    const changed = next.length !== current.length;
    if (changed) saveMemoriesAll(next);
    return changed;
  }

  if (table === "memoria_larga") {
    const current = getLongMemoriesAll();
    const next = current.filter(
      (item) => !(item.userId === userId && String(item.id) === String(id))
    );
    const changed = next.length !== current.length;
    if (changed) saveLongMemoriesAll(next);
    return changed;
  }

  if (table === "perfil_usuario") {
    const current = getProfilesAll();
    const next = current.filter(
      (item) => !(item.userId === userId && String(item.id) === String(id))
    );
    const changed = next.length !== current.length;
    if (changed) saveProfilesAll(next);
    return changed;
  }

  return false;
}

function patchProfileValue(userId, id, valor) {
  const current = getProfilesAll();
  const index = current.findIndex(
    (item) => item.userId === userId && String(item.id) === String(id)
  );

  if (index === -1) return null;

  current[index] = {
    ...current[index],
    valor: normalizeText(valor),
    updated_at: nowISO()
  };

  saveProfilesAll(current);
  return current[index];
}

function patchMemoryValue(tableName, userId, id, mensaje) {
  const table = normalizeText(tableName);

  if (table === "memoria") {
    const current = getMemoriesAll();
    const index = current.findIndex(
      (item) => item.userId === userId && String(item.id) === String(id)
    );
    if (index === -1) return null;

    current[index] = {
      ...current[index],
      mensaje: normalizeText(mensaje),
      tipo: inferTypeFromText(mensaje),
      updated_at: nowISO()
    };

    saveMemoriesAll(current);
    return current[index];
  }

  if (table === "memoria_larga") {
    const current = getLongMemoriesAll();
    const index = current.findIndex(
      (item) => item.userId === userId && String(item.id) === String(id)
    );
    if (index === -1) return null;

    current[index] = {
      ...current[index],
      mensaje: normalizeText(mensaje),
      tipo: inferTypeFromText(mensaje),
      updated_at: nowISO()
    };

    saveLongMemoriesAll(current);
    return current[index];
  }

  return null;
}

function pinMemoryToLong(userId, sourceTable, id) {
  const table = normalizeText(sourceTable);

  if (table !== "memoria" && table !== "memoria_larga") {
    throw new Error("Tabla origen inválida.");
  }

  if (table === "memoria_larga") {
    return { ok: true, alreadyPinned: true };
  }

  const recent = getMemoriesAll();
  const item = recent.find(
    (row) => row.userId === userId && String(row.id) === String(id)
  );

  if (!item) {
    throw new Error("Memoria no encontrada.");
  }

  const longList = getLongMemoriesAll();
  const exists = longList.some(
    (row) =>
      row.userId === userId &&
      normalizeText(row.mensaje) === normalizeText(item.mensaje)
  );

  if (exists) {
    return { ok: true, alreadyPinned: true };
  }

  const pinned = {
    id: createId("mlong"),
    userId,
    mensaje: item.mensaje,
    tipo: item.tipo || "contexto",
    created_at: nowISO(),
    updated_at: nowISO()
  };

  longList.push(pinned);
  saveLongMemoriesAll(longList);

  return { ok: true, pinned };
}

// =========================
// OPENAI
// =========================
async function callOpenAIChat({ message, userId }) {
  if (!OPENAI_API_KEY) {
    return fallbackReply(message, userId);
  }

  if (!fetchFn) {
    return fallbackReply(message, userId);
  }

  const profileSummary = buildProfileSummary(userId);
  const recent = getUserMemories(userId).slice(0, 8);
  const important = getUserLongMemories(userId).slice(0, 8);

  const memoryBlock = [
    `Perfil del usuario:`,
    profileSummary,
    ``,
    `Memoria reciente:`,
    recent.length
      ? recent.map((m) => `- [${m.tipo}] ${m.mensaje}`).join("\n")
      : "- Sin memoria reciente.",
    ``,
    `Memoria importante:`,
    important.length
      ? important.map((m) => `- [${m.tipo}] ${m.mensaje}`).join("\n")
      : "- Sin memoria importante."
  ].join("\n");

  const systemPrompt = [
    "Eres Pepinazo AI.",
    "Responde siempre en español.",
    "Sé claro, útil, directo y humano.",
    "Usa la memoria solo cuando aporte contexto real.",
    "No inventes datos.",
    "Mantén tono útil, con un toque de humor sobrio cuando encaje.",
    "",
    memoryBlock
  ].join("\n");

  const response = await fetchFn("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: message
        }
      ]
    })
  });

  const raw = await response.text();
  const data = safeJsonParse(raw, null);

  if (!response.ok) {
    console.error("OpenAI error:", raw);
    return fallbackReply(message, userId);
  }

  const content =
    data?.choices?.[0]?.message?.content ||
    data?.output_text ||
    "";

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  return fallbackReply(message, userId);
}

function fallbackReply(message, userId) {
  const type = inferTypeFromText(message);
  const summary = buildProfileSummary(userId);

  if (type === "proyecto") {
    return [
      "Te leo. Esto suena a proyecto o sistema en construcción.",
      "Ya quedó guardado en memoria para que no dependamos de la noble tradición de olvidar cosas justo cuando importan.",
      "",
      "Si quieres, el siguiente paso natural es bajar esto a tareas concretas: objetivo, siguiente acción, bloqueo y prioridad."
    ].join("\n");
  }

  if (type === "objetivo") {
    return [
      "Anotado como objetivo.",
      "Eso ayuda a que Pepinazo no sea solo un loro simpático, sino un sistema con dirección.",
      "",
      "Puedo ayudarte a convertirlo en plan con hitos, métricas y próximos pasos."
    ].join("\n");
  }

  if (type === "preferencia") {
    return [
      "Listo, lo tomo como preferencia estable.",
      "Queda guardado para futuras conversaciones y así reducimos la clásica tragedia de repetir el mismo contexto veinte veces."
    ].join("\n");
  }

  return [
    "Recibido.",
    "El backend está operativo y la memoria quedó actualizada.",
    "",
    "Resumen actual de contexto:",
    summary
  ].join("\n");
}

// =========================
// FINANCE
// =========================
function buildFinanceSummary(entries = []) {
  let ingresos = 0;
  let gastos = 0;

  const byCategory = {};
  const byMonth = {};
  const byDay = {};

  for (const item of entries) {
    const amount = Number(item.amount || 0);
    const type = lowerText(item.type);
    const category = normalizeText(item.category || "general");
    const date = normalizeText(item.date || nowISO().slice(0, 10));
    const month = date.slice(0, 7);

    byCategory[category] = (byCategory[category] || 0) + (type === "income" ? amount : -amount);
    byDay[date] = byDay[date] || { income: 0, expense: 0 };
    byMonth[month] = byMonth[month] || { income: 0, expense: 0 };

    if (type === "income") {
      ingresos += amount;
      byDay[date].income += amount;
      byMonth[month].income += amount;
    } else {
      gastos += amount;
      byDay[date].expense += amount;
      byMonth[month].expense += amount;
    }
  }

  const monthlySeries = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, values]) => ({
      month,
      income: values.income,
      expense: values.expense,
      balance: values.income - values.expense
    }));

  const dailySeries = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-45)
    .map(([date, values]) => ({
      date,
      income: values.income,
      expense: values.expense,
      balance: values.income - values.expense
    }));

  const categorySeries = Object.entries(byCategory)
    .map(([category, value]) => ({ category, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  return {
    totalIncome: ingresos,
    totalExpense: gastos,
    balance: ingresos - gastos,
    monthlySeries,
    dailySeries,
    categorySeries
  };
}

// =========================
// INVESTMENTS
// =========================
function buildInvestmentSummary(data) {
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const contributions = Array.isArray(data.contributions) ? data.contributions : [];

  const totalCurrentValue = assets.reduce((sum, item) => sum + Number(item.currentValue || 0), 0);
  const totalMonthlyContribution = contributions.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );

  const assetBreakdown = assets.map((item) => ({
    asset: item.asset,
    currentValue: Number(item.currentValue || 0),
    targetWeight: Number(item.targetWeight || 0)
  }));

  return {
    totalCurrentValue,
    totalMonthlyContribution,
    assetBreakdown
  };
}

function projectCompound({
  current = 0,
  monthly = 0,
  annualRate = 0.08,
  years = 1
}) {
  let value = Number(current || 0);
  const monthlyRate = annualRate / 12;
  const months = Math.max(0, Math.round(years * 12));

  for (let i = 0; i < months; i += 1) {
    value = value * (1 + monthlyRate) + Number(monthly || 0);
  }

  return value;
}

function buildInvestmentProjections(data) {
  const summary = buildInvestmentSummary(data);
  const current = summary.totalCurrentValue;
  const monthly = summary.totalMonthlyContribution;

  const scenarios = [
    { name: "conservador", rate: 0.05 },
    { name: "base", rate: 0.08 },
    { name: "agresivo", rate: 0.12 }
  ];

  const horizons = [1, 5, 10, 25];

  return scenarios.map((scenario) => ({
    scenario: scenario.name,
    annualRate: scenario.rate,
    projections: horizons.map((years) => ({
      years,
      value: Math.round(
        projectCompound({
          current,
          monthly,
          annualRate: scenario.rate,
          years
        })
      )
    }))
  }));
}

// =========================
// BUSINESS / ECOMMERCE PREP
// =========================
function buildBusinessSnapshot() {
  const opportunities = getOpportunitiesData();
  const products = getProductsData();

  return {
    opportunitiesCount: opportunities.items.length,
    productsCount: products.items.length,
    recentOpportunities: sortByDateDesc(opportunities.items).slice(0, 5),
    recentProducts: sortByDateDesc(products.items).slice(0, 5)
  };
}

// =========================
// BOOTSTRAP DATA FILES
// =========================
ensureJsonFile(MEMORY_FILE, []);
ensureJsonFile(LONG_MEMORY_FILE, []);
ensureJsonFile(PROFILE_FILE, []);
ensureJsonFile(FINANCE_FILE, {
  categories: DEFAULT_FINANCE_CATEGORIES,
  entries: []
});
ensureJsonFile(INVESTMENTS_FILE, {
  assets: [],
  contributions: []
});
ensureJsonFile(OPPORTUNITIES_FILE, {
  items: []
});
ensureJsonFile(PRODUCTS_FILE, {
  items: []
});

// =========================
// BASIC ROUTES
// =========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Pepinazo AI",
    time: nowISO(),
    openai: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL,
    xlsx: Boolean(XLSX)
  });
});

// =========================
// CHAT
// =========================
app.post("/api/chat", async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const message = normalizeText(req.body?.message);

    if (!message) {
      return res.status(400).json({
        ok: false,
        reply: "Mensaje inválido."
      });
    }

    const profileCandidate = maybeProfileItemFromText(userId, message);

    if (profileCandidate) {
      addProfileItem(profileCandidate);
    } else {
      addMemory(userId, message);
    }

    const reply = await callOpenAIChat({ message, userId });

    return res.json({
      ok: true,
      reply,
      profile_summary: buildProfileSummary(userId)
    });
  } catch (error) {
    console.error("Error /api/chat:", error);
    return res.status(500).json({
      ok: false,
      reply: "Hubo un error al procesar el mensaje.",
      error: error.message
    });
  }
});

// =========================
// MEMORY LEGACY ROUTES FOR CURRENT PUBLIC
// =========================
app.get("/prueba-de-memoria", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);

    return res.json({
      ok: true,
      userId,
      perfil_resumen: {
        resumen: buildProfileSummary(userId)
      },
      perfil_usuario: getUserProfiles(userId).map((item) => ({
        id: item.id,
        clave: item.clave,
        valor: item.valor,
        tipo: item.tipo,
        created_at: item.created_at,
        updated_at: item.updated_at
      })),
      memoria: getUserMemories(userId).map((item) => ({
        id: item.id,
        mensaje: item.mensaje,
        tipo: item.tipo,
        created_at: item.created_at,
        updated_at: item.updated_at
      })),
      memoria_larga: getUserLongMemories(userId).map((item) => ({
        id: item.id,
        mensaje: item.mensaje,
        tipo: item.tipo,
        created_at: item.created_at,
        updated_at: item.updated_at
      }))
    });
  } catch (error) {
    console.error("Error /prueba-de-memoria:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar la memoria."
    });
  }
});

app.get("/memory-panel", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    return res.json(buildMemoryPanel(userId));
  } catch (error) {
    console.error("Error /memory-panel:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar el panel de memoria."
    });
  }
});

app.delete("/memory-clear", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    clearUserData(userId);

    return res.json({
      ok: true,
      cleared: true,
      userId
    });
  } catch (error) {
    console.error("Error /memory-clear:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo borrar la memoria."
    });
  }
});

app.delete("/memory/:table/:id", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { table, id } = req.params;

    const deleted = deleteFromTable(table, userId, id);

    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: "Registro no encontrado."
      });
    }

    return res.json({
      ok: true,
      deleted: true
    });
  } catch (error) {
    console.error("Error DELETE /memory/:table/:id:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo borrar el registro."
    });
  }
});

app.patch("/memory/profile/:id", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { id } = req.params;
    const valor = normalizeText(req.body?.valor);

    if (!valor) {
      return res.status(400).json({
        ok: false,
        error: "Valor vacío."
      });
    }

    const updated = patchProfileValue(userId, id, valor);

    if (!updated) {
      return res.status(404).json({
        ok: false,
        error: "Perfil no encontrado."
      });
    }

    return res.json({
      ok: true,
      updated
    });
  } catch (error) {
    console.error("Error PATCH /memory/profile/:id:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo editar el perfil."
    });
  }
});

app.patch("/memory/message/:table/:id", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { table, id } = req.params;
    const mensaje = normalizeText(req.body?.mensaje);

    if (!mensaje) {
      return res.status(400).json({
        ok: false,
        error: "Mensaje vacío."
      });
    }

    const updated = patchMemoryValue(table, userId, id, mensaje);

    if (!updated) {
      return res.status(404).json({
        ok: false,
        error: "Memoria no encontrada."
      });
    }

    return res.json({
      ok: true,
      updated
    });
  } catch (error) {
    console.error("Error PATCH /memory/message/:table/:id:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo editar la memoria."
    });
  }
});

app.post("/memory/pin", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const sourceTable = normalizeText(req.body?.sourceTable);
    const id = normalizeText(req.body?.id);

    const result = pinMemoryToLong(userId, sourceTable, id);

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error POST /memory/pin:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "No se pudo fijar la memoria."
    });
  }
});

// =========================
// MODERN MEMORY/PROFILE ROUTES
// =========================
app.get("/api/profile", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const profiles = getUserProfiles(userId);

    return res.json({
      ok: true,
      userId,
      summary: buildProfileSummary(userId),
      items: profiles
    });
  } catch (error) {
    console.error("Error /api/profile:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar el perfil."
    });
  }
});

app.get("/api/memories", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    return res.json({
      ok: true,
      userId,
      recent: getUserMemories(userId),
      important: getUserLongMemories(userId)
    });
  } catch (error) {
    console.error("Error /api/memories:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron cargar las memorias."
    });
  }
});

app.post("/api/memories", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const mensaje = normalizeText(req.body?.mensaje || req.body?.message);
    const important = Boolean(req.body?.important);

    if (!mensaje) {
      return res.status(400).json({
        ok: false,
        error: "Mensaje vacío."
      });
    }

    const saved = important
      ? addLongMemory(userId, mensaje)
      : addMemory(userId, mensaje);

    return res.json({
      ok: true,
      saved
    });
  } catch (error) {
    console.error("Error POST /api/memories:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar la memoria."
    });
  }
});

// =========================
// FINANCE ROUTES
// =========================
app.get("/api/finance", (req, res) => {
  try {
    const data = getFinanceData();
    return res.json({
      ok: true,
      categories: data.categories || DEFAULT_FINANCE_CATEGORIES,
      entries: sortByDateDesc(data.entries || []),
      summary: buildFinanceSummary(data.entries || [])
    });
  } catch (error) {
    console.error("Error /api/finance:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar finanzas."
    });
  }
});

app.post("/api/finance", (req, res) => {
  try {
    const data = getFinanceData();
    const body = req.body || {};

    const entry = {
      id: createId("fin"),
      date: normalizeText(body.date || nowISO().slice(0, 10)),
      type: lowerText(body.type || "expense") === "income" ? "income" : "expense",
      category: normalizeText(body.category || "general"),
      description: normalizeText(body.description || ""),
      amount: Math.abs(toNumber(body.amount, 0)),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    if (!entry.amount) {
      return res.status(400).json({
        ok: false,
        error: "Monto inválido."
      });
    }

    data.entries = Array.isArray(data.entries) ? data.entries : [];
    data.entries.push(entry);
    saveFinanceData(data);

    return res.json({
      ok: true,
      saved: entry,
      summary: buildFinanceSummary(data.entries)
    });
  } catch (error) {
    console.error("Error POST /api/finance:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar el movimiento."
    });
  }
});

app.delete("/api/finance/:id", (req, res) => {
  try {
    const id = normalizeText(req.params.id);
    const data = getFinanceData();
    const current = Array.isArray(data.entries) ? data.entries : [];
    const next = current.filter((item) => String(item.id) !== String(id));

    if (next.length === current.length) {
      return res.status(404).json({
        ok: false,
        error: "Movimiento no encontrado."
      });
    }

    data.entries = next;
    saveFinanceData(data);

    return res.json({
      ok: true,
      deleted: true,
      summary: buildFinanceSummary(next)
    });
  } catch (error) {
    console.error("Error DELETE /api/finance/:id:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo borrar el movimiento."
    });
  }
});

// =========================
// INVESTMENTS ROUTES
// =========================
app.get("/api/investments", (req, res) => {
  try {
    const data = getInvestmentsData();
    return res.json({
      ok: true,
      ...data,
      summary: buildInvestmentSummary(data),
      projections: buildInvestmentProjections(data)
    });
  } catch (error) {
    console.error("Error /api/investments:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron cargar inversiones."
    });
  }
});

app.post("/api/investments/asset", (req, res) => {
  try {
    const data = getInvestmentsData();
    const body = req.body || {};

    const asset = {
      id: createId("asset"),
      asset: normalizeText(body.asset || "otro activo"),
      currentValue: Math.abs(toNumber(body.currentValue, 0)),
      targetWeight: Math.abs(toNumber(body.targetWeight, 0)),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    data.assets = Array.isArray(data.assets) ? data.assets : [];
    data.assets.push(asset);
    saveInvestmentsData(data);

    return res.json({
      ok: true,
      saved: asset,
      summary: buildInvestmentSummary(data),
      projections: buildInvestmentProjections(data)
    });
  } catch (error) {
    console.error("Error POST /api/investments/asset:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar el activo."
    });
  }
});

app.post("/api/investments/contribution", (req, res) => {
  try {
    const data = getInvestmentsData();
    const body = req.body || {};

    const contribution = {
      id: createId("contrib"),
      asset: normalizeText(body.asset || "otro activo"),
      amount: Math.abs(toNumber(body.amount, 0)),
      frequency: normalizeText(body.frequency || "monthly"),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    data.contributions = Array.isArray(data.contributions)
      ? data.contributions
      : [];
    data.contributions.push(contribution);
    saveInvestmentsData(data);

    return res.json({
      ok: true,
      saved: contribution,
      summary: buildInvestmentSummary(data),
      projections: buildInvestmentProjections(data)
    });
  } catch (error) {
    console.error("Error POST /api/investments/contribution:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar el aporte."
    });
  }
});

app.get("/api/projections", (req, res) => {
  try {
    const data = getInvestmentsData();
    return res.json({
      ok: true,
      summary: buildInvestmentSummary(data),
      projections: buildInvestmentProjections(data)
    });
  } catch (error) {
    console.error("Error /api/projections:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron calcular proyecciones."
    });
  }
});

// =========================
// BUSINESS / ECOMMERCE ROUTES
// =========================
app.get("/api/business/opportunities", (req, res) => {
  try {
    const data = getOpportunitiesData();
    return res.json({
      ok: true,
      items: sortByDateDesc(data.items || [])
    });
  } catch (error) {
    console.error("Error /api/business/opportunities:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron cargar oportunidades."
    });
  }
});

app.post("/api/business/opportunities", (req, res) => {
  try {
    const data = getOpportunitiesData();
    const body = req.body || {};

    const item = {
      id: createId("opp"),
      title: normalizeText(body.title || "Oportunidad sin título"),
      niche: normalizeText(body.niche || ""),
      description: normalizeText(body.description || ""),
      source: normalizeText(body.source || ""),
      status: normalizeText(body.status || "idea"),
      score: toNumber(body.score, 0),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    data.items = Array.isArray(data.items) ? data.items : [];
    data.items.push(item);
    saveOpportunitiesData(data);

    return res.json({
      ok: true,
      saved: item
    });
  } catch (error) {
    console.error("Error POST /api/business/opportunities:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar la oportunidad."
    });
  }
});

app.get("/api/ecommerce/products", (req, res) => {
  try {
    const data = getProductsData();
    return res.json({
      ok: true,
      items: sortByDateDesc(data.items || [])
    });
  } catch (error) {
    console.error("Error /api/ecommerce/products:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron cargar productos."
    });
  }
});

app.post("/api/ecommerce/products", (req, res) => {
  try {
    const data = getProductsData();
    const body = req.body || {};

    const item = {
      id: createId("prod"),
      name: normalizeText(body.name || "Producto sin nombre"),
      category: normalizeText(body.category || ""),
      market: normalizeText(body.market || ""),
      price: Math.abs(toNumber(body.price, 0)),
      cost: Math.abs(toNumber(body.cost, 0)),
      margin: Math.abs(toNumber(body.margin, 0)),
      source: normalizeText(body.source || ""),
      notes: normalizeText(body.notes || ""),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    data.items = Array.isArray(data.items) ? data.items : [];
    data.items.push(item);
    saveProductsData(data);

    return res.json({
      ok: true,
      saved: item
    });
  } catch (error) {
    console.error("Error POST /api/ecommerce/products:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar el producto."
    });
  }
});

// =========================
// DASHBOARD
// =========================
app.get("/api/dashboard", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const finance = getFinanceData();
    const investments = getInvestmentsData();
    const business = buildBusinessSnapshot();

    return res.json({
      ok: true,
      userId,
      cards: {
        recentMemories: getUserMemories(userId).length,
        importantMemories: getUserLongMemories(userId).length,
        profileItems: getUserProfiles(userId).length,
        financeEntries: (finance.entries || []).length,
        investmentAssets: (investments.assets || []).length
      },
      profile_summary: buildProfileSummary(userId),
      finance: {
        categories: finance.categories || DEFAULT_FINANCE_CATEGORIES,
        summary: buildFinanceSummary(finance.entries || [])
      },
      investments: {
        summary: buildInvestmentSummary(investments),
        projections: buildInvestmentProjections(investments)
      },
      business
    });
  } catch (error) {
    console.error("Error /api/dashboard:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar el dashboard."
    });
  }
});

// =========================
// OPTIONAL XLSX PARSE FROM JSON BODY
// =========================
app.post("/api/xlsx/preview", (req, res) => {
  try {
    if (!XLSX) {
      return res.status(400).json({
        ok: false,
        error: "xlsx no está disponible."
      });
    }

    const base64 = normalizeText(req.body?.base64);
    if (!base64) {
      return res.status(400).json({
        ok: false,
        error: "Falta base64."
      });
    }

    const buffer = Buffer.from(base64, "base64");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    return res.json({
      ok: true,
      sheetName,
      rows: rows.slice(0, 50)
    });
  } catch (error) {
    console.error("Error /api/xlsx/preview:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo leer el archivo xlsx."
    });
  }
});

// =========================
// 404 API
// =========================
app.use("/api", (req, res) => {
  return res.status(404).json({
    ok: false,
    error: "Ruta API no encontrada."
  });
});

// =========================
// FRONTEND FALLBACK
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
  console.log(`🤖 OpenAI: ${OPENAI_API_KEY ? "configurado" : "no configurado"}`);
  console.log(`🧾 XLSX: ${XLSX ? "disponible" : "no disponible"}`);
});

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
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// =========================
// VARIABLES DE ENTORNO
// =========================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// =========================
// HELPERS
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

function normalizeText(value) {
return String(value || "").trim();
}

// =========================
// FILTROS DE MEMORIA
// =========================
function shouldSaveMemory(message) {
const text = normalizeText(message).toLowerCase();
if (!text) return false;
if (text.length < 12) return false;

const exactBlacklist = new Set([
"hola",
"ok",
"oki",
"gracias",
"jaj",
"jaja",
"jeje",
"hi",
"hello",
"👍",
"👌",
"dale"
]);

if (exactBlacklist.has(text)) return false;

return true;
}

function shouldSaveLongMemory(message) {
const text = normalizeText(message).toLowerCase();
if (!text) return false;
if (text.length < 20) return false;

const keywords = [
"quiero",
"recuerda",
"recordar",
"importante",
"objetivo",
"configurar",
"regla",
"preferencia",
"siempre",
"nunca",
"desde ahora",
"pepinazo",
"memoria",
"supabase",
"openai",
"perplexity",
"claude",
"proyecto",
"app",
"inversion",
"inversión",
"estrategia",
"roadmap",
"guardar esto",
"guarda esto"
];

return keywords.some((k) => text.includes(k));
}

// =========================
// SUPABASE - INSERTAR
// =========================
async function insertRow(table, userId, message) {
try {
if (!hasSupabaseConfig()) {
return {
ok: false,
status: 500,
body: "Faltan variables de entorno de Supabase"
};
}

const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
method: "POST",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=representation"
},
body: JSON.stringify({
user_id: userId,
message
})
});

const body = await response.text();

console.log(`INSERT SUPABASE ${table} STATUS:`, response.status);
console.log(`INSERT SUPABASE ${table} BODY:`, body);

return {
ok: response.ok,
status: response.status,
body
};
} catch (error) {
console.log(`INSERT SUPABASE ${table} ERROR:`, error);
return {
ok: false,
status: 500,
body: String(error)
};
}
}

async function saveMemory(userId, message) {
if (!shouldSaveMemory(message)) {
console.log("NO SE GUARDA EN memoria:", message);
return { ok: true, skipped: true };
}

return insertRow("memoria", userId, message);
}

async function saveLongMemory(userId, message) {
if (!shouldSaveLongMemory(message)) {
console.log("NO SE GUARDA EN memoria_larga:", message);
return { ok: true, skipped: true };
}

return insertRow("memoria_larga", userId, message);
}

// =========================
// SUPABASE - LEER
// =========================
async function readTable(table, userId, limit = 8) {
try {
if (!hasSupabaseConfig()) return [];

const url =
`${SUPABASE_URL}/rest/v1/${table}` +
`?select=id,user_id,message,created_at` +
`&user_id=eq.${encodeURIComponent(userId)}` +
`&order=created_at.desc` +
`&limit=${limit}`;

const response = await fetch(url, {
method: "GET",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json"
}
});

const text = await response.text();

console.log(`READ SUPABASE ${table} STATUS:`, response.status);
console.log(`READ SUPABASE ${table} BODY:`, text);

if (!response.ok) return [];

const rows = safeJsonParse(text, []);
return Array.isArray(rows) ? rows.reverse() : [];
} catch (error) {
console.log(`READ SUPABASE ${table} ERROR:`, error);
return [];
}
}

async function getRecentMemory(userId, limit = 8) {
return readTable("memoria", userId, limit);
}

async function getLongMemory(userId, limit = 8) {
return readTable("memoria_larga", userId, limit);
}

function buildMemoryText(shortMemories, longMemories) {
const longText = longMemories.length
? longMemories.map((row) => row.message).join("\n")
: "Sin memoria importante.";

const shortText = shortMemories.length
? shortMemories.map((row) => row.message).join("\n")
: "Sin memoria reciente.";

return [
"MEMORIA IMPORTANTE:",
longText,
"",
"MEMORIA RECIENTE:",
shortText
].join("\n");
}

// =========================
// OPENAI
// =========================
async function callOpenAI(message, memoryText) {
try {
if (!OPENAI_API_KEY) {
return "Falta OPENAI_API_KEY en Render.";
}

const response = await fetch("https://api.openai.com/v1/chat/completions", {
method: "POST",
headers: {
Authorization: `Bearer ${OPENAI_API_KEY}`,
"Content-Type": "application/json"
},
body: JSON.stringify({
model: "gpt-4.1-mini",
messages: [
{
role: "system",
content:
"Eres Pepinazo AI. Responde siempre en español. Sé útil, claro, directo, cercano y con humor inteligente. Usa la memoria proporcionada cuando exista. No digas que no tienes memoria si el contexto incluye memoria reciente o importante. Ayuda con estrategia, inversión, automatización, negocios, código y construcción de una super app personal."
},
{
role: "system",
content: memoryText
},
{
role: "user",
content: message
}
],
temperature: 0.7
})
});

const rawText = await response.text();

console.log("OPENAI STATUS:", response.status);
console.log("OPENAI BODY:", rawText);

const data = safeJsonParse(rawText, {});

if (!response.ok) {
const apiError =
data?.error?.message ||
rawText ||
"Error desconocido al consultar OpenAI.";
return `Error OpenAI: ${apiError}`;
}

const content = data?.choices?.[0]?.message?.content;

if (!content || !String(content).trim()) {
console.log("OPENAI EMPTY CONTENT:", data);
return "Error OpenAI: respuesta vacía.";
}

return String(content).trim();
} catch (error) {
console.log("ERROR CON OPENAI:", error);
return "Error al conectar con OpenAI.";
}
}

// =========================
// RUTAS
// =========================
app.get("/", (req, res) => {
const indexPath = path.join(__dirname, "public", "index.html");

if (fs.existsSync(indexPath)) {
return res.sendFile(indexPath);
}

return res.send("Pepinazo AI en funcionamiento");
});

app.get("/health", (req, res) => {
return res.json({
ok: true,
service: "pepinazo-ai",
openai_configured: Boolean(OPENAI_API_KEY),
supabase_configured: hasSupabaseConfig()
});
});

app.get("/prueba", async (req, res) => {
const result = await saveMemory(
"usuario1",
"guarda esto prueba memoria nueva numero 12345 importante"
);

if (result.ok) {
return res.send("guardado");
}

return res.status(500).send(`Error de Supabase: ${result.status} - ${result.body}`);
});

app.get("/prueba-de-memoria", async (req, res) => {
const shortMemories = await getRecentMemory("usuario1", 20);
const longMemories = await getLongMemory("usuario1", 20);

return res.json({
memoria: shortMemories,
memoria_larga: longMemories
});
});

app.post("/api/chat", async (req, res) => {
try {
const { message } = req.body || {};

if (!message || !String(message).trim()) {
return res.json({ reply: "Mensaje vacío." });
}

const cleanMessage = String(message).trim();
const userId = "usuario1";

// 1) Guardar primero el mensaje del usuario
const saveUserShort = await saveMemory(userId, cleanMessage);
if (!saveUserShort.ok) {
console.log(
"No se pudo guardar usuario en memoria corta:",
saveUserShort.status,
saveUserShort.body
);
}

const saveUserLong = await saveLongMemory(userId, cleanMessage);
if (!saveUserLong.ok) {
console.log(
"No se pudo guardar usuario en memoria larga:",
saveUserLong.status,
saveUserLong.body
);
}

// 2) Leer memoria actualizada
const shortMemories = await getRecentMemory(userId, 8);
const longMemories = await getLongMemory(userId, 8);
const memoryText = buildMemoryText(shortMemories, longMemories);

console.log("MEMORY TEXT ENVIADO A OPENAI:");
console.log(memoryText);

// 3) Obtener respuesta del modelo
const reply = await callOpenAI(cleanMessage, memoryText);

// 4) Guardar respuesta asistente en memoria corta
const saveAssistantShort = await saveMemory("asistente", reply);
if (!saveAssistantShort.ok) {
console.log(
"No se pudo guardar asistente en memoria corta:",
saveAssistantShort.status,
saveAssistantShort.body
);
}

return res.json({ reply });
} catch (error) {
console.log("ERROR DE CHAT:", error);
return res.status(500).json({ reply: "Error en servidor." });
}
});

// =========================
// START
// =========================
app.listen(PORT, () => {
console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});

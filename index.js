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
// CONFIG TABLAS
// =========================
const SHORT_MEMORY_TABLE = "memoria";
const LONG_MEMORY_TABLE = "memoria_larga";
const PROFILE_TABLE = "perfil_usuario";
const USER_COLUMN = "id_usuario";
const MESSAGE_COLUMN = "mensaje";

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

function isNonEmptyString(value) {
return typeof value === "string" && value.trim().length > 0;
}

// =========================
// FILTROS DE MEMORIA
// =========================
function shouldSaveMemory(message) {
const text = normalizeText(message).toLowerCase();

if (!text) return false;
if (text.length < 15) return false;

const blacklist = new Set([
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
"dale",
"si",
"sí",
"no",
"bien",
"perfecto"
]);

if (blacklist.has(text)) return false;

return true;
}

function shouldSaveLongMemory(message) {
const text = normalizeText(message).toLowerCase();

if (!text) return false;
if (text.length < 20) return false;

const blockedTopics = [
"clima",
"lluvia",
"llover",
"tiempo",
"temperatura",
"pronóstico",
"pronostico"
];

if (blockedTopics.some((k) => text.includes(k))) {
return false;
}

const keywords = [
"guarda esto",
"guardar esto",
"recuerda",
"recuerda esto",
"importante",
"desde ahora",
"mi nombre",
"objetivo",
"configuración",
"configuracion",
"regla",
"preferencia",
"siempre",
"nunca",
"proyecto",
"pepinazo",
"memoria",
"estrategia",
"plan",
"meta",
"roadmap",
"app",
"supabase",
"openai",
"claude",
"perplexity"
];

return keywords.some((k) => text.includes(k));
}

// =========================
// PERFIL USUARIO
// =========================
function extractProfileData(message) {
const text = normalizeText(message);

const patterns = [
{
key: "nombre",
regex: /mi nombre es\s+(.+)/i
},
{
key: "color_favorito",
regex: /mi color favorito es\s+(.+)/i
}
];

const extracted = [];

for (const pattern of patterns) {
const match = text.match(pattern.regex);
if (match && match[1]) {
extracted.push({
clave: pattern.key,
valor: match[1].trim()
});
}
}

return extracted;
}

function extractProfileDataSmart(message) {
const text = normalizeText(message);
const extracted = [];

function add(clave, valor) {
const clean = normalizeText(valor)
.replace(/[.!,;:]+$/g, "")
.trim();

if (!clean) return;

extracted.push({ clave, valor: clean });
}

let match =
text.match(/\bme llamo\s+([A-Za-zÁÉÍÓÚáéíóúÑñ ]{2,40})/i) ||
text.match(/\bpuedes llamarme\s+([A-Za-zÁÉÍÓÚáéíóúÑñ ]{2,40})/i) ||
text.match(/\bsoy\s+([A-Za-zÁÉÍÓÚáéíóúÑñ ]{2,40})$/i);

if (match && match[1]) {
add("nombre", match[1]);
}

match =
text.match(/\bmi proyecto es\s+(.+)/i) ||
text.match(/\bestoy creando\s+(.+)/i) ||
text.match(/\bestoy haciendo\s+(.+)/i) ||
text.match(/\bestoy trabajando en\s+(.+)/i);

if (match && match[1]) {
add("proyecto", match[1]);
}

match =
text.match(/\bmi objetivo es\s+(.+)/i) ||
text.match(/\bmi meta es\s+(.+)/i) ||
text.match(/\bquiero lograr\s+(.+)/i) ||
text.match(/\bquiero crear\s+(.+)/i);

if (match && match[1]) {
add("objetivo", match[1]);
}

match =
text.match(/\bprefiero\s+(.+)/i) ||
text.match(/\bno me gusta\s+(.+)/i) ||
text.match(/\bme gusta que\s+(.+)/i);

if (match && match[1]) {
add("preferencia", match[1]);
}

match =
text.match(/\bvivo en\s+(.+)/i) ||
text.match(/\bestoy en\s+([A-Za-zÁÉÍÓÚáéíóúÑñ ]{2,50})/i);

if (match && match[1]) {
add("ciudad", match[1]);
}

match =
text.match(/\btrabajo en\s+(.+)/i) ||
text.match(/\btrabajo como\s+(.+)/i);

if (match && match[1]) {
add("trabajo", match[1]);
}

const unique = [];
const seen = new Set();

for (const item of extracted) {
const key = `${item.clave}::${item.valor.toLowerCase()}`;
if (!seen.has(key)) {
seen.add(key);
unique.push(item);
}
}

return unique;
}

async function upsertProfileValue(idUsuario, clave, valor) {
try {
if (!hasSupabaseConfig()) {
return { ok: false, status: 500, body: "Faltan variables de Supabase" };
}

const queryUrl =
`${SUPABASE_URL}/rest/v1/${PROFILE_TABLE}` +
`?select=id,clave,valor` +
`&${USER_COLUMN}=eq.${encodeURIComponent(idUsuario)}` +
`&clave=eq.${encodeURIComponent(clave)}` +
`&limit=1`;

const existingRes = await fetch(queryUrl, {
method: "GET",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json"
}
});

const existingText = await existingRes.text();
const existingRows = safeJsonParse(existingText, []);

if (Array.isArray(existingRows) && existingRows.length > 0) {
const patchUrl =
`${SUPABASE_URL}/rest/v1/${PROFILE_TABLE}` +
`?${USER_COLUMN}=eq.${encodeURIComponent(idUsuario)}` +
`&clave=eq.${encodeURIComponent(clave)}`;

const patchRes = await fetch(patchUrl, {
method: "PATCH",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=representation"
},
body: JSON.stringify({ valor })
});

const patchBody = await patchRes.text();

return {
ok: patchRes.ok,
status: patchRes.status,
body: patchBody
};
}

const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/${PROFILE_TABLE}`, {
method: "POST",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=representation"
},
body: JSON.stringify({
[USER_COLUMN]: idUsuario,
clave,
valor
})
});

const insertBody = await insertRes.text();

return {
ok: insertRes.ok,
status: insertRes.status,
body: insertBody
};
} catch (error) {
console.log("UPSERT PROFILE ERROR:", error);
return {
ok: false,
status: 500,
body: String(error)
};
}
}

async function saveExtractedProfile(idUsuario, message) {
const extractedClassic = extractProfileData(message);
const extractedSmart = extractProfileDataSmart(message);
const extracted = [...extractedClassic, ...extractedSmart];

for (const item of extracted) {
const result = await upsertProfileValue(idUsuario, item.clave, item.valor);
if (!result.ok) {
console.log("No se pudo guardar perfil:", item, result.status, result.body);
}
}
}

async function getProfileData(idUsuario, limit = 20) {
try {
if (!hasSupabaseConfig()) return [];

const url =
`${SUPABASE_URL}/rest/v1/${PROFILE_TABLE}` +
`?select=id,${USER_COLUMN},clave,valor,created_at` +
`&${USER_COLUMN}=eq.${encodeURIComponent(idUsuario)}` +
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
if (!response.ok) return [];

const rows = safeJsonParse(text, []);
return Array.isArray(rows) ? rows : [];
} catch (error) {
console.log("READ PROFILE ERROR:", error);
return [];
}
}

// =========================
// SUPABASE - INSERTAR
// =========================
async function insertRow(table, idUsuario, mensaje) {
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
[USER_COLUMN]: idUsuario,
[MESSAGE_COLUMN]: mensaje
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

async function saveMemory(idUsuario, mensaje) {
if (!shouldSaveMemory(mensaje)) {
console.log("NO SE GUARDA EN memoria:", mensaje);
return { ok: true, skipped: true };
}

return insertRow(SHORT_MEMORY_TABLE, idUsuario, mensaje);
}

async function saveLongMemory(idUsuario, mensaje) {
if (!shouldSaveLongMemory(mensaje)) {
console.log("NO SE GUARDA EN memoria_larga:", mensaje);
return { ok: true, skipped: true };
}

return insertRow(LONG_MEMORY_TABLE, idUsuario, mensaje);
}

// =========================
// SUPABASE - LEER
// =========================
async function readTable(table, idUsuario, limit = 8) {
try {
if (!hasSupabaseConfig()) return [];

const url =
`${SUPABASE_URL}/rest/v1/${table}` +
`?select=id,${USER_COLUMN},${MESSAGE_COLUMN},created_at` +
`&${USER_COLUMN}=eq.${encodeURIComponent(idUsuario)}` +
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

async function getRecentMemory(idUsuario, limit = 8) {
return readTable(SHORT_MEMORY_TABLE, idUsuario, limit);
}

async function getLongMemory(idUsuario, limit = 8) {
return readTable(LONG_MEMORY_TABLE, idUsuario, limit);
}

function buildProfileText(profileRows) {
if (!profileRows.length) {
return "Sin perfil guardado.";
}

return profileRows
.map((row) => `${row.clave}: ${row.valor}`)
.join("\n");
}

function buildMemoryText(shortMemories, longMemories, profileRows) {
const longText = longMemories.length
? longMemories.map((row) => row[MESSAGE_COLUMN]).join("\n")
: "Sin memoria importante.";

const shortText = shortMemories.length
? shortMemories.map((row) => row[MESSAGE_COLUMN]).join("\n")
: "Sin memoria reciente.";

const profileText = buildProfileText(profileRows);

return [
"PERFIL DE USUARIO:",
profileText,
"",
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
"Eres Pepinazo AI. Responde siempre en español. Sé útil, claro, directo y cercano. Usa el perfil y la memoria proporcionados cuando existan. Si el usuario pregunta qué recuerdas, responde usando solo el contexto real guardado."
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

if (!isNonEmptyString(content)) {
console.log("OPENAI EMPTY CONTENT:", data);
return "Error OpenAI: respuesta vacía.";
}

return content.trim();
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
supabase_configured: hasSupabaseConfig(),
short_memory_table: SHORT_MEMORY_TABLE,
long_memory_table: LONG_MEMORY_TABLE,
profile_table: PROFILE_TABLE,
user_column: USER_COLUMN,
message_column: MESSAGE_COLUMN
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

return res
.status(500)
.send(`Error de Supabase: ${result.status} - ${result.body}`);
});

app.get("/prueba-de-memoria", async (req, res) => {
const shortMemories = await getRecentMemory("usuario1", 20);
const longMemories = await getLongMemory("usuario1", 20);
const profileRows = await getProfileData("usuario1", 20);

return res.json({
memoria: shortMemories,
memoria_larga: longMemories,
perfil_usuario: profileRows
});
});

app.post("/api/chat", async (req, res) => {
try {
const { message } = req.body || {};

if (!isNonEmptyString(message)) {
return res.status(400).json({ reply: "Mensaje vacío." });
}

const cleanMessage = message.trim();
const userId = "usuario1";

// 1) Guardar mensaje del usuario
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

// 2) Extraer perfil estructurado
await saveExtractedProfile(userId, cleanMessage);

// 3) Leer contexto actualizado
const shortMemories = await getRecentMemory(userId, 8);
const longMemories = await getLongMemory(userId, 8);
const profileRows = await getProfileData(userId, 20);
const memoryText = buildMemoryText(shortMemories, longMemories, profileRows);

// 4) Consultar OpenAI
const reply = await callOpenAI(cleanMessage, memoryText);

// 5) Guardar respuesta del asistente en memoria corta
const saveAssistantShort = await saveMemory(userId, `ASISTENTE: ${reply}`);
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
app.listen(PORT, "0.0.0.0", () => {
console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});


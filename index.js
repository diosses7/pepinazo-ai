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
const PROFILE_SUMMARY_TABLE = "perfil_resumen"; // opcional
const USER_COLUMN = "id_usuario";
const MESSAGE_COLUMN = "mensaje";

// =========================
// LIMITES DE CONTEXTO
// =========================
const MAX_SHORT_MEMORY_ITEMS = 8;
const MAX_LONG_MEMORY_ITEMS = 8;
const MAX_PROFILE_ITEMS = 30;
const MAX_CONTEXT_CHARS = 5000;
const MAX_SECTION_CHARS = 1400;

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

function normalizeForCompare(value) {
return normalizeText(value)
.toLowerCase()
.normalize("NFD")
.replace(/[\u0300-\u036f]/g, "")
.replace(/[^\w\s]/g, " ")
.replace(/\s+/g, " ")
.trim();
}

function truncateText(text, maxChars) {
const clean = normalizeText(text);
if (clean.length <= maxChars) return clean;
return clean.slice(0, maxChars) + "...";
}

function uniqueStrings(items) {
const seen = new Set();
const result = [];

for (const item of items) {
const clean = normalizeText(item);
if (!clean) continue;

const key = normalizeForCompare(clean);
if (!key || seen.has(key)) continue;

seen.add(key);
result.push(clean);
}

return result;
}

function getUserId(req) {
const bodyUserId = normalizeText(req.body?.userId);
const queryUserId = normalizeText(req.query?.userId);
const headerUserId = normalizeText(req.headers["x-user-id"]);

return bodyUserId || queryUserId || headerUserId || "usuario1";
}

function isLikelyDuplicateValue(existingValue, newValue) {
const a = normalizeForCompare(existingValue);
const b = normalizeForCompare(newValue);

if (!a || !b) return false;
if (a === b) return true;
if (a.includes(b) || b.includes(a)) return true;

return false;
}

function inferMemoryTag(message) {
const text = normalizeText(message).toLowerCase();

if (!text) return "contexto";

if (
text.includes("mi nombre") ||
text.includes("me llamo") ||
text.includes("puedes llamarme") ||
text.includes("mi color favorito") ||
text.includes("vivo en") ||
text.includes("trabajo en") ||
text.includes("trabajo como")
) {
return "perfil";
}

if (
text.includes("mi proyecto") ||
text.includes("estoy creando") ||
text.includes("estoy haciendo") ||
text.includes("estoy trabajando en") ||
text.includes("pepinazo")
) {
return "proyecto";
}

if (
text.includes("mi objetivo") ||
text.includes("mi meta") ||
text.includes("quiero crear") ||
text.includes("quiero lograr")
) {
return "objetivo";
}

if (
text.includes("prefiero") ||
text.includes("me gusta que") ||
text.includes("no me gusta")
) {
return "preferencia";
}

if (
text.includes("recordar") ||
text.includes("recuérdame") ||
text.includes("recuerdame") ||
text.includes("mañana") ||
text.includes("después") ||
text.includes("despues")
) {
return "recordatorio";
}

if (
text.includes("haz") ||
text.includes("crear") ||
text.includes("armar") ||
text.includes("prepara") ||
text.includes("genera")
) {
return "tarea";
}

return "contexto";
}

function groupMemoriesByTag(rows) {
const grouped = {
perfil: [],
proyecto: [],
objetivo: [],
preferencia: [],
tarea: [],
recordatorio: [],
contexto: []
};

for (const row of rows) {
const message = row?.[MESSAGE_COLUMN] || "";
const tag = inferMemoryTag(message);

if (!grouped[tag]) {
grouped[tag] = [];
}

grouped[tag].push(row);
}

return grouped;
}

function limitedJoin(items, maxChars = MAX_SECTION_CHARS) {
let result = "";

for (const item of items) {
const candidate = result ? `${result}\n${item}` : item;
if (candidate.length > maxChars) break;
result = candidate;
}

return result || "Sin datos.";
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
const key = `${item.clave}::${normalizeForCompare(item.valor)}`;
if (!seen.has(key)) {
seen.add(key);
unique.push(item);
}
}

return unique;
}

async function getProfileData(idUsuario, limit = MAX_PROFILE_ITEMS) {
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

async function profileValueExists(idUsuario, clave, valor) {
try {
const rows = await getProfileData(idUsuario, 100);
const sameKeyRows = rows.filter((row) => row.clave === clave);
return sameKeyRows.some((row) => isLikelyDuplicateValue(row.valor, valor));
} catch (error) {
console.log("PROFILE DUP CHECK ERROR:", error);
return false;
}
}

async function upsertProfileValue(idUsuario, clave, valor) {
try {
if (!hasSupabaseConfig()) {
return {
ok: false,
status: 500,
body: "Faltan variables de Supabase"
};
}

const exists = await profileValueExists(idUsuario, clave, valor);
if (exists) {
return {
ok: true,
status: 200,
body: "Duplicado evitado"
};
}

const response = await fetch(
`${SUPABASE_URL}/rest/v1/${PROFILE_TABLE}`,
{
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
}
);

const body = await response.text();

return {
ok: response.ok,
status: response.status,
body
};
} catch (error) {
console.log("INSERT PROFILE ERROR:", error);

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

await refreshProfileSummary(idUsuario);
}

function buildProfileSummaryObject(profileRows) {
const latestByKey = {};
const grouped = {
nombre: [],
color_favorito: [],
proyecto: [],
objetivo: [],
preferencia: [],
ciudad: [],
trabajo: []
};

for (const row of profileRows) {
if (!row?.clave || !isNonEmptyString(row?.valor)) continue;

if (!latestByKey[row.clave]) {
latestByKey[row.clave] = row.valor;
}

if (!grouped[row.clave]) {
grouped[row.clave] = [];
}

grouped[row.clave].push(row.valor);
}

for (const key of Object.keys(grouped)) {
grouped[key] = uniqueStrings(grouped[key]);
}

return {
nombre: latestByKey.nombre || "",
color_favorito: latestByKey.color_favorito || "",
ciudad: latestByKey.ciudad || "",
trabajo: latestByKey.trabajo || "",
proyecto_principal: grouped.proyecto[0] || "",
objetivo_actual: grouped.objetivo[0] || "",
preferencias: grouped.preferencia,
proyectos: grouped.proyecto,
objetivos: grouped.objetivo,
datos_estables: {
nombre: latestByKey.nombre || "",
color_favorito: latestByKey.color_favorito || "",
ciudad: latestByKey.ciudad || "",
trabajo: latestByKey.trabajo || ""
}
};
}

function buildProfileSummaryText(profileRows) {
const summary = buildProfileSummaryObject(profileRows);
const lines = [];

if (summary.nombre) lines.push(`Nombre: ${summary.nombre}`);
if (summary.ciudad) lines.push(`Ciudad: ${summary.ciudad}`);
if (summary.trabajo) lines.push(`Trabajo: ${summary.trabajo}`);
if (summary.color_favorito) lines.push(`Color favorito: ${summary.color_favorito}`);
if (summary.proyecto_principal) lines.push(`Proyecto principal: ${summary.proyecto_principal}`);
if (summary.objetivo_actual) lines.push(`Objetivo actual: ${summary.objetivo_actual}`);
if (summary.preferencias.length) {
lines.push(`Preferencias: ${summary.preferencias.join(" | ")}`);
}

if (!lines.length) {
return "Sin resumen de perfil.";
}

return lines.join("\n");
}

async function getProfileSummaryRow(idUsuario) {
try {
if (!hasSupabaseConfig()) return null;

const url =
`${SUPABASE_URL}/rest/v1/${PROFILE_SUMMARY_TABLE}` +
`?select=id,${USER_COLUMN},resumen,created_at` +
`&${USER_COLUMN}=eq.${encodeURIComponent(idUsuario)}` +
`&order=created_at.desc` +
`&limit=1`;

const response = await fetch(url, {
method: "GET",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json"
}
});

const text = await response.text();
if (!response.ok) return null;

const rows = safeJsonParse(text, []);
if (!Array.isArray(rows) || !rows.length) return null;

return rows[0];
} catch (error) {
console.log("READ PROFILE SUMMARY ERROR:", error);
return null;
}
}

async function refreshProfileSummary(idUsuario) {
try {
if (!hasSupabaseConfig()) return null;

const profileRows = await getProfileData(idUsuario, 100);
const resumen = buildProfileSummaryText(profileRows);
const existing = await getProfileSummaryRow(idUsuario);

if (existing?.id) {
const patchUrl =
`${SUPABASE_URL}/rest/v1/${PROFILE_SUMMARY_TABLE}` +
`?id=eq.${existing.id}`;

const patchRes = await fetch(patchUrl, {
method: "PATCH",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=representation"
},
body: JSON.stringify({ resumen })
});

const patchBody = await patchRes.text();

return {
ok: patchRes.ok,
status: patchRes.status,
body: patchBody
};
}

const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/${PROFILE_SUMMARY_TABLE}`, {
method: "POST",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=representation"
},
body: JSON.stringify({
[USER_COLUMN]: idUsuario,
resumen
})
});

const insertBody = await insertRes.text();

return {
ok: insertRes.ok,
status: insertRes.status,
body: insertBody
};
} catch (error) {
console.log("REFRESH PROFILE SUMMARY INFO:", error);
return null;
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

async function getRecentMemory(idUsuario, limit = MAX_SHORT_MEMORY_ITEMS) {
return readTable(SHORT_MEMORY_TABLE, idUsuario, limit);
}

async function getLongMemory(idUsuario, limit = MAX_LONG_MEMORY_ITEMS) {
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

function buildHierarchicalMemoryText(shortMemories, longMemories, profileRows, profileSummaryText) {
const recentGrouped = groupMemoriesByTag(shortMemories);
const longGrouped = groupMemoriesByTag(longMemories);
const stableProfile = buildProfileSummaryText(profileRows);
const summaryBlock = profileSummaryText || stableProfile || "Sin resumen de perfil.";

const projectLines = uniqueStrings([
...profileRows.filter((r) => r.clave === "proyecto").map((r) => r.valor),
...longGrouped.proyecto.map((r) => r[MESSAGE_COLUMN]),
...recentGrouped.proyecto.map((r) => r[MESSAGE_COLUMN])
]);

const objectiveLines = uniqueStrings([
...profileRows.filter((r) => r.clave === "objetivo").map((r) => r.valor),
...longGrouped.objetivo.map((r) => r[MESSAGE_COLUMN]),
...recentGrouped.objetivo.map((r) => r[MESSAGE_COLUMN])
]);

const preferenceLines = uniqueStrings([
...profileRows.filter((r) => r.clave === "preferencia").map((r) => r.valor),
...longGrouped.preferencia.map((r) => r[MESSAGE_COLUMN]),
...recentGrouped.preferencia.map((r) => r[MESSAGE_COLUMN])
]);

const recentLines = shortMemories.map((r) => r[MESSAGE_COLUMN]);
const historicalLines = longMemories.map((r) => r[MESSAGE_COLUMN]);

const composed = [
"PERFIL MAESTRO:",
truncateText(summaryBlock, 700),
"",
"PERFIL ESTABLE:",
truncateText(stableProfile, 900),
"",
"PROYECTOS:",
limitedJoin(projectLines, 700),
"",
"OBJETIVOS ACTUALES:",
limitedJoin(objectiveLines, 700),
"",
"PREFERENCIAS:",
limitedJoin(preferenceLines, 700),
"",
"MEMORIA RECIENTE:",
limitedJoin(recentLines, 1000),
"",
"MEMORIA HISTÓRICA IMPORTANTE:",
limitedJoin(historicalLines, 1000)
].join("\n");

return truncateText(composed, MAX_CONTEXT_CHARS);
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
"Eres Pepinazo AI. Responde siempre en español. Sé útil, claro, directo y cercano. Usa el perfil y la memoria proporcionados cuando existan. Si el usuario pregunta qué recuerdas, responde usando solo el contexto real guardado. Prioriza el perfil maestro, luego el perfil estable, luego proyectos, objetivos, preferencias y finalmente memoria reciente."
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
// PANEL DE MEMORIA - HELPERS
// =========================
async function deleteRowById(table, id) {
try {
if (!hasSupabaseConfig()) {
return { ok: false, status: 500, body: "Faltan variables de Supabase" };
}

const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`;

const response = await fetch(url, {
method: "DELETE",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=representation"
}
});

const body = await response.text();

return {
ok: response.ok,
status: response.status,
body
};
} catch (error) {
console.log("DELETE ROW ERROR:", error);
return {
ok: false,
status: 500,
body: String(error)
};
}
}

async function updateMessageRow(table, id, newValue) {
try {
if (!hasSupabaseConfig()) {
return { ok: false, status: 500, body: "Faltan variables de Supabase" };
}

const payload =
table === PROFILE_TABLE
? { valor: newValue }
: { [MESSAGE_COLUMN]: newValue };

const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`;

const response = await fetch(url, {
method: "PATCH",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=representation"
},
body: JSON.stringify(payload)
});

const body = await response.text();

return {
ok: response.ok,
status: response.status,
body
};
} catch (error) {
console.log("UPDATE ROW ERROR:", error);
return {
ok: false,
status: 500,
body: String(error)
};
}
}

async function pinMemoryToLongMemory(idUsuario, sourceTable, id) {
try {
const rows = await readTable(sourceTable, idUsuario, 100);
const target = rows.find((row) => String(row.id) === String(id));

if (!target) {
return { ok: false, status: 404, body: "Registro no encontrado" };
}

return saveLongMemory(idUsuario, target[MESSAGE_COLUMN]);
} catch (error) {
console.log("PIN MEMORY ERROR:", error);
return {
ok: false,
status: 500,
body: String(error)
};
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
profile_summary_table: PROFILE_SUMMARY_TABLE,
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
const userId = getUserId(req);

const shortMemories = await getRecentMemory(userId, 20);
const longMemories = await getLongMemory(userId, 20);
const profileRows = await getProfileData(userId, 50);
const profileSummary = await getProfileSummaryRow(userId);

return res.json({
memoria: shortMemories.map((row) => ({
...row,
tipo: inferMemoryTag(row[MESSAGE_COLUMN])
})),
memoria_larga: longMemories.map((row) => ({
...row,
tipo: inferMemoryTag(row[MESSAGE_COLUMN])
})),
perfil_usuario: profileRows,
perfil_resumen: profileSummary
});
});

// =========================
// PANEL DE MEMORIA - BACKEND
// =========================
app.get("/memory-panel", async (req, res) => {
try {
const userId = getUserId(req);

const shortMemories = await getRecentMemory(userId, 50);
const longMemories = await getLongMemory(userId, 50);
const profileRows = await getProfileData(userId, 100);
const profileSummary = await getProfileSummaryRow(userId);

return res.json({
userId,
perfil_resumen: profileSummary,
perfil_estable: buildProfileSummaryObject(profileRows),
perfil_usuario: profileRows,
memoria_reciente: shortMemories.map((row) => ({
...row,
tipo: inferMemoryTag(row[MESSAGE_COLUMN])
})),
memoria_importante: longMemories.map((row) => ({
...row,
tipo: inferMemoryTag(row[MESSAGE_COLUMN])
}))
});
} catch (error) {
console.log("MEMORY PANEL ERROR:", error);
return res.status(500).json({ ok: false, error: "Error en memory-panel." });
}
});

app.patch("/memory/profile/:id", async (req, res) => {
const { id } = req.params;
const { valor, userId } = req.body || {};

if (!isNonEmptyString(valor)) {
return res.status(400).json({ ok: false, error: "Valor inválido." });
}

const result = await updateMessageRow(PROFILE_TABLE, id, valor);

if (!result.ok) {
return res.status(result.status || 500).json({ ok: false, error: result.body });
}

await refreshProfileSummary(normalizeText(userId) || "usuario1");

return res.json({ ok: true, result });
});

app.patch("/memory/message/:table/:id", async (req, res) => {
const { table, id } = req.params;
const { mensaje } = req.body || {};

if (![SHORT_MEMORY_TABLE, LONG_MEMORY_TABLE].includes(table)) {
return res.status(400).json({ ok: false, error: "Tabla inválida." });
}

if (!isNonEmptyString(mensaje)) {
return res.status(400).json({ ok: false, error: "Mensaje inválido." });
}

const result = await updateMessageRow(table, id, mensaje);

if (!result.ok) {
return res.status(result.status || 500).json({ ok: false, error: result.body });
}

return res.json({ ok: true, result });
});

app.delete("/memory/:table/:id", async (req, res) => {
const { table, id } = req.params;
const userId = getUserId(req);

if (![SHORT_MEMORY_TABLE, LONG_MEMORY_TABLE, PROFILE_TABLE].includes(table)) {
return res.status(400).json({ ok: false, error: "Tabla inválida." });
}

const result = await deleteRowById(table, id);

if (!result.ok) {
return res.status(result.status || 500).json({ ok: false, error: result.body });
}

if (table === PROFILE_TABLE) {
await refreshProfileSummary(userId);
}

return res.json({ ok: true, result });
});

app.post("/memory/pin", async (req, res) => {
const { sourceTable, id, userId } = req.body || {};

if (![SHORT_MEMORY_TABLE, LONG_MEMORY_TABLE].includes(sourceTable)) {
return res.status(400).json({ ok: false, error: "sourceTable inválida." });
}

if (!isNonEmptyString(String(id || ""))) {
return res.status(400).json({ ok: false, error: "ID inválido." });
}

const finalUserId = normalizeText(userId) || "usuario1";
const result = await pinMemoryToLongMemory(finalUserId, sourceTable, id);

if (!result.ok) {
return res.status(result.status || 500).json({ ok: false, error: result.body });
}

return res.json({ ok: true, result });
});

app.delete("/memory-clear", async (req, res) => {
try {
const userId = getUserId(req);

const tables = [
SHORT_MEMORY_TABLE,
LONG_MEMORY_TABLE,
PROFILE_TABLE,
PROFILE_SUMMARY_TABLE
];

const results = [];

for (const table of tables) {
try {
const url =
`${SUPABASE_URL}/rest/v1/${table}` +
`?${USER_COLUMN}=eq.${encodeURIComponent(userId)}`;

const response = await fetch(url, {
method: "DELETE",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=representation"
}
});

const body = await response.text();

results.push({
table,
ok: response.ok,
status: response.status,
body
});
} catch (innerError) {
results.push({
table,
ok: false,
status: 500,
body: String(innerError)
});
}
}

return res.json({ ok: true, results });
} catch (error) {
console.log("MEMORY CLEAR ERROR:", error);
return res.status(500).json({ ok: false, error: "Error limpiando memoria." });
}
});

app.post("/api/chat", async (req, res) => {
try {
const { message } = req.body || {};

if (!isNonEmptyString(message)) {
return res.status(400).json({ reply: "Mensaje vacío." });
}

const cleanMessage = message.trim();
const userId = getUserId(req);

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

// 2) Extraer perfil estructurado + resumen
await saveExtractedProfile(userId, cleanMessage);

// 3) Leer contexto jerárquico actualizado
const shortMemories = await getRecentMemory(userId, MAX_SHORT_MEMORY_ITEMS);
const longMemories = await getLongMemory(userId, MAX_LONG_MEMORY_ITEMS);
const profileRows = await getProfileData(userId, MAX_PROFILE_ITEMS);
const profileSummaryRow = await getProfileSummaryRow(userId);

const profileSummaryText =
profileSummaryRow?.resumen || buildProfileSummaryText(profileRows);

const memoryText = buildHierarchicalMemoryText(
shortMemories,
longMemories,
profileRows,
profileSummaryText
);

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

return res.json({
reply,
userId,
profile_summary: profileSummaryText
});
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

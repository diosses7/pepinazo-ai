require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
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

// =========================
// FILTROS DE MEMORIA
// =========================

function shouldSaveMemory(message) {
if (!message) return false;

const text = message.toLowerCase().trim();

const blacklist = [
"hola",
"ok",
"gracias",
"jaj",
"jeje",
"test",
"probando",
"123",
"hi",
"hello",
"👍"
];

if (text.length < 15) return false;

for (const word of blacklist) {
if (text.includes(word)) return false;
}

return true;
}

function shouldSaveLongMemory(message) {
if (!message) return false;

const text = message.toLowerCase().trim();

const keywords = [
"quiero",
"recuerda",
"recordar",
"importante",
"objetivo",
"config",
"configuracion",
"configuración",
"decisión",
"decision",
"usar",
"proyecto",
"regla",
"guardar",
"no guardar",
"preferencia",
"siempre",
"nunca",
"desde ahora",
"pepínazo",
"pepinazo",
"memoria",
"supabase",
"openai",
"perplexity"
];

if (text.length < 20) return false;

for (const k of keywords) {
if (text.includes(k)) return true;
}

return false;
}

// =========================
// SUPABASE SAVE
// =========================

async function insertRow(table, user, message) {
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
user_id: user,
message: message
})
});

const body = await response.text();

console.log(`SUPABASE INSERT ${table} STATUS:`, response.status);
console.log(`SUPABASE INSERT ${table} BODY:`, body);

return {
ok: response.ok,
status: response.status,
body
};
} catch (error) {
console.log(`SUPABASE INSERT ${table} ERROR:`, error);
return {
ok: false,
status: 500,
body: String(error)
};
}
}

async function saveMemory(user, message) {
if (!shouldSaveMemory(message)) {
console.log("NO SE GUARDA EN memory:", message);
return { ok: true, skipped: true };
}

return insertRow("memory", user, message);
}

async function saveLongMemory(user, message) {
if (!shouldSaveLongMemory(message)) {
console.log("NO SE GUARDA EN memory_long:", message);
return { ok: true, skipped: true };
}

return insertRow("memory_long", user, message);
}

// =========================
// SUPABASE READ
// =========================

async function readTable(table, user, limit = 8) {
try {
if (!hasSupabaseConfig()) return [];

const url =
`${SUPABASE_URL}/rest/v1/${table}` +
`?select=user_id,message,created_at` +
`&user_id=eq.${encodeURIComponent(user)}` +
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

console.log(`SUPABASE READ ${table} STATUS:`, response.status);
console.log(`SUPABASE READ ${table} BODY:`, text);

if (!response.ok) {
return [];
}

const rows = JSON.parse(text);
return rows.reverse();
} catch (error) {
console.log(`SUPABASE READ ${table} ERROR:`, error);
return [];
}
}

async function getRecentMemory(user, limit = 8) {
return readTable("memory", user, limit);
}

async function getLongMemory(user, limit = 8) {
return readTable("memory_long", user, limit);
}

function buildMemoryText(shortMemories, longMemories) {
const shortText = shortMemories.length
? shortMemories.map((m) => `${m.user_id}: ${m.message}`).join("\n")
: "Sin memoria reciente.";

const longText = longMemories.length
? longMemories.map((m) => `${m.user_id}: ${m.message}`).join("\n")
: "Sin memoria importante.";

return `
MEMORIA IMPORTANTE:
${longText}

MEMORIA RECIENTE:
${shortText}
`.trim();
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
"Eres Pepinazo AI. Responde siempre en español. Sé útil, claro, cercano y con humor inteligente suave. Usa la memoria solo si aporta valor y no inventes recuerdos."
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

const data = await response.json();

if (!response.ok) {
console.log("OPENAI HTTP ERROR:", data);
return "Error OpenAI";
}

if (!data.choices || !data.choices[0] || !data.choices[0].message) {
console.log("OPENAI RESPONSE ERROR:", data);
return "Error OpenAI";
}

return data.choices[0].message.content;
} catch (error) {
console.log("OPENAI FETCH ERROR:", error);
return "Error al conectar con OpenAI";
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

return res.send("Pepinazo AI running");
});

app.get("/test", async (req, res) => {
const result = await saveMemory("user1", "mensaje de prueba importante");

if (result.ok) {
return res.send("guardado");
}

return res.status(500).send(`error supabase: ${result.status} - ${result.body}`);
});

app.get("/memory-test", async (req, res) => {
const shortMemories = await getRecentMemory("user1", 20);
const longMemories = await getLongMemory("user1", 20);

return res.json({
memory: shortMemories,
memory_long: longMemories
});
});

app.post("/api/chat", async (req, res) => {
try {
const { message } = req.body;

if (!message || !message.trim()) {
return res.json({ reply: "Mensaje vacío" });
}

const cleanMessage = message.trim();
const userId = "user1";

// 1. Leer memorias
const shortMemories = await getRecentMemory(userId, 8);
const longMemories = await getLongMemory(userId, 8);
const memoryText = buildMemoryText(shortMemories, longMemories);

// 2. Obtener respuesta
const reply = await callOpenAI(cleanMessage, memoryText);

// 3. Guardar mensaje del usuario en memoria corta
const saveUserShort = await saveMemory(userId, cleanMessage);
if (!saveUserShort.ok) {
console.log("No se pudo guardar user en memory:", saveUserShort.status, saveUserShort.body);
}

// 4. Guardar mensaje del usuario en memoria larga si aplica
const saveUserLong = await saveLongMemory(userId, cleanMessage);
if (!saveUserLong.ok) {
console.log("No se pudo guardar user en memory_long:", saveUserLong.status, saveUserLong.body);
}

// 5. Guardar respuesta del asistente en memoria corta
const saveAssistantShort = await saveMemory("assistant", reply);
if (!saveAssistantShort.ok) {
console.log("No se pudo guardar assistant en memory:", saveAssistantShort.status, saveAssistantShort.body);
}

return res.json({ reply });
} catch (error) {
console.log("CHAT ERROR:", error);
return res.status(500).json({ reply: "Error en servidor" });
}
});

// =========================
// START
// =========================

app.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});

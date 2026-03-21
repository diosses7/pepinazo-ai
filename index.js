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
// CONFIG MEMORIA
// =========================
const SHORT_MEMORY_TABLE = "memoria";
const LONG_MEMORY_TABLE = "memoria_larga";
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
console

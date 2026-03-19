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
// HELPERS SUPABASE
// =========================

function hasSupabaseConfig() {
return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function saveMemory(user, message) {
try {
if (!hasSupabaseConfig()) {
return {
ok: false,
status: 500,
body: "Faltan variables de entorno de Supabase"
};
}

const response = await fetch(`${SUPABASE_URL}/rest/v1/memory`, {
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

console.log("SUPABASE SAVE STATUS:", response.status);
console.log("SUPABASE SAVE BODY:", body);

return {
ok: response.ok,
status: response.status,
body
};
} catch (error) {
console.log("SUPABASE SAVE ERROR:", error);
return {
ok: false,
status: 500,
body: String(error)
};
}
}

async function getRecentMemory(user, limit = 8) {
try {
if (!hasSupabaseConfig()) {
return [];
}

const url =
`${SUPABASE_URL}/rest/v1/memory` +
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

console.log("SUPABASE READ STATUS:", response.status);
console.log("SUPABASE READ BODY:", text);

if (!response.ok) {
return [];
}

let rows = [];
try {
rows = JSON.parse(text);
} catch (e) {
console.log("ERROR PARSEANDO MEMORIA:", e);
return [];
}

return rows.reverse();
} catch (error) {
console.log("SUPABASE READ ERROR:", error);
return [];
}
}

function buildMemoryText(memories) {
if (!memories || memories.length === 0) {
return "No hay memoria previa.";
}

return memories
.map((item) => `${item.user_id}: ${item.message}`)
.join("\n");
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
"Eres Pepinazo AI. Responde siempre en español. Sé útil, claro, cercano y con humor inteligente suave. Usa la memoria previa solo si aporta valor y no inventes recuerdos."
},
{
role: "system",
content: `Memoria previa del usuario:\n${memoryText}`
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
const result = await saveMemory("user1", "mensaje de prueba");

if (result.ok) {
return res.send("guardado");
}

return res.status(500).send(`error supabase: ${result.status} - ${result.body}`);
});

app.get("/memory-test", async (req, res) => {
const memories = await getRecentMemory("user1", 10);
return res.json(memories);
});

app.post("/api/chat", async (req, res) => {
try {
const { message } = req.body;

if (!message || !message.trim()) {
return res.json({ reply: "Mensaje vacío" });
}

const cleanMessage = message.trim();
const userId = "user1";

// 1. leer memoria reciente
const memories = await getRecentMemory(userId, 8);
const memoryText = buildMemoryText(memories);

// 2. preguntar a OpenAI con memoria
const reply = await callOpenAI(cleanMessage, memoryText);

// 3. guardar mensaje usuario
const saveUser = await saveMemory(userId, cleanMessage);
if (!saveUser.ok) {
console.log("No se pudo guardar mensaje del usuario:", saveUser.status, saveUser.body);
}

// 4. guardar respuesta asistente
const saveAssistant = await saveMemory("assistant", reply);
if (!saveAssistant.ok) {
console.log("No se pudo guardar respuesta del asistente:", saveAssistant.status, saveAssistant.body);
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

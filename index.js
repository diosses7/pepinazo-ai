require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

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
return !!SUPABASE_URL && !!SUPABASE_KEY;
}

async function saveMemory(user, message) {
try {
if (!hasSupabaseConfig()) {
console.log("Faltan SUPABASE_URL o SUPABASE_KEY");
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

console.log("SUPABASE STATUS:", response.status);
console.log("SUPABASE RESPONSE:", body);

return {
ok: response.ok,
status: response.status,
body
};
} catch (error) {
console.log("SUPABASE ERROR:", error);
return {
ok: false,
status: 500,
body: String(error)
};
}
}

async function callOpenAI(message) {
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
"Eres Pepinazo AI. Responde siempre en español, de forma útil, clara, cercana y con un toque de humor inteligente."
},
{
role: "user",
content: message
}
]
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
res.sendFile(indexPath, (err) => {
if (err) {
res.send("Pepinazo AI running");
}
});
});

app.get("/test", async (req, res) => {
const result = await saveMemory("user1", "mensaje de prueba");

if (result.ok) {
return res.send("guardado");
}

return res.status(500).send(`error supabase: ${result.status} - ${result.body}`);
});

app.post("/api/chat", async (req, res) => {
try {
const { message } = req.body;

if (!message || !message.trim()) {
return res.json({ reply: "Mensaje vacío" });
}

const cleanMessage = message.trim();
const reply = await callOpenAI(cleanMessage);

const saveResult = await saveMemory("user1", cleanMessage);
if (!saveResult.ok) {
console.log("No se pudo guardar memoria:", saveResult.status, saveResult.body);
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

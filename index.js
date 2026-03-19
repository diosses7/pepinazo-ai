require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// =========================
// VARIABLES DE ENTORNO
// =========================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// =========================
// GUARDAR MEMORIA EN SUPABASE
// =========================

async function saveMemory(user, message) {
try {
if (!SUPABASE_URL || !SUPABASE_KEY) {
console.log("Faltan SUPABASE_URL o SUPABASE_KEY");
return false;
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

const data = await response.text();

console.log("SUPABASE STATUS:", response.status);
console.log("SUPABASE RESPONSE:", data);

return response.ok;
} catch (error) {
console.log("SUPABASE ERROR:", error);
return false;
}
}

// =========================
// LLAMADA A OPENAI
// =========================

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
content: "Eres Pepinazo AI. Responde siempre en español, de forma útil, clara, cercana y con un toque de humor inteligente."
},
{
role: "user",
content: message
}
]
})
});

const data = await response.json();

if (!data.choices || !data.choices[0] || !data.choices[0].message) {
console.log("OPENAI ERROR:", data);
return "Error OpenAI";
}

return data.choices[0].message.content;
} catch (error) {
console.log("OPENAI FETCH ERROR:", error);
return "Error al conectar con OpenAI";
}
}

// =========================
// RUTA RAÍZ
// =========================

app.get("/", (req, res) => {
res.send("Pepinazo AI running");
});

// =========================
// TEST DE SUPABASE
// =========================

app.get("/test", async (req, res) => {
const ok = await saveMemory("user1", "mensaje de prueba");

if (ok) {
return res.send("guardado");
}

return res.send("error supabase");
});

// =========================
// CHAT
// =========================

app.post("/api/chat", async (req, res) => {
try {
const { message } = req.body;

if (!message || !message.trim()) {
return res.json({ reply: "Mensaje vacío" });
}

const cleanMessage = message.trim();

const reply = await callOpenAI(cleanMessage);

await saveMemory("user1", cleanMessage);

return res.json({ reply });
} catch (error) {
console.log("CHAT ERROR:", error);
return res.json({ reply: "Error en servidor" });
}
});

// =========================
// INICIO SERVIDOR
// =========================

app.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});

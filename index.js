const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Memoria simple en RAM
// Guarda la conversación actual mientras el servidor siga encendido.
// Si Render reinicia o redeploya, esta memoria se borra.
let conversationHistory = [];

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Ruta raíz
app.get("/", (req, res) => {
res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health check
app.get("/health", (req, res) => {
res.json({ ok: true, message: "Pepinazo AI funcionando" });
});

// Ruta principal de chat
app.post("/api/chat", async (req, res) => {
try {
const { message, provider } = req.body;

if (!message || typeof message !== "string" || !message.trim()) {
return res.status(400).json({ reply: "Mensaje inválido." });
}

const cleanMessage = message.trim();
const selectedProvider = (provider || "openai").toLowerCase().trim();

// Permite reiniciar memoria escribiendo /reset
if (cleanMessage === "/reset") {
conversationHistory = [];
return res.json({ reply: "Memoria reiniciada. Partimos de cero, como proyecto estatal en año electoral." });
}

// Guardar mensaje del usuario en memoria
conversationHistory.push({
role: "user",
content: cleanMessage
});

// Limitar memoria para no crecer infinito
// 1 mensaje del usuario + 1 del asistente = 2 entradas aprox por turno
if (conversationHistory.length > 20) {
conversationHistory = conversationHistory.slice(-20);
}

// -----------------------------
// Proveedor: OpenAI
// -----------------------------
if (selectedProvider === "openai") {
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
return res.status(500).json({
reply: "Falta configurar OPENAI_API_KEY en Render."
});
}

const response = await axios.post(
"https://api.openai.com/v1/chat/completions",
{
model: "gpt-4.1-mini",
messages: [
{
role: "system",
content:
"Eres Pepinazo AI. Responde siempre en español. Tu estilo es claro, directo, útil, cercano, con humor inteligente y un toque de ironía elegante. No seas pesado ni exagerado. Explica simple, pero con personalidad. Si el usuario pide algo técnico, sé preciso. Si el usuario conversa, responde natural y cálido. Ayudas a crear negocios, analizar inversiones, construir sistemas y tomar decisiones inteligentes. Nunca digas que eres un asistente genérico. Tu nombre es Pepinazo."
},
...conversationHistory
],
temperature: 0.7
},
{
headers: {
Authorization: `Bearer ${apiKey}`,
"Content-Type": "application/json"
},
timeout: 30000
}
);

const reply =
response.data?.choices?.[0]?.message?.content?.trim() ||
"OpenAI no devolvió respuesta.";

// Guardar respuesta del asistente en memoria
conversationHistory.push({
role: "assistant",
content: reply
});

if (conversationHistory.length > 20) {
conversationHistory = conversationHistory.slice(-20);
}

return res.json({ reply });
}

// -----------------------------
// Proveedor: Perplexity
// -----------------------------
if (selectedProvider === "perplexity") {
const apiKey = process.env.PERPLEXITY_API_KEY;

if (!apiKey) {
return res.status(500).json({
reply: "Falta configurar PERPLEXITY_API_KEY en Render."
});
}

const response = await axios.post(
"https://api.perplexity.ai/chat/completions",
{
model: "sonar",
messages: [
{
role: "system",
content:
"Eres Pepinazo AI. Responde siempre en español, de forma clara, útil, directa y con humor inteligente. Mantén contexto de la conversación y responde como un socio estratégico, no como chatbot genérico."
},
...conversationHistory
]
},
{
headers: {
Authorization: `Bearer ${apiKey}`,
"Content-Type": "application/json"
},
timeout: 30000
}
);

const reply =
response.data?.choices?.[0]?.message?.content?.trim() ||
"Perplexity no devolvió respuesta.";

// Guardar respuesta del asistente en memoria
conversationHistory.push({
role: "assistant",
content: reply
});

if (conversationHistory.length > 20) {
conversationHistory = conversationHistory.slice(-20);
}

return res.json({ reply });
}

return res.status(400).json({
reply: "Proveedor no soportado. Usa 'openai' o 'perplexity'."
});
} catch (error) {
console.error(
"Error en /api/chat:",
error.response?.data || error.message || error
);

const apiError =
error.response?.data?.error?.message ||
error.response?.data?.message ||
"Error interno del servidor.";

return res.status(500).json({
reply: `Error: ${apiError}`
});
}
});

// Levantar servidor
app.listen(PORT, () => {
console.log(`✅ Servidor corriendo en puerto ${PORT}`);
});

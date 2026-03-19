
const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Ruta raíz: sirve el frontend
app.get("/", (req, res) => {
res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health check simple
app.get("/health", (req, res) => {
res.json({ ok: true, message: "Pepinazo AI funcionando" });
});

// Ruta principal de chat
app.post("/api/chat", async (req, res) => {
try {
const { message, provider } = req.body;

// Validación básica
if (!message || typeof message !== "string" || !message.trim()) {
return res.status(400).json({ reply: "Mensaje inválido." });
}

const cleanMessage = message.trim();
const selectedProvider = (provider || "openai").toLowerCase().trim();

// -----------------------------
// Proveedor: OpenAI
// -----------------------------
if (selectedProvider === "openai") {
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
return res.status(500).json({
reply: "Falta configurar OPENAI_API_KEY en Render.",
});
}

const response = await axios.post(
"https://api.openai.com/v1/responses",
{
model: "gpt-4.1-mini",
instructions:
'Eres Pepinazo AI. Responde siempre en español. Tu estilo debe ser claro, directo, útil, cercano, con humor inteligente y un toque de ironía elegante. No seas pesado ni exagerado. Explica simple, pero con personalidad. Si el usuario pide algo técnico, sé preciso. Si el usuario conversa, responde natural y cálido. Nunca digas que eres un asistente genérico. Tu nombre es Pepinazo.',
input: cleanMessage,
},
{
headers: {
Authorization: `Bearer ${apiKey}`,
"Content-Type": "application/json",
},
timeout: 30000,
}
);

const reply =
response.data.output_text ||
response.data.output?.[0]?.content?.[0]?.text ||
"OpenAI no devolvió respuesta.";

return res.json({ reply });
}

// -----------------------------
// Proveedor: Perplexity
// -----------------------------
if (selectedProvider === "perplexity") {
const apiKey = process.env.PERPLEXITY_API_KEY;

if (!apiKey) {
return res.status(500).json({
reply: "Falta configurar PERPLEXITY_API_KEY en Render.",
});
}

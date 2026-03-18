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
        response.data?.output_text ||
        response.data?.output?.[0]?.content?.[0]?.text ||
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

      const response = await axios.post(
        "https://api.perplexity.ai/chat/completions",
        {
          model: "sonar",
          messages: [
            {
              role: "system",
              content: "Eres Pepinazo AI, un asistente útil, claro y preciso.",
            },
            {
              role: "user",
              content: cleanMessage,
            },
          ],
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
        response.data?.choices?.[0]?.message?.content ||
        "Perplexity no devolvió respuesta.";

      return res.json({ reply });
    }

    // Provider no soportado
    return res.status(400).json({
      reply: "Proveedor no soportado. Usa 'openai' o 'perplexity'.",
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
      reply: `Error: ${apiError}`,
    });
  }
});

// Levantar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
});
          

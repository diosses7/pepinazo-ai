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

// Ruta principal de chat
app.post("/api/chat", async (req, res) => {
  try {
    const { message, provider } = req.body;

    // Validación básica del mensaje
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ reply: "Mensaje inválido." });
    }

    const cleanMessage = message.trim();
    const selectedProvider = (provider || "openai").toLowerCase().trim();

    // -----------------------------
    // Proveedor: OpenAI
    // -----------------------------
    if (selectedProvider === "openai") {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({
          reply: "Falta configurar OPENAI_API_KEY en el servidor.",
        });
      }

      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "Eres Pepinazo AI, un asistente útil, claro y directo.",
            },
            {
              role: "user",
              content: cleanMessage,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
        }
      );

      return res.json({
        reply:
          response.data?.choices?.[0]?.message?.content?.trim() ||
          "No se recibió respuesta de OpenAI.",
      });
    }

    // -----------------------------
    // Proveedor: Perplexity
    // -----------------------------
    if (selectedProvider === "perplexity") {
      if (!process.env.PERPLEXITY_API_KEY) {
        return res.status(500).json({
          reply: "Falta configurar PERPLEXITY_API_KEY en el servidor.",
        });
      }

      const response = await axios.post(
        "https://api.perplexity.ai/chat/completions",
        {
          model: "sonar-pro",
          messages: [
            {
              role: "system",
              content: "Eres Pepinazo AI, un asistente útil, claro y directo.",
            },
            {
              role: "user",
              content: cleanMessage,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          },
        }
      );

      return res.json({
        reply:
          response.data?.choices?.[0]?.message?.content?.trim() ||
          "No se recibió respuesta de Perplexity.",
      });
    }

    // -----------------------------
    // Proveedor: Claude
    // -----------------------------
    if (selectedProvider === "claude") {
      if (!process.env.CLAUDE_API_KEY) {
        return res.status(500).json({
          reply: "Falta configurar CLAUDE_API_KEY en el servidor.",
        });
      }

      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1024,
          system: "Eres Pepinazo AI, un asistente útil, claro y directo.",
          messages: [
            {
              role: "user",
              content: cleanMessage,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.CLAUDE_API_KEY,
            "anthropic-version": "2023-06-01",
          },
        }
      );

      const claudeReply =
        response.data?.content
          ?.filter((item) => item.type === "text")
          ?.map((item) => item.text)
          ?.join("\n")
          ?.trim() || "No se recibió respuesta de Claude.";

      return res.json({ reply: claudeReply });
    }

    // Proveedor no válido
    return res.status(400).json({ reply: "Proveedor no válido." });
  } catch (error) {
    console.error(
      "Error en /api/chat:",
      error.response?.data || error.message || error
    );

    return res.status(500).json({
      reply:
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        "Hubo un error al procesar la solicitud.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

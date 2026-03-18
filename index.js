const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/chat", async (req, res) => {
  try {
    const { message, provider } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "Mensaje inválido." });
    }

    const selectedProvider = provider || "openai";

    // --- OpenAI ---
    if (selectedProvider === "openai") {
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
              content: message,
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

      return res.json({ reply: response.data.choices[0].message.content });
    }

    // --- Perplexity ---
    if (selectedProvider === "perplexity") {
      const response = await axios.post(
        "https://api.perplexity.ai/chat/completions",
        {
          model: "sonar",
          messages: [
            {
              role: "system",
              content: "Eres Pepinazo AI, un asistente útil, claro y directo.",
            },
            {
              role: "user",
              content: message,
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

      return res.json({ reply: response.data.choices[0].message.content });
    }

    // --- Claude ---
    if (selectedProvider === "claude") {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: "Eres Pepinazo AI, un asistente útil, claro y directo.",
          messages: [
            {
              role: "user",
              content: message,
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

      return res.json({ reply: response.data.content[0].text });
    }

    return res.status(400).json({ reply: "Proveedor no válido." });
  } catch (error) {
    console.error("Error en /chat:", error.response?.data || error.message);
    return res.status(500).json({
      reply: "Hubo un error al procesar la solicitud.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});



const express = require("express");

const cors = require("cors");

const OpenAI = require("openai");

require("dotenv").config();



const app = express();

const PORT = process.env.PORT || 3000;



app.use(cors());

app.use(express.json());



const openai = new OpenAI({

  apiKey: process.env.OPENAI_API_KEY,

});



app.get("/", (req, res) => {

  res.send("Pepinazo AI está vivo");

});



app.post("/chat", async (req, res) => {

  try {

    const { message, provider } = req.body;



    if (!message) {

      return res.status(400).json({ error: "Falta el mensaje" });

    }



    let reply = "";



    if (provider === "openai" || !provider) {

      const completion = await openai.chat.completions.create({

        model: "gpt-4o-mini",

        messages: [

          {

            role: "system",

            content: "Eres Pepinazo AI, un asistente inteligente, claro, útil y directo.",

          },

          {

            role: "user",

            content: message,

          },

        ],

      });



      reply = completion.choices[0].message.content;

    } else if (provider === "claude") {

      reply = `Claude aún no está conectado. Mensaje recibido: ${message}`;

    } else if (provider === "perplexity") {

      reply = `Perplexity aún no está conectado. Mensaje recibido: ${message}`;

    } else {

      reply = `Proveedor no reconocido. Mensaje recibido: ${message}`;

    }



    res.json({ reply });

  } catch (error) {

    console.error("Error en /chat:", error);

    res.status(500).json({

      error: "Error interno del servidor",

      details: error.message,

    });

  }

});



app.listen(PORT, () => {

  console.log(`Servidor corriendo en puerto ${PORT}`);

});


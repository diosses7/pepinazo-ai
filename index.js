

const express = require("express");

const cors = require("cors");

const path = require("path");

const OpenAI = require("openai");

require("dotenv").config();



const app = express();

const PORT = process.env.PORT || 3000;



app.use(cors());

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));



const openai = new OpenAI({

  apiKey: process.env.OPENAI_API_KEY,

});



app.post("/chat", async (req, res) => {

  try {

    const { message } = req.body;



    if (!message) {

      return res.status(400).json({ error: "Falta el mensaje" });

    }



    const completion = await openai.chat.completions.create({

      model: "gpt-4o-mini",

      messages: [

        { role: "system", content: "Eres Pepinazo AI, claro, útil y directo." },

        { role: "user", content: message }

      ]

    });



    res.json({

      reply: completion.choices[0].message.content

    });

  } catch (error) {

    console.error("Error en /chat:", error);

    res.status(500).json({

      error: "Error interno",

      details: error.message

    });

  }

});



app.listen(PORT, () => {

  console.log(`Servidor corriendo en puerto ${PORT}`);

});


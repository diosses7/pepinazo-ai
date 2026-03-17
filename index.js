const express = require("express");

const cors = require("cors");

require("dotenv").config();



const OpenAI = require("openai");



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

    const userMessage = req.body.message;



    const completion = await openai.chat.completions.create({

      model: "gpt-4.1-mini",

      messages: [

        { role: "system", content: "Eres Pepinazo AI" },

        { role: "user", content: userMessage },

      ],

    });



    res.json({

      reply: completion.choices[0].message.content,

    });

  } catch (error) {

    console.error(error);

    res.status(500).send("Error en /chat");

  }

});



app.listen(PORT, () => {

  console.log("Servidor corriendo");

});


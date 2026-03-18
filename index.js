const express = require("express");

const cors = require("cors");

require("dotenv").config();



const app = express();

const PORT = process.env.PORT || 3000;



app.use(cors());

app.use(express.json());



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



    if (provider === "openai") {

      reply = `OpenAI respondería: ${message}`;

    } else if (provider === "claude") {

      reply = `Claude respondería: ${message}`;

    } else if (provider === "perplexity") {

      reply = `Perplexity respondería: ${message}`;

    } else {

      reply = `Pepinazo recibió tu mensaje: ${message}`;

    }



    res.json({ reply });

  } catch (error) {

    console.error("Error en /chat:", error);

    res.status(500).json({ error: "Error interno del servidor" });

  }

});



app.listen(PORT, () => {

  console.log(`Servidor corriendo en puerto ${PORT}`);

});

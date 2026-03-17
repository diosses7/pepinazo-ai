const express = require("express");

const cors = require("cors");

require("dotenv").config();



const app = express();

const PORT = process.env.PORT || 3000;



app.use(cors());

app.use(express.json());



app.get("/", function(req, res) {

  res.send("Pepinazo AI está vivo");

});



app.post("/chat", function(req, res) {



  const message = req.body.message;



  if (!message) {

    return res.status(400).json({ error: "Falta el mensaje" });

  }



  try {

    return res.json({

      reply: "Pepinazo recibió tu mensaje: " + message

    });

  } catch (error) {

    return res.status(500).json({ error: "Error interno" });

  }



});



app.listen(PORT, function() {

  console.log("Servidor corriendo en puerto " + PORT);

});

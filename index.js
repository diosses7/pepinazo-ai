import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("Pepinazo AI funcionando 🚀");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});

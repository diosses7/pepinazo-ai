require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;


// =========================
// SUPABASE CONFIG
// =========================

const SUPABASE_URL = "https://ccgiqdhssnveaalbnrlh.supabase.co";

const SUPABASE_KEY = "sb_publishable_REEMPLAZAR_POR_TU_KEY";


// =========================
// GUARDAR MEMORIA
// =========================

async function saveMemory(user, message) {

try {

await fetch(`${SUPABASE_URL}/rest/v1/memory`, {
method: "POST",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=minimal"
},
body: JSON.stringify({
user_id: user,
message: message
})
});

} catch (err) {

console.log("Error guardando memoria", err);

}

}


// =========================
// OPENAI
// =========================

async function callOpenAI(message) {

const apiKey = process.env.OPENAI_API_KEY;

const response = await fetch(
"https://api.openai.com/v1/chat/completions",
{
method: "POST",
headers: {
Authorization: `Bearer ${apiKey}`,
"Content-Type": "application/json"
},
body: JSON.stringify({
model: "gpt-4.1-mini",
messages: [
{
role: "user",
content: message
}
]
})
}
);

const data = await response.json();

if (!data.choices) {
console.log(data);
return "Error OpenAI";
}

return data.choices[0].message.content;

}


// =========================
// CHAT API
// =========================

app.post("/api/chat", async (req, res) => {

try {

const { message } = req.body;

if (!message) {
return res.json({ reply: "Mensaje vacío" });
}

const reply = await callOpenAI(message);

await saveMemory("user1", message);

res.json({ reply });

} catch (err) {

console.log(err);

res.json({
reply: "Error en servidor"
});

}

});


// =========================
// START
// =========================

app.listen(PORT, () => {

console.log("Server running on port", PORT);

});

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function hasSupabaseConfig() {
return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

//
// ==============================
// FILTRO DE MEMORIA
// ==============================
//

function shouldSaveMemory(message) {
if (!message) return false;

const text = message.toLowerCase().trim();

const blacklist = [
"hola",
"ok",
"gracias",
"jaj",
"test",
"probando",
"memoria",
"123",
"hi",
"hello",
"jeje",
"👍"
];

if (text.length < 15) return false;

for (let word of blacklist) {
if (text.includes(word)) return false;
}

return true;
}

//
// ==============================
// SUPABASE SAVE
// ==============================
//

async function saveMemory(user, message) {
try {
if (!hasSupabaseConfig()) return;

if (!shouldSaveMemory(message)) {
console.log("NO SE GUARDA:", message);
return;
}

await fetch(`${SUPABASE_URL}/rest/v1/memory`, {
method: "POST",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=representation"
},
body: JSON.stringify({
user_id: user,
message: message
})
});

console.log("GUARDADO:", message);

} catch (err) {
console.log("ERROR SAVE:", err);
}
}

//
// ==============================
// LEER MEMORIA
// ==============================
//

async function getRecentMemory(user, limit = 8) {
try {
if (!hasSupabaseConfig()) return [];

const url =
`${SUPABASE_URL}/rest/v1/memory` +
`?select=user_id,message,created_at` +
`&user_id=eq.${user}` +
`&order=created_at.desc` +
`&limit=${limit}`;

const res = await fetch(url, {
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`
}
});

const data = await res.json();

return data.reverse();

} catch (err) {
console.log(err);
return [];
}
}

function buildMemoryText(memories) {
if (!memories.length) return "Sin memoria previa.";

return memories
.map(m => `${m.user_id}: ${m.message}`)
.join("\n");
}

//
// ==============================
// OPENAI
// ==============================
//

async function callOpenAI(message, memoryText) {

const response = await fetch(
"https://api.openai.com/v1/chat/completions",
{
method: "POST",
headers: {
Authorization: `Bearer ${OPENAI_API_KEY}`,
"Content-Type": "application/json"
},
body: JSON.stringify({
model: "gpt-4.1-mini",
messages: [
{
role: "system",
content:
"Eres Pepinazo AI. Responde en español, con humor ligero, claro y útil."
},
{
role: "system",
content:
"Memoria previa:\n" + memoryText
},
{
role: "user",
content: message
}
]
})
}
);

const data = await response.json();

return data.choices[0].message.content;
}

//
// ==============================
// RUTAS
// ==============================
//

app.get("/", (req, res) => {
const indexPath = path.join(__dirname, "public", "index.html");

if (fs.existsSync(indexPath)) {
return res.sendFile(indexPath);
}

res.send("Pepinazo OK");
});

app.post("/api/chat", async (req, res) => {

try {

const { message } = req.body;

const userId = "user1";

const memories = await getRecentMemory(userId);

const memoryText = buildMemoryText(memories);

const reply = await callOpenAI(message, memoryText);

await saveMemory(userId, message);

await saveMemory("assistant", reply);

res.json({ reply });

} catch (err) {

console.log(err);

res.json({
reply: "Error"
});

}

});

app.listen(PORT, () => {
console.log("RUNNING", PORT);
});

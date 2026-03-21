require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const TABLE_MEMORY = "memoria";
const TABLE_PROFILE = "perfil_usuario";


// =========================
// SUPABASE HELPERS
// =========================

async function supabaseInsert(table, data) {
return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
method: "POST",
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
Prefer: "return=minimal",
},
body: JSON.stringify(data),
});
}

async function supabaseSelect(table, query = "") {
const res = await fetch(
`${SUPABASE_URL}/rest/v1/${table}?select=*${query}`,
{
headers: {
apikey: SUPABASE_KEY,
Authorization: `Bearer ${SUPABASE_KEY}`,
},
}
);

return res.json();
}


// =========================
// PERFIL
// =========================

async function saveProfile(user, key, value) {
await supabaseInsert(TABLE_PROFILE, {
id_usuario: user,
clave: key,
valor: value,
});
}

async function getProfile(user) {
return await supabaseSelect(
TABLE_PROFILE,
`&id_usuario=eq.${user}`
);
}


// =========================
// MEMORIA
// =========================

async function saveMemory(user, text) {
await supabaseInsert(TABLE_MEMORY, {
id_usuario: user,
mensaje: text,
});
}

async function getMemory(user) {
return await supabaseSelect(
TABLE_MEMORY,
`&id_usuario=eq.${user}&limit=10&order=id.desc`
);
}


// =========================
// OPENAI
// =========================

async function callOpenAI(prompt) {
const res = await fetch(
"https://api.openai.com/v1/chat/completions",
{
method: "POST",
headers: {
Authorization: `Bearer ${OPENAI_API_KEY}`,
"Content-Type": "application/json",
},
body: JSON.stringify({
model: "gpt-4.1-mini",
messages: [
{
role: "system",
content:
"Eres Pepinazo AI con memoria persistente.",
},
{
role: "user",
content: prompt,
},
],
}),
}
);

const data = await res.json();

return data.choices?.[0]?.message?.content || "Error";
}


// =========================
// CHAT
// =========================

app.post("/api/chat", async (req, res) => {
try {
const message = req.body.message;
const user = "usuario1";

if (!message) {
return res.json({ reply: "Mensaje vacío" });
}

// guardar memoria
await saveMemory(user, message);

// leer memoria
const memory = await getMemory(user);

// leer perfil
const profile = await getProfile(user);

const context = `
Memoria:
${JSON.stringify(memory)}

Perfil:
${JSON.stringify(profile)}

Usuario dice:
${message}
`;

const reply = await callOpenAI(context);

res.json({ reply });

} catch (err) {
console.log(err);
res.json({ reply: "Error servidor" });
}
});


// =========================

app.get("/health", (req, res) => {
res.json({ ok: true });
});

app.listen(PORT, () => {
console.log("Pepinazo AI running on " + PORT);
});

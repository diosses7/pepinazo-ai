 require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// =========================
// OPTIONAL DEPENDENCIES
// =========================
let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    fetchFn = require("node-fetch");
  } catch {
    fetchFn = null;
  }
}

let XLSX = null;
try {
  XLSX = require("xlsx");
} catch {
  XLSX = null;
}

// =========================
// APP
// =========================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// =========================
// ENV
// =========================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// =========================
// PATHS
// =========================
const DATA_DIR = path.join(__dirname, "data");

const MEMORY_FILE = path.join(DATA_DIR, "memoria.json");
const LONG_MEMORY_FILE = path.join(DATA_DIR, "memoria_larga.json");
const PROFILE_FILE = path.join(DATA_DIR, "perfil_usuario.json");
const FINANCE_FILE = path.join(DATA_DIR, "finance_data.json");
const INVESTMENTS_FILE = path.join(DATA_DIR, "investments_data.json");
const OPPORTUNITIES_FILE = path.join(DATA_DIR, "business_opportunities.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "ecommerce_products.json");

// =========================
// HELPERS
// =========================
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureJsonFile(file, def) {
  ensureDir();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(def, null, 2));
  }
}

function read(file, def) {
  ensureJsonFile(file, def);
  return JSON.parse(fs.readFileSync(file));
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function nowISO() {
  return new Date().toISOString();
}

function id(prefix = "id") {
  return `${prefix}_${Date.now()}`;
}

// =========================
// INIT FILES
// =========================
ensureJsonFile(MEMORY_FILE, []);
ensureJsonFile(LONG_MEMORY_FILE, []);
ensureJsonFile(PROFILE_FILE, []);
ensureJsonFile(FINANCE_FILE, { entries: [] });
ensureJsonFile(INVESTMENTS_FILE, { assets: [], contributions: [] });
ensureJsonFile(OPPORTUNITIES_FILE, { items: [] });
ensureJsonFile(PRODUCTS_FILE, { items: [] });

// =========================
// BASIC ROUTES
// =========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    time: nowISO(),
    openai: !!OPENAI_API_KEY,
    xlsx: !!XLSX
  });
});

// =========================
// MEMORY SIMPLE
// =========================
app.get("/api/memories", (req, res) => {
  res.json({
    ok: true,
    recent: read(MEMORY_FILE, []),
    important: read(LONG_MEMORY_FILE, [])
  });
});

app.post("/api/memories", (req, res) => {
  const msg = req.body?.message;
  if (!msg) return res.json({ ok: false });

  const mem = read(MEMORY_FILE, []);
  mem.push({ id: id("mem"), mensaje: msg, created: nowISO() });
  write(MEMORY_FILE, mem);

  res.json({ ok: true });
});

// =========================
// FINANCE
// =========================
app.get("/api/finance", (req, res) => {
  const data = read(FINANCE_FILE, { entries: [] });

  let income = 0, expense = 0;

  data.entries.forEach(e => {
    if (e.type === "income") income += e.amount;
    else expense += e.amount;
  });

  res.json({
    ok: true,
    entries: data.entries,
    summary: {
      income,
      expense,
      balance: income - expense
    }
  });
});

app.post("/api/finance", (req, res) => {
  const data = read(FINANCE_FILE, { entries: [] });

  const e = {
    id: id("fin"),
    type: req.body.type,
    amount: Number(req.body.amount),
    date: req.body.date || nowISO(),
    category: req.body.category || ""
  };

  data.entries.push(e);
  write(FINANCE_FILE, data);

  res.json({ ok: true });
});

// =========================
// INVESTMENTS
// =========================
app.get("/api/investments", (req, res) => {
  const data = read(INVESTMENTS_FILE, { assets: [] });

  let total = 0;
  data.assets.forEach(a => total += Number(a.value || 0));

  res.json({ ok: true, total, assets: data.assets });
});

// =========================
// BUSINESS
// =========================
app.get("/api/business/opportunities", (req, res) => {
  res.json({
    ok: true,
    items: read(OPPORTUNITIES_FILE, { items: [] }).items
  });
});

// =========================
// ECOMMERCE
// =========================
app.get("/api/ecommerce/products", (req, res) => {
  res.json({
    ok: true,
    items: read(PRODUCTS_FILE, { items: [] }).items
  });
});

// =========================
// DASHBOARD
// =========================
app.get("/api/dashboard", (req, res) => {

  const fin = read(FINANCE_FILE, { entries: [] });
  const inv = read(INVESTMENTS_FILE, { assets: [] });

  let income = 0, expense = 0;

  fin.entries.forEach(e => {
    if (e.type === "income") income += e.amount;
    else expense += e.amount;
  });

  let investTotal = 0;
  inv.assets.forEach(a => investTotal += Number(a.value || 0));

  res.json({
    ok: true,
    finance: {
      income,
      expense,
      balance: income - expense
    },
    investments: {
      total: investTotal
    }
  });
});

// =========================
// XLSX (OPTIONAL)
// =========================
app.post("/api/xlsx/preview", (req, res) => {
  if (!XLSX) return res.json({ ok: false, error: "xlsx no instalado" });

  const buffer = Buffer.from(req.body.base64, "base64");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  res.json({ ok: true, rows: rows.slice(0, 50) });
});

// =========================
// FALLBACK
// =========================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log("Pepinazo corriendo en", PORT);
});

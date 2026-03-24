
  assets: [],
  contributions: []
});
ensureJsonFile(OPPORTUNITIES_FILE, {
  items: []
});
ensureJsonFile(PRODUCTS_FILE, {
  items: []
});

// =========================
// BASIC ROUTES
// =========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Pepinazo AI",
    time: nowISO(),
    openai: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL,
    xlsx: Boolean(XLSX)
  });
});

// =========================
// CHAT
// =========================
app.post("/api/chat", async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const message = normalizeText(req.body?.message);

    if (!message) {
      return res.status(400).json({
        ok: false,
        reply: "Mensaje inválido."
      });
    }

    const profileCandidate = maybeProfileItemFromText(userId, message);

    if (profileCandidate) {
      addProfileItem(profileCandidate);
    } else {
      addMemory(userId, message);
    }

    const reply = await callOpenAIChat({ message, userId });

    return res.json({
      ok: true,
      reply,
      profile_summary: buildProfileSummary(userId)
    });
  } catch (error) {
    console.error("Error /api/chat:", error);
    return res.status(500).json({
      ok: false,
      reply: "Hubo un error al procesar el mensaje.",
      error: error.message
    });
  }
});

// =========================
// MEMORY LEGACY ROUTES FOR CURRENT PUBLIC
// =========================
app.get("/prueba-de-memoria", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);

    return res.json({
      ok: true,
      userId,
      perfil_resumen: {
        resumen: buildProfileSummary(userId)
      },
      perfil_usuario: getUserProfiles(userId).map((item) => ({
        id: item.id,
        clave: item.clave,
        valor: item.valor,
        tipo: item.tipo,
        created_at: item.created_at,
        updated_at: item.updated_at
      })),
      memoria: getUserMemories(userId).map((item) => ({
        id: item.id,
        mensaje: item.mensaje,
        tipo: item.tipo,
        created_at: item.created_at,
        updated_at: item.updated_at
      })),
      memoria_larga: getUserLongMemories(userId).map((item) => ({
        id: item.id,
        mensaje: item.mensaje,
        tipo: item.tipo,
        created_at: item.created_at,
        updated_at: item.updated_at
      }))
    });
  } catch (error) {
    console.error("Error /prueba-de-memoria:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar la memoria."
    });
  }
});

app.get("/memory-panel", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    return res.json(buildMemoryPanel(userId));
  } catch (error) {
    console.error("Error /memory-panel:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar el panel de memoria."
    });
  }
});

app.delete("/memory-clear", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    clearUserData(userId);

    return res.json({
      ok: true,
      cleared: true,
      userId
    });
  } catch (error) {
    console.error("Error /memory-clear:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo borrar la memoria."
    });
  }
});

app.delete("/memory/:table/:id", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { table, id } = req.params;

    const deleted = deleteFromTable(table, userId, id);

    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: "Registro no encontrado."
      });
    }

    return res.json({
      ok: true,
      deleted: true
    });
  } catch (error) {
    console.error("Error DELETE /memory/:table/:id:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo borrar el registro."
    });
  }
});

app.patch("/memory/profile/:id", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { id } = req.params;
    const valor = normalizeText(req.body?.valor);

    if (!valor) {
      return res.status(400).json({
        ok: false,
        error: "Valor vacío."
      });
    }

    const updated = patchProfileValue(userId, id, valor);

    if (!updated) {
      return res.status(404).json({
        ok: false,
        error: "Perfil no encontrado."
      });
    }

    return res.json({
      ok: true,
      updated
    });
  } catch (error) {
    console.error("Error PATCH /memory/profile/:id:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo editar el perfil."
    });
  }
});

app.patch("/memory/message/:table/:id", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { table, id } = req.params;
    const mensaje = normalizeText(req.body?.mensaje);

    if (!mensaje) {
      return res.status(400).json({
        ok: false,
        error: "Mensaje vacío."
      });
    }

    const updated = patchMemoryValue(table, userId, id, mensaje);

    if (!updated) {
      return res.status(404).json({
        ok: false,
        error: "Memoria no encontrada."
      });
    }

    return res.json({
      ok: true,
      updated
    });
  } catch (error) {
    console.error("Error PATCH /memory/message/:table/:id:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo editar la memoria."
    });
  }
});

app.post("/memory/pin", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const sourceTable = normalizeText(req.body?.sourceTable);
    const id = normalizeText(req.body?.id);

    const result = pinMemoryToLong(userId, sourceTable, id);

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error POST /memory/pin:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "No se pudo fijar la memoria."
    });
  }
});

// =========================
// MODERN MEMORY/PROFILE ROUTES
// =========================
app.get("/api/profile", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const profiles = getUserProfiles(userId);

    return res.json({
      ok: true,
      userId,
      summary: buildProfileSummary(userId),
      items: profiles
    });
  } catch (error) {
    console.error("Error /api/profile:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar el perfil."
    });
  }
});

app.get("/api/memories", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    return res.json({
      ok: true,
      userId,
      recent: getUserMemories(userId),
      important: getUserLongMemories(userId)
    });
  } catch (error) {
    console.error("Error /api/memories:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron cargar las memorias."
    });
  }
});

app.post("/api/memories", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const mensaje = normalizeText(req.body?.mensaje || req.body?.message);
    const important = Boolean(req.body?.important);

    if (!mensaje) {
      return res.status(400).json({
        ok: false,
        error: "Mensaje vacío."
      });
    }

    const saved = important
      ? addLongMemory(userId, mensaje)
      : addMemory(userId, mensaje);

    return res.json({
      ok: true,
      saved
    });
  } catch (error) {
    console.error("Error POST /api/memories:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar la memoria."
    });
  }
});

// =========================
// FINANCE ROUTES
// =========================
app.get("/api/finance", (req, res) => {
  try {
    const data = getFinanceData();
    return res.json({
      ok: true,
      categories: data.categories || DEFAULT_FINANCE_CATEGORIES,
      entries: sortByDateDesc(data.entries || []),
      summary: buildFinanceSummary(data.entries || [])
    });
  } catch (error) {
    console.error("Error /api/finance:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar finanzas."
    });
  }
});

app.post("/api/finance", (req, res) => {
  try {
    const data = getFinanceData();
    const body = req.body || {};

    const entry = {
      id: createId("fin"),
      date: normalizeText(body.date || nowISO().slice(0, 10)),
      type: lowerText(body.type || "expense") === "income" ? "income" : "expense",
      category: normalizeText(body.category || "general"),
      description: normalizeText(body.description || ""),
      amount: Math.abs(toNumber(body.amount, 0)),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    if (!entry.amount) {
      return res.status(400).json({
        ok: false,
        error: "Monto inválido."
      });
    }

    data.entries = Array.isArray(data.entries) ? data.entries : [];
    data.entries.push(entry);
    saveFinanceData(data);

    return res.json({
      ok: true,
      saved: entry,
      summary: buildFinanceSummary(data.entries)
    });
  } catch (error) {
    console.error("Error POST /api/finance:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar el movimiento."
    });
  }
});

app.delete("/api/finance/:id", (req, res) => {
  try {
    const id = normalizeText(req.params.id);
    const data = getFinanceData();
    const current = Array.isArray(data.entries) ? data.entries : [];
    const next = current.filter((item) => String(item.id) !== String(id));

    if (next.length === current.length) {
      return res.status(404).json({
        ok: false,
        error: "Movimiento no encontrado."
      });
    }

    data.entries = next;
    saveFinanceData(data);

    return res.json({
      ok: true,
      deleted: true,
      summary: buildFinanceSummary(next)
    });
  } catch (error) {
    console.error("Error DELETE /api/finance/:id:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo borrar el movimiento."
    });
  }
});

// =========================
// INVESTMENTS ROUTES
// =========================
app.get("/api/investments", (req, res) => {
  try {
    const data = getInvestmentsData();
    return res.json({
      ok: true,
      ...data,
      summary: buildInvestmentSummary(data),
      projections: buildInvestmentProjections(data)
    });
  } catch (error) {
    console.error("Error /api/investments:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron cargar inversiones."
    });
  }
});

app.post("/api/investments/asset", (req, res) => {
  try {
    const data = getInvestmentsData();
    const body = req.body || {};

    const asset = {
      id: createId("asset"),
      asset: normalizeText(body.asset || "otro activo"),
      currentValue: Math.abs(toNumber(body.currentValue, 0)),
      targetWeight: Math.abs(toNumber(body.targetWeight, 0)),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    data.assets = Array.isArray(data.assets) ? data.assets : [];
    data.assets.push(asset);
    saveInvestmentsData(data);

    return res.json({
      ok: true,
      saved: asset,
      summary: buildInvestmentSummary(data),
      projections: buildInvestmentProjections(data)
    });
  } catch (error) {
    console.error("Error POST /api/investments/asset:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar el activo."
    });
  }
});

app.post("/api/investments/contribution", (req, res) => {
  try {
    const data = getInvestmentsData();
    const body = req.body || {};

    const contribution = {
      id: createId("contrib"),
      asset: normalizeText(body.asset || "otro activo"),
      amount: Math.abs(toNumber(body.amount, 0)),
      frequency: normalizeText(body.frequency || "monthly"),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    data.contributions = Array.isArray(data.contributions)
      ? data.contributions
      : [];
    data.contributions.push(contribution);
    saveInvestmentsData(data);

    return res.json({
      ok: true,
      saved: contribution,
      summary: buildInvestmentSummary(data),
      projections: buildInvestmentProjections(data)
    });
  } catch (error) {
    console.error("Error POST /api/investments/contribution:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar el aporte."
    });
  }
});

app.get("/api/projections", (req, res) => {
  try {
    const data = getInvestmentsData();
    return res.json({
      ok: true,
      summary: buildInvestmentSummary(data),
      projections: buildInvestmentProjections(data)
    });
  } catch (error) {
    console.error("Error /api/projections:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron calcular proyecciones."
    });
  }
});

// =========================
// BUSINESS / ECOMMERCE ROUTES
// =========================
app.get("/api/business/opportunities", (req, res) => {
  try {
    const data = getOpportunitiesData();
    return res.json({
      ok: true,
      items: sortByDateDesc(data.items || [])
    });
  } catch (error) {
    console.error("Error /api/business/opportunities:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron cargar oportunidades."
    });
  }
});

app.post("/api/business/opportunities", (req, res) => {
  try {
    const data = getOpportunitiesData();
    const body = req.body || {};

    const item = {
      id: createId("opp"),
      title: normalizeText(body.title || "Oportunidad sin título"),
      niche: normalizeText(body.niche || ""),
      description: normalizeText(body.description || ""),
      source: normalizeText(body.source || ""),
      status: normalizeText(body.status || "idea"),
      score: toNumber(body.score, 0),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    data.items = Array.isArray(data.items) ? data.items : [];
    data.items.push(item);
    saveOpportunitiesData(data);

    return res.json({
      ok: true,
      saved: item
    });
  } catch (error) {
    console.error("Error POST /api/business/opportunities:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar la oportunidad."
    });
  }
});

app.get("/api/ecommerce/products", (req, res) => {
  try {
    const data = getProductsData();
    return res.json({
      ok: true,
      items: sortByDateDesc(data.items || [])
    });
  } catch (error) {
    console.error("Error /api/ecommerce/products:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudieron cargar productos."
    });
  }
});

app.post("/api/ecommerce/products", (req, res) => {
  try {
    const data = getProductsData();
    const body = req.body || {};

    const item = {
      id: createId("prod"),
      name: normalizeText(body.name || "Producto sin nombre"),
      category: normalizeText(body.category || ""),
      market: normalizeText(body.market || ""),
      price: Math.abs(toNumber(body.price, 0)),
      cost: Math.abs(toNumber(body.cost, 0)),
      margin: Math.abs(toNumber(body.margin, 0)),
      source: normalizeText(body.source || ""),
      notes: normalizeText(body.notes || ""),
      created_at: nowISO(),
      updated_at: nowISO()
    };

    data.items = Array.isArray(data.items) ? data.items : [];
    data.items.push(item);
    saveProductsData(data);

    return res.json({
      ok: true,
      saved: item
    });
  } catch (error) {
    console.error("Error POST /api/ecommerce/products:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo guardar el producto."
    });
  }
});

// =========================
// DASHBOARD
// =========================
app.get("/api/dashboard", (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const finance = getFinanceData();
    const investments = getInvestmentsData();
    const business = buildBusinessSnapshot();

    return res.json({
      ok: true,
      userId,
      cards: {
        recentMemories: getUserMemories(userId).length,
        importantMemories: getUserLongMemories(userId).length,
        profileItems: getUserProfiles(userId).length,
        financeEntries: (finance.entries || []).length,
        investmentAssets: (investments.assets || []).length
      },
      profile_summary: buildProfileSummary(userId),
      finance: {
        categories: finance.categories || DEFAULT_FINANCE_CATEGORIES,
        summary: buildFinanceSummary(finance.entries || [])
      },
      investments: {
        summary: buildInvestmentSummary(investments),
        projections: buildInvestmentProjections(investments)
      },
      business
    });
  } catch (error) {
    console.error("Error /api/dashboard:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar el dashboard."
    });
  }
});

// =========================
// OPTIONAL XLSX PARSE FROM JSON BODY
// =========================
app.post("/api/xlsx/preview", (req, res) => {
  try {
    if (!XLSX) {
      return res.status(400).json({
        ok: false,
        error: "xlsx no está disponible."
      });
    }

    const base64 = normalizeText(req.body?.base64);
    if (!base64) {
      return res.status(400).json({
        ok: false,
        error: "Falta base64."
      });
    }

    const buffer = Buffer.from(base64, "base64");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    return res.json({
      ok: true,
      sheetName,
      rows: rows.slice(0, 50)
    });
  } catch (error) {
    console.error("Error /api/xlsx/preview:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo leer el archivo xlsx."
    });
  }
});

// =========================
// 404 API
// =========================
app.use("/api", (req, res) => {
  return res.status(404).json({
    ok: false,
    error: "Ruta API no encontrada."
  });
});

// =========================
// FRONTEND FALLBACK
// =========================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "

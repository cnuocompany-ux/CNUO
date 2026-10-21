// ===== MY STORES MANAGER — BACKEND v5 =====
// DATA LIVES IN GITHUB — survives redeploys, crashes, and code updates. Records NEVER clear.
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

process.env.TZ = "Africa/Lagos"; // ALL dates in Nigerian time — set by the server, nobody can fake it

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" })); // needed for product photos

const DATA_FILE = path.join(__dirname, "data.json");
const PORT = process.env.PORT || 3000;

// ---------- GitHub = your permanent database (set these 4 variables in Render) ----------
const GH_TOKEN = process.env.GH_TOKEN || "";
const GH_REPO = process.env.GH_REPO || "";     // e.g. cnuocompany-ux/CNUO
const GH_BRANCH = process.env.GH_BRANCH || "main";
const GH_PATH = process.env.GH_PATH || "backend/data.json";
const ghHeaders = { Authorization: `Bearer ${GH_TOKEN}`, "User-Agent": "my-stores", "Content-Type": "application/json" };
const ghUrl = (q) => `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}${q || ""}`;

// ---------- password hashing (built into Node, no extra install) ----------
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const uid = () => crypto.randomBytes(8).toString("hex");

// ---------- load data: GitHub first (permanent), local file only as backup ----------
async function loadDB() {
  if (GH_TOKEN && GH_REPO) {
    try {
      const r = await fetch(ghUrl(`?ref=${GH_BRANCH}`), { headers: ghHeaders });
      if (r.ok) {
        const j = await r.json();
        console.log("✅ Data loaded from GitHub (permanent storage)");
        return JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
      }
      if (r.status === 404) console.log("No data file on GitHub yet — will be created on first save.");
      else console.error("GitHub load failed:", r.status);
    } catch (e) { console.error("GitHub load error:", e.message); }
  }
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return { ownerPassword: hash("owner123"), lowStockDefault: 5, stores: [] };
}

// ---------- save data: local file AND GitHub (queued so saves never collide) ----------
let ghQueue = Promise.resolve();
function ghSave() {
  if (!GH_TOKEN || !GH_REPO) return;
  ghQueue = ghQueue.then(async () => {
    try {
      let sha;
      const cur = await fetch(ghUrl(`?ref=${GH_BRANCH}`), { headers: ghHeaders });
      if (cur.ok) sha = (await cur.json()).sha;
      const body = {
        message: "business data " + new Date().toISOString(),
        content: Buffer.from(JSON.stringify(db, null, 2)).toString("base64"),
        branch: GH_BRANCH
      };
      if (sha) body.sha = sha;
      const r = await fetch(ghUrl(""), { method: "PUT", headers: ghHeaders, body: JSON.stringify(body) });
      if (!r.ok) console.error("GitHub save failed:", await r.text());
    } catch (e) { console.error("GitHub save error:", e.message); }
  });
}
const saveDB = () => {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
  ghSave(); // permanent copy to GitHub
};

// ---------- login tokens (memory only — logins reset on restart, DATA never does) ----------
const ownerTokens = new Set();
const storeTokens = {}; // token -> storeId

function ownerAuth(req, res, next) {
  if (ownerTokens.has(req.headers["x-owner-token"])) return next();
  res.status(401).json({ error: "Owner login required" });
}
function storeAuth(req, res, next) {
  const t = req.headers["x-store-token"];
  const sid = storeTokens[t];
  const store = sid && db.stores.find((s) => s.id === sid);
  if (store) { req.store = store; return next(); }
  res.status(401).json({ error: "Wrong password for this store" });
}
// OWNER ONLY: for adding/adjusting goods, photos, prices, stock
function ownerOnly(req, res, next) {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  if (ownerTokens.has(req.headers["x-owner-token"])) { req.store = s; return next(); }
  res.status(403).json({ error: "Only the owner can add or adjust goods" });
}
const getStore = (id) => db.stores.find((s) => s.id === id);

// calculated fields for a store's products
function withCalc(store) {
  return store.products.map((p) => {
    const sold = store.sales.filter((s) => s.productId === p.id)
      .reduce((a, s) => a + s.qty, 0);
    const remaining = p.qtyArrived - sold;
    const status = remaining <= 0 ? "FINISHED"
      : remaining <= (store.lowStock ?? db.lowStockDefault) ? "LOW STOCK" : "OK";
    return {
      ...p,
      createdAt: p.createdAt || p.addedAt || null, // original creation date — NEVER changes
      purchases: p.purchases || [],                // full purchase history with dates + suppliers
      sold, remaining, status
    };
  });
}

// ---------- OWNER AUTH ----------
app.post("/api/owner/login", (req, res) => {
  if (hash(req.body.password || "") === db.ownerPassword) {
    const t = uid(); ownerTokens.add(t);
    return res.json({ token: t });
  }
  res.status(401).json({ error: "Wrong owner password" });
});

app.post("/api/owner/password", ownerAuth, (req, res) => {
  if (!req.body.newPassword) return res.status(400).json({ error: "New password required" });
  db.ownerPassword = hash(req.body.newPassword); saveDB();
  res.json({ ok: true });
});

// ---------- FULL DATA BACKUP (owner only) ----------
app.get("/api/export", ownerAuth, (req, res) => res.json(db));

// ---------- STORES ----------
app.get("/api/stores", (req, res) => {
  res.json(db.stores.map((s) => ({
    id: s.id, name: s.name, registeredName: s.registeredName, color: s.color
  })));
});

app.get("/api/stores/:id", (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const isOwner = ownerTokens.has(req.headers["x-owner-token"]);
  const sid = storeTokens[req.headers["x-store-token"]];
  if (!isOwner && sid !== s.id) return res.status(401).json({ error: "Login required" });
  const products = withCalc(s);
  const totalIn = s.sales.reduce((a, x) => a + x.amount, 0);
  const profit = s.sales.reduce((a, x) => a + x.profit, 0);
  res.json({
    id: s.id, name: s.name, registeredName: s.registeredName, color: s.color,
    lowStock: s.lowStock ?? db.lowStockDefault,
    isOwner,
    products,
    sales: s.sales.slice().reverse(),
    totals: { totalIn, profit, count: s.sales.length,
      alerts: products.filter((p) => p.status !== "OK").length }
  });
});

app.post("/api/stores", ownerAuth, (req, res) => {
  const { name, registeredName, password, color } = req.body;
  if (!name || !password) return res.status(400).json({ error: "Name and password are required" });
  const s = {
    id: uid(), name, registeredName: registeredName || "",
    password: hash(password), color: color || "#1F4E79",
    lowStock: db.lowStockDefault, products: [], sales: []
  };
  db.stores.push(s); saveDB();
  res.json({ id: s.id });
});

app.post("/api/stores/:id/login", (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  if (hash(req.body.password || "") === s.password) {
    const t = uid(); storeTokens[t] = s.id;
    return res.json({ token: t });
  }
  res.status(401).json({ error: "Wrong password for this store" });
});

app.put("/api/stores/:id", ownerAuth, (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const { name, registeredName, color, lowStock, newPassword } = req.body;
  if (name) s.name = name;
  if (registeredName !== undefined) s.registeredName = registeredName;
  if (color) s.color = color;
  if (lowStock !== undefined) s.lowStock = Number(lowStock);
  if (newPassword) {
    s.password = hash(newPassword);
    for (const [t, sid] of Object.entries(storeTokens)) if (sid === s.id) delete storeTokens[t];
  }
  saveDB();
  res.json({ ok: true });
});

app.delete("/api/stores/:id", ownerAuth, (req, res) => {
  db.stores = db.stores.filter((s) => s.id !== req.params.id);
  saveDB();
  res.json({ ok: true });
});

// ---------- PRODUCTS (OWNER ONLY) ----------
app.post("/api/stores/:id/products", ownerOnly, (req, res) => {
  const { name, qtyArrived, costPrice, sellPrice, photo, supplier } = req.body;
  if (!name || !(qtyArrived > 0)) return res.status(400).json({ error: "Name and quantity required" });
  const now = new Date().toISOString();
  const p = {
    id: uid(), name, photo: photo || "",
    qtyArrived: Number(qtyArrived),
    costPrice: Number(costPrice) || 0,
    sellPrice: Number(sellPrice) || 0,
    createdAt: now, // original date — editing later NEVER changes this
    purchases: [{
      id: uid(), qty: Number(qtyArrived),
      costPrice: Number(costPrice) || 0,
      supplier: (supplier || "").trim(),
      date: now
    }]
  };
  req.store.products.push(p); saveDB();
  res.json({ id: p.id });
});

// EDIT product — fix forgotten details. createdAt and purchase history stay untouched.
app.put("/api/stores/:id/products/:pid", ownerOnly, (req, res) => {
  const p = req.store.products.find((x) => x.id === req.params.pid);
  if (!p) return res.status(404).json({ error: "Product not found" });
  const { name, sellPrice, costPrice, photo } = req.body;
  if (name !== undefined && String(name).trim()) p.name = String(name).trim();
  if (sellPrice !== undefined && sellPrice !== "") p.sellPrice = Number(sellPrice);
  if (costPrice !== undefined && costPrice !== "") p.costPrice = Number(costPrice);
  if (photo) p.photo = photo;
  saveDB();
  res.json({ ok: true });
});

// RESTOCK — adds to total AND records this batch with its own date + supplier
app.post("/api/stores/:id/products/:pid/restock", ownerOnly, (req, res) => {
  const p = req.store.products.find((x) => x.id === req.params.pid);
  if (!p) return res.status(404).json({ error: "Product not found" });
  const qty = Number(req.body.qty);
  if (!(qty > 0)) return res.status(400).json({ error: "Quantity required" });
  p.qtyArrived += qty;
  if (req.body.costPrice) p.costPrice = Number(req.body.costPrice);
  if (req.body.sellPrice) p.sellPrice = Number(req.body.sellPrice);
  p.purchases = p.purchases || [];
  p.purchases.push({
    id: uid(), qty,
    costPrice: req.body.costPrice ? Number(req.body.costPrice) : p.costPrice,
    supplier: (req.body.supplier || "").trim(),
    date: new Date().toISOString() // THIS batch's date — different from earlier batches
  });
  saveDB();
  res.json({ ok: true });
});

app.delete("/api/stores/:id/products/:pid", ownerAuth, (req, res) => {
  const s = getStore(req.params.id);
  s.products = s.products.filter((p) => p.id !== req.params.pid);
  s.sales = s.sales.filter((x) => x.productId !== req.params.pid);
  saveDB();
  res.json({ ok: true });
});

// ---------- SALES (workers can only record sales; date + worker name enforced by server) ----------
app.post("/api/stores/:id/sales", storeAuth, (req, res) => {
  const { productId, qty, amount, worker } = req.body;
  if (!worker || !String(worker).trim()) {
    return res.status(400).json({ error: "Worker name is required. Enter your name when opening the store." });
  }
  const p = req.store.products.find((x) => x.id === productId);
  if (!p) return res.status(404).json({ error: "Product not found" });
  if (!(qty > 0)) return res.status(400).json({ error: "Quantity required" });
  const remaining = p.qtyArrived - req.store.sales
    .filter((s) => s.productId === p.id).reduce((a, s) => a + s.qty, 0);
  if (qty > remaining) return res.status(400).json({ error: `Only ${remaining} left in stock` });
  const amt = amount !== undefined && amount !== "" ? Number(amount) : p.sellPrice * qty;
  const sale = {
    id: uid(), productId: p.id, productName: p.name,
    qty: Number(qty), amount: amt, costPrice: p.costPrice,
    profit: amt - p.costPrice * qty,
    worker: String(worker).trim(),
    date: new Date().toISOString() // SERVER time — the staff's phone cannot change this
  };
  req.store.sales.push(sale); saveDB();
  res.json({ id: sale.id });
});

app.get("/", (req, res) => res.send("My Stores API is running ✅ — data stored permanently in GitHub"));

// ---------- START: load permanent data FIRST, then open the server ----------
let db;
loadDB().then((loaded) => {
  db = loaded;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});

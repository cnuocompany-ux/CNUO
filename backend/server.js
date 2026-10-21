// ===== MY STORES MANAGER — BACKEND (deploy on Render) =====
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" })); // needed for product photos

const DATA_FILE = path.join(__dirname, "data.json");
const PORT = process.env.PORT || 3000;

// ---------- password hashing (built into Node, no extra install) ----------
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const uid = () => crypto.randomBytes(8).toString("hex");

// ---------- data file ----------
function loadDB() {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  // First run: default owner password is owner123 — CHANGE IT after first login!
  return { ownerPassword: hash("owner123"), lowStockDefault: 5, stores: [] };
}
let db = loadDB();
const saveDB = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

// ---------- login tokens (memory only — workers re-login if server restarts) ----------
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
const getStore = (id) => db.stores.find((s) => s.id === id);

// calculated fields for a store's products
function withCalc(store) {
  return store.products.map((p) => {
    const sold = store.sales.filter((s) => s.productId === p.id)
      .reduce((a, s) => a + s.qty, 0);
    const remaining = p.qtyArrived - sold;
    const status = remaining <= 0 ? "FINISHED"
      : remaining <= (store.lowStock ?? db.lowStockDefault) ? "LOW STOCK" : "OK";
    return { ...p, sold, remaining, status };
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

// ---------- STORES ----------
// public: only names/design — no money data (for the main page)
app.get("/api/stores", (req, res) => {
  res.json(db.stores.map((s) => ({
    id: s.id, name: s.name, registeredName: s.registeredName, color: s.color
  })));
});

// full data — owner token OR that store's token
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

// worker login for one store
app.post("/api/stores/:id/login", (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  if (hash(req.body.password || "") === s.password) {
    const t = uid(); storeTokens[t] = s.id;
    return res.json({ token: t });
  }
  res.status(401).json({ error: "Wrong password for this store" });
});

// update store: rename, change color, low-stock level, or CHANGE PASSWORD (kick old worker out)
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

// ---------- PRODUCTS (new goods arriving) ----------
app.post("/api/stores/:id/products", storeAuth, (req, res) => {
  const { name, qtyArrived, costPrice, sellPrice, photo } = req.body;
  if (!name || !(qtyArrived > 0)) return res.status(400).json({ error: "Name and quantity required" });
  const p = {
    id: uid(), name, photo: photo || "",
    qtyArrived: Number(qtyArrived), costPrice: Number(costPrice) || 0,
    sellPrice: Number(sellPrice) || 0, addedAt: new Date().toISOString()
  };
  req.store.products.push(p); saveDB();
  res.json({ id: p.id });
});

// more stock arrived for an existing product
app.post("/api/stores/:id/products/:pid/restock", storeAuth, (req, res) => {
  const p = req.store.products.find((x) => x.id === req.params.pid);
  if (!p) return res.status(404).json({ error: "Product not found" });
  if (!(req.body.qty > 0)) return res.status(400).json({ error: "Quantity required" });
  p.qtyArrived += Number(req.body.qty);
  if (req.body.costPrice) p.costPrice = Number(req.body.costPrice);
  if (req.body.sellPrice) p.sellPrice = Number(req.body.sellPrice);
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

// ---------- SALES ----------
app.post("/api/stores/:id/sales", storeAuth, (req, res) => {
  const { productId, qty, amount, worker } = req.body;
  const p = req.store.products.find((x) => x.id === productId);
  if (!p) return res.status(404).json({ error: "Product not found" });
  if (!(qty > 0)) return res.status(400).json({ error: "Quantity required" });
  const remaining = p.qtyArrived - req.store.sales
    .filter((s) => s.productId === p.id).reduce((a, s) => a + s.qty, 0);
  if (qty > remaining) return res.status(400).json({ error: `Only ${remaining} left in stock` });
  // amount = real money collected (worker can type more than set price). Default = set price × qty
  const amt = amount !== undefined && amount !== "" ? Number(amount) : p.sellPrice * qty;
  const sale = {
    id: uid(), productId: p.id, productName: p.name,
    qty: Number(qty), amount: amt, costPrice: p.costPrice,
    profit: amt - p.costPrice * qty,
    worker: worker || "", date: new Date().toISOString()
  };
  req.store.sales.push(sale); saveDB();
  res.json({ id: sale.id });
});

app.get("/", (req, res) => res.send("My Stores API is running ✅"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


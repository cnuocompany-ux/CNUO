// ===== MY STORES MANAGER — BACKEND v20 =====
// + DEBTS + EXPENSES + CLOSING + NOTES + CUSTOMERS + MORNING REPORT + DAY VIEW + POS + MONEY POSITION + HANDOVERS
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const Jimp = require("jimp");

process.env.TZ = "Africa/Lagos";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const DATA_FILE = path.join(__dirname, "data.json");
const PORT = process.env.PORT || 3000;

const MONGO_URL = process.env.MONGO_URL || "";
let mongoClient = null;
let mongoCol = null;

async function connectMongo() {
  if (!MONGO_URL) return;
  try {
    mongoClient = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 8000 });
    await mongoClient.connect();
    mongoCol = mongoClient.db("mystores").collection("app");
    console.log("Connected to MongoDB");
  } catch (e) { console.error("MongoDB connection error:", e.message); }
}

const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const uid = () => crypto.randomBytes(8).toString("hex");
const round2 = (x) => Math.round(Number(x || 0) * 100) / 100;

async function loadDB() {
  await connectMongo();
  if (mongoCol) {
    try {
      const meta = await mongoCol.findOne({ _id: "meta" });
      const storeDocs = await mongoCol.find({ _id: { $regex: /^store:/ } }).toArray();
      let stores = storeDocs.map((d) => d.data);
      const old = await mongoCol.findOne({ _id: "main" });
      if (old && old.data && Array.isArray(old.data.stores)) {
        let added = 0;
        for (const s of old.data.stores) {
          if (s && s.id && !stores.find((x) => x.id === s.id)) { stores.push(s); added++; }
        }
        const migrated = {
          ownerPassword: (meta && meta.ownerPassword) || old.data.ownerPassword || hash("owner123"),
          lowStockDefault: (meta && meta.lowStockDefault) || old.data.lowStockDefault || 5,
          stores
        };
        await mongoCol.updateOne({ _id: "meta" },
          { $set: { ownerPassword: migrated.ownerPassword, lowStockDefault: migrated.lowStockDefault } }, { upsert: true });
        for (const s of migrated.stores) {
          await mongoCol.updateOne({ _id: "store:" + s.id }, { $set: { data: s } }, { upsert: true });
        }
        console.log("Merge complete:", added, "store(s)");
        return migrated;
      }
      console.log("Data loaded:", stores.length, "store(s)");
      return {
        ownerPassword: (meta && meta.ownerPassword) || hash("owner123"),
        lowStockDefault: (meta && meta.lowStockDefault) || 5,
        stores
      };
    } catch (e) { console.error("Mongo load failed:", e.message); }
  }
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return { ownerPassword: hash("owner123"), lowStockDefault: 5, stores: [] };
}

async function saveDB() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
  if (mongoCol) {
    const doSave = async () => {
      await mongoCol.updateOne({ _id: "meta" },
        { $set: { ownerPassword: db.ownerPassword, lowStockDefault: db.lowStockDefault } }, { upsert: true });
      for (const s of db.stores) {
        await mongoCol.updateOne({ _id: "store:" + s.id }, { $set: { data: s } }, { upsert: true });
      }
      const existing = await mongoCol.find({ _id: { $regex: /^store:/ } }).project({ _id: 1 }).toArray();
      for (const d of existing) {
        const sid = d._id.replace("store:", "");
        if (!db.stores.find((s) => s.id === sid)) await mongoCol.deleteOne({ _id: d._id });
      }
    };
    try { await doSave(); }
    catch (e) {
      console.error("Mongo save failed, retrying:", e.message);
      try { await connectMongo(); if (mongoCol) await doSave(); } catch (e2) { console.error("Mongo save failed again:", e2.message); }
    }
  }
}

async function deleteStoreDoc(id) {
  if (!mongoCol) return;
  try { await mongoCol.deleteOne({ _id: "store:" + id }); } catch (e) {}
}

async function shrinkPhoto(dataUrl) {
  if (!dataUrl || !String(dataUrl).startsWith("data:image")) return dataUrl || "";
  try {
    const buf = Buffer.from(String(dataUrl).split(",")[1], "base64");
    if (buf.length < 60 * 1024) return dataUrl;
    const img = await Jimp.read(buf);
    img.scaleToFit(512, 512);
    img.quality(68);
    const out = await img.getBufferAsync(Jimp.MIME_JPEG);
    return "data:image/jpeg;base64," + out.toString("base64");
  } catch (e) { console.error("Photo error:", e.message); return null; }
}

const ownerTokens = new Set();
const storeTokens = {};

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
function ownerOnly(req, res, next) {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  if (ownerTokens.has(req.headers["x-owner-token"])) { req.store = s; return next(); }
  res.status(403).json({ error: "Only the owner can add or adjust goods" });
}
const getStore = (id) => db.stores.find((s) => s.id === id);

function withCalc(store) {
  return store.products.map((p) => {
    const sold = round2(store.sales.filter((s) => s.productId === p.id).reduce((a, s) => a + Number(s.qty), 0));
    const remaining = round2(Number(p.qtyArrived) - sold);
    const status = remaining <= 0 ? "FINISHED"
      : remaining <= (store.lowStock ?? db.lowStockDefault) ? "LOW STOCK" : "OK";
    return { ...p, createdAt: p.createdAt || p.addedAt || null, purchases: p.purchases || [], sold, remaining, status };
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

app.post("/api/owner/password", ownerAuth, async (req, res) => {
  if (!req.body.newPassword) return res.status(400).json({ error: "New password required" });
  db.ownerPassword = hash(req.body.newPassword);
  await saveDB();
  res.json({ ok: true });
});

app.get("/api/export", ownerAuth, (req, res) => res.json(db));

// ---------- STORES ----------
app.get("/api/stores", (req, res) => {
  res.json(db.stores.map((s) => ({ id: s.id, name: s.name, registeredName: s.registeredName, color: s.color })));
});

app.get("/api/stores/:id", (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const isOwner = ownerTokens.has(req.headers["x-owner-token"]);
  const sid = storeTokens[req.headers["x-store-token"]];
  if (!isOwner && sid !== s.id) return res.status(401).json({ error: "Login required" });
  const products = withCalc(s).map((p) => { const { photo, ...rest } = p; return { ...rest, hasPhoto: !!photo }; });
  const totalIn = round2(s.sales.reduce((a, x) => a + x.amount, 0));
  let spent = 0;
  for (const p of s.products) for (const b of (p.purchases || [])) spent += (b.qty || 0) * (b.costPrice || 0);
  spent = round2(spent);
  let stockValue = 0;
  for (const p of products) stockValue += Math.max(0, p.remaining) * (p.costPrice || 0);
  // ===== DEBTS / EXPENSES / CLOSING =====
  const debts = s.debts || [];
  const unpaid = debts.filter((d) => !d.paid).sort((a, b) => b.date.localeCompare(a.date));
  const paidDebts = isOwner ? debts.filter((d) => d.paid).sort((a, b) => (b.paidDate || "").localeCompare(a.paidDate || "")) : [];
  const owedTotal = round2(unpaid.reduce((a, d) => a + d.amount, 0));
  const expenses = s.expenses || [];
  const expensesTotal = round2(expenses.reduce((a, x) => a + x.amount, 0));
  // ===== MONEY POSITION: cash drawer bucket + POS/bank bucket =====
  const posCashIn = round2((s.pos || []).filter((x) => x.type === "TRANSFER").reduce((a, x) => a + x.total, 0));
  const posCashOut = round2((s.pos || []).filter((x) => x.type === "WITHDRAW").reduce((a, x) => a + x.amount, 0));
  const posBankIn = round2((s.pos || []).filter((x) => x.type === "WITHDRAW").reduce((a, x) => a + x.total, 0));
  const posBankOut = round2((s.pos || []).filter((x) => x.type === "TRANSFER").reduce((a, x) => a + x.amount, 0));
  const debtsPaidTotal = round2((s.debts || []).filter((d) => d.paid).reduce((a, d) => a + d.amount, 0));
  const handovers = (s.handovers || []).slice().reverse();
  const handoversTotal = round2((s.handovers || []).reduce((a, h) => a + h.amount, 0));
  const lastHandover = (s.handovers || []).slice(-1)[0] || null;
  const openingCash = (s.openingCash === undefined || s.openingCash === null) ? ((s.cashOpening === undefined || s.cashOpening === null) ? null : round2(s.cashOpening)) : round2(s.openingCash);
  const openingBank = (s.openingBank === undefined || s.openingBank === null) ? null : round2(s.openingBank);
  // Drawer: opening + cash sales + debt repayments + POS transfer cash in - POS withdraw cash out - expenses - goods - handovers
  const drawerCash = openingCash === null ? null : round2(openingCash + totalIn + debtsPaidTotal + posCashIn - posCashOut - expensesTotal - spent - handoversTotal);
  // Bank/POS: opening + withdraw money in - transfer money out
  const bankCash = openingBank === null ? null : round2(openingBank + posBankIn - posBankOut);
  const grandTotal = (drawerCash === null || bankCash === null) ? null : round2(drawerCash + bankCash);
  // staff possession since last handover
  const since = lastHandover ? lastHandover.date : "0000";
  const flowSum = (arr, val) => round2((arr || []).filter((x) => x.date > since).reduce((a, x) => a + val(x), 0));
  const staffPossession = round2(
    flowSum(s.sales, (x) => x.amount) + flowSum(s.pos, (x) => (x.type === "TRANSFER" ? x.total : -x.amount)) - flowSum(s.expenses, (x) => x.amount));
  res.json({
    id: s.id, name: s.name, registeredName: s.registeredName, color: s.color,
    lowStock: s.lowStock ?? db.lowStockDefault,
    photosAt: s.photosAt || 0,
    cashOpening: openingCash, cashNow: grandTotal, openingCash, openingBank,
    drawerCash, bankCash, grandTotal, handovers, lastHandover, staffPossession,
    cashInTotal: round2(totalIn + debtsPaidTotal + posCashIn),
    cashOutTotal: round2(expensesTotal + spent + posCashOut + handoversTotal),
    posCashNet: round2(posCashIn - posCashOut),
    isOwner, products, sales: s.sales.slice().reverse(),
    corrections: isOwner ? (s.corrections || []).slice().reverse() : [],
    debts: unpaid, debtsPaid: paidDebts, owedTotal,
    posToday: (() => { const t = new Date().toISOString().slice(0, 10); return (s.pos || []).filter((x) => x.date.slice(0, 10) === t).slice().reverse(); })(),
    posChargesToday: round2((s.pos || []).filter((x) => x.date.slice(0, 10) === new Date().toISOString().slice(0, 10)).reduce((a, x) => a + x.charge, 0)),
    posChargesAll: round2((s.pos || []).reduce((a, x) => a + x.charge, 0)),
    notes: isOwner ? (s.notes || []).slice().reverse() : [],
    customers: isOwner ? (s.customers || []).slice().reverse() : [],
    expenses: isOwner ? expenses.slice().reverse() : [], expensesTotal,
    closings: isOwner ? (s.closings || []).slice().reverse().slice(0, 60) : [],
    totals: { totalIn, spent, profit: round2(totalIn - spent - expensesTotal), stockValue: round2(stockValue),
      count: s.sales.length, alerts: products.filter((p) => p.status !== "OK").length }
  });
});

app.get("/api/stores/:id/photos", (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const isOwner = ownerTokens.has(req.headers["x-owner-token"]);
  const sid = storeTokens[req.headers["x-store-token"]];
  if (!isOwner && sid !== s.id) return res.status(401).json({ error: "Login required" });
  const photos = {};
  for (const p of s.products) if (p.photo) photos[p.id] = p.photo;
  res.json({ photosAt: s.photosAt || 0, photos });
});

app.post("/api/stores", ownerAuth, async (req, res) => {
  const { name, registeredName, password, color } = req.body;
  if (!name || !password) return res.status(400).json({ error: "Name and password are required" });
  const s = { id: uid(), name, registeredName: registeredName || "", password: hash(password),
    color: color || "#1F4E79", lowStock: db.lowStockDefault,
    products: [], sales: [], corrections: [], debts: [], expenses: [], closings: [], photosAt: 0 };
  db.stores.push(s);
  await saveDB();
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

app.put("/api/stores/:id", ownerAuth, async (req, res) => {
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
  await saveDB();
  res.json({ ok: true });
});

app.delete("/api/stores/:id", ownerAuth, async (req, res) => {
  db.stores = db.stores.filter((s) => s.id !== req.params.id);
  await deleteStoreDoc(req.params.id);
  await saveDB();
  res.json({ ok: true });
});

// ---------- PRODUCTS ----------
app.post("/api/stores/:id/products", ownerOnly, async (req, res) => {
  const { name, qtyArrived, costPrice, sellPrice, supplier } = req.body;
  if (!name || !(qtyArrived > 0)) return res.status(400).json({ error: "Name and quantity required" });
  const photo = await shrinkPhoto(req.body.photo);
  if (photo === null) return res.status(400).json({ error: "Photo too large or unsupported. Use a JPG/PNG photo." });
  const now = new Date().toISOString();
  const p = { id: uid(), name, photo: photo || "", qtyArrived: round2(qtyArrived),
    costPrice: Number(costPrice) || 0, sellPrice: Number(sellPrice) || 0, createdAt: now,
    purchases: [{ id: uid(), qty: round2(qtyArrived), costPrice: Number(costPrice) || 0, supplier: (supplier || "").trim(), date: now }] };
  req.store.products.push(p);
  req.store.photosAt = Date.now();
  await saveDB();
  res.json({ id: p.id });
});

app.put("/api/stores/:id/products/:pid", ownerOnly, async (req, res) => {
  const p = req.store.products.find((x) => x.id === req.params.pid);
  if (!p) return res.status(404).json({ error: "Product not found" });
  const { name, sellPrice, costPrice } = req.body;
  if (name !== undefined && String(name).trim()) p.name = String(name).trim();
  if (sellPrice !== undefined && sellPrice !== "") p.sellPrice = Number(sellPrice);
  if (costPrice !== undefined && costPrice !== "") p.costPrice = Number(costPrice);
  if (req.body.photo) {
    const shrunk = await shrinkPhoto(req.body.photo);
    if (shrunk === null) return res.status(400).json({ error: "Photo too large or unsupported." });
    p.photo = shrunk;
    req.store.photosAt = Date.now();
  }
  await saveDB();
  res.json({ ok: true });
});

app.post("/api/stores/:id/products/:pid/restock", ownerOnly, async (req, res) => {
  const p = req.store.products.find((x) => x.id === req.params.pid);
  if (!p) return res.status(404).json({ error: "Product not found" });
  const qty = round2(req.body.qty);
  if (!(qty > 0)) return res.status(400).json({ error: "Quantity required" });
  p.qtyArrived = round2(Number(p.qtyArrived) + qty);
  if (req.body.costPrice) p.costPrice = Number(req.body.costPrice);
  if (req.body.sellPrice) p.sellPrice = Number(req.body.sellPrice);
  p.purchases = p.purchases || [];
  p.purchases.push({ id: uid(), qty, costPrice: req.body.costPrice ? Number(req.body.costPrice) : p.costPrice,
    supplier: (req.body.supplier || "").trim(), date: new Date().toISOString() });
  await saveDB();
  res.json({ ok: true });
});

app.delete("/api/stores/:id/products/:pid", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  s.products = s.products.filter((p) => p.id !== req.params.pid);
  s.sales = s.sales.filter((x) => x.productId !== req.params.pid);
  s.photosAt = Date.now();
  await saveDB();
  res.json({ ok: true });
});

// ---------- SALES ----------
app.post("/api/stores/:id/sales", storeAuth, async (req, res) => {
  const { productId, amount, worker } = req.body;
  const qty = round2(req.body.qty);
  if (!worker || !String(worker).trim()) return res.status(400).json({ error: "Worker name is required." });
  const p = req.store.products.find((x) => x.id === productId);
  if (!p) return res.status(404).json({ error: "Product not found" });
  if (!(qty > 0)) return res.status(400).json({ error: "Quantity required" });
  const remaining = round2(Number(p.qtyArrived) - req.store.sales.filter((s) => s.productId === p.id).reduce((a, s) => a + Number(s.qty), 0));
  if (qty > remaining) return res.status(400).json({ error: `Only ${remaining} left in stock` });
  const amt = amount !== undefined && amount !== "" ? Number(amount) : round2(p.sellPrice * qty);
  const sale = { id: uid(), productId: p.id, productName: p.name, qty, amount: amt, costPrice: p.costPrice,
    profit: round2(amt - qty * p.costPrice), worker: String(worker).trim(), date: new Date().toISOString() };
  req.store.sales.push(sale);
  await saveDB();
  res.json({ id: sale.id });
});

app.delete("/api/stores/:id/sales/:sid", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const sale = s.sales.find((x) => x.id === req.params.sid);
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required (for the corrections log)." });
  s.corrections = s.corrections || [];
  s.corrections.push({ id: uid(), type: "SALE REMOVED", date: new Date().toISOString(), by: "OWNER", reason,
    details: sale.qty + " x " + sale.productName + " - " + sale.amount + " (recorded " + sale.date + " by " + (sale.worker || "-") + ")" });
  s.sales = s.sales.filter((x) => x.id !== req.params.sid);
  await saveDB();
  res.json({ ok: true });
});

// ---------- DEBT BOOK (staff add debts, mark paid; owner sees everything) ----------
app.post("/api/stores/:id/debts", storeAuth, async (req, res) => {
  const customer = String(req.body.customer || "").trim();
  const amount = Number(req.body.amount);
  if (!customer) return res.status(400).json({ error: "Customer name is required." });
  if (!(amount > 0)) return res.status(400).json({ error: "Amount is required." });
  const d = { id: uid(), customer, amount, note: String(req.body.note || "").trim(),
    worker: String(req.body.worker || "").trim(), date: new Date().toISOString(), paid: false };
  req.store.debts = req.store.debts || [];
  req.store.debts.push(d);
  await saveDB();
  res.json({ id: d.id });
});

app.put("/api/stores/:id/debts/:did/pay", storeAuth, async (req, res) => {
  const d = (req.store.debts || []).find((x) => x.id === req.params.did);
  if (!d) return res.status(404).json({ error: "Debt not found" });
  if (!d.paid) {
    d.paid = true;
    d.paidDate = new Date().toISOString();
    d.paidBy = String(req.body.worker || "").trim();
    await saveDB();
  }
  res.json({ ok: true });
});

app.delete("/api/stores/:id/debts/:did", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const d = (s.debts || []).find((x) => x.id === req.params.did);
  if (!d) return res.status(404).json({ error: "Debt not found" });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required (for the corrections log)." });
  s.corrections = s.corrections || [];
  s.corrections.push({ id: uid(), type: "DEBT REMOVED", date: new Date().toISOString(), by: "OWNER", reason,
    details: d.customer + " - " + d.amount + (d.paid ? " (was paid)" : " (UNPAID)") });
  s.debts = s.debts.filter((x) => x.id !== req.params.did);
  await saveDB();
  res.json({ ok: true });
});

// ---------- EXPENSES (owner only) ----------
app.post("/api/stores/:id/expenses", ownerOnly, async (req, res) => {
  const amount = Number(req.body.amount);
  const reason = String(req.body.reason || "").trim();
  if (!(amount > 0)) return res.status(400).json({ error: "Amount is required." });
  if (!reason) return res.status(400).json({ error: "Reason is required (e.g. transport, fuel, rent)." });
  const e = { id: uid(), amount, reason, date: new Date().toISOString(), by: "OWNER" };
  req.store.expenses = req.store.expenses || [];
  req.store.expenses.push(e);
  await saveDB();
  res.json({ id: e.id });
});

app.delete("/api/stores/:id/expenses/:eid", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const e = (s.expenses || []).find((x) => x.id === req.params.eid);
  if (!e) return res.status(404).json({ error: "Expense not found" });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required (for the corrections log)." });
  s.corrections = s.corrections || [];
  s.corrections.push({ id: uid(), type: "EXPENSE REMOVED", date: new Date().toISOString(), by: "OWNER", reason,
    details: e.reason + " - " + e.amount });
  s.expenses = s.expenses.filter((x) => x.id !== req.params.eid);
  await saveDB();
  res.json({ ok: true });
});

// ---------- DAILY CLOSING (staff count cash; owner sees history) ----------
app.post("/api/stores/:id/closing", storeAuth, async (req, res) => {
  const counted = Number(req.body.counted);
  if (!(counted >= 0)) return res.status(400).json({ error: "Counted amount is required." });
  const today = new Date().toISOString().slice(0, 10);
  const salesSum = req.store.sales.filter((x) => x.date.slice(0, 10) === today).reduce((a, x) => a + x.amount, 0);
  const posCash = (req.store.pos || []).filter((x) => x.date.slice(0, 10) === today)
    .reduce((a, x) => a + (x.type === "TRANSFER" ? x.total : -x.amount), 0);
  const expected = round2(salesSum + posCash);
  const difference = round2(counted - expected);
  const c = { id: uid(), date: new Date().toISOString(), day: today, expected, counted, difference,
    worker: String(req.body.worker || "").trim() };
  req.store.closings = req.store.closings || [];
  req.store.closings.push(c);
  await saveDB();
  res.json({ expected, counted, difference });
});

// ---------- VOICE NOTES TO OWNER (staff send, owner reviews) ----------
app.post("/api/stores/:id/notes", storeAuth, async (req, res) => {
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Say or type the message first." });
  if (text.length > 500) return res.status(400).json({ error: "Keep the note short (under 500 letters)." });
  const n = { id: uid(), text, worker: String(req.body.worker || "").trim(), date: new Date().toISOString(), heard: false };
  req.store.notes = req.store.notes || [];
  req.store.notes.push(n);
  await saveDB();
  res.json({ id: n.id });
});

app.put("/api/stores/:id/notes/:nid/heard", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const n = (s.notes || []).find((x) => x.id === req.params.nid);
  if (!n) return res.status(404).json({ error: "Note not found" });
  n.heard = true;
  await saveDB();
  res.json({ ok: true });
});

app.delete("/api/stores/:id/notes/:nid", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  s.notes = (s.notes || []).filter((x) => x.id !== req.params.nid);
  await saveDB();
  res.json({ ok: true });
});

// ---------- CUSTOMER MEASUREMENTS BOOK (owner only) ----------
app.post("/api/stores/:id/customers", ownerOnly, async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Customer name is required." });
  const c = { id: uid(), name, phone: String(req.body.phone || "").trim(),
    bust: String(req.body.bust || "").trim(), waist: String(req.body.waist || "").trim(),
    hip: String(req.body.hip || "").trim(), shoulder: String(req.body.shoulder || "").trim(),
    length: String(req.body.length || "").trim(), notes: String(req.body.notes || "").trim(),
    date: new Date().toISOString() };
  req.store.customers = req.store.customers || [];
  req.store.customers.push(c);
  await saveDB();
  res.json({ id: c.id });
});

app.put("/api/stores/:id/customers/:cid", ownerOnly, async (req, res) => {
  const c = (req.store.customers || []).find((x) => x.id === req.params.cid);
  if (!c) return res.status(404).json({ error: "Customer not found" });
  for (const k of ["name","phone","bust","waist","hip","shoulder","length","notes"]) {
    if (req.body[k] !== undefined) c[k] = String(req.body[k]).trim();
  }
  if (!c.name) return res.status(400).json({ error: "Customer name is required." });
  await saveDB();
  res.json({ ok: true });
});

app.delete("/api/stores/:id/customers/:cid", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  s.customers = (s.customers || []).filter((x) => x.id !== req.params.cid);
  await saveDB();
  res.json({ ok: true });
});

// ---------- OWNER MORNING REPORT (all stores, one screen) ----------
app.get("/api/owner/report", ownerAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let T = { todaySales: 0, todayProfit: 0, todayCount: 0, yestSales: 0, owed: 0, debtsTodayTotal: 0, expensesToday: 0, lowCount: 0, openNotes: 0, posChargesToday: 0 };
  const stores = db.stores.map((s) => {
    const products = withCalc(s);
    const sales = s.sales || [];
    const tSales = sales.filter((x) => x.date.slice(0, 10) === today);
    const ySales = sales.filter((x) => x.date.slice(0, 10) === yest);
    const sum = (arr) => round2(arr.reduce((a, x) => a + x.amount, 0));
    const tProfit = round2(tSales.reduce((a, x) => a + (x.amount - (x.qty || 0) * (x.costPrice || 0)), 0));
    const debts = s.debts || [];
    const tDebts = debts.filter((d) => d.date.slice(0, 10) === today && !d.paid);
    const owed = round2(debts.filter((d) => !d.paid).reduce((a, d) => a + d.amount, 0));
    const expToday = round2((s.expenses || []).filter((e) => e.date.slice(0, 10) === today).reduce((a, e) => a + e.amount, 0));
    const lowCount = products.filter((p) => p.status !== "OK").length;
    const openNotes = (s.notes || []).filter((n) => !n.heard).length;
    const posChargesToday = round2((s.pos || []).filter((x) => x.date.slice(0, 10) === today).reduce((a, x) => a + x.charge, 0));
    const lastClosing = (s.closings || []).slice(-1)[0] || null;
    const row = { id: s.id, name: s.name, color: s.color,
      todaySales: sum(tSales), todayProfit: tProfit, todayCount: tSales.length, yestSales: sum(ySales),
      owed, debtsToday: tDebts.length, debtsTodayTotal: round2(tDebts.reduce((a, d) => a + d.amount, 0)),
      expensesToday: expToday, lowCount, openNotes, lastClosing, posChargesToday };
    T.todaySales = round2(T.todaySales + row.todaySales); T.todayProfit = round2(T.todayProfit + row.todayProfit);
    T.todayCount += row.todayCount; T.yestSales = round2(T.yestSales + row.yestSales);
    T.owed = round2(T.owed + owed); T.debtsTodayTotal = round2(T.debtsTodayTotal + row.debtsTodayTotal);
    T.expensesToday = round2(T.expensesToday + expToday); T.lowCount += lowCount; T.openNotes += openNotes;
    T.posChargesToday = round2(T.posChargesToday + posChargesToday);
    return row;
  });
  res.json({ today, stores, totals: T });
});

// ---------- DAY VIEW: everything that happened on one day ----------
// ---------- POS (withdraw / transfer agent transactions) ----------
app.post("/api/stores/:id/pos", storeAuth, async (req, res) => {
  const type = String(req.body.type || "").toUpperCase();
  if (type !== "WITHDRAW" && type !== "TRANSFER") return res.status(400).json({ error: "Choose WITHDRAW or TRANSFER." });
  const amount = Number(req.body.amount);
  if (!(amount > 0)) return res.status(400).json({ error: "Amount is required." });
  const charge = Math.max(0, Number(req.body.charge) || 0);
  const t = { id: uid(), type, amount, charge, total: round2(amount + charge),
    note: String(req.body.note || "").trim(), worker: String(req.body.worker || "").trim(),
    date: new Date().toISOString() };
  req.store.pos = req.store.pos || [];
  req.store.pos.push(t);
  await saveDB();
  res.json({ id: t.id, total: t.total });
});

app.delete("/api/stores/:id/pos/:pid", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const t = (s.pos || []).find((x) => x.id === req.params.pid);
  if (!t) return res.status(404).json({ error: "Transaction not found" });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required (for the corrections log)." });
  s.corrections = s.corrections || [];
  s.corrections.push({ id: uid(), type: "POS REMOVED", date: new Date().toISOString(), by: "OWNER", reason,
    details: t.type + " " + t.amount + " (charge " + t.charge + ") - " + (t.worker || "-") });
  s.pos = s.pos.filter((x) => x.id !== req.params.pid);
  await saveDB();
  res.json({ ok: true });
});

app.get("/api/stores/:id/day",  (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const isOwner = ownerTokens.has(req.headers["x-owner-token"]);
  const sid = storeTokens[req.headers["x-store-token"]];
  if (!isOwner && sid !== s.id) return res.status(401).json({ error: "Login required" });
  const day = String(req.query.d || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: "Pick a date first." });
  const sales = (s.sales || []).filter((x) => x.date.slice(0, 10) === day).sort((a, b) => b.date.localeCompare(a.date));
  const debtsAll = s.debts || [];
  const debtsAdded = debtsAll.filter((d) => d.date.slice(0, 10) === day);
  const debtsPaid = debtsAll.filter((d) => d.paid && (d.paidDate || "").slice(0, 10) === day);
  const expenses = (s.expenses || []).filter((e) => e.date.slice(0, 10) === day);
  const closings = (s.closings || []).filter((c) => c.day === day);
  const corrections = isOwner ? (s.corrections || []).filter((c) => c.date.slice(0, 10) === day) : [];
  const pos = (s.pos || []).filter((x) => x.date.slice(0, 10) === day).sort((a, b) => b.date.localeCompare(a.date));
  const posCash = round2(pos.reduce((a, x) => a + (x.type === "TRANSFER" ? x.total : -x.amount), 0));
  const posCharges = round2(pos.reduce((a, x) => a + x.charge, 0));
  const saleProfit = (x) => (x.profit !== undefined ? x.profit : round2(x.amount - (x.qty || 0) * (x.costPrice || 0)));
  res.json({ day, sales, debtsAdded, debtsPaid, expenses, closings, corrections, pos,
    totals: {
      posCharges, posCash,
      money: round2(sales.reduce((a, x) => a + x.amount, 0)),
      profit: round2(sales.reduce((a, x) => a + saleProfit(x), 0)),
      expensesTotal: round2(expenses.reduce((a, e) => a + e.amount, 0)),
      debtsAddedTotal: round2(debtsAdded.reduce((a, d) => a + d.amount, 0)),
      debtsPaidTotal: round2(debtsPaid.reduce((a, d) => a + d.amount, 0)) } });
});

// ---------- OPENING BALANCES + HANDOVERS ----------
app.put("/api/stores/:id/opening", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const cash = Number(req.body.cash), bank = Number(req.body.bank);
  if (!(cash >= 0) || isNaN(cash) || !(bank >= 0) || isNaN(bank))
    return res.status(400).json({ error: "Type both amounts (0 is allowed)." });
  s.openingCash = round2(cash);
  s.openingBank = round2(bank);
  s.cashOpening = round2(cash + bank); // legacy mirror
  await saveDB();
  res.json({ ok: true });
});

// staff gives money to owner — leaves staff possession, dated
app.post("/api/stores/:id/handovers", storeAuth, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!(amount > 0)) return res.status(400).json({ error: "Amount given to owner is required." });
  const h = { id: uid(), amount, note: String(req.body.note || "").trim(),
    worker: String(req.body.worker || "").trim(), date: new Date().toISOString() };
  req.store.handovers = req.store.handovers || [];
  req.store.handovers.push(h);
  await saveDB();
  res.json({ id: h.id });
});

app.delete("/api/stores/:id/handovers/:hid", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const h = (s.handovers || []).find((x) => x.id === req.params.hid);
  if (!h) return res.status(404).json({ error: "Handover not found" });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required (for the corrections log)." });
  s.corrections = s.corrections || [];
  s.corrections.push({ id: uid(), type: "HANDOVER REMOVED", date: new Date().toISOString(), by: "OWNER", reason,
    details: h.worker + " gave " + h.amount + " to owner on " + h.date });
  s.handovers = s.handovers.filter((x) => x.id !== req.params.hid);
  await saveDB();
  res.json({ ok: true });
});

app.get("/", (req, res) => res.send("CNUO API running - CNUO Stores Manager"));

// ---------- START ----------
let db;
loadDB().then(async (loaded) => {
  db = loaded;
  let fixed = 0;
  for (const s of db.stores) {
    let touched = false;
    for (const p of s.products || []) {
      if (p.photo && p.photo.length > 120 * 1024) {
        const shrunk = await shrinkPhoto(p.photo);
        if (shrunk && shrunk.length <= 120 * 1024) p.photo = shrunk; else p.photo = "";
        touched = true; fixed++;
      }
    }
    if (touched) s.photosAt = Date.now();
  }
  if (fixed) { console.log("Old photos fixed:", fixed); await saveDB(); }
  app.listen(PORT, () => console.log("Server running on port " + PORT));
});

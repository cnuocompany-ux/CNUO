// ===== MY STORES MANAGER — BACKEND v9 =====
// ROOT FIX: one MongoDB file PER STORE (16MB limit becomes unreachable)
// + photos compressed + oversized photos rejected + every save confirmed
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

// ---------- MongoDB ----------
const MONGO_URL = process.env.MONGO_URL || "";
let mongoClient = null;
let mongoCol = null;

async function connectMongo() {
  if (!MONGO_URL) return;
  try {
    mongoClient = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 8000 });
    await mongoClient.connect();
    mongoCol = mongoClient.db("mystores").collection("app");
    console.log("✅ Connected to MongoDB");
  } catch (e) { console.error("MongoDB connection error:", e.message); }
}

// ---------- password hashing ----------
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const uid = () => crypto.randomBytes(8).toString("hex");

// ---------- LOAD: meta file + one file per store ----------
async function loadDB() {
  await connectMongo();
  if (mongoCol) {
    try {
      const meta = await mongoCol.findOne({ _id: "meta" });
      const storeDocs = await mongoCol.find({ _id: { $regex: /^store:/ } }).toArray();
      console.log("✅ Data loaded from MongoDB (permanent) — " + storeDocs.length + " store(s)");
      return {
        ownerPassword: (meta && meta.ownerPassword) || hash("owner123"),
        lowStockDefault: (meta && meta.lowStockDefault) || 5,
        stores: storeDocs.map((d) => d.data)
      };
    } catch (e) { console.error("Mongo load failed:", e.message); }
  }
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return { ownerPassword: hash("owner123"), lowStockDefault: 5, stores: [] };
}

// ---------- SAVE: meta + each store as its OWN file (no more 16MB wall) ----------
async function saveDB() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
  if (mongoCol) {
    const doSave = async () => {
      await mongoCol.updateOne(
        { _id: "meta" },
        { $set: { ownerPassword: db.ownerPassword, lowStockDefault: db.lowStockDefault } },
        { upsert: true }
      );
      for (const s of db.stores) {
        await mongoCol.updateOne({ _id: "store:" + s.id }, { $set: { data: s } }, { upsert: true });
      }
      // clean up files of deleted stores
      const existing = await mongoCol.find({ _id: { $regex: /^store:/ } }).project({ _id: 1 }).toArray();
      for (const d of existing) {
        const sid = d._id.replace("store:", "");
        if (!db.stores.find((s) => s.id === sid)) await mongoCol.deleteOne({ _id: d._id });
      }
      console.log("Saved to MongoDB ✅");
    };
    try { await doSave(); }
    catch (e) {
      console.error("Mongo save failed — reconnecting and retrying:", e.message);
      try { await connectMongo(); if (mongoCol) await doSave(); console.log("Mongo save recovered ✅"); }
      catch (e2) { console.error("Mongo save failed again:", e2.message); }
    }
  }
}

async function deleteStoreDoc(id) {
  if (!mongoCol) return;
  try { await mongoCol.deleteOne({ _id: "store:" + id }); } catch (e) {}
}

// ---------- PHOTOS: compress to small JPEG. Returns NULL if it cannot be made safe. ----------
async function shrinkPhoto(dataUrl) {
  if (!dataUrl || !String(dataUrl).startsWith("data:image")) return dataUrl || "";
  try {
    const buf = Buffer.from(String(dataUrl).split(",")[1], "base64");
    if (buf.length < 60 * 1024) return dataUrl; // already small
    const img = await Jimp.read(buf);
    img.scaleToFit(512, 512);
    img.quality(68);
    const out = await img.getBufferAsync(Jimp.MIME_JPEG);
    return "data:image/jpeg;base64," + out.toString("base64");
  } catch (e) {
    console.error("Photo could not be processed:", e.message);
    return null; // caller must reject — never store unprocessable photos
  }
}

// ---------- login tokens ----------
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
    const sold = store.sales.filter((s) => s.productId === p.id).reduce((a, s) => a + s.qty, 0);
    const remaining = p.qtyArrived - sold;
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
  const products = withCalc(s);
  const totalIn = s.sales.reduce((a, x) => a + x.amount, 0);
  let spent = 0;
  for (const p of s.products) for (const b of (p.purchases || [])) spent += (b.qty || 0) * (b.costPrice || 0);
  let stockValue = 0;
  for (const p of products) stockValue += Math.max(0, p.remaining) * (p.costPrice || 0);
  res.json({
    id: s.id, name: s.name, registeredName: s.registeredName, color: s.color,
    lowStock: s.lowStock ?? db.lowStockDefault,
    isOwner, products, sales: s.sales.slice().reverse(),
    totals: { totalIn, spent, profit: totalIn - spent, stockValue, count: s.sales.length,
      alerts: products.filter((p) => p.status !== "OK").length }
  });
});

app.post("/api/stores", ownerAuth, async (req, res) => {
  const { name, registeredName, password, color } = req.body;
  if (!name || !password) return res.status(400).json({ error: "Name and password are required" });
  const s = {
    id: uid(), name, registeredName: registeredName || "",
    password: hash(password), color: color || "#1F4E79",
    lowStock: db.lowStockDefault, products: [], sales: []
  };
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
  if (photo === null) {
    return res.status(400).json({ error: "This photo format is too large or unsupported. Please use a normal JPG/PNG photo (take a new picture with the camera set to JPG)." });
  }
  const now = new Date().toISOString();
  const p = {
    id: uid(), name, photo: photo || "",
    qtyArrived: Number(qtyArrived),
    costPrice: Number(costPrice) || 0,
    sellPrice: Number(sellPrice) || 0,
    createdAt: now,
    purchases: [{ id: uid(), qty: Number(qtyArrived), costPrice: Number(costPrice) || 0,
      supplier: (supplier || "").trim(), date: now }]
  };
  req.store.products.push(p);
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
    if (shrunk === null) {
      return res.status(400).json({ error: "This photo format is too large or unsupported. Please use a normal JPG/PNG photo." });
    }
    p.photo = shrunk;
  }
  await saveDB();
  res.json({ ok: true });
});

app.post("/api/stores/:id/products/:pid/restock", ownerOnly, async (req, res) => {
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
    date: new Date().toISOString()
  });
  await saveDB();
  res.json({ ok: true });
});

app.delete("/api/stores/:id/products/:pid", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  s.products = s.products.filter((p) => p.id !== req.params.pid);
  s.sales = s.sales.filter((x) => x.productId !== req.params.pid);
  await saveDB();
  res.json({ ok: true });
});

// ---------- SALES ----------
app.post("/api/stores/:id/sales", storeAuth, async (req, res) => {
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
    worker: String(worker).trim(),
    date: new Date().toISOString()
  };
  req.store.sales.push(sale);
  await saveDB(); // MongoDB FIRST — confirmed before "saved" is shown
  res.json({ id: sale.id });
});

app.get("/", (req, res) => res.send("My Stores API is running ✅ — per-store permanent storage in MongoDB"));

// ---------- START ----------
let db;
loadDB().then((loaded) => {
  db = loaded;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});

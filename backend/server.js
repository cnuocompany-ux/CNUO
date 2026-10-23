// ===== MY STORES MANAGER — BACKEND v11 =====
// v10 (halves, owner corrections, double-tap safe) + SPEED (photos load separately)
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
    console.log("✅ Connected to MongoDB");
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
        console.log("📦 Old-format data found — merging...");
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
        console.log("✅ Merge complete — " + added + " store(s) added");
        return migrated;
      }

      console.log("✅ Data loaded from MongoDB — " + stores.length + " store(s)");
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
  } catch (e) {
    console.error("Photo could not be processed:", e.message);
    return null;
  }
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

app.get("/api/stores", (req, res) => {
  res.json(db.stores.map((s) => ({ id: s.id, name: s.name, registeredName: s.registeredName, color: s.color })));
});

// MAIN STORE DATA — fast: photos are NOT included here (they load separately)
app.get("/api/stores/:id", (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const isOwner = ownerTokens.has(req.headers["x-owner-token"]);
  const sid = storeTokens[req.headers["x-store-token"]];
  if (!isOwner && sid !== s.id) return res.status(401).json({ error: "Login required" });
  const products = withCalc(s).map((p) => {
    const { photo, ...rest } = p;
    return { ...rest, hasPhoto: !!photo };
  });
  const totalIn = round2(s.sales.reduce((a, x) => a + x.amount, 0));
  let spent = 0;
  for (const p of s.products) for (const b of (p.purchases || [])) spent += (b.qty || 0) * (b.costPrice || 0);
  spent = round2(spent);
  let stockValue = 0;
  for (const p of products) stockValue += Math.max(0, p.remaining) * (p.costPrice || 0);
  res.json({
    id: s.id, name: s.name, registeredName: s.registeredName, color: s.color,
    lowStock: s.lowStock ?? db.lowStockDefault,
    photosAt: s.photosAt || 0,
    isOwner, products, sales: s.sales.slice().reverse(),
    corrections: isOwner ? (s.corrections || []).slice().reverse() : [],
    totals: { totalIn, spent, profit: round2(totalIn - spent), stockValue: round2(stockValue), count: s.sales.length,
      alerts: products.filter((p) => p.status !== "OK").length }
  });
});

// PHOTOS load separately (background) so the main screen is instant
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
  const s = {
    id: uid(), name, registeredName: registeredName || "",
    password: hash(password), color: color || "#1F4E79",
    lowStock: db.lowStockDefault, products: [], sales: [], corrections: [], photosAt: 0
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

app.post("/api/stores/:id/products", ownerOnly, async (req, res) => {
  const { name, qtyArrived, costPrice, sellPrice, supplier } = req.body;
  if (!name || !(qtyArrived > 0)) return res.status(400).json({ error: "Name and quantity required" });
  const photo = await shrinkPhoto(req.body.photo);
  if (photo === null) {
    return res.status(400).json({ error: "This photo format is too large or unsupported. Please use a normal JPG/PNG photo." });
  }
  const now = new Date().toISOString();
  const p = {
    id: uid(), name, photo: photo || "",
    qtyArrived: round2(qtyArrived),
    costPrice: Number(costPrice) || 0,
    sellPrice: Number(sellPrice) || 0,
    createdAt: now,
    purchases: [{ id: uid(), qty: round2(qtyArrived), costPrice: Number(costPrice) || 0,
      supplier: (supplier || "").trim(), date: now }]
  };
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
    if (shrunk === null) {
      return res.status(400).json({ error: "This photo format is too large or unsupported. Please use a normal JPG/PNG photo." });
    }
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
  s.photosAt = Date.now();
  await saveDB();
  res.json({ ok: true });
});

// ---------- SALES ----------
app.post("/api/stores/:id/sales", storeAuth, async (req, res) => {
  const { productId, amount, worker } = req.body;
  const qty = round2(req.body.qty);
  if (!worker || !String(worker).trim()) {
    return res.status(400).json({ error: "Worker name is required. Enter your name when opening the store." });
  }
  const p = req.store.products.find((x) => x.id === productId);
  if (!p) return res.status(404).json({ error: "Product not found" });
  if (!(qty > 0)) return res.status(400).json({ error: "Quantity required" });
  const remaining = round2(Number(p.qtyArrived) - req.store.sales
    .filter((s) => s.productId === p.id).reduce((a, s) => a + Number(s.qty), 0));
  if (qty > remaining) return res.status(400).json({ error: `Only ${remaining} left in stock` });
  const amt = amount !== undefined && amount !== "" ? Number(amount) : round2(p.sellPrice * qty);
  const sale = {
    id: uid(), productId: p.id, productName: p.name,
    qty, amount: amt, costPrice: p.costPrice,
    profit: round2(amt - qty * p.costPrice),
    worker: String(worker).trim(),
    date: new Date().toISOString()
  };
  req.store.sales.push(sale);
  await saveDB();
  res.json({ id: sale.id });
});

// OWNER ONLY: remove mistaken sale, reason recorded
app.delete("/api/stores/:id/sales/:sid", ownerAuth, async (req, res) => {
  const s = getStore(req.params.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  const sale = s.sales.find((x) => x.id === req.params.sid);
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required (for the corrections log)." });
  s.corrections = s.corrections || [];
  s.corrections.push({
    id: uid(), type: "SALE REMOVED", date: new Date().toISOString(), by: "OWNER", reason,
    details: sale.qty + " x " + sale.productName + " — " + sale.amount +
      " (recorded " + sale.date + " by " + (sale.worker || "—") + ")"
  });
  s.sales = s.sales.filter((x) => x.id !== req.params.sid);
  await saveDB();
  res.json({ ok: true });
});

app.get("/", (req, res) => res.send("My Stores API is running ✅ — fast mode: photos load separately"));

// ---------- START + legacy photo cleanup ----------
let db;
loadDB().then(async (loaded) => {
  db = loaded;
  let fixed = 0;
  for (const s of db.stores) {
    let touched = false;
    for (const p of s.products || []) {
      if (p.photo && p.photo.length > 120 * 1024) {
        const shrunk = await shrinkPhoto(p.photo);
        if (shrunk && shrunk.length <= 120 * 1024) { p.photo = shrunk; }
        else { p.photo = ""; }
        touched = true; fixed++;
      }
    }
    if (touched) s.photosAt = Date.now();
  }
  if (fixed) { console.log("🖼️ Old oversized photos fixed: " + fixed); await saveDB(); }
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});

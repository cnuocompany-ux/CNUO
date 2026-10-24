// ===== MY STORES MANAGER — FRONTEND v12 =====
// v11 (speed, halves, corrections) + VOICE INPUT + SMART SUGGESTIONS
let API = localStorage.getItem("apiUrl") || "";
let ownerToken = localStorage.getItem("ownerToken") || "";
let storeToken = localStorage.getItem("storeToken") || "";
let storeId = localStorage.getItem("storeId") || "";
let selectedColor = "#1F4E79";
let editingProduct = null;
let saleSaving = false;
const photoCache = {};
let salePicker = { products: [], selected: null };
const VOICE_SUPPORTED = "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
let assistantActive = false;
let femaleVoice = null;
function pickFemaleVoice() {
  if (!("speechSynthesis" in window)) return;
  const vs = speechSynthesis.getVoices();
  femaleVoice =
    vs.find((v) => /female/i.test(v.name)) ||
    vs.find((v) => /zira|samantha|susan|victoria|serena|karen|moira|tessa|fiona|google uk english female/i.test(v.name)) ||
    vs.find((v) => v.lang === "en-GB") ||
    vs.find((v) => v.lang && v.lang.startsWith("en")) || null;
}
if ("speechSynthesis" in window) {
  pickFemaleVoice();
  speechSynthesis.onvoiceschanged = pickFemaleVoice;
}
function speak(text, onDone) {
  if (!("speechSynthesis" in window)) { if (onDone) onDone(); return; }
  try { speechSynthesis.cancel(); } catch (e) {}
  const u = new SpeechSynthesisUtterance(text);
  if (femaleVoice) u.voice = femaleVoice;
  u.lang = "en-NG"; u.rate = 0.98; u.pitch = 1.05;
  let done = false;
  const finish = () => { if (!done) { done = true; if (onDone) onDone(); } };
  u.onend = finish; u.onerror = finish;
  speechSynthesis.speak(u);
  setTimeout(finish, Math.max(3500, text.length * 130));
}
function listenOnce() {
  return new Promise((resolve) => {
    if (!VOICE_SUPPORTED) return resolve("");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = "en-NG"; r.interimResults = false; r.maxAlternatives = 1;
    let got = false;
    const done = (v) => { if (!got) { got = true; try { r.stop(); } catch (e) {} resolve(v); } };
    r.onresult = (e) => { if (e.results && e.results[0] && e.results[0][0]) done(e.results[0][0].transcript.trim()); };
    r.onerror = () => done("");
    r.onend = () => done("");
    try { r.start(); } catch (e) { done(""); }
    setTimeout(() => done(""), 12000);
  });
}
// She speaks the question, then listens (auto, with a tap-to-answer fallback button)
function ask(question) {
  return new Promise((resolve) => {
    const status = document.getElementById("voiceStatus");
    if (status) status.innerHTML = '<div style="background:#e8f0fe;border-radius:8px;padding:10px">' +
      '<b>\u{1F50A} She asks:</b> "' + esc(question) + '"<br>' +
      '<span class="small">\u{1F3A4} Listening automatically... or tap:</span> ' +
      '<button class="btn btn-gray" id="answerBtn" style="padding:6px 12px">\u{1F3A4} Answer</button> ' +
      '<button class="btn btn-gray" id="stopBtn" style="padding:6px 12px">\u{23F9} Stop</button></div>';
    let finished = false;
    const finish = (v) => { if (!finished) { finished = true; resolve(v); } };
    const stopBtn = document.getElementById("stopBtn");
    if (stopBtn) stopBtn.onclick = () => { assistantActive = false; try { speechSynthesis.cancel(); } catch (e) {} finish(null); };
    const startListening = () => {
      const b = document.getElementById("answerBtn");
      if (b) b.style.display = "none";
      listenOnce().then(finish);
    };
    const ansBtn = document.getElementById("answerBtn");
    if (ansBtn) ansBtn.onclick = startListening;
    speak(question, () => { if (assistantActive) startListening(); });
  });
}
function endAssistant(msg) {
  assistantActive = false;
  try { speechSynthesis.cancel(); } catch (e) {}
  const status = document.getElementById("voiceStatus");
  if (status && msg) status.innerHTML = '<div class="small">' + esc(msg) + ' \u2014 tap \u{1F3A4} VOICE ASSISTANT to start again.</div>';
}
function describeCurrentSale() {
  const p = salePicker.selected;
  const q = val("saleQty") || "?";
  const a = val("saleAmount") || "?";
  return (p ? p.name : "no product selected") + ", quantity " + q + ", amount " + a + " naira";
}
function applyCorrection(text) {
  const lower = " " + String(text || "").toLowerCase() + " ";
  const units = "(yards?|yds?|litres?|liters?|pieces?|pcs?|packs?|bottles?|wraps?)";
  const qm = lower.match(new RegExp("(" + NUMRE + "(?:\\s+and\\s+(?:a\\s+)?half)?)\\s*" + units));
  if (qm) {
    const v = spokenNumber(qm[1]);
    if (v !== null) { document.getElementById("saleQty").value = v; prefillAmount(); return true; }
  }
  const amountWords = lower.match(new RegExp("(" + NUMRE + "(?:\\s+" + NUMRE + ")*)\\s*(?:naira)?"));
  if (amountWords) {
    const v = spokenNumber(amountWords[1]);
    if (v !== null && /\d|one|two|three|four|five|six|seven|eight|nine|half/.test(amountWords[1])) {
      document.getElementById("saleAmount").value = v; return true;
    }
  }
  return false;
}
// The full talking assistant
async function voiceAssistant(storeId) {
  if (!VOICE_SUPPORTED) { alert("Voice assistant needs the Chrome browser."); return; }
  if (assistantActive) return;
  assistantActive = true;
  const status = document.getElementById("voiceStatus");

  // 1) name
  let name = sellerName(storeId);
  let ans = await ask(name ? ("Welcome back, " + name + "! What did you sell today?") : "Hello! What is your name?");
  if (ans === null) return endAssistant("Stopped");
  ans = (ans || "").trim();
  if (ans) {
    const m = ans.match(/(?:name is|i am|i'm)\s+([a-zA-Z]+)/i);
    name = m ? m[1] : ans.split(/\s+/).slice(0, 2).join(" ");
    localStorage.setItem("seller_" + storeId, name);
  }
  if (!name) name = "Seller";

  // 2) the sale
  const saleText = await ask("Thank you, " + name + ". What did you sell? For example: 2 and a half yards of Ankara for 9 thousand naira.");
  if (saleText === null) return endAssistant("Stopped");
  if (!saleText || !saleText.trim()) {
    speak("I did not hear anything. Please try again.");
    return endAssistant("Nothing heard");
  }
  const parsed = parseSpokenSale(saleText, salePicker.products);
  if (parsed.product) pickProduct(parsed.product.id);
  if (parsed.qty !== null) document.getElementById("saleQty").value = parsed.qty;
  if (parsed.amount !== null) document.getElementById("saleAmount").value = parsed.amount;
  else prefillAmount();

  // 3) confirm
  let conf = await ask("You said: " + describeCurrentSale() + ". Is that correct? Say yes, or say the correction, like: 3 yards, or 8000 naira.");
  if (conf === null) return endAssistant("Stopped");
  conf = (conf || "").toLowerCase().trim();
  const isYes = /\b(yes|correct|okay|ok|sure|exactly|right|confirm|that's right)\b/.test(conf);
  if (!isYes && conf && applyCorrection(conf)) {
    conf = await ask("Updated: " + describeCurrentSale() + ". Is it correct now?");
    if (conf === null) return endAssistant("Stopped");
    conf = (conf || "").toLowerCase();
  }
  if (/\b(yes|correct|okay|ok|sure|exactly|right|confirm|that's right)\b/.test(conf)) {
    try {
      await api("/api/stores/" + storeId + "/sales", { method: "POST", body: JSON.stringify({
        productId: val("saleProduct"),
        qty: Number(val("saleQty")),
        amount: val("saleAmount") === "" ? undefined : Number(val("saleAmount")),
        worker: name }) });
      speak("Sale saved! Thank you, " + name + ". Goodbye.");
      if (status) status.innerHTML = '<div class="msg msg-ok">\u2705 Sale saved by voice: ' + esc(describeCurrentSale()) + '</div>';
      assistantActive = false;
      setTimeout(() => renderStore(storeId, "sale", "Sale saved \u2705"), 1600);
      return;
    } catch (e) {
      speak("Sorry, saving failed.");
      return endAssistant("Error: " + e.message);
    }
  }
  speak("Please check the details on the screen, then press Save sale. Goodbye.");
  endAssistant("Not confirmed \u2014 details are on the form above");
}

const app = document.getElementById("app");
const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtQty = (n) => {
  const r = Math.round(Number(n || 0) * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(parseFloat(r.toFixed(2)));
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => { const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const dayDate = (iso) => new Date(iso).toLocaleDateString();
const sellerName = (id) => localStorage.getItem("seller_" + id) || "";
const val = (x) => ((document.getElementById(x) || {}).value ?? "");

const purchaseLine = (p) => (p.purchases || [])
  .map((b) => `${dayDate(b.date)}: ${fmtQty(b.qty)} @ ${money(b.costPrice)}${b.supplier ? " from " + esc(b.supplier) : ""}`)
  .join(" · ");

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (ownerToken) headers["x-owner-token"] = ownerToken;
  if (storeToken) headers["x-store-token"] = storeToken;
  const r = await fetch(API + path, { ...opts, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// ---------- PHOTOS: load in background ----------
async function ensurePhotos(id, photosAt) {
  if (photoCache[id] && photoCache[id].at === photosAt) { applyPhotos(id); return; }
  try {
    const r = await api(`/api/stores/${id}/photos`);
    photoCache[id] = { at: r.photosAt, photos: r.photos || {} };
    applyPhotos(id);
  } catch (e) {}
}
function applyPhotos(id) {
  const c = photoCache[id];
  if (!c) return;
  document.querySelectorAll("img[data-pid]").forEach((img) => {
    const p = c.photos[img.dataset.pid];
    if (p) { img.src = p; img.style.display = ""; }
  });
}
function getCachedPhoto(pid) {
  for (const k in photoCache) { if (photoCache[k].photos && photoCache[k].photos[pid]) return photoCache[k].photos[pid]; }
  return "";
}

// ================= VOICE + SPEECH PARSING =================
const NUMWORDS = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
  seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50,
  sixty:60, seventy:70, eighty:80, ninety:90, half:0.5 };
const NUMRE = "(?:\\d+(?:\\.\\d+)?|" + Object.keys(NUMWORDS).join("|") + ")";

function spokenNumber(str) {
  const tokens = String(str).toLowerCase().trim().split(/\s+/).filter((t) => t && t !== "and" && t !== "a" && t !== "an");
  let total = 0, cur = 0, has = false;
  for (const t of tokens) {
    if (t === "thousand") { cur = (cur || 1) * 1000; total += cur; cur = 0; has = true; }
    else if (t === "hundred") { cur = (cur || 1) * 100; has = true; }
    else if (NUMWORDS[t] !== undefined) { cur += NUMWORDS[t]; has = true; }
    else if (/^\d+(\.\d+)?$/.test(t)) { cur += parseFloat(t); has = true; }
  }
  return has ? total + cur : null;
}

// Parse "sold 2 and a half yards of ankara for nine thousand naira"
function parseSpokenSale(text, products) {
  const lower = " " + text.toLowerCase().replace(/[?!.,]/g, " ") + " ";
  const units = "(yards?|yds?|litres?|liters?|pieces?|pcs?|packs?|bottles?|wraps?|rolls?|meters?|metres?)";
  let qty = null;
  const qm = lower.match(new RegExp("(" + NUMRE + "(?:\\s+and\\s+(?:a\\s+)?half)?)\\s*" + units));
  if (qm) qty = spokenNumber(qm[1]);
  if (qty === null) {
    const anyNum = lower.match(/(\d+(?:\.\d+)?)/);
    if (anyNum) qty = parseFloat(anyNum[1]);
  }
  let amount = null;
  const amountM = lower.match(new RegExp("(" + NUMRE + "(?:\\s+" + NUMRE + ")*)\\s*(?:naira|ngn|₦)"));
  if (amountM) amount = spokenNumber(amountM[1]);
  if (amount === null) {
    const forM = lower.match(/(?:for|at|price)\s+([a-z0-9\s]+?)(?:\s+naira)?$/);
    if (forM) amount = spokenNumber(forM[1]);
  }
  let best = null, bestScore = 0;
  for (const p of products) {
    const words = String(p.name).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    let score = 0;
    for (const w of words) { if (lower.includes(w)) score++; }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return { qty, amount, product: best, heard: text.trim() };
}

// Generic voice -> text field
function voiceFill(inputId, statusId) {
  if (!VOICE_SUPPORTED) { alert("Voice input is not supported in this browser. Please use Chrome."); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = "en-NG"; r.interimResults = true; r.maxAlternatives = 1;
  const status = document.getElementById(statusId);
  if (status) status.textContent = "🎤 Listening... speak now";
  let finalText = "";
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    if (status) status.textContent = "🎤 " + (finalText || interim);
    if (finalText) {
      const inp = document.getElementById(inputId);
      if (inp) inp.value = finalText.trim();
      if (status) status.textContent = "✅ " + finalText.trim();
    }
  };
  r.onerror = (e) => { if (status) status.textContent = "🎤 Error: " + e.error + " — allow microphone permission"; };
  r.start();
}

// Voice sale: speak what was sold -> fill the form -> staff confirms
function voiceSale() {
  if (!VOICE_SUPPORTED) { alert("Voice input is not supported in this browser. Please use Chrome."); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = "en-NG"; r.interimResults = true; r.maxAlternatives = 1;
  const status = document.getElementById("voiceStatus");
  if (status) status.textContent = "🎤 Listening... e.g. 'Sold 2 and a half yards of Ankara for nine thousand naira'";
  let finalText = "";
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    if (status) status.textContent = "🎤 " + (finalText || interim);
  };
  r.onerror = (e) => { if (status) status.textContent = "🎤 Error: " + e.error + " — allow microphone permission"; };
  r.onend = () => {
    if (!finalText.trim()) return;
    const parsed = parseSpokenSale(finalText, salePicker.products);
    if (parsed.product) pickProduct(parsed.product.id);
    if (parsed.qty !== null) document.getElementById("saleQty").value = parsed.qty;
    if (parsed.amount !== null) document.getElementById("saleAmount").value = parsed.amount;
    else prefillAmount();
    if (status) status.textContent = `🎤 Heard: "${finalText.trim()}" — CHECK the details above, then tap Save sale`;
  };
  r.start();
}

// ================= SETUP =================
function renderSetup(msg = "") {
  app.innerHTML = `<div class="container">
    <div class="topbar"><h1>🏪 My Stores Manager</h1></div>
    <div class="card">
      <h2>Welcome! One-time setup</h2>
      <p class="small">Paste the web address (URL) of your backend from Render.</p>
      ${msg ? `<div class="msg msg-error">${esc(msg)}</div>` : ""}
      <label>Backend URL from Render</label>
      <input id="setupUrl" placeholder="https://your-app.onrender.com" />
      <button class="btn btn-primary btn-block" onclick="saveSetup()">Save & Continue</button>
    </div></div>`;
}
async function saveSetup() {
  let url = val("setupUrl").trim().replace(/\/+$/, "");
  if (!url) return;
  localStorage.setItem("apiUrl", url);
  API = url;
  try { await api("/api/stores"); renderHome(); }
  catch (e) { renderSetup("Cannot reach that address. Check it and try again."); }
}

// ================= HOME =================
async function renderHome(msg = "") {
  let stores = [];
  try { stores = await api("/api/stores"); } catch (e) {}
  app.innerHTML = `<div class="topbar">
      <h1>🏪 My Stores</h1>
      <div>
        ${ownerToken ? `<button class="btn btn-green" onclick="showAddStore()">+ Add Store</button>
        <button class="btn btn-gray" onclick="logoutOwner()">Owner logout</button>`
        : `<button class="btn btn-gray" onclick="showOwnerLogin()">Owner login</button>`}
      </div></div>
    <div class="container">
      ${msg ? `<div class="msg msg-ok">${esc(msg)}</div>` : ""}
      <div id="homeMain">
        <p class="small">Click a store and enter its password to open it.</p>
        <div class="store-grid">
          ${stores.map((s) => `
            <div class="store-card" style="background:${esc(s.color)}" onclick="openStore('${s.id}', '${esc(s.name)}')">
              <h3>${esc(s.name)}</h3>
              <small>${esc(s.registeredName || "")}</small><br><br>
              <small>🔒 Staff & owner only</small>
            </div>`).join("")}
        </div>
        ${stores.length === 0 ? `<div class="card"><p>No stores yet. Click <b>Owner login</b> first (password: <b>owner123</b>), then add your first store.</p></div>` : ""}
      </div>
      <div id="homeForm"></div>
    </div>`;
}

function showOwnerLogin() {
  document.getElementById("homeMain").style.display = "none";
  document.getElementById("homeForm").innerHTML = `<div class="card">
    <h2>Owner login</h2>
    <div id="ofMsg"></div>
    <label>Owner password</label><input id="ofPass" type="password" />
    <button class="btn btn-primary btn-block" onclick="doOwnerLogin()">Login</button>
    <button class="btn btn-gray btn-block" onclick="renderHome()">Cancel</button>
  </div>`;
}
async function doOwnerLogin() {
  try {
    const r = await api("/api/owner/login", { method: "POST",
      body: JSON.stringify({ password: val("ofPass") }) });
    ownerToken = r.token; localStorage.setItem("ownerToken", ownerToken);
    renderHome();
  } catch (e) { document.getElementById("ofMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
function logoutOwner() { ownerToken = ""; localStorage.removeItem("ownerToken"); renderHome(); }

const COLORS = ["#1F4E79", "#c62828", "#2e7d32", "#6a1b9a", "#e65100", "#00695c"];
function showAddStore() {
  if (!ownerToken) return showOwnerLogin();
  document.getElementById("homeMain").style.display = "none";
  document.getElementById("homeForm").innerHTML = `<div class="card">
    <h2>Add a new store</h2>
    <div id="asMsg"></div>
    <label>Store name</label><input id="asName" placeholder="e.g. Oil Store" />
    <label>Registered name (optional)</label><input id="asReg" placeholder="e.g. Chidi Enterprises" />
    <label>Password for this store (give ONLY to the worker there)</label>
    <input id="asPass" type="text" placeholder="e.g. oil123" />
    <label>Store color / design</label>
    <div class="color-row">${COLORS.map((c) =>
      `<div class="color-dot ${c === selectedColor ? "sel" : ""}" style="background:${c}" onclick="pickColor('${c}')"></div>`).join("")}</div>
    <button class="btn btn-green btn-block" onclick="doAddStore()">Create store</button>
    <button class="btn btn-gray btn-block" onclick="renderHome()">Cancel</button>
  </div>`;
}
function pickColor(c) { selectedColor = c; showAddStore(); }
async function doAddStore() {
  try {
    await api("/api/stores", { method: "POST", body: JSON.stringify({
      name: val("asName"), registeredName: val("asReg"),
      password: val("asPass"), color: selectedColor }) });
    renderHome("Store created ✅");
  } catch (e) { document.getElementById("asMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}

// ================= STORE LOGIN + DASHBOARD =================
async function openStore(id, name) {
  if (storeId === id && storeToken) return renderStore(id);
  storeId = id; localStorage.setItem("storeId", id);
  app.innerHTML = `<div class="topbar"><h1>🔒 ${esc(name)}</h1>
      <button class="btn btn-gray" onclick="clearStoreLogin(); renderHome()">← All stores</button></div>
    <div class="container"><div class="card">
      <h2>Enter store password</h2>
      <div id="slMsg"></div>
      <label>Your name (REQUIRED — who is selling today)</label>
      <input id="slName" placeholder="e.g. Ada" value="${esc(sellerName(id))}" />
      <button class="btn btn-gray btn-block" onclick="voiceFill('slName','slVoiceStatus')">🎤 Speak your name</button>
      <div id="slVoiceStatus" class="small"></div>
      <label>Password</label><input id="slPass" type="password" />
      <button class="btn btn-primary btn-block" onclick="doStoreLogin('${id}')">Open store & start selling</button>
    </div></div>`;
}
async function doStoreLogin(id) {
  const nm = val("slName").trim();
  if (!nm) {
    document.getElementById("slMsg").innerHTML =
      `<div class="msg msg-error">⚠️ Type or speak your name first. It is required.</div>`;
    return;
  }
  try {
    const r = await api(`/api/stores/${id}/login`, { method: "POST",
      body: JSON.stringify({ password: val("slPass") }) });
    storeToken = r.token; localStorage.setItem("storeToken", storeToken);
    localStorage.setItem("seller_" + id, nm);
    renderStore(id);
  } catch (e) { document.getElementById("slMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
function clearStoreLogin() { storeToken = ""; storeId = "";
  localStorage.removeItem("storeToken"); localStorage.removeItem("storeId"); }

async function renderStore(id, tab = "sale", msg = "") {
  let d;
  try { d = await api(`/api/stores/${id}`); }
  catch (e) { clearStoreLogin(); return openStore(id, "this store"); }
  if (editingProduct && !d.products.find((p) => p.id === editingProduct)) editingProduct = null;

  const badge = (s) => s === "FINISHED" ? `<span class="badge badge-fin">FINISHED</span>`
    : s === "LOW STOCK" ? `<span class="badge badge-low">LOW STOCK</span>`
    : `<span class="badge badge-ok">OK</span>`;

  const today = new Date().toDateString();
  const tSales = d.sales.filter((s) => new Date(s.date).toDateString() === today);
  const tMoney = tSales.reduce((a, s) => a + s.amount, 0);
  const tProfit = tSales.reduce((a, s) => a + (s.amount - s.qty * (s.costPrice || 0)), 0);
  const trueProfit = (d.totals.totalIn || 0) - (d.totals.spent || 0);

  // ---- smart suggestions data ----
  const productNames = [...new Set(d.products.map((p) => p.name))];
  const supplierNames = [...new Set(d.products.flatMap((p) => (p.purchases || []).map((b) => b.supplier)).filter(Boolean))];
  const dlProducts = `<datalist id="dl-products">${productNames.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
  const dlSuppliers = `<datalist id="dl-suppliers">${supplierNames.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;

  const photoCell = (p) => p.hasPhoto
    ? `<img class="thumb" data-pid="${p.id}" style="display:none">`
    : "";

  const productRow = (p, ownerView) => `<tr>
    <td>${photoCell(p)}</td>
    <td><b>${esc(p.name)}</b><br>
      <span class="small">added: ${p.createdAt ? dayDate(p.createdAt) : "—"} · cost: ${money(p.costPrice)}</span><br>
      <span class="small" style="color:#555">📥 ${purchaseLine(p) || "no purchase records"}</span></td>
    <td>${fmtQty(p.qtyArrived)}</td><td>${fmtQty(p.sold)}</td><td><b>${fmtQty(p.remaining)}</b></td>
    <td>${badge(p.status)}</td><td>${money(p.sellPrice)}</td>
    ${ownerView ? `<td><button class="btn btn-gray" onclick="startEdit('${p.id}','${id}')">✏️ Edit / +Stock</button>
        <button class="btn btn-red" onclick="doDeleteProduct('${id}','${p.id}')">✕</button></td>` : ""}
  </tr>`;

  const cached = getCachedPhoto(editingProduct || "");
  const editForm = (p) => `<div class="card" style="border:2px solid #1F4E79">
    <h2>✏️ Edit: ${esc(p.name)}</h2>
    <p class="small">Created on <b>${p.createdAt ? dayDate(p.createdAt) : "—"}</b> — this date never changes.</p>
    <div id="editMsg"></div>
    <label>Product name</label><input id="eName" list="dl-products" value="${esc(p.name)}" />
    <label>Sell price</label><input id="eSell" type="number" min="0" step="any" value="${p.sellPrice}" />
    <label>Cost price</label><input id="eCost" type="number" min="0" step="any" value="${p.costPrice}" />
    <label>📦 Add more stock — halves allowed (0 if none arrived)</label>
    <input id="eQty" type="number" min="0" step="0.5" value="0" />
    <label>Supplier — who did you buy the new stock from?</label>
    <input id="eSupplier" list="dl-suppliers" placeholder="e.g. Chidi Market" />
    <label>Change photo (optional — leave empty to keep current)</label>
    <input id="ePhoto" type="file" accept="image/*" />
    ${cached ? `<img class="thumb" src="${cached}" style="margin-top:6px">` : ""}
    <button class="btn btn-green btn-block" onclick="doEditProduct('${id}','${p.id}')">💾 Save changes</button>
    <button class="btn btn-gray btn-block" onclick="cancelEdit('${id}')">Cancel</button>
  </div>`;

  app.innerHTML = `<div class="topbar" style="background:${esc(d.color)}">
      <h1>🏪 ${esc(d.name)}</h1>
      <button class="btn btn-gray" onclick="clearStoreLogin(); renderHome()">← All stores</button></div>
    <div class="container">
      ${dlProducts}${dlSuppliers}
      ${msg ? `<div class="msg msg-ok">${esc(msg)}</div>` : ""}
      ${sellerName(id) ? `<div class="card" style="padding:10px 14px;margin:0 0 10px 0">👤 Selling today: <b>${esc(sellerName(id))}</b></div>` : ""}
      ${d.totals.alerts > 0 ? `<div class="msg msg-error">⚠️ ${d.totals.alerts} product(s) finished or low on stock!</div>` : ""}

      <h2 style="margin-top:10px">📊 All-time money</h2>
      <div class="stat-row">
        <div class="stat"><div class="num">${money(d.totals.totalIn)}</div><div class="lbl">💰 All-time SOLD</div></div>
        <div class="stat"><div class="num">${money(d.totals.spent)}</div><div class="lbl">🛒 All-time SPENT</div></div>
        <div class="stat"><div class="num" style="color:${trueProfit >= 0 ? "#2e7d32" : "#c62828"}">${money(trueProfit)}</div><div class="lbl">✅ TRUE PROFIT</div></div>
        <div class="stat"><div class="num">${money(d.totals.stockValue)}</div><div class="lbl">📦 Money in stock</div></div>
      </div>

      <h2>📅 Today</h2>
      <div class="stat-row">
        <div class="stat"><div class="num">${money(tMoney)}</div><div class="lbl">Today's money</div></div>
        <div class="stat"><div class="num">${money(tProfit)}</div><div class="lbl">Today's profit</div></div>
        <div class="stat"><div class="num">${tSales.length}</div><div class="lbl">Today's sales</div></div>
        <div class="stat"><div class="num">${d.totals.count}</div><div class="lbl">All-time sales</div></div>
      </div>

      <div class="tabs">
        <div class="tab ${tab === "sale" ? "active" : ""}" onclick="renderStore('${id}','sale')">➕ Record sale</div>
        <div class="tab ${tab === "stock" ? "active" : ""}" onclick="renderStore('${id}','stock')">📦 Stock</div>
        <div class="tab ${tab === "log" ? "active" : ""}" onclick="renderStore('${id}','log')">📋 Sales log</div>
        ${d.isOwner ? `<div class="tab ${tab === "fixes" ? "active" : ""}" onclick="renderStore('${id}','fixes')">🛠 Corrections</div>` : ""}
        ${d.isOwner ? `<div class="tab ${tab === "settings" ? "active" : ""}" onclick="renderStore('${id}','settings')">⚙️ Settings</div>` : ""}
      </div>

      <div class="section ${tab === "sale" ? "active" : ""}"><div class="card">
        <h2>Record a sale</h2>
        <div id="saleMsg"></div>
        ${VOICE_SUPPORTED ? `
                <button class="btn btn-primary btn-block" onclick="voiceAssistant('${id}')">\u{1F3A4} VOICE ASSISTANT — she asks your name & what you sold</button>
        <div id="voiceStatus" class="small" style="margin:6px 0;color:#1F4E79;font-weight:600">Tap and she will talk to you. Or type below \u{1F50D}</div>
        <hr style="margin:12px 0">` : `<p class="small">🎤 Voice input needs Chrome browser</p>`}
        <label>Product — type ANY part of the name to search (no scrolling)</label>
        <div id="pickerBox"></div>
        <label>Quantity sold — halves allowed (0.5, 1.5, 2...)</label>
        <input id="saleQty" type="number" min="0.5" step="0.5" value="1" oninput="prefillAmount()" />
        <label>Amount received (auto-fills — change if sold higher)</label>
        <input id="saleAmount" type="number" min="0" step="any" />
        <button class="btn btn-green btn-block" id="saleBtn" onclick="doSale('${id}')">💾 Save sale</button>
        <p class="small">Seller: <b>${esc(sellerName(id) || "—")}</b> · Double-tap is blocked</p>
      </div></div>

      <div class="section ${tab === "stock" ? "active" : ""}">
      ${d.isOwner ? `<div class="card">
        <h2>Stock</h2>
        ${editingProduct ? editForm(d.products.find((p) => p.id === editingProduct)) : ""}
        ${d.products.length === 0 ? "<p>No products yet. Add your first goods below.</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th></th><th>Product (added date + purchase history)</th><th>Total arrived</th><th>Sold</th><th>Left</th><th>Status</th><th>Sell price</th><th></th></tr>
          ${d.products.map((p) => productRow(p, true)).join("")}
        </table></div>`}
        <hr style="margin:16px 0">
        <h2>Add new goods (owner only)</h2>
        <div id="prodMsg"></div>
        <label>Product name — typing shows suggestions</label><input id="pName" list="dl-products" placeholder="e.g. Engine Oil / Ankara Wrapper" />
        <button class="btn btn-gray btn-block" onclick="voiceFill('pName','prodVoiceStatus')">🎤 Speak product name</button>
        <div id="prodVoiceStatus" class="small"></div>
        <label>Photo (optional)</label><input id="pPhoto" type="file" accept="image/*" />
        <label>Quantity arrived — halves allowed (e.g. 10.5 yards)</label><input id="pQty" type="number" min="0.5" step="0.5" />
        <label>Cost price — what YOU paid for one</label><input id="pCost" type="number" min="0" step="any" />
        <label>Sell price — what the customer pays</label><input id="pSell" type="number" min="0" step="any" />
        <label>Supplier — typing shows past suppliers</label><input id="pSupplier" list="dl-suppliers" placeholder="e.g. Chidi Market, Lagos" />
        <button class="btn btn-gray btn-block" onclick="voiceFill('pSupplier','supVoiceStatus')">🎤 Speak supplier name</button>
        <div id="supVoiceStatus" class="small"></div>
        <button class="btn btn-primary btn-block" onclick="doAddProduct('${id}')">📦 Save product</button>
      </div>` : `<div class="card"><h2>Stock</h2>
        <p>👀 View only — only the owner can add goods.</p>
        ${d.products.length === 0 ? "<p>No products yet.</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th></th><th>Product</th><th>Total arrived</th><th>Sold</th><th>Left</th><th>Status</th><th>Sell price</th></tr>
          ${d.products.map((p) => productRow(p, false)).join("")}
        </table></div>`}
      </div>`}
      </div>

      <div class="section ${tab === "log" ? "active" : ""}"><div class="card">
        <h2>Sales log</h2>
        ${d.sales.length === 0 ? "<p>No sales yet.</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th>Date & time</th><th>Product</th><th>Qty</th><th>Amount</th><th>Profit</th><th>By</th>${d.isOwner ? "<th></th>" : ""}</tr>
          ${d.sales.map((s) => `<tr>
            <td class="small">${fmtDate(s.date)}</td><td>${esc(s.productName)}</td>
            <td>${fmtQty(s.qty)}</td><td>${money(s.amount)}</td>
            <td style="color:#2e7d32"><b>${money(s.amount - s.qty * (s.costPrice || 0))}</b></td>
            <td>${esc(s.worker || "—")}</td>
            ${d.isOwner ? `<td><button class="btn btn-red" onclick="doDeleteSale('${id}','${s.id}')">✕</button></td>` : ""}
          </tr>`).join("")}
        </table></div>
        ${d.isOwner ? `<p class="small">✕ = remove a mistaken entry (owner only — reason recorded)</p>` : ""}`}
      </div></div>

      ${d.isOwner ? `<div class="section ${tab === "fixes" ? "active" : ""}"><div class="card">
        <h2>🛠 Corrections log (owner only)</h2>
        ${(d.corrections || []).length === 0 ? "<p>No corrections yet. ✅</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th>Date & time</th><th>Action</th><th>Details</th><th>Reason</th><th>By</th></tr>
          ${(d.corrections || []).map((c) => `<tr>
            <td class="small">${fmtDate(c.date)}</td>
            <td><b>${esc(c.type)}</b></td>
            <td class="small">${esc(c.details || "")}</td>
            <td>${esc(c.reason)}</td>
            <td>${esc(c.by)}</td>
          </tr>`).join("")}
        </table></div>`}
      </div></div>` : ""}

      ${d.isOwner ? `<div class="section ${tab === "settings" ? "active" : ""}"><div class="card">
        <h2>Store settings (owner only)</h2>
        <div id="setMsg"></div>
        <label>Store name</label><input id="setName" value="${esc(d.name)}" />
        <label>Registered name</label><input id="setReg" value="${esc(d.registeredName)}" />
        <label>Low-stock alert level</label>
        <input id="setLow" type="number" min="0" step="0.5" value="${d.lowStock}" />
        <label>NEW store password — kicks out the old worker</label>
        <input id="setPass" type="text" placeholder="leave empty to keep current password" />
        <button class="btn btn-primary btn-block" onclick="doUpdateStore('${id}')">💾 Save settings</button>
        <hr style="margin:16px 0">
        <label>Owner password (main password)</label>
        <input id="setOwnerPass" type="text" placeholder="new owner password" />
        <button class="btn btn-gray btn-block" onclick="doChangeOwnerPass()">Change owner password</button>
        <hr style="margin:16px 0">
        <button class="btn btn-green btn-block" onclick="doBackup()">💾 DOWNLOAD ALL MY DATA (backup)</button>
        <hr style="margin:16px 0">
        <button class="btn btn-red btn-block" onclick="doDeleteStore('${id}')">🗑️ DELETE this store</button>
      </div></div>` : ""}
    </div>`;

  renderSalePicker(d.products);
  if (d.products.some((p) => p.hasPhoto)) ensurePhotos(id, d.photosAt || 0);
}

// ---------- searchable product picker ----------
function renderSalePicker(products) {
  const box = document.getElementById("pickerBox");
  if (!box) return;
  salePicker.products = products.filter((p) => p.remaining > 0);
  salePicker.selected = null;
  box.innerHTML = `
    <input id="saleSearch" placeholder="type to search... e.g. 'ankara' or 'oil'" oninput="filterSalePicker()" autocomplete="off" style="margin-bottom:4px" />
    <div id="pickerResults" style="border:1px solid #ddd;border-radius:8px;max-height:200px;overflow-y:auto"></div>
    <div id="pickerSelected" style="display:none;margin-top:6px;padding:10px;background:#c8e6c9;border-radius:8px;font-weight:700"></div>
    <input type="hidden" id="saleProduct" />`;
  filterSalePicker();
}
function filterSalePicker() {
  const q = (val("saleSearch") || "").toLowerCase().trim();
  const list = salePicker.products.filter((p) => !q || p.name.toLowerCase().includes(q));
  const box = document.getElementById("pickerResults");
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<div class="small" style="padding:10px;color:#777">No match for that spelling — owner can add it in Stock.</div>`;
    return;
  }
  box.innerHTML = list.map((p) => `
    <div onclick="pickProduct('${p.id}')" style="padding:11px;border-bottom:1px solid #eee;cursor:pointer">
      <b>${esc(p.name)}</b> <span class="small">&mdash; ${fmtQty(p.remaining)} left @ ${money(p.sellPrice)}</span>
    </div>`).join("");
}
function pickProduct(pid) {
  const p = salePicker.products.find((x) => x.id === pid);
  if (!p) return;
  salePicker.selected = p;
  const hid = document.getElementById("saleProduct");
  if (hid) hid.value = p.id;
  const sel = document.getElementById("pickerSelected");
  if (sel) { sel.style.display = "block"; sel.textContent = "Selected: " + p.name + " \u2014 " + fmtQty(p.remaining) + " left @ " + money(p.sellPrice); }
  const res = document.getElementById("pickerResults");
  if (res) res.innerHTML = "";
  prefillAmount();
}

function prefillAmount() {
  const p = salePicker.selected;
  if (!p) return;
  const qtyEl = document.getElementById("saleQty");
  const qty = Number((qtyEl && qtyEl.value) || 1);
  const amtEl = document.getElementById("saleAmount");
  if (amtEl) amtEl.value = Math.round(p.sellPrice * qty * 100) / 100;
}

async function doSale(id) {
  if (saleSaving) return;
  saleSaving = true;
  const btn = document.getElementById("saleBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  try {
    await api(`/api/stores/${id}/sales`, { method: "POST", body: JSON.stringify({
      productId: val("saleProduct"),
      qty: Number(val("saleQty")),
      amount: val("saleAmount") === "" ? undefined : Number(val("saleAmount")),
      worker: sellerName(id) }) });
    saleSaving = false;
    renderStore(id, "sale", "Sale saved ✅");
  } catch (e) {
    saleSaving = false;
    if (btn) { btn.disabled = false; btn.textContent = "💾 Save sale"; }
    document.getElementById("saleMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`;
  }
}

async function doDeleteSale(storeId, saleId) {
  const reason = prompt("Why are you removing this sale? (It will be permanently recorded)");
  if (reason === null) return;
  if (!reason.trim()) { alert("A reason is required for the corrections log."); return; }
  if (!confirm("Remove this sale? The quantity goes back into stock.")) return;
  try {
    await api(`/api/stores/${storeId}/sales/${saleId}`, { method: "DELETE",
      body: JSON.stringify({ reason: reason.trim() }) });
    renderStore(storeId, "log", "Sale removed ✅ Reason recorded in Corrections.");
  } catch (e) { alert(e.message); }
}

function startEdit(pid, id) { editingProduct = pid; renderStore(id, "stock"); }
function cancelEdit(id) { editingProduct = null; renderStore(id, "stock"); }

async function doEditProduct(id, pid) {
  try {
    const name = val("eName").trim();
    const sell = val("eSell");
    const cost = val("eCost");
    const newQty = Number(val("eQty") || 0);
    const supplier = val("eSupplier").trim();
    const file = document.getElementById("ePhoto").files[0];

    const finish = async (photo) => {
      await api(`/api/stores/${id}/products/${pid}`, { method: "PUT",
        body: JSON.stringify({ name, sellPrice: sell, costPrice: cost, photo }) });
      if (newQty > 0) {
        await api(`/api/stores/${id}/products/${pid}/restock`, { method: "POST",
          body: JSON.stringify({ qty: newQty, costPrice: cost || undefined, supplier }) });
      }
      editingProduct = null;
      renderStore(id, "stock", "Product updated ✅ Original date kept.");
    };
    if (file) { const r = new FileReader();
      r.onload = () => finish(r.result); r.readAsDataURL(file); }
    else await finish("");
  } catch (e) {
    const m = document.getElementById("editMsg");
    if (m) m.innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; else alert(e.message);
  }
}

async function doDeleteProduct(id, pid) {
  if (!confirm("Delete this product, its purchase history and sales?")) return;
  try { await api(`/api/stores/${id}/products/${pid}`, { method: "DELETE" });
    renderStore(id, "stock", "Product deleted"); } catch (e) { alert(e.message); }
}

function doAddProduct(id) {
  const name = val("pName");
  const qty = Number(val("pQty"));
  const cost = Number(val("pCost"));
  const sell = Number(val("pSell"));
  const supplier = val("pSupplier");
  const file = document.getElementById("pPhoto").files[0];
  const send = (photo) => api(`/api/stores/${id}/products`, { method: "POST",
      body: JSON.stringify({ name, qtyArrived: qty, costPrice: cost, sellPrice: sell, photo, supplier }) })
    .then(() => renderStore(id, "stock", "Product added ✅ Purchase recorded."))
    .catch((e) => { document.getElementById("prodMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; });
  if (file) { const r = new FileReader();
    r.onload = () => send(r.result); r.readAsDataURL(file); }
  else send("");
}

async function doUpdateStore(id) {
  const pass = val("setPass");
  try {
    await api(`/api/stores/${id}`, { method: "PUT", body: JSON.stringify({
      name: val("setName"), registeredName: val("setReg"),
      lowStock: Number(val("setLow")), newPassword: pass || undefined }) });
    if (pass) { clearStoreLogin(); return renderHome("Password changed. Old worker can no longer enter. ✅"); }
    renderStore(id, "settings", "Settings saved ✅");
  } catch (e) { document.getElementById("setMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
async function doChangeOwnerPass() {
  try { await api("/api/owner/password", { method: "POST",
    body: JSON.stringify({ newPassword: val("setOwnerPass") }) });
    alert("Owner password changed ✅"); }
  catch (e) { alert(e.message); }
}
async function doDeleteStore(id) {
  if (!confirm("Delete this store and ALL its data forever?")) return;
  try { await api(`/api/stores/${id}`, { method: "DELETE" });
    clearStoreLogin(); renderHome("Store deleted"); } catch (e) { alert(e.message); }
}

async function doBackup() {
  try {
    const data = await api("/api/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-stores-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    alert("Backup downloaded ✅ Keep this file safe.");
  } catch (e) { alert(e.message); }
}

// ================= START =================
if (!API) renderSetup();
else renderHome();

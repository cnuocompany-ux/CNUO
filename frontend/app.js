// ===== MY STORES MANAGER — FRONTEND v24 =====
// v21: OFFLINE OUTBOX — save sales/debts on phone when no network, auto-send when back
// v19: comma-numbers fix (10,000) + voice assistant AMARA + picker + halves + corrections
let API = localStorage.getItem("apiUrl") || "";
let ownerToken = localStorage.getItem("ownerToken") || "";
let storeToken = localStorage.getItem("storeToken") || "";
let storeId = localStorage.getItem("storeId") || "";
let selectedColor = "#1F4E79";
let editingProduct = null;
let saleSaving = false;
const photoCache = {};
// ---------- OFFLINE OUTBOX: save on phone when no network, auto-send later ----------
let outbox = [];
try { outbox = JSON.parse(localStorage.getItem("cnuo_outbox") || "[]"); } catch (e) { outbox = []; }
let outboxSyncing = false;
function saveOutbox() { try { localStorage.setItem("cnuo_outbox", JSON.stringify(outbox)); } catch (e) {} }
function isNetError(e) { return !navigator.onLine || /failed to fetch|network|timeout|unreachable/i.test(String(e && e.message)); }
async function submitWrite(path, method, payload) {
  try { await api(path, { method, body: JSON.stringify(payload) }); return { ok: true }; }
  catch (e) {
    if (isNetError(e)) { outbox.push({ path, method, payload, at: Date.now() }); saveOutbox(); return { queued: true }; }
    throw e;
  }
}
async function syncOutbox() {
  if (outboxSyncing || !outbox.length || !navigator.onLine) return;
  outboxSyncing = true;
  let sent = 0, dropped = 0;
  while (outbox.length && navigator.onLine) {
    const item = outbox[0];
    try { await api(item.path, { method: item.method, body: JSON.stringify(item.payload) }); outbox.shift(); sent++; }
    catch (e) {
      if (isNetError(e)) break;             // still offline — retry later
      outbox.shift(); dropped++;            // server rejected it (e.g. not enough stock left)
    }
  }
  outboxSyncing = false;
  saveOutbox();
  updateOutboxBadge();
  if (sent > 0 || dropped > 0) {
    const msg = (sent ? sent + " queued item(s) sent ✅" : "") + (dropped ? " " + dropped + " could not be sent (stock changed) — please check" : "");
    if (storeId) { try { renderStore(storeId, undefined, msg.trim()); } catch (e) {} }
    else if (sent > 0) alert("📶 " + msg.trim());
  }
}
function updateOutboxBadge() {
  document.querySelectorAll("[data-outbox-badge]").forEach((el) => {
    el.style.display = outbox.length ? "" : "none";
    el.textContent = "📶 " + outbox.length + " queued";
  });
}
window.addEventListener("online", () => syncOutbox());
setInterval(() => { if (outbox.length) syncOutbox(); }, 30000);
// store view cache for offline viewing
const storeCache = {};
try { for (const k in localStorage) { if (k.indexOf("cnuo_cache_") === 0) { try { storeCache[k.replace("cnuo_cache_", "")] = JSON.parse(localStorage[k]); } catch (e) {} } } } catch (e) {}
let salePicker = { products: [], selected: null };
const VOICE_SUPPORTED = "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
let assistantActive = false;
const ASSISTANT_NAME = "Amara"; // \u{270F}\u{FE0F} change her name here if you like
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
  u.lang = "en-NG"; u.rate = 0.92; u.pitch = 1.0; // calm, relaxed
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
      '<b>\u{1F50A} ' + ASSISTANT_NAME + ' asks:</b> "' + esc(question) + '"<br>' +
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
  const lower = " " + String(text || "").toLowerCase().replace(/(\d),(\d)/g, "$1$2") + " ";
  const units = "(yards?|yds?|litres?|liters?|pieces?|pcs?|packs?|bottles?|wraps?)";
  const qm = lower.match(new RegExp("(" + NUMRE + "(?:\\s+and\\s+(?:a\\s+)?half)?)\\s*" + units));
  if (qm) {
    const v = spokenNumber(qm[1]);
    if (v !== null) { document.getElementById("saleQty").value = v; prefillAmount(); return true; }
  }
  const amountWords = lower.match(new RegExp("(" + NUMRE + "(?:\\s+" + NUMANY + ")*)\\s*(?:naira)?"));
  if (amountWords) {
    const v = spokenNumber(amountWords[1]);
    if (v !== null && /\d|one|two|three|four|five|six|seven|eight|nine|half/.test(amountWords[1])) {
      document.getElementById("saleAmount").value = v; return true;
    }
  }
  return false;
}
// ---------- smart helpers ----------
function parseNumberOnly(text) {
  const lower = " " + String(text || "").toLowerCase().replace(/(\d),(\d)/g, "$1$2") + " ";
  const m = lower.match(new RegExp("(" + NUMRE + "(?:\\s+(?:" + NUMANY + "|and|a|an|half))*)"));
  if (!m) return null;
  return spokenNumber(m[1]);
}
function matchProductText(text, products) {
  const lower = " " + String(text || "").toLowerCase().replace(/[?!.,]/g, " ") + " ";
  const squashed = lower.replace(/[^a-z0-9]/g, "");
  let best = null, bs = 0;
  for (const p of products) {
    const pname = String(p.name).toLowerCase();
    const pSquash = pname.replace(/[^a-z0-9]/g, "");
    const words = pname.split(/\s+/).filter((w) => w.length > 2);
    let s = 0;
    for (const w of words) { if (lower.includes(w)) s++; }
    if (pSquash.length > 3 && squashed.includes(pSquash)) s += 2;
    if (s > bs) { bs = s; best = p; }
  }
  return best;
}
// ---------- AMARA: the talking sales assistant (asks until everything is clear) ----------
async function voiceAssistant(storeId) {
  if (!VOICE_SUPPORTED) { alert("Voice assistant needs the Chrome browser."); return; }
  if (assistantActive) return;
  assistantActive = true;

  // 1) greet + name
  let name = sellerName(storeId);
  let ans = await ask(name
    ? ("Welcome back, " + name + "! I am " + ASSISTANT_NAME + ". What did you sell today?")
    : ("Hello! I am " + ASSISTANT_NAME + ", your sales assistant. What is your name?"));
  if (ans === null) return endAssistant("Stopped");
  ans = (ans || "").trim();
  if (ans) {
    const m = ans.match(/(?:name is|i am|i'm)\s+([a-zA-Z]+)/i);
    name = m ? m[1] : ans.split(/\s+/).slice(0, 2).join(" ");
    localStorage.setItem("seller_" + storeId, name);
  }
  if (!name) name = "Seller";

  // 2) what did you sell
  const saleText = await ask("What did you sell?");
  if (saleText === null) return endAssistant("Stopped");
  if (!saleText || !saleText.trim()) {
    speak("I did not hear anything. Please try again.");
    return endAssistant("Nothing heard");
  }
  const parsed = parseSpokenSale(saleText, salePicker.products);

  // 3) follow-up: which product?
  if (!parsed.product && salePicker.products.length === 1) {
    parsed.product = salePicker.products[0]; // only one product in this store — she knows it
  }
  if (!parsed.product) {
    const pAns = await ask("Which product did you sell? Say its name.");
    if (pAns === null) return endAssistant("Stopped");
    parsed.product = matchProductText(pAns, salePicker.products);
    if (!parsed.product) {
      const pAns2 = await ask("Say the product name again, slowly.");
      if (pAns2 === null) return endAssistant("Stopped");
      parsed.product = matchProductText(pAns2, salePicker.products);
    }
    if (!parsed.product) {
      const rdy = await ask("Please TAP the product on the screen, then say: ready.");
      if (rdy === null) return endAssistant("Stopped");
      parsed.product = salePicker.selected;
      if (!parsed.product) { speak("No product chosen. Goodbye."); return endAssistant("No product"); }
    }
  }
  pickProduct(parsed.product.id);
  if (parsed.qty !== null) document.getElementById("saleQty").value = parsed.qty;
  if (parsed.amount !== null) document.getElementById("saleAmount").value = parsed.amount;
  else prefillAmount();

  // 4) follow-up: how many?
  if (parsed.qty === null) {
    const qAns = await ask("How many did you sell?");
    if (qAns === null) return endAssistant("Stopped");
    parsed.qty = parseNumberOnly(qAns);
    if (parsed.qty !== null) { document.getElementById("saleQty").value = parsed.qty; prefillAmount(); }
  }
  const qtyN = Number(val("saleQty") || 1);

  // 5) follow-up: price — and detect TOTAL vs EACH when qty > 1
  if (parsed.amount === null) {
    const aAns = await ask("At what price did you sell " + (qtyN > 1 ? "each one" : "it") + "? Say the amount in naira.");
    if (aAns === null) return endAssistant("Stopped");
    let unit = parseNumberOnly(aAns);
    if (unit === null) {
      const again = await ask("Say the amount again. Only the number.");
      if (again === null) return endAssistant("Stopped");
      unit = parseNumberOnly(again);
    }
    if (unit !== null) {
      if (qtyN > 1) {
        const t = await ask(unit + " naira — is that the price of EACH one, or the TOTAL for all " + qtyN + "?");
        if (t === null) return endAssistant("Stopped");
        if (/each|per|apiece/.test((t || "").toLowerCase())) parsed.amount = Math.round(unit * qtyN * 100) / 100;
        else parsed.amount = unit;
      } else parsed.amount = unit;
      document.getElementById("saleAmount").value = parsed.amount;
    } else prefillAmount();
  } else if (qtyN > 1) {
    const t = await ask("You said " + parsed.amount + " naira. Is that the TOTAL for " + qtyN + ", or the price of EACH one?");
    if (t === null) return endAssistant("Stopped");
    if (/each|per|apiece/.test((t || "").toLowerCase())) {
      parsed.amount = Math.round(parsed.amount * qtyN * 100) / 100;
    }
    document.getElementById("saleAmount").value = parsed.amount;
  }

  // 6) final confirm
  let conf = await ask("Let me confirm. " + describeCurrentSale() + ". Is that correct? Say yes, or say the correction.");
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
      const vr = await submitWrite("/api/stores/" + storeId + "/sales", "POST", {
        productId: val("saleProduct"),
        qty: Number(val("saleQty")),
        amount: val("saleAmount") === "" ? undefined : Number(val("saleAmount")),
        worker: name });
      speak(vr.queued ? "No network. I saved it on this phone. It will send when network returns." : "Sale saved! Thank you, " + name + ". Goodbye.");
      const status = document.getElementById("voiceStatus");
      if (status) status.innerHTML = '<div class="msg msg-ok">\u2705 Sale saved by ' + ASSISTANT_NAME + ': ' + esc(describeCurrentSale()) + '</div>';
      assistantActive = false;
      setTimeout(() => renderStore(storeId, "sale", "Sale saved \u2705"), 1600);
      return;
    } catch (e) {
      speak("Sorry, saving failed.");
      return endAssistant("Error: " + e.message);
    }
  }
  speak("No problem. Please check the details on the screen, then press Save sale. Goodbye.");
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
const smartDate = (iso) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString();
};
const smartTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const smartDateTime = (iso) => smartDate(iso) + " " + smartTime(iso);
const dayDate = (iso) => new Date(iso).toLocaleDateString();
const sellerName = (id) => localStorage.getItem("seller_" + id) || "";
const val = (x) => ((document.getElementById(x) || {}).value ?? "");

const purchaseLine = (p) => (p.purchases || [])
  .map((b) => `${smartDate(b.date)}: ${fmtQty(b.qty)} @ ${money(b.costPrice)}${b.supplier ? " from " + esc(b.supplier) : ""}`)
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
const NUMRE = "(?:\\d+(?:\\.\\d+)?|" + Object.keys(NUMWORDS).sort((a, b) => b.length - a.length).join("|") + ")";
const NUMANY = "(?:" + NUMRE + "|thousand|hundred)";

function spokenNumber(str) {
  const tokens = String(str).toLowerCase().trim().split(/\s+/).filter((t) => t && t !== "and" && t !== "a" && t !== "an");
  let total = 0, cur = 0, has = false, afterThousand = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], next = tokens[i + 1];
    if (t === "thousand") { cur = (cur || 1) * 1000; total += cur; cur = 0; has = true; afterThousand = true; }
    else if (t === "hundred") { cur = (cur || 1) * 100; has = true; }
    else if (NUMWORDS[t] !== undefined) {
      const v = NUMWORDS[t];
      if (afterThousand && v > 0 && v < 100 && next !== "hundred") cur += v * 100;
      else cur += v;
      has = true;
    }
    else if (/^\d+(\.\d+)?$/.test(t)) { cur += parseFloat(t); has = true; }
  }
  return has ? total + cur : null;
}

// Parse "sold 2 and a half yards of ankara for nine thousand naira"
function parseSpokenSale(text, products) {
  const lower = " " + String(text).replace(/(\d),(\d)/g, "$1$2").toLowerCase().replace(/[?!.,]/g, " ") + " ";
  const units = "(yards?|yds?|litres?|liters?|pieces?|pcs?|packs?|bottles?|wraps?|rolls?|meters?|metres?)";
  let qty = null;
  const qm = lower.match(new RegExp("(" + NUMRE + "(?:\\s+and\\s+(?:a\\s+)?half)?)\\s*" + units));
  if (qm) qty = spokenNumber(qm[1]);
  if (qty === null) {
    const digitGroups = [...lower.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
    if (digitGroups.length >= 2) qty = parseFloat(digitGroups[0]);
  }
  let amount = null;
  const amountM = lower.match(new RegExp("(" + NUMRE + "(?:\\s+" + NUMANY + ")*)\\s*(?:naira|ngn|₦)"));
  if (amountM) amount = spokenNumber(amountM[1]);
  if (amount === null) {
    const forM = lower.match(/(?:for|at|price)\s+([a-z0-9\s]+?)(?:\s+naira)?$/);
    if (forM) amount = spokenNumber(forM[1]);
  }
  let firstGroup = null, lastGroup = null;
  {
    const groups = [...lower.matchAll(new RegExp("(" + NUMRE + "(?:\\s+(?:" + NUMRE + "|thousand|hundred))*)", "g"))].map((m) => m[1]);
    firstGroup = groups[0] || null;
    lastGroup = groups.length ? groups[groups.length - 1] : null;
  }

  let best = null, bestScore = 0;
  for (const p of products) {
    const words = String(p.name).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    let score = 0;
    for (const w of words) { if (lower.includes(w)) score++; }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (qty === null && amount === null && firstGroup && firstGroup === lastGroup) {
    const numPos = lower.indexOf(firstGroup.trim().split(/\s+/)[0]);
    const prodWords = best ? String(best.name).toLowerCase().split(/\s+/).filter((w) => w.length > 2) : [];
    const prodPos = prodWords.length ? lower.indexOf(prodWords[0]) : -1;
    if (best && prodPos >= 0 && numPos >= 0 && numPos < prodPos) qty = spokenNumber(firstGroup);
    else amount = spokenNumber(firstGroup);
  } else if (amount === null && lastGroup) {
    let cand = lastGroup;
    if (qty !== null && spokenNumber(cand) === qty) cand = firstGroup !== lastGroup ? firstGroup : null;
    if (qty === null && firstGroup && /^\d/.test(firstGroup.trim())) qty = spokenNumber(firstGroup);
    amount = cand ? spokenNumber(cand) : amount;
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
      <span data-outbox-badge class="badge badge-low" style="display:${outbox.length ? "" : "none"}">📶 ${outbox.length} queued</span>
      <div>
        ${ownerToken ? `<button class="btn btn-primary" onclick="renderReport()">📰 Report</button>
        <button class="btn btn-green" onclick="showAddStore()">+ Add Store</button>
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
  let d, offline = false;
  try {
    d = await api(`/api/stores/${id}`);
    storeCache[id] = d;
    try { localStorage.setItem("cnuo_cache_" + id, JSON.stringify(d)); } catch (e) {}
    setTimeout(syncOutbox, 300);
  } catch (e) {
    if (!navigator.onLine && storeCache[id]) { d = storeCache[id]; offline = true; }
    else { clearStoreLogin(); return openStore(id, "this store"); }
  }
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
  const debtCustomers = [...new Set([...(d.debts || []).map((x) => x.customer), ...((d.debtsPaid) || []).map((x) => x.customer)])];
  const dlCustomers = `<datalist id="dl-customers">${debtCustomers.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;

  const photoCell = (p) => p.hasPhoto
    ? `<img class="thumb" data-pid="${p.id}" style="display:none">`
    : "";

  const productRow = (p, ownerView) => `<tr>
    <td>${photoCell(p)}</td>
    <td><b>${esc(p.name)}</b><br>
      <span class="small">added: ${p.createdAt ? smartDate(p.createdAt) : "—"} · cost: ${money(p.costPrice)}</span><br>
      <span class="small" style="color:#555">📥 ${purchaseLine(p) || "no purchase records"}</span></td>
    <td>${fmtQty(p.qtyArrived)}</td><td>${fmtQty(p.sold)}</td><td><b>${fmtQty(p.remaining)}</b></td>
    <td>${badge(p.status)}</td><td>${money(p.sellPrice)}</td>
    ${ownerView ? `<td><button class="btn btn-gray" onclick="startEdit('${p.id}','${id}')">✏️ Edit / +Stock</button>
        <button class="btn btn-red" onclick="doDeleteProduct('${id}','${p.id}')">✕</button></td>` : ""}
  </tr>`;

  const cached = getCachedPhoto(editingProduct || "");
  const editForm = (p) => `<div class="card" style="border:2px solid #1F4E79">
    <h2>✏️ Edit: ${esc(p.name)}</h2>
    <p class="small">Created on <b>${p.createdAt ? smartDate(p.createdAt) : "—"}</b> — this date never changes.</p>
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
      ${dlProducts}${dlSuppliers}${dlCustomers}
      ${msg ? `<div class="msg msg-ok">${esc(msg)}</div>` : ""}
      ${offline ? `<div class="msg msg-error">📶 OFFLINE — showing last saved data. Sales will queue on this phone.</div>` : ""}
      <span data-outbox-badge class="badge badge-low" style="display:${outbox.length ? "" : "none"}">📶 ${outbox.length} queued</span>
      ${sellerName(id) ? `<div class="card" style="padding:10px 14px;margin:0 0 10px 0">👤 Selling today: <b>${esc(sellerName(id))}</b></div>` : ""}
      ${d.totals.alerts > 0 ? `<div class="msg msg-error">⚠️ ${d.totals.alerts} product(s) finished or low on stock!</div>` : ""}

      <h2 style="margin-top:10px">📊 All-time money</h2>
      <div class="stat-row">
        <div class="stat"><div class="num">${money(d.totals.totalIn)}</div><div class="lbl">💰 All-time SOLD</div></div>
        <div class="stat"><div class="num">${money(d.totals.spent)}</div><div class="lbl">🛒 SPENT on goods</div></div>
        <div class="stat"><div class="num">${money(d.expensesTotal || 0)}</div><div class="lbl">💸 EXPENSES</div></div>
        <div class="stat"><div class="num">${money(d.owedTotal || 0)}</div><div class="lbl">🧾 OWED to you</div></div>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="num" style="color:${(d.totals.profit || 0) >= 0 ? "#2e7d32" : "#c62828"}">${money(d.totals.profit)}</div><div class="lbl">✅ NET PROFIT (after expenses)</div></div>
        <div class="stat"><div class="num">${money(d.totals.stockValue)}</div><div class="lbl">📦 Money in stock</div></div>
        <div class="stat"><div class="num">${d.totals.count}</div><div class="lbl">All-time sales</div></div>
        <div class="stat"><div class="num">${(d.debts || []).length}</div><div class="lbl">Unpaid debts</div></div>
      </div>

      <h2>📅 Today</h2>
      <div class="stat-row">
        <div class="stat"><div class="num">${money(tMoney)}</div><div class="lbl">Today's money</div></div>
        <div class="stat"><div class="num">${money(tProfit)}</div><div class="lbl">Today's profit</div></div>
        <div class="stat"><div class="num">${tSales.length}</div><div class="lbl">Today's sales</div></div>
        <div class="stat"><div class="num">${money(d.posChargesToday || 0)}</div><div class="lbl">💳 POS charges</div></div>
      </div>

      <div class="tabs">
        <div class="tab ${tab === "sale" ? "active" : ""}" onclick="renderStore('${id}','sale')">➕ Record sale</div>
        <div class="tab ${tab === "stock" ? "active" : ""}" onclick="renderStore('${id}','stock')">📦 Stock</div>
        <div class="tab ${tab === "log" ? "active" : ""}" onclick="renderStore('${id}','log')">📋 Sales log</div>
        <div class="tab ${tab === "debts" ? "active" : ""}" onclick="renderStore('${id}','debts')">🧾 Debts</div>
        <div class="tab ${tab === "close" ? "active" : ""}" onclick="renderStore('${id}','close')">🔒 Close day</div>
        <div class="tab ${tab === "day" ? "active" : ""}" onclick="renderStore('${id}','day')">📅 Day view</div>
        <div class="tab ${tab === "pos" ? "active" : ""}" onclick="renderStore('${id}','pos')">💳 POS</div>
        <div class="tab ${tab === "notes" ? "active" : ""}" onclick="renderStore('${id}','notes')">📣 Notes</div>
        ${d.isOwner ? `<div class="tab ${tab === "customers" ? "active" : ""}" onclick="renderStore('${id}','customers')">👗 Customers</div>` : ""}
        ${d.isOwner ? `<div class="tab ${tab === "expenses" ? "active" : ""}" onclick="renderStore('${id}','expenses')">💸 Expenses</div>` : ""}
        ${d.isOwner ? `<div class="tab ${tab === "fixes" ? "active" : ""}" onclick="renderStore('${id}','fixes')">🛠 Corrections</div>` : ""}
        ${d.isOwner ? `<div class="tab ${tab === "settings" ? "active" : ""}" onclick="renderStore('${id}','settings')">⚙️ Settings</div>` : ""}
      </div>

      <div class="section ${tab === "sale" ? "active" : ""}"><div class="card">
        <h2>Record a sale</h2>
        <div id="saleMsg"></div>
        ${VOICE_SUPPORTED ? `
                <button class="btn btn-primary btn-block" onclick="voiceAssistant('${id}')">\u{1F3A4} ${ASSISTANT_NAME.toUpperCase()}</button>
        <div id="voiceStatus" class="small" style="margin:6px 0;color:#1F4E79;font-weight:600">Tap to talk \u2014 or type below</div>
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
            <td class="small">${smartDateTime(s.date)}</td><td>${esc(s.productName)}</td>
            <td>${fmtQty(s.qty)}</td><td>${money(s.amount)}</td>
            <td style="color:#2e7d32"><b>${money(s.amount - s.qty * (s.costPrice || 0))}</b></td>
            <td>${esc(s.worker || "—")}</td>
            ${d.isOwner ? `<td><button class="btn btn-red" onclick="doDeleteSale('${id}','${s.id}')">✕</button></td>` : ""}
          </tr>`).join("")}
        </table></div>
        ${d.isOwner ? `<p class="small">✕ = remove a mistaken entry (owner only — reason recorded)</p>` : ""}`}
      </div></div>

      <div class="section ${tab === "debts" ? "active" : ""}"><div class="card">
        <h2>🧾 Debt Book (sell now, pay later)</h2>
        <div class="stat" style="margin-bottom:8px"><div class="num">${money(d.owedTotal || 0)}</div><div class="lbl">Total owed to you</div></div>
        <div id="debtMsg"></div>
        <label>Customer name</label><input id="dbCustomer" list="dl-customers" placeholder="Who is taking the goods?" />
        <label>Amount (naira)</label><input id="dbAmount" type="number" min="1" step="any" />
        <label>Note - what did they take? (optional)</label><input id="dbNote" placeholder="e.g. 2 yards ankara" />
        <button class="btn btn-primary btn-block" onclick="doAddDebt('${id}')">🧾 Record debt</button>
        <hr style="margin:14px 0">
        ${(d.debts || []).length === 0 ? "<p>No unpaid debts. ✅</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th>Customer</th><th>Amount</th><th>Note</th><th>Date</th><th>By</th><th></th></tr>
          ${d.debts.map((x) => `<tr>
            <td><b>${esc(x.customer)}</b></td><td>${money(x.amount)}</td>
            <td class="small">${esc(x.note || "—")}</td>
            <td class="small">${smartDateTime(x.date)}</td><td>${esc(x.worker || "—")}</td>
            <td><button class="btn btn-green" onclick="doPayDebt('${id}','${x.id}')">✅ Paid</button>
            ${d.isOwner ? `<button class="btn btn-red" onclick="doDeleteDebt('${id}','${x.id}')">✕</button>` : ""}</td>
          </tr>`).join("")}
        </table></div>`}
        ${d.isOwner && (d.debtsPaid || []).length ? `<hr style="margin:14px 0"><p class="small"><b>Paid debts (recent):</b></p>
        <div style="overflow-x:auto"><table>
          <tr><th>Customer</th><th>Amount</th><th>Paid on</th><th></th></tr>
          ${d.debtsPaid.slice(0, 20).map((x) => `<tr>
            <td>${esc(x.customer)}</td><td>${money(x.amount)}</td>
            <td class="small">${x.paidDate ? smartDateTime(x.paidDate) : "—"} by ${esc(x.paidBy || "—")}</td>
            <td><button class="btn btn-red" onclick="doDeleteDebt('${id}','${x.id}')">✕</button></td>
          </tr>`).join("")}
        </table></div>` : ""}
      </div></div>

      <div class="section ${tab === "close" ? "active" : ""}"><div class="card">
        <h2>🔒 Close the day</h2>
        <p class="small">Count the physical cash in the drawer. The system expects <b>${money(tMoney)}</b> from today's sales.</p>
        <div id="closeMsg"></div>
        <label>How much cash did you count?</label>
        <input id="closeCounted" type="number" min="0" step="any" />
        <button class="btn btn-primary btn-block" onclick="doClosing('${id}')">🔒 Save closing</button>
        ${d.isOwner && (d.closings || []).length ? `<hr style="margin:14px 0"><p class="small"><b>Closing history:</b></p>
        <div style="overflow-x:auto"><table>
          <tr><th>Date</th><th>Expected</th><th>Counted</th><th>Difference</th><th>By</th></tr>
          ${d.closings.map((c) => `<tr>
            <td class="small">${smartDate(c.day + "T12:00:00")}</td><td>${money(c.expected)}</td><td>${money(c.counted)}</td>
            <td style="color:${c.difference === 0 ? "#2e7d32" : "#c62828"};font-weight:700">${money(c.difference)}</td>
            <td>${esc(c.worker || "—")}</td>
          </tr>`).join("")}
        </table></div>` : ""}
      </div></div>

      ${d.isOwner ? `<div class="section ${tab === "expenses" ? "active" : ""}"><div class="card">
        <h2>💸 Expenses (owner only)</h2>
        <p class="small">Money spent that is NOT buying goods: transport, fuel, rent, packaging...</p>
        <div id="expMsg"></div>
        <label>Amount (naira)</label><input id="expAmount" type="number" min="1" step="any" />
        <label>Reason</label><input id="expReason" placeholder="e.g. Transport to Balogun market" />
        <button class="btn btn-primary btn-block" onclick="doAddExpense('${id}')">💾 Save expense</button>
        <hr style="margin:14px 0">
        <p><b>Total expenses: ${money(d.expensesTotal || 0)}</b></p>
        ${(d.expenses || []).length === 0 ? "<p>No expenses yet.</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th>Date</th><th>Reason</th><th>Amount</th><th></th></tr>
          ${d.expenses.map((e) => `<tr>
            <td class="small">${fmtDate(e.date)}</td><td>${esc(e.reason)}</td><td>${money(e.amount)}</td>
            <td><button class="btn btn-red" onclick="doDeleteExpense('${id}','${e.id}')">✕</button></td>
          </tr>`).join("")}
        </table></div>`}
      </div></div>` : ""}

      <div class="section ${tab === "notes" ? "active" : ""}"><div class="card">
        <h2>📣 Notes to the owner</h2>
        <p class="small">Staff: report anything - price changes, problems, requests. The owner reads these.</p>
        <div id="noteMsg"></div>
        <label>Your message (or tap the mic to speak it)</label>
        <textarea id="noteText" rows="2" style="width:100%;padding:10px;border:1px solid #bbb;border-radius:8px"></textarea>
        <button class="btn btn-gray btn-block" onclick="voiceFill('noteText','noteVoiceStatus')">🎤 Speak the note</button>
        <div id="noteVoiceStatus" class="small"></div>
        <button class="btn btn-primary btn-block" onclick="doAddNote('${id}')">📣 Send to owner</button>
        ${d.isOwner ? `${(d.notes || []).length === 0 ? `<hr style="margin:14px 0"><p>No notes. ✅</p>` : `
        <hr style="margin:14px 0">
        <div style="overflow-x:auto"><table>
          <tr><th>Date</th><th>Message</th><th>From</th><th></th></tr>
          ${d.notes.map((n) => `<tr style="${n.heard ? "opacity:0.55" : ""}">
            <td class="small">${smartDateTime(n.date)}</td>
            <td><b>${esc(n.text)}</b>${n.heard ? `<br><span class="small">✔ reviewed</span>` : ""}</td>
            <td>${esc(n.worker || "—")}</td>
            <td>${n.heard ? "" : `<button class="btn btn-green" onclick="doMarkNote('${id}','${n.id}')">✔ Done</button>`}
                <button class="btn btn-red" onclick="doDeleteNote('${id}','${n.id}')">✕</button></td>
          </tr>`).join("")}
        </table></div>`}` : ""}
      </div></div>

      ${d.isOwner ? `<div class="section ${tab === "customers" ? "active" : ""}"><div class="card">
        <h2>👗 Customer measurements book</h2>
        <div id="custMsg"></div>
        <label>Customer name</label><input id="cName" placeholder="e.g. Mama Ngozi" />
        <label>Phone (optional)</label><input id="cPhone" placeholder="080..." />
        <div class="stat-row" style="margin:4px 0">
          <div><label>Bust/Chest</label><input id="cBust" placeholder="36" style="margin:2px 0" /></div>
          <div><label>Waist</label><input id="cWaist" placeholder="32" style="margin:2px 0" /></div>
          <div><label>Hip</label><input id="cHip" placeholder="40" style="margin:2px 0" /></div>
          <div><label>Shoulder</label><input id="cShoulder" placeholder="16" style="margin:2px 0" /></div>
          <div><label>Length</label><input id="cLength" placeholder="41" style="margin:2px 0" /></div>
        </div>
        <label>Notes (style, fabric preference...)</label><input id="cNotes" placeholder="e.g. prefers ankara, A-line" />
        <button class="btn btn-primary btn-block" onclick="doAddCustomer('${id}')">💾 Save customer</button>
        <hr style="margin:14px 0">
        ${(d.customers || []).length === 0 ? "<p>No customers yet.</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th>Name</th><th>Phone</th><th>B</th><th>W</th><th>H</th><th>Sh</th><th>L</th><th>Notes</th><th></th></tr>
          ${d.customers.map((c) => `<tr>
            <td><b>${esc(c.name)}</b></td><td class="small">${esc(c.phone || "—")}</td>
            <td>${esc(c.bust || "—")}</td><td>${esc(c.waist || "—")}</td><td>${esc(c.hip || "—")}</td>
            <td>${esc(c.shoulder || "—")}</td><td>${esc(c.length || "—")}</td>
            <td class="small">${esc(c.notes || "—")}</td>
            <td><button class="btn btn-red" onclick="doDeleteCustomer('${id}','${c.id}')">✕</button></td>
          </tr>`).join("")}
        </table></div>`}
      </div></div>` : ""}

      <div class="section ${tab === "day" ? "active" : ""}"><div class="card">
        <h2>📅 Day view — everything that happened</h2>
        <label>Pick a date</label>
        <input type="date" id="dayInput" value="${new Date().toISOString().slice(0, 10)}" onchange="loadDay('${id}')" />
        <div id="dayResults"></div>
      </div></div>

      <div class="section ${tab === "pos" ? "active" : ""}"><div class="card">
        <h2>💳 POS transactions</h2>
        <p class="small"><b>WITHDRAW</b> = you give the person cash. <b>TRANSFER</b> = the person gives you cash, you send to their account.</p>
        <div id="posMsg"></div>
        <label>Type</label>
        <select id="posType" onchange="posPreview()">
          <option value="WITHDRAW">WITHDRAW — give cash</option>
          <option value="TRANSFER">TRANSFER — receive cash, send to account</option>
        </select>
        <label>Amount (the person's money)</label>
        <input id="posAmount" type="number" min="1" step="any" oninput="posPreview()" />
        <label>Charge (your fee)</label>
        <input id="posCharge" type="number" min="0" step="any" value="0" oninput="posPreview()" />
        <div id="posPreview" class="small" style="background:#e8f0fe;padding:10px;border-radius:8px;margin:6px 0">Type the amount to see the calculation.</div>
        <label>Note (optional — customer name / account)</label>
        <input id="posNote" placeholder="e.g. Mama B / GTB" />
        <button class="btn btn-primary btn-block" onclick="doAddPos('${id}')">💳 Save transaction</button>
        <hr style="margin:14px 0">
        <p><b>POS charges today: ${money(d.posChargesToday || 0)}</b> · All-time charges: ${money(d.posChargesAll || 0)}</p>
        ${(d.posToday || []).length === 0 ? "<p>No POS transactions today.</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th>Time</th><th>Type</th><th>Amount</th><th>Charge</th><th>Note</th><th>By</th><th></th></tr>
          ${d.posToday.map((x) => `<tr>
            <td class="small">${smartTime(x.date)}</td>
            <td><b>${x.type === "WITHDRAW" ? "💸 Withdraw" : "💰 Transfer"}</b></td>
            <td>${money(x.amount)}</td>
            <td style="color:#2e7d32"><b>${money(x.charge)}</b></td>
            <td class="small">${esc(x.note || "—")}</td>
            <td>${esc(x.worker || "—")}</td>
            <td>${d.isOwner ? `<button class="btn btn-red" onclick="doDeletePos('${id}','${x.id}')">✕</button>` : ""}</td>
          </tr>`).join("")}
        </table></div>`}
      </div></div>

      ${d.isOwner ? `<div class="section ${tab === "fixes" ? "active" : ""}"><div class="card">
        <h2>🛠 Corrections log (owner only)</h2>
        ${(d.corrections || []).length === 0 ? "<p>No corrections yet. ✅</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th>Date & time</th><th>Action</th><th>Details</th><th>Reason</th><th>By</th></tr>
          ${(d.corrections || []).map((c) => `<tr>
            <td class="small">${smartDateTime(c.date)}</td>
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

  updateOutboxBadge();
  if (tab === "day") setTimeout(() => loadDay(id), 60);
  if (tab === "pos") setTimeout(posPreview, 60);
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
    const r = await submitWrite(`/api/stores/${id}/sales`, "POST", {
      productId: val("saleProduct"),
      qty: Number(val("saleQty")),
      amount: val("saleAmount") === "" ? undefined : Number(val("saleAmount")),
      worker: sellerName(id) });
    saleSaving = false;
    renderStore(id, "sale", r.queued ? `📶 No network — sale saved on this phone (${outbox.length} queued). It will send automatically.` : "Sale saved ✅");
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

// ---------- DEBTS / EXPENSES / CLOSING ----------
async function doAddDebt(id) {
  try {
    const dr = await submitWrite(`/api/stores/${id}/debts`, "POST", {
      customer: val("dbCustomer"), amount: Number(val("dbAmount")),
      note: val("dbNote"), worker: sellerName(id) });
    renderStore(id, "debts", dr.queued ? `📶 No network — debt saved on this phone (${outbox.length} queued).` : "Debt recorded ✅ The owner can see it anytime.");
  } catch (e) { document.getElementById("debtMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
async function doPayDebt(id, did) {
  if (!confirm("Confirm: the customer has PAID this debt?")) return;
  try {
    const pr = await submitWrite(`/api/stores/${id}/debts/${did}/pay`, "PUT", { worker: sellerName(id) });
    renderStore(id, "debts", pr.queued ? "📶 No network — will mark as paid when network returns." : "Marked as paid ✅");
  } catch (e) { alert(e.message); }
}
async function doDeleteDebt(id, did) {
  const reason = prompt("Why are you removing this debt? (recorded in Corrections)");
  if (reason === null) return;
  if (!reason.trim()) { alert("A reason is required."); return; }
  if (!confirm("Remove this debt entry?")) return;
  try {
    await api(`/api/stores/${id}/debts/${did}`, { method: "DELETE", body: JSON.stringify({ reason: reason.trim() }) });
    renderStore(id, "debts", "Debt removed ✅ Reason recorded.");
  } catch (e) { alert(e.message); }
}
async function doAddExpense(id) {
  try {
    await api(`/api/stores/${id}/expenses`, { method: "POST", body: JSON.stringify({
      amount: Number(val("expAmount")), reason: val("expReason") }) });
    renderStore(id, "expenses", "Expense saved ✅");
  } catch (e) { document.getElementById("expMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
async function doDeleteExpense(id, eid) {
  const reason = prompt("Why are you removing this expense? (recorded in Corrections)");
  if (reason === null) return;
  if (!reason.trim()) { alert("A reason is required."); return; }
  if (!confirm("Remove this expense?")) return;
  try {
    await api(`/api/stores/${id}/expenses/${eid}`, { method: "DELETE", body: JSON.stringify({ reason: reason.trim() }) });
    renderStore(id, "expenses", "Expense removed ✅");
  } catch (e) { alert(e.message); }
}
async function doClosing(id) {
  const counted = val("closeCounted");
  if (counted === "" || isNaN(Number(counted))) { alert("Type the cash you counted."); return; }
  try {
    const r = await api(`/api/stores/${id}/closing`, { method: "POST", body: JSON.stringify({
      counted: Number(counted), worker: sellerName(id) }) });
    const diff = r.difference;
    const msg = diff === 0
      ? `Closing saved: counted ${money(r.counted)} = expected ✅ Perfect.`
      : `Closing saved: counted ${money(r.counted)}, expected ${money(r.expected)} — DIFFERENCE ${diff > 0 ? "+" : ""}${money(diff)} (owner notified in history)`;
    renderStore(id, "close", msg);
  } catch (e) { document.getElementById("closeMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}

// ---------- POS ----------
function posPreview() {
  const box = document.getElementById("posPreview");
  if (!box) return;
  const a = Number(val("posAmount") || 0);
  const c = Number(val("posCharge") || 0);
  const type = val("posType");
  if (!a) { box.textContent = "Type the amount to see the calculation."; return; }
  box.innerHTML = type === "WITHDRAW"
    ? `You give <b>${money(a)}</b> cash to the customer · customer pays you <b>${money(a + c)}</b> · <b style="color:#2e7d32">you earn ${money(c)}</b><br><span class="small">Drawer: -${money(a)} cash</span>`
    : `Customer gives you <b>${money(a + c)}</b> cash · you transfer <b>${money(a)}</b> to their account · <b style="color:#2e7d32">you earn ${money(c)}</b><br><span class="small">Drawer: +${money(a + c)} cash</span>`;
}
async function doAddPos(id) {
  try {
    const r = await submitWrite(`/api/stores/${id}/pos`, "POST", {
      type: val("posType"), amount: Number(val("posAmount")),
      charge: Number(val("posCharge") || 0), note: val("posNote"), worker: sellerName(id) });
    renderStore(id, "pos", r.queued ? `📶 No network — saved on this phone (${outbox.length} queued).` : `💳 POS saved — total ${money(r.total || 0)} ✅`);
  } catch (e) { document.getElementById("posMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
async function doDeletePos(id, pid) {
  const reason = prompt("Why are you removing this POS entry? (recorded in Corrections)");
  if (reason === null) return;
  if (!reason.trim()) { alert("A reason is required."); return; }
  if (!confirm("Remove this POS entry?")) return;
  try {
    await api(`/api/stores/${id}/pos/${pid}`, { method: "DELETE", body: JSON.stringify({ reason: reason.trim() }) });
    renderStore(id, "pos", "POS entry removed ✅");
  } catch (e) { alert(e.message); }
}

// ---------- DAY VIEW ----------
async function loadDay(id) {
  const box = document.getElementById("dayResults");
  if (!box) return;
  const d = (document.getElementById("dayInput") || {}).value;
  if (!d) { box.innerHTML = "<p>Pick a date.</p>"; return; }
  box.innerHTML = '<p class="small">Loading...</p>';
  let r;
  try { r = await api(`/api/stores/${id}/day?d=${d}`); }
  catch (e) { box.innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; return; }
  const t = r.totals;
  const nothing = !r.sales.length && !r.debtsAdded.length && !r.debtsPaid.length && !r.expenses.length && !r.closings.length && !r.corrections.length && !(r.pos || []).length;
  let h = `<h3 style="margin-top:14px">${esc(smartDate(r.day + "T12:00:00"))} — summary</h3>
    <div class="stat-row">
      <div class="stat"><div class="num">${money(t.money)}</div><div class="lbl">Money in</div></div>
      <div class="stat"><div class="num">${money(t.profit)}</div><div class="lbl">Profit</div></div>
      <div class="stat"><div class="num">${money(t.expensesTotal)}</div><div class="lbl">Expenses</div></div>
      <div class="stat"><div class="num">${r.sales.length}</div><div class="lbl">Sales</div></div>
    </div>`;
  if (nothing) { h += "<p>Nothing was recorded on this day.</p>"; box.innerHTML = h; return; }
  if (r.sales.length) h += `<h3 style="margin-top:12px">Sales (${r.sales.length})</h3>
    <div style="overflow-x:auto"><table>
      <tr><th>Time</th><th>Product</th><th>Qty</th><th>Amount</th><th>Profit</th><th>By</th></tr>
      ${r.sales.map((s) => `<tr><td class="small">${smartTime(s.date)}</td><td>${esc(s.productName)}</td>
        <td>${fmtQty(s.qty)}</td><td>${money(s.amount)}</td>
        <td style="color:${(s.amount - s.qty * (s.costPrice || 0)) >= 0 ? "#2e7d32" : "#c62828"}"><b>${money(s.amount - s.qty * (s.costPrice || 0))}</b></td>
        <td>${esc(s.worker || "—")}</td></tr>`).join("")}
    </table></div>`;
  if (r.debtsAdded.length) h += `<h3 style="margin-top:12px">🧾 Debts added (${money(t.debtsAddedTotal)})</h3>
    <div style="overflow-x:auto"><table>
      <tr><th>Customer</th><th>Amount</th><th>Note</th><th>By</th></tr>
      ${r.debtsAdded.map((x) => `<tr><td><b>${esc(x.customer)}</b></td><td>${money(x.amount)}</td>
        <td class="small">${esc(x.note || "—")}</td><td>${esc(x.worker || "—")}</td></tr>`).join("")}
    </table></div>`;
  if (r.debtsPaid.length) h += `<h3 style="margin-top:12px">✅ Debts paid (${money(t.debtsPaidTotal)})</h3>
    <div style="overflow-x:auto"><table>
      <tr><th>Customer</th><th>Amount</th><th>Paid by</th></tr>
      ${r.debtsPaid.map((x) => `<tr><td>${esc(x.customer)}</td><td>${money(x.amount)}</td><td>${esc(x.paidBy || "—")}</td></tr>`).join("")}
    </table></div>`;
  if (r.expenses.length) h += `<h3 style="margin-top:12px">💸 Expenses (${money(t.expensesTotal)})</h3>
    <div style="overflow-x:auto"><table>
      <tr><th>Reason</th><th>Amount</th></tr>
      ${r.expenses.map((e) => `<tr><td>${esc(e.reason)}</td><td>${money(e.amount)}</td></tr>`).join("")}
    </table></div>`;
  if ((r.pos || []).length) h += `<h3 style="margin-top:12px">💳 POS (${money(r.totals.posCharges)} charges · cash impact ${money(r.totals.posCash)})</h3>
    <div style="overflow-x:auto"><table>
      <tr><th>Time</th><th>Type</th><th>Amount</th><th>Charge</th><th>Note</th><th>By</th></tr>
      ${r.pos.map((x) => `<tr><td class="small">${smartTime(x.date)}</td>
        <td><b>${x.type === "WITHDRAW" ? "💸 Withdraw" : "💰 Transfer"}</b></td>
        <td>${money(x.amount)}</td><td style="color:#2e7d32"><b>${money(x.charge)}</b></td>
        <td class="small">${esc(x.note || "—")}</td><td>${esc(x.worker || "—")}</td></tr>`).join("")}
    </table></div>`;
  if (r.closings.length) h += `<h3 style="margin-top:12px">🔒 Closing</h3>
    <div style="overflow-x:auto"><table>
      <tr><th>Expected</th><th>Counted</th><th>Difference</th><th>By</th></tr>
      ${r.closings.map((c) => `<tr><td>${money(c.expected)}</td><td>${money(c.counted)}</td>
        <td style="color:${c.difference === 0 ? "#2e7d32" : "#c62828"};font-weight:700">${money(c.difference)}</td>
        <td>${esc(c.worker || "—")}</td></tr>`).join("")}
    </table></div>`;
  if (r.corrections.length) h += `<h3 style="margin-top:12px">🛠 Corrections (owner only)</h3>
    <div style="overflow-x:auto"><table>
      <tr><th>Time</th><th>Action</th><th>Details</th><th>Reason</th></tr>
      ${r.corrections.map((c) => `<tr><td class="small">${smartTime(c.date)}</td><td><b>${esc(c.type)}</b></td>
        <td class="small">${esc(c.details || "")}</td><td>${esc(c.reason)}</td></tr>`).join("")}
    </table></div>`;
  box.innerHTML = h;
}

// ---------- NOTES / CUSTOMERS / OWNER REPORT ----------
async function doAddNote(id) {
  try {
    const r = await submitWrite(`/api/stores/${id}/notes`, "POST", { text: val("noteText"), worker: sellerName(id) });
    renderStore(id, "notes", r.queued ? "📶 No network — note saved on this phone, will send." : "📣 Note sent to the owner ✅");
  } catch (e) { document.getElementById("noteMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
async function doMarkNote(id, nid) {
  try { await api(`/api/stores/${id}/notes/${nid}/heard`, { method: "PUT" }); renderStore(id, "notes", "Marked as reviewed ✅"); }
  catch (e) { alert(e.message); }
}
async function doDeleteNote(id, nid) {
  if (!confirm("Delete this note?")) return;
  try { await api(`/api/stores/${id}/notes/${nid}`, { method: "DELETE" }); renderStore(id, "notes", "Note deleted"); }
  catch (e) { alert(e.message); }
}
async function doAddCustomer(id) {
  try {
    await api(`/api/stores/${id}/customers`, { method: "POST", body: JSON.stringify({
      name: val("cName"), phone: val("cPhone"), bust: val("cBust"), waist: val("cWaist"),
      hip: val("cHip"), shoulder: val("cShoulder"), length: val("cLength"), notes: val("cNotes") }) });
    renderStore(id, "customers", "Customer saved ✅");
  } catch (e) { document.getElementById("custMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
async function doDeleteCustomer(id, cid) {
  if (!confirm("Delete this customer?")) return;
  try { await api(`/api/stores/${id}/customers/${cid}`, { method: "DELETE" }); renderStore(id, "customers", "Customer deleted"); }
  catch (e) { alert(e.message); }
}

// ---------- OWNER MORNING REPORT ----------
async function renderReport() {
  let r;
  try { r = await api("/api/owner/report"); }
  catch (e) { alert(e.message); return renderHome(); }
  const T = r.totals;
  app.innerHTML = `<div class="topbar"><h1>📰 Morning Report</h1>
      <div><button class="btn btn-green" onclick="renderReport()">🔄 Refresh</button>
      <button class="btn btn-gray" onclick="renderHome()">← My Stores</button></div></div>
    <div class="container">
      <p class="small">All your stores at a glance — ${new Date(r.today).toLocaleDateString()}</p>
      <div class="stat-row">
        <div class="stat"><div class="num">${money(T.todaySales)}</div><div class="lbl">💰 Sold today (all stores)</div></div>
        <div class="stat"><div class="num">${money(T.todayProfit)}</div><div class="lbl">Today's profit</div></div>
        <div class="stat"><div class="num">${T.todayCount}</div><div class="lbl">Sales today</div></div>
        <div class="stat"><div class="num">${money(T.yestSales)}</div><div class="lbl">Yesterday sold</div></div>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="num">${money(T.owed)}</div><div class="lbl">🧾 Total owed to you</div></div>
        <div class="stat"><div class="num">${money(T.debtsTodayTotal)}</div><div class="lbl">Debts added today</div></div>
        <div class="stat"><div class="num">${money(T.expensesToday)}</div><div class="lbl">💸 Expenses today</div></div>
        <div class="stat"><div class="num" style="color:${T.lowCount ? "#c62828" : "#2e7d32"}">${T.lowCount}</div><div class="lbl">Low/finished items</div></div>
      </div>
      ${T.openNotes ? `<div class="msg msg-error">📣 ${T.openNotes} unread note(s) from staff — open the stores to read them</div>` : ""}
      ${r.stores.map((s) => `<div class="card" style="border-left:6px solid ${esc(s.color)}">
        <h2>${esc(s.name)}</h2>
        <div class="stat-row">
          <div class="stat"><div class="num">${money(s.todaySales)}</div><div class="lbl">Sold today</div></div>
          <div class="stat"><div class="num">${money(s.todayProfit)}</div><div class="lbl">Profit today</div></div>
          <div class="stat"><div class="num">${money(s.owed)}</div><div class="lbl">Owed</div></div>
          <div class="stat"><div class="num">${s.todayCount}</div><div class="lbl">Sales</div></div>
        </div>
        <p class="small">
          🧾 ${s.debtsToday ? `Debts today: ${s.debtsToday} (${money(s.debtsTodayTotal)}) — ` : ""}
          💸 Expenses today: ${money(s.expensesToday)} ·
          ${s.lowCount ? `<span style="color:#c62828">⚠️ ${s.lowCount} low/finished</span> · ` : ""}
          ${s.openNotes ? `<span style="color:#c62828">📣 ${s.openNotes} unread note(s)</span> · ` : ""}
          💳 POS charges today: <b>${money(s.posChargesToday || 0)}</b> ·
          ${s.lastClosing ? `🔒 Last closing: counted ${money(s.lastClosing.counted)} vs ${money(s.lastClosing.expected)} → <b style="color:${s.lastClosing.difference === 0 ? "#2e7d32" : "#c62828"}">${money(s.lastClosing.difference)}</b>` : "🔒 No closing yet"}
        </p>
      </div>`).join("")}
    </div>`;
}

// ================= START =================
if (!API) renderSetup();
else renderHome();

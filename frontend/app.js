// ===== MY STORES MANAGER — FRONTEND v2 =====
// Changes: staff name at login, today's totals, owner-only goods, data backup button
let API = localStorage.getItem("apiUrl") || "";
let ownerToken = localStorage.getItem("ownerToken") || "";
let storeToken = localStorage.getItem("storeToken") || "";
let storeId = localStorage.getItem("storeId") || "";
let selectedColor = "#1F4E79";

const app = document.getElementById("app");
const money = (n) => Number(n || 0).toLocaleString();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => { const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const sellerName = (id) => localStorage.getItem("seller_" + id) || "";

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (ownerToken) headers["x-owner-token"] = ownerToken;
  if (storeToken) headers["x-store-token"] = storeToken;
  const r = await fetch(API + path, { ...opts, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// ================= SETUP SCREEN (first visit) =================
function renderSetup(msg = "") {
  app.innerHTML = `<div class="container">
    <div class="topbar"><h1>🏪 My Stores Manager</h1></div>
    <div class="card">
      <h2>Welcome! One-time setup</h2>
      <p class="small">Paste the web address (URL) of your backend from Render.
      It looks like: https://my-stores.onrender.com</p>
      ${msg ? `<div class="msg msg-error">${esc(msg)}</div>` : ""}
      <label>Backend URL from Render</label>
      <input id="setupUrl" placeholder="https://your-app.onrender.com" />
      <button class="btn btn-primary btn-block" onclick="saveSetup()">Save & Continue</button>
    </div></div>`;
}
async function saveSetup() {
  let url = document.getElementById("setupUrl").value.trim().replace(/\/+$/, "");
  if (!url) return;
  localStorage.setItem("apiUrl", url);
  API = url;
  try { await api("/api/stores"); renderHome(); }
  catch (e) { renderSetup("Cannot reach that address. Check it and try again."); }
}

// ================= HOME: all stores =================
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
        <p class="small">Click a store and enter its password to open it. Owner login is for adding stores and seeing everything.</p>
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

// ---- owner login ----
function showOwnerLogin() {
  document.getElementById("homeMain").style.display = "none";
  document.getElementById("homeForm").innerHTML = `<div class="card">
    <h2>Owner login</h2>
    <div id="ofMsg"></div>
    <label>Owner password</label><input id="ofPass" type="password" />
    <button class="btn btn-primary btn-block" onclick="doOwnerLogin()">Login</button>
    <button class="btn btn-gray btn-block" onclick="renderHome()">Cancel</button>
    <p class="small">First time? Default password is <b>owner123</b>. Change it after login (Settings).</p>
  </div>`;
}
async function doOwnerLogin() {
  try {
    const r = await api("/api/owner/login", { method: "POST",
      body: JSON.stringify({ password: document.getElementById("ofPass").value }) });
    ownerToken = r.token; localStorage.setItem("ownerToken", ownerToken);
    renderHome();
  } catch (e) { document.getElementById("ofMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
function logoutOwner() { ownerToken = ""; localStorage.removeItem("ownerToken"); renderHome(); }

// ---- add store ----
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
      name: document.getElementById("asName").value,
      registeredName: document.getElementById("asReg").value,
      password: document.getElementById("asPass").value,
      color: selectedColor }) });
    renderHome("Store created ✅ Share its name + password with the worker.");
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
      <label>Your name (who is selling today)</label>
      <input id="slName" placeholder="e.g. Ada" value="${esc(sellerName(id))}" />
      <label>Password</label><input id="slPass" type="password" />
      <button class="btn btn-primary btn-block" onclick="doStoreLogin('${id}')">Open store & start selling</button>
      <p class="small">Type your name every day you sell — all your sales will carry your name and the real date.</p>
    </div></div>`;
}
async function doStoreLogin(id) {
  try {
    const r = await api(`/api/stores/${id}/login`, { method: "POST",
      body: JSON.stringify({ password: document.getElementById("slPass").value }) });
    storeToken = r.token; localStorage.setItem("storeToken", storeToken);
    const nm = (document.getElementById("slName") || {}).value || "";
    if (nm.trim()) localStorage.setItem("seller_" + id, nm.trim());
    renderStore(id);
  } catch (e) { document.getElementById("slMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
function clearStoreLogin() { storeToken = ""; storeId = "";
  localStorage.removeItem("storeToken"); localStorage.removeItem("storeId"); }

async function renderStore(id, tab = "sale", msg = "") {
  let d;
  try { d = await api(`/api/stores/${id}`); }
  catch (e) { clearStoreLogin(); return openStore(id, "this store"); }
  const badge = (s) => s === "FINISHED" ? `<span class="badge badge-fin">FINISHED</span>`
    : s === "LOW STOCK" ? `<span class="badge badge-low">LOW STOCK</span>`
    : `<span class="badge badge-ok">OK</span>`;

  // today's totals — calculated from the server's real dates
  const today = new Date().toDateString();
  const tSales = d.sales.filter((s) => new Date(s.date).toDateString() === today);
  const tMoney = tSales.reduce((a, s) => a + s.amount, 0);
  const tProfit = tSales.reduce((a, s) => a + s.profit, 0);

  app.innerHTML = `<div class="topbar" style="background:${esc(d.color)}">
      <h1>🏪 ${esc(d.name)}</h1>
      <button class="btn btn-gray" onclick="clearStoreLogin(); renderHome()">← All stores</button></div>
    <div class="container">
      ${msg ? `<div class="msg msg-ok">${esc(msg)}</div>` : ""}
      ${sellerName(id) ? `<div class="card" style="padding:10px 14px;margin:0 0 10px 0">👤 Selling today: <b>${esc(sellerName(id))}</b></div>` : ""}
      ${d.totals.alerts > 0 ? `<div class="msg msg-error">⚠️ ${d.totals.alerts} product(s) finished or low on stock!</div>` : ""}
      <div class="stat-row">
        <div class="stat"><div class="num">${money(tMoney)}</div><div class="lbl">Today's money</div></div>
        <div class="stat"><div class="num">${money(tProfit)}</div><div class="lbl">Today's profit</div></div>
        <div class="stat"><div class="num">${tSales.length}</div><div class="lbl">Today's sales</div></div>
        <div class="stat"><div class="num">${money(d.totals.totalIn)}</div><div class="lbl">All-time money</div></div>
      </div>
      <div class="tabs">
        <div class="tab ${tab === "sale" ? "active" : ""}" onclick="renderStore('${id}','sale')">➕ Record sale</div>
        <div class="tab ${tab === "stock" ? "active" : ""}" onclick="renderStore('${id}','stock')">📦 Stock</div>
        <div class="tab ${tab === "log" ? "active" : ""}" onclick="renderStore('${id}','log')">📋 Sales log</div>
        ${d.isOwner ? `<div class="tab ${tab === "settings" ? "active" : ""}" onclick="renderStore('${id}','settings')">⚙️ Settings</div>` : ""}
      </div>

      <div class="section ${tab === "sale" ? "active" : ""}"><div class="card">
        <h2>Record a sale</h2>
        <div id="saleMsg"></div>
        <label>Product</label>
        <select id="saleProduct" onchange="prefillAmount()">
          <option value="">-- choose product --</option>
          ${d.products.filter((p) => p.remaining > 0).map((p) =>
            `<option value="${p.id}" data-price="${p.sellPrice}" data-remain="${p.remaining}">
              ${esc(p.name)} (${p.remaining} left)</option>`).join("")}
        </select>
        <label>Quantity sold</label>
        <input id="saleQty" type="number" min="1" value="1" oninput="prefillAmount()" />
        <label>Amount received (auto-fills with your set price — change it if sold higher)</label>
        <input id="saleAmount" type="number" min="0" />
        <label>Worker name</label>
        <input id="saleWorker" value="${esc(sellerName(id))}" placeholder="Who made this sale?" />
        <button class="btn btn-green btn-block" onclick="doSale('${id}')">💾 Save sale</button>
      </div></div>

      <div class="section ${tab === "stock" ? "active" : ""}">
      ${d.isOwner ? `<div class="card">
        <h2>Stock</h2>
        ${d.products.length === 0 ? "<p>No products yet. Add your first goods below.</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th></th><th>Product</th><th>Arrived</th><th>Sold</th><th>Left</th><th>Status</th><th>Sell price</th><th></th></tr>
          ${d.products.map((p) => `<tr>
            <td>${p.photo ? `<img class="thumb" src="${p.photo}">` : ""}</td>
            <td><b>${esc(p.name)}</b><br><span class="small">cost: ${money(p.costPrice)}</span></td>
            <td>${p.qtyArrived}</td><td>${p.sold}</td><td><b>${p.remaining}</b></td>
            <td>${badge(p.status)}</td><td>${money(p.sellPrice)}</td>
            <td><button class="btn btn-gray" onclick="doRestock('${id}','${p.id}')">+ Stock</button>
                <button class="btn btn-red" onclick="doDeleteProduct('${id}','${p.id}')">✕</button></td>
          </tr>`).join("")}
        </table></div>`}
        <hr style="margin:16px 0">
        <h2>Add new goods (owner only)</h2>
        <div id="prodMsg"></div>
        <label>Product name</label><input id="pName" placeholder="e.g. Total 5W-30 engine oil" />
        <label>Photo (optional)</label><input id="pPhoto" type="file" accept="image/*" />
        <label>Quantity arrived</label><input id="pQty" type="number" min="1" />
        <label>Cost price — what YOU paid for one</label><input id="pCost" type="number" min="0" />
        <label>Sell price — what the customer pays</label><input id="pSell" type="number" min="0" />
        <button class="btn btn-primary btn-block" onclick="doAddProduct('${id}')">📦 Save product</button>
      </div>` : `<div class="card"><h2>Stock</h2>
        <p>👀 View only — only the owner can add goods.</p>
        ${d.products.length === 0 ? "<p>No products yet.</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th></th><th>Product</th><th>Arrived</th><th>Sold</th><th>Left</th><th>Status</th><th>Sell price</th></tr>
          ${d.products.map((p) => `<tr>
            <td>${p.photo ? `<img class="thumb" src="${p.photo}">` : ""}</td>
            <td><b>${esc(p.name)}</b></td>
            <td>${p.qtyArrived}</td><td>${p.sold}</td><td><b>${p.remaining}</b></td>
            <td>${badge(p.status)}</td><td>${money(p.sellPrice)}</td>
          </tr>`).join("")}
        </table></div>`}
      </div>`}
      </div>

      <div class="section ${tab === "log" ? "active" : ""}"><div class="card">
        <h2>Sales log (real dates from the server)</h2>
        ${d.sales.length === 0 ? "<p>No sales yet.</p>" : `
        <div style="overflow-x:auto"><table>
          <tr><th>Date & time</th><th>Product</th><th>Qty</th><th>Amount</th><th>Profit</th><th>By</th></tr>
          ${d.sales.map((s) => `<tr>
            <td class="small">${fmtDate(s.date)}</td><td>${esc(s.productName)}</td>
            <td>${s.qty}</td><td>${money(s.amount)}</td>
            <td style="color:#2e7d32"><b>${money(s.profit)}</b></td><td>${esc(s.worker || "—")}</td>
          </tr>`).join("")}
        </table></div>`}
      </div></div>

      ${d.isOwner ? `<div class="section ${tab === "settings" ? "active" : ""}"><div class="card">
        <h2>Store settings (owner only)</h2>
        <div id="setMsg"></div>
        <label>Store name</label><input id="setName" value="${esc(d.name)}" />
        <label>Registered name</label><input id="setReg" value="${esc(d.registeredName)}" />
        <label>Low-stock alert level (warn when remaining is this or less)</label>
        <input id="setLow" type="number" min="0" value="${d.lowStock}" />
        <label>NEW store password — changes immediately and kicks out the old worker</label>
        <input id="setPass" type="text" placeholder="leave empty to keep current password" />
        <button class="btn btn-primary btn-block" onclick="doUpdateStore('${id}')">💾 Save settings</button>
        <hr style="margin:16px 0">
        <label>Owner password (main password)</label>
        <input id="setOwnerPass" type="text" placeholder="new owner password" />
        <button class="btn btn-gray btn-block" onclick="doChangeOwnerPass()">Change owner password</button>
        <hr style="margin:16px 0">
        <button class="btn btn-green btn-block" onclick="doBackup()">💾 DOWNLOAD ALL MY DATA (backup)</button>
        <p class="small">Saves everything — all stores, products, sales — as a file on your phone. Do this weekly!</p>
        <hr style="margin:16px 0">
        <button class="btn btn-red btn-block" onclick="doDeleteStore('${id}')">🗑️ DELETE this store</button>
      </div></div>` : ""}
    </div>`;
}

function prefillAmount() {
  const sel = document.getElementById("saleProduct");
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.dataset.price) return;
  document.getElementById("saleAmount").value =
    Number(opt.dataset.price) * Number(document.getElementById("saleQty").value || 1);
}

async function doSale(id) {
  try {
    const qty = Number(document.getElementById("saleQty").value);
    const amount = document.getElementById("saleAmount").value;
    await api(`/api/stores/${id}/sales`, { method: "POST", body: JSON.stringify({
      productId: document.getElementById("saleProduct").value,
      qty,
      amount: amount === "" ? undefined : Number(amount),
      worker: document.getElementById("saleWorker").value || sellerName(id) }) });
    renderStore(id, "sale", "Sale saved ✅");
  } catch (e) { document.getElementById("saleMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}

function doRestock(id, pid) {
  const qty = prompt("How many more arrived?");
  if (!qty || !(qty > 0)) return;
  api(`/api/stores/${id}/products/${pid}/restock`, { method: "POST",
    body: JSON.stringify({ qty: Number(qty) }) })
    .then(() => renderStore(id, "stock", "Stock updated ✅"))
    .catch((e) => alert(e.message));
}
async function doDeleteProduct(id, pid) {
  if (!confirm("Delete this product and its sales history?")) return;
  try { await api(`/api/stores/${id}/products/${pid}`, { method: "DELETE" });
    renderStore(id, "stock", "Product deleted"); } catch (e) { alert(e.message); }
}

function doAddProduct(id) {
  const name = document.getElementById("pName").value;
  const qty = Number(document.getElementById("pQty").value);
  const cost = Number(document.getElementById("pCost").value);
  const sell = Number(document.getElementById("pSell").value);
  const file = document.getElementById("pPhoto").files[0];
  const send = (photo) => api(`/api/stores/${id}/products`, { method: "POST",
      body: JSON.stringify({ name, qtyArrived: qty, costPrice: cost, sellPrice: sell, photo }) })
    .then(() => renderStore(id, "stock", "Product added ✅"))
    .catch((e) => { document.getElementById("prodMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; });
  if (file) { const r = new FileReader();
    r.onload = () => send(r.result); r.readAsDataURL(file); }
  else send("");
}

async function doUpdateStore(id) {
  const pass = document.getElementById("setPass").value;
  try {
    await api(`/api/stores/${id}`, { method: "PUT", body: JSON.stringify({
      name: document.getElementById("setName").value,
      registeredName: document.getElementById("setReg").value,
      lowStock: Number(document.getElementById("setLow").value),
      newPassword: pass || undefined }) });
    if (pass) { clearStoreLogin(); return renderHome("Password changed. Old worker can no longer enter. ✅"); }
    renderStore(id, "settings", "Settings saved ✅");
  } catch (e) { document.getElementById("setMsg").innerHTML = `<div class="msg msg-error">${esc(e.message)}</div>`; }
}
async function doChangeOwnerPass() {
  try { await api("/api/owner/password", { method: "POST",
    body: JSON.stringify({ newPassword: document.getElementById("setOwnerPass").value }) });
    alert("Owner password changed ✅"); }
  catch (e) { alert(e.message); }
}
async function doDeleteStore(id) {
  if (!confirm("Delete this store and ALL its data forever?")) return;
  try { await api(`/api/stores/${id}`, { method: "DELETE" });
    clearStoreLogin(); renderHome("Store deleted"); } catch (e) { alert(e.message); }
}

// ---------- DOWNLOAD FULL BACKUP (owner only) ----------
async function doBackup() {
  try {
    const data = await api("/api/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-stores-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    alert("Backup downloaded ✅ Keep this file safe — it contains ALL your business data.");
  } catch (e) { alert(e.message); }
}

// ================= START =================
if (!API) renderSetup();
else renderHome();

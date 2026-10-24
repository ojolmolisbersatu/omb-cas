// ===== KONFIGURASI (isi sendiri; anon key memang publik, JANGAN isi service role) =====
var SUPABASE_URL = "https://yloxoxgvedepmegihver.supabase.co";
var ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsb3hveGd2ZWRlcG1lZ2lodmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3Mzk4NDYsImV4cCI6MjEwMzMxNTg0Nn0.b74It13ynjkLSBqsvyuYbWmo0TkL0ztb1bj9d8TAerc";
var QRIS_STATIC = "00020101021126570011ID.DANA.WWW011893600915303471271802090347127180303UMI51440014ID.CO.QRIS.WWW0215ID10265837741240303UMI5204739453033605802ID5916Semilir Semarang6013Kota Semarang6105501166304285A"; // dari OMB Nota Cas
var API = SUPABASE_URL + "/functions/v1/charge-api";

var PEND = new URLSearchParams(location.search).get("charger"); // dari QR charger: ?charger=<id colokan>
var sb = supabase.createClient(SUPABASE_URL, ANON_KEY);
var $app = document.getElementById("app");
var S = { page: "home", sub: null, stopDlg: false, user: null, admin: false, tab: "charge", adminMenu: "sessions", outlets: [], tariff: 0, maxWh: 5000, sess: null, all: [], names: {}, outlet: 1, sig: "", profile: null, busy: {}, tgt: null, custom: "", pwOpen: false, np1: "", np2: "", members: null, msq: "", unl: null, asq: "", coin: null, topup: null, tops: [], unpaid: [], ledger: [], rtab: "semua", topupOpen: false, tamt: 0, tsq: "", exFrom: "", exTo: "", exUser: "", pwShow: {}, wallets: {} };
(function () { var n = new Date(); S.exTo = ymd(n); S.exFrom = ymd(new Date(n.getFullYear(), n.getMonth(), 1)); })();

function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function rp(n) { return "Rp" + Number(n || 0).toLocaleString("id-ID"); }
// Hasil selalu dalam Wh (bilangan bulat), karena server dan Shelly memakai Wh.
function tgtVal() {
  var t;
  if (S.tgt === "custom") {
    var p = parseFloat(String(S.custom).replace(",", "."));
    t = isFinite(p) ? Math.round(p * 1000) : 0;
  } else t = S.tgt;
  return t && t > 0 ? t : 0;
}
// 1 Poin = 1.000 Wh. Tampil 2 desimal, dibulatkan ke atas: 234 Wh -> 0,24
function poin(wh) {
  var n = (Math.ceil(Number(wh || 0) / 10 - 1e-6) / 100) || 0;
  return n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function toast(m) {
  var d = document.createElement("div"); d.className = "toast"; d.setAttribute("role", "status"); d.textContent = m;
  document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3500);
}

// ===== QRIS DINAMIS =====
function crc16(s) {
  var c = 0xFFFF;
  for (var i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (var j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1);
    c &= 0xFFFF;
  }
  return c.toString(16).toUpperCase().padStart(4, "0");
}
function qrisDynamic(amount) {
  var f = [], p = QRIS_STATIC, k = 0;
  while (k < p.length) { var l = parseInt(p.substr(k + 2, 2), 10); f.push({ t: p.substr(k, 2), v: p.substr(k + 4, l) }); k += 4 + l; }
  f = f.filter(function (x) { return x.t !== "63" && x.t !== "54"; });
  f.forEach(function (x) { if (x.t === "01") x.v = "12"; });
  var ci = -1; f.forEach(function (x, n) { if (x.t === "53") ci = n; });
  var a = { t: "54", v: String(Math.round(amount)) };
  if (ci >= 0) f.splice(ci + 1, 0, a); else f.push(a);
  var s = f.map(function (x) { return x.t + String(x.v.length).padStart(2, "0") + x.v; }).join("") + "6304";
  return s + crc16(s);
}

// ===== API =====
async function api(path, body) {
  var s = (await sb.auth.getSession()).data.session;
  var r = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (s ? s.access_token : "") },
    body: JSON.stringify(body || {})
  });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(j.message || j.error || "Gagal (" + r.status + ")");
  return j;
}

// ===== DATA =====
async function load() {
  var u = S.user.id;
  var q = await Promise.all([
    sb.from("charge_outlets").select("*").order("id"),
    sb.from("charge_tariffs").select("price_per_kwh").order("effective_from", { ascending: false }).limit(1),
    sb.from("charge_config").select("max_target_wh").maybeSingle(),
    sb.from("charge_sessions").select("*").eq("user_id", u).order("created_at", { ascending: false }).limit(1)
  ]);
  S.outlets = q[0].data || [];
  S.tariff = q[1].data && q[1].data[0] ? q[1].data[0].price_per_kwh : 0;
  S.maxWh = q[2].data ? q[2].data.max_target_wh : 5000;
  S.sess = q[3].data && q[3].data[0] ? q[3].data[0] : null;
  var hadTop = !!S.topup;
  var wq = await Promise.all([
    sb.from("charge_wallets").select("balance").eq("user_id", u).maybeSingle(),
    sb.from("charge_topups").select("*").eq("user_id", u).eq("status", "pending").order("created_at", { ascending: false }).limit(1)
  ]);
  S.coin = wq[0].error ? null : (wq[0].data ? Number(wq[0].data.balance) : 0);
  S.topup = wq[1].data && wq[1].data[0] ? wq[1].data[0] : null;
  if (hadTop && !S.topup && S.topupOpen) { S.topupOpen = false; toast("Saldo coin diperbarui"); }
  if (S.tab === "riwayat") {
    var hq = await sb.from("charge_sessions").select("*").eq("user_id", u).order("created_at", { ascending: false }).limit(30);
    S.hist = hq.data || [];
    var lq = await sb.from("charge_coin_ledger").select("*").eq("user_id", u).order("id", { ascending: false }).limit(50);
    S.ledger = lq.data || [];
  }
  // Utamakan RPC charge_busy_outlets() (bisa dibaca semua user, tanpa membuka data sesi orang lain).
  var bz = await sb.rpc("charge_busy_outlets");
  if (bz.error) bz = await sb.from("charge_sessions").select("outlet_id").in("status", ["pending", "running"]);
  S.busy = {};
  (bz.data || []).forEach(function (x) { S.busy[x.outlet_id] = true; });
  if (S.admin) {
    var aq = await Promise.all([
      sb.from("charge_topups").select("*").eq("status", "pending").order("created_at"),
      sb.from("charge_sessions").select("*").eq("payment_status", "unpaid").order("created_at", { ascending: false }).limit(50)
    ]);
    S.tops = aq[0].data || []; S.unpaid = aq[1].data || [];
  }
  if (S.admin && S.tab === "admin") {
    var a = await sb.from("charge_sessions").select("*").order("created_at", { ascending: false }).limit(30);
    S.all = a.data || [];
    var wl = await sb.from("charge_wallets").select("user_id,balance").range(0, 999);
    if (!wl.error) { S.wallets = {}; (wl.data || []).forEach(function (x) { S.wallets[x.user_id] = Number(x.balance); }); }
    var ids = S.all.concat(S.unpaid).map(function (x) { return x.member_id; });
    var m = await sb.from("anggota_omb").select("id,nama").in("id", ids);
    if (m.data) m.data.forEach(function (x) { S.names[x.id] = x.nama; });
  }
  if (S.admin && S.tab === "admin" && S.members === null) {
    try { S.members = (await api("/admin/members")).members || []; } catch (e) { S.members = []; toast("Daftar anggota gagal dimuat: " + e.message); }
  }
  if (S.admin && S.tab === "admin" && S.unl === null) {
    try { S.unl = (await api("/admin/unlinked")).anggota || []; } catch (e) { S.unl = []; toast("Daftar anggota gagal dimuat: " + e.message); }
  }
  var sig = JSON.stringify([S.sess, S.all, S.tariff, S.tab, S.adminMenu, S.outlets, S.busy, S.members, S.unl, S.pwOpen, S.hist, S.wallets, S.coin, S.topup, S.tops, S.unpaid, S.ledger, S.rtab, S.topupOpen, S.page, S.sub, S.stopDlg, S.outlet]);
  var typing = document.activeElement && document.activeElement.tagName === "INPUT";
  if (sig !== S.sig && !typing && !(ST.stream && document.getElementById("qv"))) { S.sig = sig; render(); } // tunda render saat pengguna sedang mengetik
}

var LOKASI = { nama: "SPKLU OMB Semilir", alamat: "Semilir, Kota Semarang", jam: "24 Jam", fasilitas: ["Toilet", "Parkir", "Warung"], lat: null, lng: null }; // lat & lng: koordinat lokasi (contoh -6.9932, 110.4203). Selama kosong, peta tampil sebagai gambar hiasan // edit sesuai kondisi lokasi
function driveImg(u) {
  if (!u) return "";
  var m = /\/d\/([\w-]+)/.exec(u) || /[?&]id=([\w-]+)/.exec(u);
  return m && /drive\.google\.com/.test(u) ? "https://lh3.googleusercontent.com/d/" + m[1] : u;
}
async function loadLokasi() {
  try {
    var r = await sb.rpc("charge_stations_public"), x = r.data && r.data[0]; if (r.error || !x) return;
    LOKASI.nama = x.name || LOKASI.nama; LOKASI.alamat = x.address || LOKASI.alamat;
    if (x.open_hours) LOKASI.jam = x.open_hours === "00:00-00:00" ? "24 Jam" : x.open_hours;
    LOKASI.foto = driveImg(x.photo_url); LOKASI.fasilitas = x.facilities || [];
    if (x.lat != null && x.lng != null) { LOKASI.lat = Number(x.lat); LOKASI.lng = Number(x.lng); }
  } catch (e) {}
}
function seenId() { try { return localStorage.getItem("omb_seen"); } catch (e) { return null; } }
function topbar(t, act, v) { return '<div class="top">' + (act ? '<button data-act="' + act + '" data-v="' + (v || "") + '" aria-label="Kembali">' + ic("back") + '</button>' : '<i></i>') + '<b>' + t + '</b><i></i></div>'; }
function mm(sec) { sec = Math.max(0, Math.round(sec)); return [sec / 3600 | 0, (sec % 3600) / 60 | 0, sec % 60].map(function (n) { return String(n).padStart(2, "0"); }).join(":"); }
function estCost(wh) { return Math.ceil(wh * S.tariff / 1000 / 100) * 100; }
function lokasiStat() { var k = { a: 0, u: 0, x: 0 }; S.outlets.forEach(function (o) { if (S.busy[o.id]) k.u++; else if (o.is_available) k.a++; else k.x++; }); return k; }
function menuBtn(i, t, sub, act, v, b) { return '<button class="menu" data-act="' + act + '" data-v="' + v + '"><span class="mi' + (b ? " b" : "") + '">' + ic(i) + '</span><span class="t"><b>' + t + '</b>' + (sub ? '<small>' + sub + '</small>' : "") + '</span>' + ic("chev") + '</button>'; }
function homeView() {
  return '<div style="margin:4px 0 12px"><div class="mute">Halo,</div><p class="hello">' + esc(nm()) + '</p><div class="mute">Selamat beraktivitas, semoga selalu lancar!</div></div>' + coinCard() + pendTop() +
    menuBtn("scan", "Scan QR", "Langsung mulai pengisian", "page", "scan") + menuBtn("pin", "Pilih Lokasi", "Lihat daftar lokasi terdekat", "page", "map", 1) +
    '<div class="card" style="background:var(--grad);color:#fff;border:0"><b>Nikmati pengalaman ngecas yang lebih mudah dengan OMB Service</b></div>';
}
function scanView() {
  return topbar("Scan QR Lokasi", "page", "home") + '<div class="scan"><video id="qv" autoplay playsinline muted></video><i></i><div id="qerr" class="qerr"></div></div>' +
    '<p class="mute" style="text-align:center">Arahkan kamera ke QR Code untuk memulai</p>' + menuBtn("scan", "Input ID Lokasi", "Jika tidak ada QR code", "inputid", "");
}
var MAPI = null;
function initMap() {
  var el = document.getElementById("lmap");
  if (MAPI) { try { MAPI.remove(); } catch (e) {} MAPI = null; }
  if (!el || typeof L === "undefined") return;
  MAPI = L.map(el, { zoomControl: false }).setView([LOKASI.lat, LOKASI.lng], 16);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(MAPI);
  L.marker([LOKASI.lat, LOKASI.lng], { icon: L.divIcon({ className: "", html: '<div class="pin">⚡</div>', iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(MAPI);
}
function mapView() {
  var k = lokasiStat();
  return topbar("Pilih Lokasi", "page", "home") + '<div class="mapbar">' + ic("search") + ' Cari lokasi, nama...</div>' + (LOKASI.lat != null ? '<div class="map" id="lmap"></div>' : '<div class="map"><svg viewBox="0 0 300 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><path d="M-10 90L310 140M60 -10L110 310M-10 230L310 200M220 -10L180 310" stroke="#fff" stroke-width="12" fill="none"/><g transform="translate(150 150)"><circle r="22" fill="#22A85A" opacity=".2"/><circle r="11" fill="#22A85A"/><path d="M-3 -6L-6 1h4l-1 5 6-7h-4z" fill="#fff"/></g></svg></div>') +
    '<div class="sheet"><b>' + esc(LOKASI.nama) + '</b><div class="mute">' + k.a + ' tersedia · ' + esc(LOKASI.jam) + '</div><button class="big acc" style="margin-top:10px" data-act="page" data-v="detail">Lihat Detail</button>' +
    (LOKASI.lat != null ? '<a class="btn ghost" style="margin-top:8px;padding:12px;font-size:16px" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + LOKASI.lat + "," + LOKASI.lng + '">Petunjuk arah</a>' : "") + '</div>';
}
function detailView() {
  var k = lokasiStat(), sel = S.outlets.filter(function (x) { return x.id === S.outlet; })[0], selOk = sel && sel.is_available && !S.busy[sel.id];
  var list = S.outlets.map(function (x) {
    var u = !!S.busy[x.id], ok = x.is_available && !u;
    return '<button class="ch' + (S.outlet === x.id ? " sel" : "") + '" data-act="outlet" data-v="' + x.id + '"' + (ok ? "" : " disabled") + '><span class="mi">' + ic("bolt") + '</span><b>' + esc(x.name) + '</b><span class="st" style="color:' + (u ? "var(--blue)" : ok ? "var(--ok)" : "var(--bad)") + '">' + (u ? "Terisi" : ok ? "Tersedia" : "Tidak tersedia") + '</span></button>';
  }).join("");
  return topbar("Detail Lokasi", "page", "map") + '<div class="card" style="background:' + (LOKASI.foto ? "linear-gradient(rgba(27,42,74,.3),rgba(27,42,74,.8)),url(" + String(LOKASI.foto).replace(/[()'"\s]/g, "") + ") center/cover" : "var(--grad)") + ';color:#fff;border:0;min-height:130px;display:flex;flex-direction:column;justify-content:flex-end"><b style="font-size:20px">' + esc(LOKASI.nama) + '</b><div>' + esc(LOKASI.alamat) + ' · ' + esc(LOKASI.jam) + '</div></div>' +
    '<div class="chips"><span class="tag paid">' + k.a + ' Tersedia</span><span class="tag run">' + k.u + ' Terisi</span><span class="tag">' + k.x + ' Nonaktif</span></div>' +
    (LOKASI.fasilitas.length ? '<div class="mute">Fasilitas: ' + LOKASI.fasilitas.map(esc).join(" · ") + '</div>' : "") + '<h2>Daftar Lokasi</h2>' + list +
    '<button class="big acc" style="margin-top:12px" data-act="page" data-v="bayar"' + (selOk ? "" : " disabled") + '>Pilih Tempat</button>';
}
function estHtml() {
  var c = estCost(tgtVal()), b = S.coin || 0, f = function (n) { return Number(n).toLocaleString("id-ID"); };
  return '<div class="kv" style="border:0;margin:0"><span>Perkiraan biaya</span><b>' + rp(c) + '</b></div><div class="kv"><span>Saldo Coin</span><b>' + f(b) + ' Coin</b></div><div class="kv"><span>' + (b >= c ? "Perkiraan sisa saldo" : "Kekurangan via QRIS") + '</span><b>' + (b >= c ? f(b - c) + " Coin" : rp(c - b)) + '</b></div>';
}
function bayarView() {
  var o = S.outlets.filter(function (x) { return x.id === S.outlet; })[0] || {};
  var chips = [1000, 2500, 5000].map(function (n) { return '<button class="' + (S.tgt === n ? "sel" : "") + '" data-act="tgt" data-v="' + n + '">' + (n / 1000).toLocaleString("id-ID") + ' Poin</button>'; }).join("");
  return topbar("Pembayaran", "page", "detail") + '<div class="menu" style="margin-top:0"><span class="mi">' + ic("bolt") + '</span><span class="t"><b>' + esc(LOKASI.nama) + '</b><small>' + esc(o.name || "") + '</small></span></div>' +
    '<h2>Jumlah Pengisian</h2><input id="cp" type="number" inputmode="decimal" step="0.01" min="0.01" max="' + (S.maxWh / 1000) + '" placeholder="Masukkan jumlah Poin (maks ' + (S.maxWh / 1000).toLocaleString("id-ID") + ')" value="' + esc(S.tgt === "custom" ? S.custom : "") + '">' +
    '<div class="chips row" style="margin:10px 0">' + chips + '</div><div class="mute">1 Poin = 1 kWh = ' + rp(S.tariff) + '</div>' +
    '<h2>Pembayaran</h2><div class="card mute">Saat sesi selesai, Saldo Coin dipotong lebih dulu. Kekurangannya dibayar lewat QRIS.</div><div class="card" id="estbox">' + estHtml() + '</div>' +
    '<button id="startBtn" class="big acc" data-act="start"' + (tgtVal() ? "" : " disabled") + '>⚡ Mulai Pengisian</button>';
}
function runView(s) {
  var run = s.status === "running", used = run ? Math.max(0, (s.last_wh || s.start_wh) - s.start_wh) : 0, tg = Number(s.target_wh || 0), pct = tg ? Math.min(100, used / tg * 100) : 0;
  var t0 = new Date(s.started_at || s.created_at).getTime(), el = (Date.now() - t0) / 1000, left = used > 0 && el > 0 ? Math.max(0, tg - used) / (used / el) : null, C = 2 * Math.PI * 88;
  var st = s.status === "pending" ? "Menunggu perangkat" : s.stop_requested_at ? "Menghentikan..." : "Mengisi";
  return topbar("Pengisian Berlangsung") + '<div style="text-align:center"><span class="pill"><span class="dot"></span>' + st + '</span></div>' +
    '<div class="ring"><svg viewBox="0 0 200 200"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22A85A"/><stop offset="1" stop-color="#1E88E5"/></linearGradient></defs><circle cx="100" cy="100" r="88" fill="none" stroke="#DCE3EC" stroke-width="14"/><circle cx="100" cy="100" r="88" fill="none" stroke="url(#rg)" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + (C * pct / 100) + ' ' + C + '"/></svg>' +
    '<div class="c"><span style="color:var(--warn)">' + ic("bolt") + '</span><div class="num">' + poin(used) + '</div><div class="mute">Poin (' + fmt(used / 1000, 2) + ' kWh)</div><div class="mute">dari ' + poin(tg) + ' Poin</div></div></div>' +
    devRows(s) + '<div class="card"><div class="kv" style="border:0;margin:0"><span>Durasi</span><b' + (run ? ' data-since="' + t0 + '"' : "") + '>' + mm(el) + '</b></div><div class="kv"><span>Sisa waktu (estimasi)</span><b>' + (left == null ? "—" : mm(left)) + '</b></div></div>' +
    '<div class="card"><span class="mute">Biaya aktual (perkiraan)</span><div class="num" style="font-size:28px">' + rp(estCost(used)) + '</div></div>' + coinCard() + pendTop() +
    '<button class="big bad" style="margin-top:12px" data-act="stopask"' + (s.stop_requested_at ? " disabled" : "") + '>' + ic("power") + ' Akhiri Pengisian</button>' +
    '<p class="mute">Berhenti saat Anda menekan Akhiri Pengisian, atau otomatis jika tidak ada aliran listrik 10 detik.</p>' +
    (S.stopDlg ? '<div class="mask"><div class="dlg"><h2 style="margin-top:0">Hentikan Pengisian?</h2><p class="mute">Pengisian akan dihentikan dan tagihan dihitung dari pemakaian.</p><button class="big bad" data-act="stop">Ya, Hentikan</button><button class="big ghost" style="margin-top:10px" data-act="stopno">Batal</button></div></div>' : "");
}
function doneView(s) {
  var cn = Number(s.amount_coin || 0), q = Number(s.amount_qris || 0), e = s.finished_at || s.ended_at || s.updated_at, dur = e ? (new Date(e).getTime() - new Date(s.started_at || s.created_at).getTime()) / 1000 : null;
  return topbar("Rincian Pengisian") + '<div class="card"><div class="row"><span class="pill" style="width:46px;height:46px;justify-content:center;border-radius:50%">' + ic("check") + '</span><div><b style="font-size:18px">Pengisian Selesai</b><div class="mute">' + dt(s.created_at) + '</div></div></div>' +
    '<div class="kv"><span>Colokan</span><b>Colokan ' + s.outlet_id + '</b></div><div class="kv"><span>Energi terpakai</span><b>' + poin(s.used_wh) + ' Poin (' + fmt(s.used_wh / 1000, 2) + ' kWh)</b></div><div class="kv"><span>Durasi</span><b>' + (dur != null && dur >= 0 ? mm(dur) : "—") + '</b></div></div>' +
    '<h2>Rincian Biaya</h2><div class="card"><div class="kv" style="border:0;margin:0"><span>Total biaya</span><b>' + rp(s.amount_idr) + '</b></div>' + (cn > 0 ? '<div class="kv"><span>Dibayar dengan Coin</span><b>' + rp(cn) + '</b></div>' : "") + (q > 0 ? '<div class="kv"><span>Dibayar dengan QRIS</span><b>' + rp(q) + '</b></div>' : "") + '<div class="kv"><span>Status</span><span class="tag paid">Lunas</span></div></div>' +
    '<button class="big acc" data-act="seen">Selesai</button>';
}
function sessItem(x) {
  var run = x.status === "pending" || x.status === "running";
  var tg = run ? '<span class="tag run">Berjalan</span>' : x.payment_status === "paid" ? '<span class="tag paid">Lunas</span>' : x.payment_status === "unpaid" ? '<span class="tag unpaid">Belum bayar</span>' : '<span class="tag">' + esc(x.status) + '</span>';
  return '<div class="card"><div class="row sp"><div class="row"><span class="mi">' + ic("bolt") + '</span><div><b>Pengisian Colokan ' + x.outlet_id + '</b><div class="mute">' + dt(x.created_at) + '</div></div></div>' + tg + '</div><div class="row sp" style="margin-top:8px"><span>' + poin(x.used_wh) + ' Poin</span><b>' + rp(x.amount_idr) + '</b></div>' +
    (Number(x.amount_coin) > 0 ? '<div class="mute">Coin ' + rp(x.amount_coin) + (x.amount_qris ? ' · QRIS ' + rp(x.amount_qris) : '') + '</div>' : '') + '</div>';
}

var ST = { stream: null, timer: null, starting: false, bad: "", at: 0 };
function openCharger(id) {
  var o = S.outlets.filter(function (x) { return String(x.id) === String(id).trim(); })[0];
  if (!o) { toast("Charger tidak ditemukan"); return false; }
  if (!o.is_available || S.busy[o.id]) { toast("Charger sedang tidak tersedia"); return false; }
  S.outlet = o.id; S.tab = "charge"; S.page = "bayar"; return true;
}
function chargerFrom(t) {
  var m = /[?&]charger=([^&#\s]+)/.exec(t); if (m) return decodeURIComponent(m[1]);
  return /^\d+$/.test(String(t).trim()) ? String(t).trim() : null;
}
function stopScan() {
  if (ST.timer) { clearInterval(ST.timer); ST.timer = null; }
  if (ST.stream) { ST.stream.getTracks().forEach(function (t) { t.stop(); }); ST.stream = null; }
}
function onQr(t) {
  if (t === ST.bad && Date.now() - ST.at < 3000) return;
  ST.bad = t; ST.at = Date.now();
  var id = chargerFrom(t);
  if (id == null) return toast("QR ini bukan QR Code OMB");
  if (openCharger(id)) { stopScan(); S.sig = ""; render(); }
}
async function startScan() {
  if (ST.starting) return;
  var fail = function () { stopScan(); var e = document.getElementById("qerr"); if (e) e.textContent = "Kamera tidak bisa dibuka. Izinkan akses kamera untuk aplikasi ini, atau pakai Input ID Lokasi."; };
  ST.starting = true;
  try {
    if (!ST.stream) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no camera api");
      ST.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    }
    var v = document.getElementById("qv"); if (!v) return stopScan();
    v.srcObject = ST.stream; v.muted = true; await v.play();
  } catch (e) { return fail(); } finally { ST.starting = false; }
  if (ST.timer) return;
  var cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
  ST.timer = setInterval(function () {
    var vid = document.getElementById("qv"); if (!vid || !vid.videoWidth || typeof jsQR !== "function") return;
    var w = Math.min(480, vid.videoWidth), h = Math.round(vid.videoHeight * w / vid.videoWidth);
    cv.width = w; cv.height = h; cx.drawImage(vid, 0, 0, w, h);
    var r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    if (r && r.data) onQr(r.data);
  }, 250);
}

// ===== TAMPILAN =====
function login(err) {
  $app.innerHTML = '<div class="hero"><img src="icon-192.png" alt="OMB Service"><h1>OMB Service</h1><p></p><span class="pill" style="margin-top:12px;background:rgba(255,255,255,.2);color:#fff">Khusus Anggota OMB</span></div><div class="card">' +
    '<label class="mute" for="em">Email</label><input id="em" type="email" autocomplete="username">' +
    '<label class="mute" for="pw">Password</label>' + pwBox("pw", "current-password", "") +
    '<p class="mute" style="color:var(--bad)">' + esc(err || "") + '</p><button class="big acc" data-act="login">Masuk</button></div>';
}

function eyeIc(show) {
  return '<svg viewBox="0 0 24 24">' + (show
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>') + '</svg>';
}
// Kolom password dengan tombol mata (tekan untuk lihat/sembunyikan)
function pwBox(id, auto, val) {
  var show = !!S.pwShow[id];
  return '<div class="pwbox"><input id="' + id + '" type="' + (show ? "text" : "password") + '" autocomplete="' + auto + '" value="' + esc(val || "") + '">' +
    '<button type="button" class="eye" data-act="eye" data-v="' + id + '" aria-label="' + (show ? "Sembunyikan password" : "Tampilkan password") + '">' + eyeIc(show) + '</button></div>';
}

function ic(n) {
  var p = {
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    riwayat: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    setting: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    profil: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>', chev: '<path d="M9 18l6-6-6-6"/>', check: '<path d="M20 6L9 17l-5-5"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    bolt: '<path d="M13 2L3 14h8l-1 8 10-12h-8z"/>', coin: '<circle cx="12" cy="12" r="10"/><path d="M14.5 9H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9M12 6v2M12 16v2"/>',
    power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10"/>', search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
    car: '<path d="M5 17h14M6 17l1-6h10l1 6M7 11l1.5-4h7L17 11"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>', info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
  };
  return '<svg class="ico" viewBox="0 0 24 24">' + p[n] + '</svg>';
}
var BOLT = '<svg viewBox="0 0 24 24"><path d="M13 2L3 14h8l-1 8 10-12h-8z"/></svg>';
function nm() { var p = S.profile; return p && p.nama ? p.nama : (S.user.email || "Anggota"); }
function fmt(x, d) { return Number(x).toFixed(d).replace(".", ","); }

function head() { return '<div class="brand">' + BOLT + '<span><b>OMB</b> Service</span></div>'; }

function navBar() {
  var items = [["charge", "home", "Beranda"], ["riwayat", "riwayat", "Riwayat"], ["profil", "profil", "Profil"]];
  if (S.admin) items.push(["admin", "admin", "Admin", S.tops.length + S.unpaid.length]);
  return '<nav class="nav">' + items.map(function (x) {
    return '<button class="' + (S.tab === x[0] || (x[0] === "profil" && S.tab === "setting") ? "on" : "") + '" data-act="tab" data-v="' + x[0] + '">' + ic(x[1]) + x[2] + (x[3] ? '<span class="badge">' + x[3] + '</span>' : "") + '</button>';
  }).join("") + '</nav>';
}

// Saldo coin: tempat sudah disiapkan, data belum diisi (S.coin diisi nanti)
function coinCard() {
  var has = S.coin != null;
  return '<div class="coinbox"><div><small>Saldo Coin</small><div class="n">' + (has ? Number(S.coin).toLocaleString("id-ID") : "—") + '</div><small>' + (has ? "1 Coin = Rp1" : "Memuat...") + '</small></div>' +
    (has ? '<button class="sm" style="background:#fff;color:var(--ink)" data-act="topupform">+ Isi Saldo</button>' : "") + '</div>';
}

// Arus/tegangan/daya real-time; baris yang datanya kosong disembunyikan
function devRows(s) {
  var r = [["Daya", s.last_power_w, 0, "W"], ["Tegangan", s.last_voltage_v, 0, "V"], ["Arus", s.last_current_a, 2, "A"]];
  if (r.every(function (x) { return x[1] == null; })) return "";
  return '<div class="card tri">' + r.map(function (x) { return '<div><span class="mute">' + x[0] + '</span><b>' + (x[1] == null ? "—" : fmt(x[1], x[2]) + " " + x[3]) + '</b></div>'; }).join("") + '</div>';
}

function render() {
  if (!S.user) return login();
  var v = S.tab === "admin" && S.admin ? adminView() : S.tab === "riwayat" ? histView() : S.tab === "setting" ? settingView() : S.tab === "profil" ? profilView() : userView();
  $app.innerHTML = (S.tab === "admin" && S.admin ? head() : "") + v + navBar();
  if (document.getElementById("qv")) startScan(); else stopScan();
  initMap();
  var q = document.getElementById("qr");
  if (q) {
    try { new QRCode(q, { text: qrisDynamic(Number(q.dataset.amt)), width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M }); }
    catch (e) { q.textContent = "QRIS belum diatur"; }
  }
}

function pendTop() {
  if (!S.topup) return "";
  return '<div class="card warnbox"><b>Permintaan isi saldo ' + rp(S.topup.amount) + '</b><div class="mute">Menunggu pembayaran dan verifikasi admin.</div>' +
    '<button class="sm acc" style="margin-top:8px" data-act="topupform">Lihat QRIS</button></div>';
}

function topupView() {
  var t = S.topup;
  if (t) {
    var wa = "https://wa.me/6285128052599?text=" + encodeURIComponent("Halo admin OMB Service, saya " + nm() + " sudah membayar isi saldo coin " + rp(t.amount) + ". Mohon diverifikasi.");
    return '<h2>Isi Saldo</h2><div class="card"><span class="mute">Total Pembayaran</span><div class="num" style="color:var(--acc)">' + rp(t.amount) + '</div>' +
      '<div class="kv"><span>Coin yang didapat</span><b>' + Number(t.amount).toLocaleString("id-ID") + ' Coin</b></div></div>' +
      '<div class="card" style="text-align:center"><b>Scan untuk Membayar</b><div id="qr" data-amt="' + t.amount + '"></div><div class="mute">Buka aplikasi pembayaran favoritmu dan scan QRIS di atas.</div></div>' +
      '<div class="card mute">Setelah membayar, tekan tombol di bawah. Saldo bertambah setelah admin memverifikasi pembayaran.</div>' +
      '<a class="btn acc" href="' + wa + '" target="_blank" rel="noopener">Saya Sudah Bayar</a>' +
      '<div class="row" style="margin-top:10px"><button class="ghost big" data-act="topupcancel">Ganti nominal</button><button class="ghost big" data-act="topupback">Kembali</button></div>';
  }
  var chips = [10000, 25000, 50000, 100000].map(function (n) {
    return '<button class="' + (S.tamt === n ? "sel" : "") + '" data-act="tamt" data-v="' + n + '">' + rp(n) + '</button>';
  }).join("");
  var ok = S.tamt >= 5000 && S.tamt <= 1000000;
  return '<h2>Isi Saldo Coin</h2><div class="card"><div class="mute">1 Coin = Rp1. Minimal Rp5.000, maksimal Rp1.000.000.</div>' +
    '<input id="ta" type="number" inputmode="numeric" min="5000" max="1000000" placeholder="Masukkan nominal (Rp)" value="' + (S.tamt || "") + '" style="margin-top:8px">' +
    '<div class="chips" style="display:grid;grid-template-columns:1fr 1fr">' + chips + '</div></div>' +
    '<button id="topupBtn" class="big acc" data-act="topupgo"' + (ok ? "" : " disabled") + '>Lanjut ke QRIS</button>' +
    '<button class="big ghost" style="margin-top:10px" data-act="topupback">Kembali</button>';
}

function userView() {
  var s = S.sess;
  var activeSess = s && (s.status === "pending" || s.status === "running");
  if (activeSess && S.topupOpen) {
    return '<div class="card"><div class="row"><span class="dot' + (s.status === "running" ? "" : " off") + '"></span><b>Colokan ' + s.outlet_id + ' sedang mengisi</b></div>' +
      '<div class="mute">Pengisian tetap berjalan selama Anda mengisi saldo.</div></div>' + topupView();
  }
  if (activeSess) return runView(s);
  if (S.topupOpen) return topupView();
  if (s && s.payment_status === "unpaid") {
    var due = s.amount_qris != null ? Number(s.amount_qris) : Number(s.amount_idr), cn = Number(s.amount_coin || 0);
    var wa = "https://wa.me/6285128052599?text=" + encodeURIComponent("Halo admin OMB Service, saya " + nm() + " sudah membayar tagihan charge " + rp(due) + " (" + poin(s.used_wh) + " Poin, Colokan " + s.outlet_id + "). Mohon diverifikasi.");
    return topbar("Pembayaran") + '<div class="card"><span class="mute">' + (cn > 0 ? "Sisa Pembayaran" : "Total Pembayaran") + '</span><div class="num" style="color:var(--acc)">' + rp(due) + '</div>' +
      '<div class="kv"><span>Pemakaian</span><b>' + poin(s.used_wh) + ' Poin</b></div><div class="kv"><span>Colokan</span><b>Colokan ' + s.outlet_id + '</b></div>' +
      (cn > 0 ? '<div class="kv"><span>Total tagihan</span><b>' + rp(s.amount_idr) + '</b></div><div class="kv"><span>Dibayar dengan coin</span><b>-' + rp(cn) + '</b></div>' : '') + '</div>' +
      '<div class="card" style="text-align:center"><b>Scan untuk Membayar</b><div id="qr" data-amt="' + due + '"></div><div class="mute">Buka aplikasi pembayaran favoritmu dan scan QRIS di atas.</div></div>' +
      '<div class="card mute">Admin akan memverifikasi pembayaran secara manual, lalu Anda bisa mengisi lagi.</div>' +
      '<a class="btn acc" href="' + wa + '" target="_blank" rel="noopener">Saya Sudah Bayar</a>';
  }
  if (s && s.payment_status === "paid" && String(s.id) !== seenId()) return doneView(s);
  return S.page === "scan" ? scanView() : S.page === "map" ? mapView() : S.page === "detail" ? detailView() : S.page === "bayar" ? bayarView() : homeView();
}

function coinItem(x) {
  var kinds = { topup: "Top Up Coin", spend: "Pemakaian saldo", adjust: "Koreksi saldo" };
  var d = Number(x.delta), note = x.kind === "spend" && x.session_id ? "Bayar sesi charge #" + String(x.session_id).slice(-6).toUpperCase() : (x.note || "");
  return '<div class="card"><div class="row sp"><div class="row"><span class="mi b">' + ic("coin") + '</span><div><b>' + (kinds[x.kind] || "Mutasi") + '</b><div class="mute">' + dt(x.created_at) + (note ? " · " + esc(note) : "") + '</div></div></div><b class="' + (d >= 0 ? "pos" : "neg") + '">' + (d >= 0 ? "+" : "-") + Math.abs(d).toLocaleString("id-ID") + '</b></div><div class="mute" style="margin-top:6px">Saldo setelahnya: ' + Number(x.balance_after).toLocaleString("id-ID") + ' Coin</div></div>';
}

function histView() {
  var h = S.hist || [], l = S.ledger || [], t = S.rtab, it = [];
  var seg = '<div class="seg" style="grid-template-columns:repeat(3,1fr)">' + [["semua", "Semua"], ["sesi", "Pengisian"], ["coin", "Saldo Coin"]].map(function (x) { return '<button class="' + (t === x[0] ? "sel" : "") + '" data-act="rtab" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join("") + '</div>';
  if (t !== "coin") h.forEach(function (x) { it.push({ d: x.created_at, h: sessItem(x) }); });
  if (t !== "sesi") l.forEach(function (x) { it.push({ d: x.created_at, h: coinItem(x) }); });
  it.sort(function (a, b) { return new Date(b.d) - new Date(a.d); });
  return topbar("Riwayat") + seg + (t === "coin" ? coinCard() + pendTop() : "") + (it.length ? it.map(function (i) { return i.h; }).join("") : '<p class="mute">Belum ada riwayat.</p>');
}

function settingView() {
  var pw = S.pwOpen ? '<div class="card"><b>Ubah password</b>' +
    '<label class="mute" for="np1">Password baru (minimal 8 karakter)</label>' + pwBox("np1", "new-password", S.np1) +
    '<label class="mute" for="np2">Ulangi password baru</label>' + pwBox("np2", "new-password", S.np2) +
    '<div class="row" style="margin-top:10px"><button class="acc" data-act="pwsave">Simpan</button><button class="ghost" data-act="pwform">Batal</button></div></div>' : "";
  return topbar("Pengaturan", "tab", "profil") + '<div class="card"><button class="ghost big" data-act="pwform">Ubah password</button></div>' + pw +
    '<button class="big bad" data-act="logout">Keluar</button>';
}

function profilView() {
  var p = S.profile;
  return topbar("Profil") + '<div class="card row"><span class="av">' + ic("profil") + '</span><div><b style="font-size:18px">' + esc(nm()) + '</b><div class="mute">' + (p && p.id != null ? "ID Anggota: " + esc(p.id) : "") + '</div><span class="pill">Anggota Aktif</span></div></div>' + coinCard() +
    (S.sub === "diri" ? '<div class="card"><div class="kv" style="border:0;margin:0"><span>Nama</span><b>' + esc(nm()) + '</b></div><div class="kv"><span>ID Anggota</span><b>' + esc(p && p.id != null ? p.id : "-") + '</b></div><div class="kv"><span>Email</span><b>' + esc(S.user.email || "-") + '</b></div></div>' : "") +
    menuBtn("profil", "Data Diri", "", "sub", "diri") + menuBtn("car", "Kendaraan", "", "soon", "Kendaraan") + menuBtn("coin", "Saldo & Riwayat", "", "rcoin", "", 1) + menuBtn("setting", "Pengaturan", "", "tab", "setting") +
    menuBtn("help", "Bantuan", "Hubungi admin lewat WhatsApp", "help", "", 1) + menuBtn("info", "Tentang OMB Service", "", "soon", "Halaman Tentang") + '<button class="big ghost" style="margin-top:6px" data-act="logout">Keluar</button>';
}

function memberRows() {
  if (S.members === null) return '<p class="mute">Memuat...</p>';
  var q = S.msq.trim().toLowerCase();
  var list = S.members.filter(function (m) {
    return !q || [m.nama_panggilan, m.id_anggota, m.email].join(" ").toLowerCase().indexOf(q) >= 0;
  }).slice(0, 30);
  if (!list.length) return '<p class="mute">Tidak ada anggota ditemukan.</p>';
  return list.map(function (m) {
    return '<div class="s"><div class="row sp"><div><b>' + esc(m.nama_panggilan || m.nama || "-") + '</b> <span class="mute">' + esc(m.id_anggota || "") + '</span>' +
      '<div class="mute">' + esc(m.email || "") + '</div></div><button class="sm" data-act="resetpw" data-v="' + esc(m.user_id) + '">Reset</button></div></div>';
  }).join("");
}

function unlinkedRows() {
  if (S.unl === null) return '<p class="mute">Memuat...</p>';
  var q = S.asq.trim().toLowerCase();
  var list = S.unl.filter(function (m) {
    return !q || [m.nama_panggilan, m.nama, m.id_anggota].join(" ").toLowerCase().indexOf(q) >= 0;
  }).slice(0, 30);
  if (!list.length) return '<p class="mute">Semua anggota sudah punya akun.</p>';
  return list.map(function (m) {
    return '<div class="s"><div class="row sp"><div><b>' + esc(m.nama_panggilan || m.nama || "-") + '</b> <span class="mute">' + esc(m.id_anggota || "") + '</span></div>' +
      '<button class="sm" data-act="mkuser" data-v="' + esc(m.id) + '">Buat akun</button></div></div>';
  }).join("");
}

function genPw() {
  var a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = new Uint32Array(10), o = "";
  crypto.getRandomValues(r);
  for (var i = 0; i < r.length; i++) o += a[r[i] % a.length];
  return o;
}

function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function fdt(x) { if (!x) return ""; var d = new Date(x); return ymd(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
function csvCell(v) {
  var s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s; // cegah rumus di Excel
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildCsv(rows, names) {
  var head = ["Tanggal", "ID Sesi", "ID Anggota", "Nama", "Colokan", "Status", "Target (Poin)", "Terpakai (Poin)", "Tarif per 1 Poin (Rp)", "Total (Rp)", "Dibayar Coin (Rp)", "QRIS (Rp)", "Status Bayar", "Waktu Lunas", "Alasan Berhenti"];
  var rn = function (n) { return n == null ? "" : Math.round(Number(n)); };
  var pn = function (n) { return n == null ? "" : poin(n); };
  var lines = [head].concat(rows.map(function (x) {
    var a = names[x.member_id] || {};
    return [fdt(x.created_at), x.id, a.id_anggota || "", a.nama_panggilan || a.nama || "", x.outlet_id, x.status, pn(x.target_wh), pn(x.used_wh), rn(x.tariff_per_kwh),
      rn(x.amount_idr), rn(x.amount_coin), x.amount_idr == null ? "" : rn(x.amount_qris != null ? x.amount_qris : x.amount_idr), x.payment_status || "", fdt(x.paid_at), x.stop_reason || ""];
  }));
  return lines.map(function (l) { return l.map(csvCell).join(";"); }).join("\r\n");
}
async function pageAll(table) {
  var from = new Date(S.exFrom + "T00:00:00"), to = new Date(S.exTo + "T00:00:00"); to.setDate(to.getDate() + 1);
  var out = [], off = 0;
  while (true) {
    var q = sb.from(table).select("*").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).order("created_at", { ascending: true }).range(off, off + 999);
    if (S.exUser) q = q.eq("user_id", S.exUser);
    var r = await q;
    if (r.error) throw new Error("Gagal mengambil data: " + r.error.message);
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < 1000) break;
    off += 1000;
  }
  return out;
}
async function fetchLedger() { return { rows: await pageAll("charge_coin_ledger") }; }
async function fetchExport() {
  var out = await pageAll("charge_sessions");
  var ids = [], names = {};
  out.forEach(function (x) { if (x.member_id != null && ids.indexOf(x.member_id) < 0) ids.push(x.member_id); });
  for (var i = 0; i < ids.length; i += 150) {
    var m = await sb.from("anggota_omb").select("id,id_anggota,nama,nama_panggilan").in("id", ids.slice(i, i + 150));
    (m.data || []).forEach(function (a) { names[a.id] = a; });
  }
  return { rows: out, names: names };
}
function buildLedgerCsv(rows) {
  var kinds = { topup: "Isi saldo", spend: "Pemakaian", adjust: "Koreksi" };
  var mem = {};
  (S.members || []).forEach(function (m) { mem[m.user_id] = m; });
  var head = ["Tanggal", "ID Anggota", "Nama", "Jenis", "Jumlah (Coin)", "Saldo Setelahnya (Coin)", "ID Sesi", "Keterangan", "Diproses Oleh"];
  var lines = [head].concat(rows.map(function (x) {
    var m = mem[x.user_id] || {}, a = mem[x.created_by];
    var by = x.created_by ? (a ? (a.nama_panggilan || a.nama || "Admin") : "Admin") : "Sistem";
    return [fdt(x.created_at), m.id_anggota || "", m.nama_panggilan || m.nama || "", kinds[x.kind] || x.kind, Math.round(Number(x.delta)), Math.round(Number(x.balance_after)), x.session_id || "", x.note || "", by];
  }));
  return lines.map(function (l) { return l.map(csvCell).join(";"); }).join("\r\n");
}
function downloadCsv(name, text) {
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
}
function exportCard() {
  var opts = '<option value="">Semua anggota</option>' + (S.members || []).slice().sort(function (a, b) {
    return String(a.nama_panggilan || a.nama || "").localeCompare(String(b.nama_panggilan || b.nama || ""));
  }).map(function (m) {
    return '<option value="' + esc(m.user_id) + '"' + (S.exUser === m.user_id ? " selected" : "") + '>' + esc((m.nama_panggilan || m.nama || m.email) + (m.id_anggota ? " (" + m.id_anggota + ")" : "")) + '</option>';
  }).join("");
  return '<h2>Export CSV</h2><div class="card"><div class="mute">Rekap per periode, bisa dibuka di Excel atau Google Sheets. Filter anggota berlaku untuk keduanya.</div>' +
    '<div class="row" style="margin-top:8px"><div style="flex:1"><label class="mute" for="ef">Dari</label><input id="ef" type="date" value="' + esc(S.exFrom) + '"></div>' +
    '<div style="flex:1"><label class="mute" for="et">Sampai</label><input id="et" type="date" value="' + esc(S.exTo) + '"></div></div>' +
    '<label class="mute" for="eu">Anggota</label><select id="eu">' + opts + '</select>' +
    '<button class="big acc" style="margin-top:10px" data-act="export">Unduh Sesi Charge</button>' +
    '<button class="big ghost" style="margin-top:8px" data-act="exportcoin">Unduh Mutasi Coin</button></div>';
}

function who(uid) {
  var m = (S.members || []).filter(function (x) { return x.user_id === uid; })[0];
  return m ? (m.nama_panggilan || m.nama || m.email) + (m.id_anggota ? " (" + m.id_anggota + ")" : "") : "Anggota";
}
function dt(x) { return new Date(x).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }

function bal(uid) { return S.wallets[uid] || 0; }
function cf(n) { return Number(n || 0).toLocaleString("id-ID"); }
function tsRows() {
  if (S.members === null) return '<p class="mute">Memuat...</p>';
  var q = S.tsq.trim().toLowerCase();
  var list = S.members.filter(function (m) {
    return !q || [m.nama_panggilan, m.id_anggota, m.email].join(" ").toLowerCase().indexOf(q) >= 0;
  }).sort(function (a, b) { return bal(b.user_id) - bal(a.user_id); }).slice(0, 20);
  if (!list.length) return '<p class="mute">Tidak ada anggota ditemukan.</p>';
  return list.map(function (m) {
    return '<div class="s"><div class="row sp"><div><b>' + esc(m.nama_panggilan || m.nama || "-") + '</b> <span class="mute">' + esc(m.id_anggota || "") + '</span><div class="mute">Saldo <b class="' + (bal(m.user_id) > 0 ? "pos" : "") + '">' + cf(bal(m.user_id)) + ' Coin</b></div></div>' +
      '<button class="sm" data-act="topupman" data-v="' + esc(m.user_id) + '">Isi saldo</button></div></div>';
  }).join("");
}

function sessRow(x) {
  var btn = "";
  if (x.payment_status === "unpaid") btn += '<button class="sm acc" data-act="paid" data-v="' + x.id + '">Tandai lunas</button> ';
  if (x.status === "running") btn += '<button class="sm ghost" data-act="finish" data-v="' + x.id + '">Selesaikan manual</button> ';
  if (x.status === "pending") btn += '<button class="sm ghost" data-act="cancel" data-v="' + x.id + '">Batalkan</button> ';
  var pay = x.payment_status === "paid" ? "paid" : x.payment_status === "unpaid" ? "unpaid" : "";
  var cn = Number(x.amount_coin || 0);
  var tagih = x.payment_status === "unpaid" ? '<div><b>Tagih QRIS ' + rp(x.amount_qris != null ? x.amount_qris : x.amount_idr) + '</b>' + (cn ? ' <span class="mute">(coin ' + rp(cn) + ' sudah terpakai)</span>' : '') + '</div>' : (cn ? '<div class="mute">Coin ' + rp(cn) + (x.amount_qris ? ' · QRIS ' + rp(x.amount_qris) : '') + '</div>' : '');
  return '<div class="s"><div class="row sp"><b>' + esc(S.names[x.member_id] || "Member " + x.member_id) + '</b><span class="tag ' + (x.status === "running" ? "run" : pay) + '">' + esc(x.payment_status === "unpaid" ? "belum bayar" : x.status) + '</span></div>' +
    '<div class="mute">Colokan ' + x.outlet_id + ' - ' + dt(x.created_at) + '</div>' +
    '<div>' + (x.used_wh != null ? poin(x.used_wh) + ' Poin, ' + rp(x.amount_idr) : 'Target ' + poin(x.target_wh) + ' Poin') +
    (x.status === "running" ? ' <span class="mute">(terakhir ' + poin((x.last_wh || x.start_wh) - x.start_wh) + ' Poin)</span>' : "") + '</div>' + tagih +
    (x.stop_reason ? '<div class="mute">Berhenti: ' + esc(x.stop_reason) + '</div>' : "") +
    (btn ? '<div class="row" style="margin-top:6px;flex-wrap:wrap">' + btn + '</div>' : "") + '</div>';
}

function adminView() {
  var tabs = [["topup", "💰", "Request Saldo", S.tops.length], ["sessions", "🕘", "Sesi Terbaru", S.unpaid.length], ["add", "➕", "Tambah Anggota", 0], ["reset", "🔑", "Reset Password", 0]];
  var menu = '<div class="admin-menu"><div class="admin-menu-inner">' + tabs.map(function (t) {
    return '<button class="' + (S.adminMenu === t[0] ? "active" : "") + '" data-act="adminmenu" data-v="' + t[0] + '">' + t[1] + ' ' + t[2] + (t[3] ? '<span class="badge">' + t[3] + '</span>' : "") + '</button>';
  }).join("") + '</div></div>';

  var run = S.all.filter(function (x) { return x.status === "pending" || x.status === "running"; });
  var rest = S.all.filter(function (x) { return x.payment_status !== "unpaid" && x.status !== "pending" && x.status !== "running"; });
  var sessionSection =
        S.outlets.map(function (o) {
      return '<button class="big bad" data-act="off" data-v="' + o.id + '">OFF darurat ' + esc(o.name) + '</button>';
    }).join("") +
    '<div class="card warnbox"><b>Belum bayar (' + S.unpaid.length + ')</b>' + (S.unpaid.length ? S.unpaid.map(sessRow).join("") : '<p class="mute">Semua sesi sudah lunas.</p>') + '</div>' +
    (run.length ? '<div class="card"><b>Sedang berjalan (' + run.length + ')</b>' + run.map(sessRow).join("") + '</div>' : "") +
    '<div class="card"><b>Sesi selesai terbaru</b>' + (rest.map(sessRow).join("") || '<p class="mute">Belum ada sesi.</p>') + '</div>' +
    exportCard() +
    '<h2>Tarif per 1.000 poin</h2><div class="card"><div class="mute">Sekarang ' + rp(S.tariff) + '. Sesi yang sudah berjalan tidak berubah.</div>' +
    '<div class="row" style="margin-top:8px"><input id="tf" type="number" inputmode="numeric" min="1" placeholder="Rupiah per 1.000 poin"><button data-act="tariff">Simpan tarif</button></div></div>';

  var totalCoin = { sum: 0, n: 0 };
  Object.keys(S.wallets).forEach(function (k) { if (S.wallets[k] > 0) { totalCoin.sum += S.wallets[k]; totalCoin.n++; } });
  var topupSection =
    '<h2 class="admin-section-title">Request isi saldo (' + S.tops.length + ')</h2><div class="card warnbox">' +
    (S.tops.length ? S.tops.map(function (x) {
      return '<div class="s"><div class="row sp"><div><b>' + esc(who(x.user_id)) + '</b><div class="mute">' + dt(x.created_at) + '</div><div class="mute">Saldo saat ini: ' + cf(bal(x.user_id)) + ' Coin</div></div>' +
        '<div style="text-align:right"><b>' + rp(x.amount) + '</b><br><button class="sm acc" style="margin-top:6px" data-act="topupok" data-v="' + x.id + '">Konfirmasi</button></div></div></div>';
    }).join("") : '<p class="mute">Tidak ada permintaan yang menunggu.</p>') + '</div>' +
    '<h2>Saldo anggota</h2><div class="card"><div class="mute">Total beredar <b>' + cf(totalCoin.sum) + ' Coin</b> · ' + totalCoin.n + ' anggota punya saldo. Isi manual untuk pembayaran tunai atau koreksi.</div>' +
    '<input id="ts" type="search" placeholder="Cari nama, ID anggota, atau email" value="' + esc(S.tsq) + '" style="margin-top:8px"><div id="tlist">' + tsRows() + '</div></div>';

  var addSection =
    '<h2 class="admin-section-title">Tambah akun anggota</h2><div class="card"><div class="mute">Anggota yang belum punya akun login.</div>' +
    '<input id="as" type="search" placeholder="Cari nama atau ID anggota" value="' + esc(S.asq) + '" style="margin-top:8px">' +
    '<div id="alist">' + unlinkedRows() + '</div></div>';
  var resetSection =
    '<h2 class="admin-section-title">Reset password anggota</h2><div class="card"><input id="ms" type="search" placeholder="Cari nama, ID anggota, atau email" value="' + esc(S.msq) + '">' +
    '<div id="mlist">' + memberRows() + '</div></div>';

  return menu + (S.adminMenu === "add" ? addSection : S.adminMenu === "reset" ? resetSection : S.adminMenu === "topup" ? topupSection : sessionSection);
}

// ===== AKSI =====
document.addEventListener("click", async function (e) {
  var b = e.target.closest("[data-act]"); if (!b) return;
  var act = b.dataset.act, v = b.dataset.v;
  try {
    if (act === "eye") {
      var pi = document.getElementById(v), sh = pi.type === "password";
      S.pwShow[v] = sh; pi.type = sh ? "text" : "password";
      b.innerHTML = eyeIc(sh); b.setAttribute("aria-label", sh ? "Sembunyikan password" : "Tampilkan password");
      pi.focus(); try { pi.setSelectionRange(pi.value.length, pi.value.length); } catch (e2) {}
      return;
    }
    if (act === "login") {
      var r = await sb.auth.signInWithPassword({ email: document.getElementById("em").value.trim(), password: document.getElementById("pw").value });
      if (r.error) return login("Email atau password salah.");
      return boot();
    }
    if (act === "logout") { await sb.auth.signOut(); S.user = null; S.profile = null; S.members = null; S.unl = null; S.pwOpen = false; S.np1 = ""; S.np2 = ""; S.sig = ""; S.pwShow = {}; return login(); }
    if (act === "tab") {
      S.tab = v; S.topupOpen = false; S.page = "home"; S.sub = null;
      if (v === "admin") S.adminMenu = "sessions";
      S.sig = "";
      return load();
    }
    if (act === "adminmenu") {
      S.adminMenu = v || "sessions";
      S.sig = "";
      return render();
    }
    if (act === "export" || act === "exportcoin") {
      if (!S.exFrom || !S.exTo || S.exFrom > S.exTo) return toast("Periode tidak valid");
      var coin = act === "exportcoin";
      if (coin && S.members === null) return toast("Daftar anggota belum dimuat, coba lagi sebentar");
      var lbl = b.textContent; b.disabled = true; b.textContent = "Menyiapkan...";
      try {
        var ex = coin ? await fetchLedger() : await fetchExport();
        if (!ex.rows.length) { toast("Tidak ada data pada periode itu"); return; }
        downloadCsv((coin ? "omb-mutasi-coin_" : "omb-sesi-charge_") + S.exFrom + "_sd_" + S.exTo + ".csv", coin ? buildLedgerCsv(ex.rows) : buildCsv(ex.rows, ex.names));
        toast(ex.rows.length + (coin ? " mutasi" : " sesi") + " diunduh");
      } finally { b.disabled = false; b.textContent = lbl; }
      return;
    }
    if (act === "rtab") { S.rtab = v; S.sig = ""; return render(); }
    if (act === "topupform") { S.tab = "charge"; S.topupOpen = true; S.sig = ""; return render(); }
    if (act === "topupback") { S.topupOpen = false; S.tamt = 0; S.sig = ""; return render(); }
    if (act === "tamt") { S.tamt = parseInt(v, 10); S.sig = ""; return render(); }
    if (act === "topupgo") {
      if (!(S.tamt >= 5000 && S.tamt <= 1000000)) return toast("Nominal Rp5.000 - Rp1.000.000");
      b.disabled = true;
      var tr = await api("/topup", { amount: S.tamt });
      S.topup = tr.topup; S.tamt = 0; S.sig = ""; return render();
    }
    if (act === "topupcancel") {
      b.disabled = true;
      await api("/topup/cancel", {});
      S.topup = null; S.tamt = 0; S.sig = ""; return render();
    }
    if (act === "topupok") {
      var tp = (S.tops || []).filter(function (x) { return x.id === v; })[0];
      if (!confirm("Konfirmasi pembayaran " + rp(tp ? tp.amount : 0) + " dari " + who(tp && tp.user_id) + "?\nSaldo coin langsung bertambah.")) return;
      await api("/admin/topup-confirm", { topup_id: v });
      toast("Saldo coin ditambahkan");
    }
    if (act === "topupman") {
      var amt = prompt("Nominal coin untuk " + who(v) + " (1 coin = Rp1; angka minus untuk koreksi):", "");
      if (amt === null) return;
      amt = parseInt(amt, 10);
      if (!amt) return toast("Nominal tidak valid");
      await api("/admin/topup", { user_id: v, amount: amt, note: "Isi saldo manual" });
      toast("Saldo diperbarui");
    }
    if (act === "outlet") {
      var o = S.outlets.filter(function (x) { return String(x.id) === v; })[0];
      if (!o || !o.is_available) return toast("Colokan tidak tersedia");
      if (S.busy[o.id]) return toast("Colokan sedang dipakai");
      S.outlet = o.id; S.sig = ""; return render();
    }
    if (act === "page") { S.page = v; S.sig = ""; window.scrollTo(0, 0); return render(); }
    if (act === "sub") { S.sub = S.sub === v ? null : v; S.sig = ""; return render(); }
    if (act === "soon") return toast(v + " belum tersedia");
    if (act === "help") { window.open("https://wa.me/6285128052599", "_blank"); return; }
    if (act === "rcoin") { S.tab = "riwayat"; S.rtab = "coin"; S.sig = ""; return load(); }
    if (act === "seen") { try { localStorage.setItem("omb_seen", String(S.sess.id)); } catch (e2) {} S.sig = ""; return render(); }
    if (act === "stopask") { S.stopDlg = true; S.sig = ""; return render(); }
    if (act === "stopno") { S.stopDlg = false; S.sig = ""; return render(); }
    if (act === "inputid") {
      var iv = prompt("Masukkan nomor/ID Lokasi:", ""); if (iv === null) return;
      if (openCharger(iv)) { S.sig = ""; return render(); }
      return;
    }
    if (act === "pwform") { S.pwOpen = !S.pwOpen; S.np1 = ""; S.np2 = ""; S.sig = ""; return render(); }
    if (act === "pwsave") {
      var n1 = document.getElementById("np1").value, n2 = document.getElementById("np2").value;
      if (n1.length < 8) return toast("Password minimal 8 karakter");
      if (n1 !== n2) return toast("Ulangi password tidak sama");
      b.disabled = true;
      var ur = await sb.auth.updateUser({ password: n1 });
      if (ur.error) {
        var em = String(ur.error.message || "");
        throw new Error(/same/i.test(em) ? "Password baru tidak boleh sama dengan yang lama" : "Gagal mengubah password: " + em);
      }
      S.pwOpen = false; S.np1 = ""; S.np2 = ""; S.sig = ""; render(); return toast("Password berhasil diubah");
    }
    if (act === "mkuser") {
      var am = (S.unl || []).filter(function (m) { return String(m.id) === v; })[0];
      if (!am) return;
      var an = am.nama_panggilan || am.nama || "anggota";
      var em0 = String(an).toLowerCase().replace(/[^a-z0-9]+/g, "") + "@omb.id";
      var em = prompt("Email login untuk " + an + " (" + am.id_anggota + "):", em0);
      if (em === null) return;
      em = em.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return toast("Format email tidak valid");
      var pw0 = prompt("Password awal (minimal 8 karakter). Boleh diganti:", genPw());
      if (pw0 === null) return;
      pw0 = pw0.trim();
      if (pw0.length < 8) return toast("Password minimal 8 karakter");
      await api("/admin/create-user", { member_id: am.id, email: em, password: pw0 });
      alert("Akun " + an + " berhasil dibuat.\n\nEmail: " + em + "\nPassword: " + pw0 + "\n\nSampaikan ke anggota, lalu minta segera menggantinya lewat tombol Password.");
      S.unl = null; S.members = null; S.sig = ""; return load();
    }
    if (act === "resetpw") {
      var mem = (S.members || []).filter(function (m) { return m.user_id === v; })[0];
      var nm = mem ? (mem.nama_panggilan || mem.email) : "anggota";
      var np = prompt("Password baru untuk " + nm + " (minimal 8 karakter). Boleh diganti:", genPw());
      if (np === null) return;
      np = np.trim();
      if (np.length < 8) return toast("Password minimal 8 karakter");
      await api("/admin/reset-password", { user_id: v, new_password: np });
      alert("Password " + nm + " sudah direset.\n\nPassword baru: " + np + "\n\nSampaikan ke anggota, lalu minta segera menggantinya lewat tombol Password.");
      return;
    }
    if (act === "tgt") {
      var nv = v === "custom" ? "custom" : parseInt(v, 10);
      S.tgt = (S.tgt === nv) ? null : nv; // tekan lagi = batal pilih
      S.custom = ""; S.sig = ""; return render();
    }
    if (act === "start") {
      var o2 = S.outlets.filter(function (x) { return x.id === S.outlet; })[0];
      if (!o2 || !o2.is_available) return toast("Colokan tidak tersedia");
      if (S.busy[o2.id]) return toast("Colokan sedang dipakai");
      var tw = tgtVal();
      if (!tw) return toast("Pilih atau isi jumlah poin dulu");
      if (tw > S.maxWh) return toast("Maksimal " + poin(S.maxWh) + " poin");
      b.disabled = true;
      await api("/session", { outlet_id: S.outlet, target_wh: tw });
      S.tgt = null; S.custom = ""; S.page = "home";
      toast("Menunggu perangkat menyalakan colokan");
    }
    if (act === "stop") {
      S.stopDlg = false;
      b.disabled = true;
      var sr = await api("/session/stop", {});
      toast(sr.action === "pending_cancelled" ? "Sesi dibatalkan" : "Perintah stop dikirim");
    }
    if (act === "paid") await api("/admin/paid", { session_id: v });
    if (act === "cancel") await api("/admin/finish", { session_id: v, action: "cancel" });
    if (act === "finish") {
      if (!confirm("Selesaikan sesi dengan poin dari status terakhir perangkat?")) return;
      await api("/admin/finish", { session_id: v });
    }
     if (act === "off") {
      var oid = parseInt(v, 10) || 1;
      if (!confirm("Matikan colokan " + oid + " sekarang?")) return;
      var res = await api("/admin/off", { outlet_id: oid });
      toast(res.action === "stop_requested" ? "Perintah OFF dikirim, relay mati dalam beberapa detik" : "OFF diproses: " + res.action);
    }
    if (act === "tariff") {
      var p = parseInt(document.getElementById("tf").value, 10);
      if (!p || p < 1) return toast("Isi tarif dalam rupiah");
      var ins = await sb.from("charge_tariffs").insert({ price_per_kwh: p });
      if (ins.error) throw new Error("Gagal menyimpan tarif");
      toast("Tarif disimpan");
    }
    S.sig = ""; load();
  } catch (err) { toast(err.message); b.disabled = false; }
});

// ===== PROFIL ANGGOTA (tabel anggota_omb: id_anggota, nama_panggilan) =====
async function loadProfile() {
  var u = S.user, m = null, errs = [];
  // Utamakan RPC my_member() (charge_profiles -> anggota_omb), aman untuk user biasa.
  try {
    var rp0 = await sb.rpc("my_member");
    if (!rp0.error && rp0.data && rp0.data[0]) { S.profile = { id: rp0.data[0].id_anggota, nama: rp0.data[0].nama_panggilan }; return; }
    if (rp0.error) errs.push("my_member: " + rp0.error.message);
  } catch (e) { errs.push("my_member: " + e.message); }
  async function tryQ(col, val) {
    if (m || val == null || val === "") return;
    try {
      var r = await sb.from("anggota_omb").select("id_anggota,nama_panggilan").eq(col, val).limit(1);
      if (r.error) errs.push(col + ": " + r.error.message);
      else if (r.data && r.data[0]) m = r.data[0];
    } catch (e) { errs.push(col + ": " + e.message); }
  }
  await tryQ("user_id", u.id);
  await tryQ("auth_user_id", u.id);
  await tryQ("email", u.email);
  if (S.sess) { await tryQ("id", S.sess.member_id); await tryQ("id_anggota", S.sess.member_id); }
  if (!m && errs.length) console.warn("Profil anggota tidak ditemukan:", errs);
  S.profile = m ? { id: m.id_anggota, nama: m.nama_panggilan } : null;
}

async function boot() {
  var s = (await sb.auth.getSession()).data.session;
  if (!s) return login();
  S.user = s.user;
  var a = await sb.from("charge_admins").select("user_id").eq("user_id", s.user.id).maybeSingle();
  S.admin = !!(a.data);
  await load();
  await loadProfile();
  await loadLokasi();
  if (PEND) {
    var pid = PEND; PEND = null;
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    openCharger(pid);
  }
  S.sig = ""; render();
}
document.addEventListener("input", function (e) {
  var id = e.target.id;
  if (id === "cp") { S.custom = e.target.value; S.tgt = "custom"; document.querySelectorAll(".chips .sel").forEach(function (c) { c.classList.remove("sel"); }); var sb = document.getElementById("startBtn"); if (sb) sb.disabled = !tgtVal(); var eb = document.getElementById("estbox"); if (eb) eb.innerHTML = estHtml(); }
  if (id === "ta") { S.tamt = parseInt(e.target.value, 10) || 0; document.querySelectorAll(".chips button").forEach(function (c) { c.classList.toggle("sel", parseInt(c.dataset.v, 10) === S.tamt); }); var tb = document.getElementById("topupBtn"); if (tb) tb.disabled = !(S.tamt >= 5000 && S.tamt <= 1000000); }
  if (id === "ts") { S.tsq = e.target.value; var tl = document.getElementById("tlist"); if (tl) tl.innerHTML = tsRows(); }
  if (id === "ef") S.exFrom = e.target.value;
  if (id === "et") S.exTo = e.target.value;
  if (id === "eu") S.exUser = e.target.value;
  if (id === "np1") S.np1 = e.target.value;
  if (id === "np2") S.np2 = e.target.value;
  if (id === "as") { S.asq = e.target.value; var al = document.getElementById("alist"); if (al) al.innerHTML = unlinkedRows(); }
  if (id === "ms") { S.msq = e.target.value; var ml = document.getElementById("mlist"); if (ml) ml.innerHTML = memberRows(); }
});
setInterval(function () { if (S.user && document.visibilityState === "visible") load(); }, 4000);
boot();
if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
setInterval(function () { document.querySelectorAll("[data-since]").forEach(function (e) { e.textContent = mm((Date.now() - Number(e.dataset.since)) / 1000); }); }, 1000);

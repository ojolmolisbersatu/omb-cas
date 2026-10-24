// Web admin mitra OMB Charger. Terpisah dari aplikasi pengguna: sesi login punya kunci sendiri (omb-admin-auth),
// jadi masuk di sini tidak ikut masuk ke aplikasi pengguna, dan sebaliknya.
(function () {
  var SUPABASE_URL = "https://yloxoxgvedepmegihver.supabase.co", ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsb3hveGd2ZWRlcG1lZ2lodmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3Mzk4NDYsImV4cCI6MjEwMzMxNTg0Nn0.b74It13ynjkLSBqsvyuYbWmo0TkL0ztb1bj9d8TAerc";
  var sb = supabase.createClient(SUPABASE_URL, ANON_KEY, { auth: { storageKey: "omb-admin-auth" } });
  var root = document.getElementById("app");
  var A = { tab: "pantau", isAdmin: false, user: null, ov: [], sid: null, rows: [], from: ymd(new Date()), to: ymd(new Date()) };

  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rp(n) { return "Rp" + Number(n || 0).toLocaleString("id-ID"); }
  function poin(wh) { return (Number(wh || 0) / 1000).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function dt(x) { return new Date(x).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function toast(m) { var d = document.createElement("div"); d.className = "toast"; d.textContent = m; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3500); }
  function $id(i) { return document.getElementById(i); }
  function station() { return A.ov.filter(function (s) { return s.station_id === A.sid; })[0]; }

  function loginView(err) {
    root.innerHTML = '<div class="box"><h1>OMB Charger</h1><p class="mute">Web admin mitra</p><div class="card">' +
      '<label class="mute" for="em">Email</label><input id="em" type="email" autocomplete="username">' +
      '<label class="mute" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password">' +
      '<p class="mute" style="color:var(--bad)">' + esc(err || "") + '</p><button class="big acc" data-a="login">Masuk</button></div></div>';
  }

  function monitor() {
    var s = station();
    var opts = A.ov.map(function (x) { return '<option value="' + x.station_id + '"' + (x.station_id === A.sid ? " selected" : "") + ">" + esc(x.station_name) + "</option>"; }).join("");
    $id("v").innerHTML = '<div class="card"><label class="mute" for="st">Lokasi</label><select id="st">' + opts + "</select>" +
      '<div class="mute">' + esc(s ? s.address || "" : "") + "</div></div>" +
      '<h2>Status colokan</h2><div id="live" class="grid"></div>' +
      '<h2>Riwayat</h2><div class="card"><div class="row"><div style="flex:1"><label class="mute" for="df">Dari</label><input id="df" type="date" value="' + A.from + '"></div>' +
      '<div style="flex:1"><label class="mute" for="dtt">Sampai</label><input id="dtt" type="date" value="' + A.to + '"></div></div>' +
      '<div class="row" style="margin-top:10px"><button class="acc" data-a="apply">Tampilkan</button><button class="ghost" data-a="csv">Unduh CSV</button></div></div>' +
      '<div id="sum" class="grid"></div><div class="card" style="overflow-x:auto"><table id="tbl"></table></div>';
    live(); data();
  }

  function live() {
    var s = station(), el = $id("live"); if (!el || !s) return;
    el.innerHTML = s.outlets.map(function (o) {
      var st = o.busy ? ["use", "Sedang dipakai"] : o.is_available ? ["", "Tersedia"] : ["off", "Nonaktif"];
      return '<div class="card"><b>' + esc(o.name) + '</b><div class="mute"><span class="dot ' + st[0] + '"></span>' + st[1] + "</div></div>";
    }).join("") || '<p class="mute">Belum ada colokan.</p>';
  }

  function stat(x) {
    return x.status === "pending" || x.status === "running" ? "Berjalan" : x.payment_status === "paid" ? "Lunas" : x.payment_status === "unpaid" ? "Belum bayar" : esc(x.status);
  }
  function data() {
    var r = A.rows, wh = 0, paid = 0, unpaid = 0;
    r.forEach(function (x) {
      wh += Number(x.used_wh || 0);
      if (x.payment_status === "paid") paid += Number(x.amount_idr || 0);
      if (x.payment_status === "unpaid") unpaid += Number(x.amount_idr || 0);
    });
    var sum = $id("sum"), tb = $id("tbl"); if (!sum || !tb) return;
    sum.innerHTML = [["Jumlah sesi", r.length], ["Energi (Poin)", poin(wh)], ["Pendapatan lunas", rp(paid)], ["Belum dibayar", rp(unpaid)]].map(function (x) {
      return '<div class="card"><span class="mute">' + x[0] + '</span><div class="num">' + x[1] + "</div></div>";
    }).join("");
    var name = {}; (station() || { outlets: [] }).outlets.forEach(function (o) { name[o.id] = o.name; });
    tb.innerHTML = "<tr><th>Waktu</th><th>Colokan</th><th>Status</th><th>Poin</th><th>Total</th></tr>" + (r.length ? r.map(function (x) {
      return "<tr><td>" + dt(x.created_at) + "</td><td>" + esc(name[x.outlet_id] || x.outlet_id) + "</td><td>" + stat(x) + "</td><td>" + poin(x.used_wh) + "</td><td>" + (x.amount_idr == null ? "-" : rp(x.amount_idr)) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="mute">Tidak ada sesi pada periode ini.</td></tr>');
  }

  async function overview() {
    var r = await sb.rpc("partner_overview");
    if (r.error) return toast("Gagal memuat: " + r.error.message);
    A.ov = r.data || [];
    if (!A.ov.length && A.isAdmin) { A.sid = null; return true; }
    if (!A.ov.length) { root.innerHTML = '<div class="box"><div class="card">Akun ini belum terhubung ke lokasi mana pun. Hubungi admin OMB.</div><button class="ghost big" data-a="logout">Keluar</button></div>'; return false; }
    if (!station()) A.sid = A.ov[0].station_id;
    return true;
  }
  async function rows() {
    var to = new Date(A.to + "T00:00:00"); to.setDate(to.getDate() + 1);
    var r = await sb.rpc("partner_sessions", { p_station: A.sid, p_from: new Date(A.from + "T00:00:00").toISOString(), p_to: to.toISOString() });
    if (r.error) return toast("Gagal memuat riwayat: " + r.error.message);
    A.rows = r.data || []; data();
  }
  async function start() {
    var s = (await sb.auth.getSession()).data.session;
    if (!s) { A.user = null; return loginView(); }
    A.user = s.user;
    var q = await sb.rpc("is_main_admin"); A.isAdmin = q.data === true;
    if (await overview()) { shell(); if (A.tab === "pantau") await rows(); }
  }

  function csvCell(v) { var s = v == null ? "" : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csv() {
    if (!A.rows.length) return toast("Tidak ada data pada periode ini");
    var name = {}; station().outlets.forEach(function (o) { name[o.id] = o.name; });
    var L = [["Waktu", "ID Sesi", "Colokan", "Status", "Poin terpakai", "Tarif per 1.000 poin", "Total (Rp)", "Status bayar"]].concat(A.rows.map(function (x) {
      return [new Date(x.created_at).toLocaleString("id-ID"), String(x.id).slice(-6).toUpperCase(), name[x.outlet_id] || x.outlet_id, x.status, poin(x.used_wh), x.tariff_per_kwh, x.amount_idr == null ? "" : x.amount_idr, x.payment_status || ""];
    }));
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + L.map(function (l) { return l.map(csvCell).join(";"); }).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "mitra_" + A.from + "_sd_" + A.to + ".csv"; document.body.appendChild(a); a.click(); a.remove();
  }

  function shell() {
    root.innerHTML = '<header><b>OMB Charger · ' + (A.isAdmin ? "Admin" : "Mitra") + '</b><button class="ghost sm" data-a="logout">Keluar</button></header>' +
      (A.isAdmin ? '<div class="seg" style="grid-template-columns:repeat(3,1fr)"><button class="' + (A.tab === "pantau" ? "sel" : "") + '" data-a="tab" data-v="pantau">Pantau</button><button class="' + (A.tab === "kelola" ? "sel" : "") + '" data-a="tab" data-v="kelola">Kelola Lokasi</button><button class="' + (A.tab === "qr" ? "sel" : "") + '" data-a="tab" data-v="qr">QR Code</button></div>' : "") +
      '<div id="v"></div>';
    if (A.tab === "kelola") kelola(); else if (A.tab === "qr") qrTab(); else monitor();
  }

  // ===== Kelola Lokasi (admin utama) =====
  var SKIP = { id: 1, name: 1, is_available: 1, station_id: 1, created_at: 1, updated_at: 1 };
  function inp(l, k, v, t, ph) { return '<label class="mute">' + l + '</label><input data-f="' + k + '"' + (t ? ' type="' + t + '"' : "") + (ph ? ' placeholder="' + ph + '"' : "") + ' value="' + esc(v) + '">'; }
  function chk(l, k, v) { return '<label class="row" style="margin:8px 0"><input type="checkbox" data-f="' + k + '" style="width:auto"' + (v ? " checked" : "") + "> " + l + "</label>"; }
  function stForm(s) {
    s = s || { is_active: true, open_hours: "00:00-00:00" };
    return '<div class="frm" data-id="' + (s.id || "") + '">' + inp("Nama lokasi", "name", s.name) + inp("Alamat", "address", s.address) + inp("Foto (link gambar)", "photo_url", s.photo_url) +
      inp("Jam buka", "open_hours", s.open_hours) + chk("Lokasi aktif (tampil di aplikasi)", "is_active", s.is_active) +
      '<button class="acc" data-a="ssave">' + (s.id ? "Simpan lokasi" : "Tambah lokasi") + "</button></div>";
  }
  function ocForm(o, sid, tpl) {
    var ex = {}, src = o || tpl || {};
    Object.keys(src).forEach(function (k) { if (!SKIP[k]) ex[k] = o ? o[k] : null; });
    o = o || { is_available: true };
    return '<div class="frm card" data-id="' + (o.id == null ? "" : o.id) + '" data-sid="' + sid + '"><b>' + (o.id == null ? "Colokan baru" : "Colokan #" + o.id) + "</b>" + inp("Nama colokan", "name", o.name) +
      chk("Colokan aktif", "is_available", o.is_available) +
      '<label class="mute">Pengaturan alat (JSON: id perangkat dan kolom teknis lain)</label><textarea data-f="extra" rows="4">' + esc(JSON.stringify(ex, null, 1)) + "</textarea>" +
      '<button class="acc" data-a="osave">' + (o.id == null ? "Tambah colokan" : "Simpan colokan") + "</button></div>";
  }
  function ptForm(sid) {
    return '<div class="frm" data-sid="' + sid + '"><b>Tambah mitra</b>' + inp("Email", "email", "", "email") + inp("Nama mitra", "nama", "") +
      inp("Password (isi kalau akun baru, minimal 8 karakter)", "password", "", "password", "Kosongkan jika akun sudah ada") + '<button class="acc" data-a="padd">Tambah mitra</button></div>';
  }
  async function kelola() {
    var r = await sb.rpc("admin_overview");
    if (r.error) return toast("Gagal memuat: " + r.error.message);
    var d = r.data || [], el = $id("v"); if (!el) return;
    el.innerHTML = '<h2>Lokasi baru</h2><div class="card">' + stForm() + "</div>" + d.map(function (x) {
      var s = x.station, o = x.outlets;
      return '<h2>' + esc(s.name) + '</h2><div class="card">' + stForm(s) + "</div>" +
        '<div class="mute">Colokan</div>' + o.map(function (c) { return ocForm(c, s.id); }).join("") + ocForm(null, s.id, o[0]) +
        '<div class="card"><b>Mitra lokasi ini</b>' + (x.partners.length ? x.partners.map(function (p) {
          return '<div class="row" style="justify-content:space-between;margin:8px 0"><span>' + esc(p.nama || "-") + ' <span class="mute">' + esc(p.email) + '</span></span><button class="ghost sm" data-a="pdel" data-u="' + p.user_id + '" data-s="' + s.id + '">Lepas</button></div>';
        }).join("") : '<p class="mute">Belum ada mitra.</p>') + ptForm(s.id) + "</div>";
    }).join("");
  }

  // ===== QR Code charger (admin utama): satu QR per colokan, isinya tautan aplikasi ?charger=<id colokan> =====
  function qrBase() { var b = A.qb || new URL("./", location.href).href; return /\/$/.test(b) ? b : b + "/"; }
  async function qrTab() {
    var r = await sb.rpc("admin_overview");
    if (r.error) return toast("Gagal memuat: " + r.error.message);
    A.qr = r.data || []; qrDraw();
  }
  function qrDraw() {
    var el = $id("v"); if (!el) return;
    el.innerHTML = '<div class="card noprint"><b>QR Code Charger</b><div class="mute">Satu QR per colokan. Cetak lalu tempel di charger; saat discan, aplikasi membuka halaman pembayaran colokan itu.</div>' +
      '<label class="mute" for="qb">Alamat aplikasi (isi ulang bila domain berubah)</label><input id="qb" value="' + esc(qrBase()) + '">' +
      '<div class="row" style="margin-top:10px"><button class="acc" data-a="qrprint">Cetak semua</button></div></div><div id="qrsheet">' +
      (A.qr.length ? A.qr.map(function (x) {
        return '<h2>' + esc(x.station.name) + '</h2><div class="qgrid">' + (x.outlets.map(function (o) {
          return '<div class="qc" data-id="' + o.id + '" data-s="' + esc(x.station.name) + '" data-o="' + esc(o.name) + '"><b>' + esc(x.station.name) + '</b><div>' + esc(o.name) + '</div><div class="qr"></div>' +
            '<div class="mute">ID Charger: ' + o.id + '</div><div class="mute">Scan untuk mulai mengisi</div><button class="ghost sm noprint" style="margin-top:8px" data-a="qrpng">Unduh PNG</button></div>';
        }).join("") || '<p class="mute">Belum ada colokan.</p>') + '</div>';
      }).join("") : '<p class="mute">Belum ada lokasi.</p>') + '</div>';
    el.querySelectorAll(".qc").forEach(function (c) {
      try { new QRCode(c.querySelector(".qr"), { text: qrBase() + "?charger=" + c.dataset.id, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M }); }
      catch (e) { c.querySelector(".qr").textContent = "QR gagal dibuat"; }
    });
  }
  function qrPng(b) {
    var c = b.closest(".qc"), cv = c.querySelector("canvas"); if (!cv) return toast("QR belum siap");
    var o = document.createElement("canvas"); o.width = 360; o.height = 470;
    var g = o.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 360, 470); g.fillStyle = "#1B2A4A"; g.textAlign = "center";
    g.font = "bold 22px sans-serif"; g.fillText(c.dataset.s, 180, 40); g.font = "20px sans-serif"; g.fillText(c.dataset.o, 180, 70);
    g.drawImage(cv, 50, 90, 260, 260); g.font = "18px sans-serif"; g.fillText("ID Charger: " + c.dataset.id, 180, 395); g.fillText("Scan untuk mulai mengisi", 180, 425);
    var a = document.createElement("a"); a.href = o.toDataURL("image/png"); a.download = "qr-charger-" + c.dataset.id + ".png";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function vals(f) { var o = {}; f.querySelectorAll("[data-f]").forEach(function (e) { o[e.dataset.f] = e.type === "checkbox" ? e.checked : e.value.trim(); }); return o; }
  async function fnError(e) { try { return (await e.context.json()).message; } catch (x) { return e.message; } }
  async function manage(b) {
    var a = b.dataset.a, f = b.closest(".frm"), v = f ? vals(f) : {}, r;
    if (a === "tab") { A.tab = b.dataset.v; shell(); if (A.tab === "pantau") rows(); return; }
    if (a === "ssave") {
      if (!v.name) return toast("Isi nama lokasi");
      r = await sb.rpc("admin_save_station", { p: { id: f.dataset.id ? Number(f.dataset.id) : null, name: v.name, address: v.address || null, photo_url: v.photo_url || null, open_hours: v.open_hours || "00:00-00:00", is_active: v.is_active } });
    } else if (a === "osave") {
      var ex; try { ex = JSON.parse(v.extra || "{}"); } catch (e) { return toast("Pengaturan alat bukan JSON yang valid"); }
      if (!v.name) return toast("Isi nama colokan");
      var pl = Object.assign(ex, { name: v.name, is_available: v.is_available, station_id: Number(f.dataset.sid) });
      if (f.dataset.id !== "") pl.id = Number(f.dataset.id);
      r = await sb.rpc("admin_save_outlet", { p: pl });
    } else if (a === "pdel") {
      if (!confirm("Lepas mitra ini dari lokasi?")) return;
      r = await sb.rpc("admin_unlink_partner", { p_user: b.dataset.u, p_station: Number(b.dataset.s) });
    } else if (a === "padd") {
      if (!v.email) return toast("Isi email mitra");
      if (v.password) {
        r = await sb.functions.invoke("partner-admin", { body: { email: v.email, password: v.password, nama: v.nama, station_id: Number(f.dataset.sid) } });
        if (r.error) return toast(await fnError(r.error));
      } else {
        r = await sb.rpc("admin_link_partner", { p_email: v.email, p_station: Number(f.dataset.sid), p_nama: v.nama || null });
        if (!r.error && r.data === false) return toast("Email belum terdaftar. Isi password untuk membuat akun baru.");
      }
    } else return;
    if (r && r.error) return toast(r.error.message);
    toast("Tersimpan"); kelola();
  }

  async function login() {
    var r = await sb.auth.signInWithPassword({ email: $id("em").value.trim(), password: $id("pw").value });
    if (r.error) return loginView("Email atau password salah.");
    start();
  }
  document.addEventListener("click", async function (e) {
    var b = e.target.closest("[data-a]"); if (!b) return;
    try {
      if (b.dataset.a === "login") { b.disabled = true; await login(); }
      if (b.dataset.a === "logout") { await sb.auth.signOut(); A.user = null; loginView(); }
      if (b.dataset.a === "apply") {
        var f = $id("df").value, t = $id("dtt").value;
        if (!f || !t || f > t) return toast("Periode tidak valid");
        A.from = f; A.to = t; await rows();
      }
      if (b.dataset.a === "csv") csv();
      if (b.dataset.a === "qrprint") window.print();
      if (b.dataset.a === "qrpng") qrPng(b);
      await manage(b);
    } catch (err) { toast(err.message); b.disabled = false; }
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "qb") { A.qb = e.target.value.trim(); return qrDraw(); }
    if (e.target.id === "st") { A.sid = Number(e.target.value); shell(); rows(); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.id === "pw") login(); });

  setInterval(async function () { if (A.user && !document.hidden && await overview()) live(); }, 10000);
  setInterval(function () { if (A.user && !document.hidden && A.tab === "pantau" && A.to >= ymd(new Date())) rows(); }, 30000);
  start();
})();

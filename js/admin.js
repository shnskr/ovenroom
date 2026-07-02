(function () {
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isDemo = () => String(CONFIG.API_URL).includes("PASTE_YOUR");

  const STATUS_LABEL = { pending: "대기", approved: "승인", rejected: "거절", canceled: "취소" };
  let demoRows = null;

  function token() { return sessionStorage.getItem("ovenroom_admin_token") || ""; }
  function setToken(t) { sessionStorage.setItem("ovenroom_admin_token", t); }

  function toast(msg, ok) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (ok ? " ok" : " err");
    setTimeout(() => (t.className = "toast"), 3600);
  }

  function roomName(id) {
    const r = CONFIG.ROOMS.find((r) => r.id === id);
    return r ? r.name : id;
  }

  function seedDemo() {
    const today = dateStr(new Date());
    return [
      { id: "d1", room: "oven-room", date: today, start: "14:00", end: "16:00", name: "김민지", phone: "010-1234-5678", people: 2, memo: "합주 연습", status: "pending" },
      { id: "d2", room: "oven-room", date: today, start: "18:00", end: "19:00", name: "이서준", phone: "010-2222-3333", people: 1, memo: "", status: "approved" },
      { id: "d3", room: "oven-room", date: today, start: "20:00", end: "22:00", name: "박도윤", phone: "010-9876-5432", people: 4, memo: "보컬 연습", status: "pending" },
    ];
  }

  async function load() {
    const from = $("#fromDate").value;
    const to = $("#toDate").value;
    const body = $("#tableBody");
    body.innerHTML = `<tr><td colspan="7" class="hint">불러오는 중…</td></tr>`;
    try {
      let rows;
      if (isDemo()) {
        if (!demoRows) demoRows = seedDemo();
        rows = demoRows.filter((r) => r.date >= from && r.date <= to);
      } else {
        const res = await API.getReservations(token(), from, to);
        rows = res.reservations || [];
      }
      render(rows);
    } catch (e) {
      body.innerHTML = `<tr><td colspan="7" class="hint">${e.message}</td></tr>`;
      if (/토큰|권한|unauthorized/i.test(e.message)) showLogin();
    }
  }

  function actionsFor(status) {
    if (status === "pending") return [{ l: "승인", c: "ok", s: "approved" }, { l: "거절", c: "warn", s: "rejected" }];
    if (status === "approved") return [{ l: "취소", c: "warn", s: "canceled" }];
    return [{ l: "승인", c: "ok", s: "approved" }];
  }

  function render(rows) {
    const body = $("#tableBody");
    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="7" class="hint">해당 기간에 예약이 없습니다.</td></tr>`;
      return;
    }
    rows.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    body.innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.className = r.status;
      tr.innerHTML =
        `<td data-label="일시">${r.date}<br><span class="muted">${r.start}~${r.end}</span></td>` +
        `<td data-label="공간">${roomName(r.room)}</td>` +
        `<td data-label="예약자">${escapeHtml(r.name)}<br><span class="muted">${escapeHtml(r.phone)}</span></td>` +
        `<td data-label="인원">${r.people || 1}명</td>` +
        `<td data-label="요청사항">${escapeHtml(r.memo || "")}</td>` +
        `<td data-label="상태"><span class="badge ${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td>` +
        `<td class="actions" data-label="관리"></td>`;
      const cell = tr.querySelector(".actions");
      actionsFor(r.status).forEach((a) => cell.appendChild(actionBtn(a.l, a.c, () => change(r.id, a.s))));
      body.appendChild(tr);
    });
  }

  function actionBtn(label, cls, fn) {
    const b = document.createElement("button");
    b.className = "mini " + cls;
    b.textContent = label;
    b.onclick = fn;
    return b;
  }

  async function change(id, status) {
    if ((status === "canceled" || status === "rejected") && !confirm("진행할까요?")) return;
    try {
      if (isDemo()) {
        const row = demoRows.find((r) => r.id === id);
        if (row) row.status = status;
        toast("데모 모드: 상태가 변경되었습니다.", true);
      } else {
        await API.setStatus(token(), id, status);
        toast("변경되었습니다.", true);
      }
      load();
    } catch (e) {
      toast(e.message);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function showLogin() { $("#loginGate").style.display = "flex"; $("#adminApp").style.display = "none"; }
  function showApp() { $("#loginGate").style.display = "none"; $("#adminApp").style.display = "block"; }

  function init() {
    const today = new Date();
    const weekLater = new Date(); weekLater.setDate(today.getDate() + 7);
    $("#fromDate").value = dateStr(today);
    $("#toDate").value = dateStr(weekLater);

    $("#loginBtn").onclick = () => {
      const t = $("#tokenInput").value.trim();
      if (!t) return;
      setToken(t);
      showApp();
      load();
    };
    $("#logoutBtn").onclick = (e) => { e.preventDefault(); sessionStorage.removeItem("ovenroom_admin_token"); showLogin(); };
    $("#reloadBtn").onclick = load;

    if (isDemo() || token()) { showApp(); load(); } else { showLogin(); }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

(function () {
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isDemo = () => String(CONFIG.API_URL).includes("PASTE_YOUR");

  const STATUS_CSS = { "대기": "pending", "확정": "confirmed", "취소": "canceled" };
  const CAT_LABEL = { general: "일반", member: "쿠키박스 단원", team: "공연팀", credit: "쿠금통" };
  let demoRows = null;

  function token() { return sessionStorage.getItem("ovenroom_admin_token") || ""; }
  function setToken(t) { sessionStorage.setItem("ovenroom_admin_token", t); }

  function toast(msg, ok) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (ok ? " ok" : " err");
    setTimeout(() => (t.className = "toast"), 3600);
  }

  function catLabel(r) { return r.categoryLabel || CAT_LABEL[r.category] || r.category || "-"; }
  function fmtAmount(a) { return a == null || a === "" ? "-" : Number(a).toLocaleString() + "원"; }

  function seedDemo() {
    const today = dateStr(new Date());
    return [
      { id: "d1", date: today, start: "14:00", end: "16:00", name: "김민지", phone: "010-1234-5678", people: 2, category: "general", showName: "", amount: 15000, status: "대기" },
      { id: "d2", date: today, start: "18:00", end: "19:00", name: "이서준", phone: "010-2222-3333", people: 1, category: "member", showName: "", amount: 8000, status: "확정" },
      { id: "d3", date: today, start: "20:00", end: "22:00", name: "박도윤", phone: "010-9876-5432", people: 4, category: "team", showName: "가을 정기공연", amount: 16000, status: "대기" },
    ];
  }

  async function load() {
    const from = $("#fromDate").value;
    const to = $("#toDate").value;
    const body = $("#tableBody");
    body.innerHTML = `<tr><td colspan="8" class="hint">불러오는 중…</td></tr>`;
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
      body.innerHTML = `<tr><td colspan="8" class="hint">${e.message}</td></tr>`;
      if (/토큰|권한|unauthorized/i.test(e.message)) showLogin();
    }
  }

  function actionsFor(status) {
    if (status === "대기") return [{ l: "확정", c: "ok", s: "확정" }, { l: "취소", c: "warn", s: "취소" }];
    if (status === "확정") return [{ l: "취소", c: "warn", s: "취소" }];
    return [{ l: "확정", c: "ok", s: "확정" }];
  }

  function render(rows) {
    const body = $("#tableBody");
    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="8" class="hint">해당 기간에 예약이 없습니다.</td></tr>`;
      return;
    }
    rows.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    body.innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      const cssStatus = STATUS_CSS[r.status] || "";
      tr.className = cssStatus;
      tr.innerHTML =
        `<td data-label="일시">${r.date}<br><span class="muted">${r.start}~${r.end}</span></td>` +
        `<td data-label="예약자">${escapeHtml(r.name)}<br><span class="muted">${escapeHtml(r.phone)}</span></td>` +
        `<td data-label="인원">${r.people || 1}명</td>` +
        `<td data-label="구분">${escapeHtml(catLabel(r))}</td>` +
        `<td data-label="공연명">${escapeHtml(r.showName || "")}</td>` +
        `<td data-label="입금액">${fmtAmount(r.amount)}</td>` +
        `<td data-label="상태"><span class="badge ${cssStatus}">${escapeHtml(r.status)}</span></td>` +
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
    if (status === "취소" && !confirm("이 예약을 취소할까요? 캘린더 일정이 삭제됩니다.")) return;
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

(function () {
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isDemo = () => String(CONFIG.API_URL).includes("PASTE_YOUR");

  const STATUS_CSS = { "대기": "pending", "확정": "confirmed", "취소": "canceled" };
  const CAT_LABEL = { general: "일반", member: "쿠키박스 단원", team: "공연팀", credit: "쿠금통" };
  let demoRows = null;

  const AUTH_KEY = "ovenroom_admin_auth";
  let myInfo = null; // 서버가 알려준 내 계정 정보 { id, nick }
  let lastRows = []; // 마지막 조회 결과 (정렬 변경 시 재조회 없이 다시 그림)
  function auth() {
    try { return JSON.parse(sessionStorage.getItem(AUTH_KEY)); } catch (e) { return null; }
  }
  function setAuth(id, pw) { sessionStorage.setItem(AUTH_KEY, JSON.stringify({ id, pw })); }

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
      { id: "d1", createdAt: today + " 09:15", date: today, start: "14:00", end: "16:00", name: "김민지", phone: "010-1234-5678", people: 2, category: "general", showName: "", amount: 15000, status: "대기" },
      { id: "d2", createdAt: today + " 10:40", date: today, start: "18:00", end: "19:00", name: "이서준", phone: "010-2222-3333", people: 1, category: "member", showName: "", amount: 8000, status: "확정" },
      { id: "d3", createdAt: today + " 11:02", date: today, start: "20:00", end: "22:00", name: "박도윤", phone: "010-9876-5432", people: 4, category: "team", showName: "가을 정기공연", amount: 16000, status: "대기" },
    ];
  }

  // 체크된 상태 목록 (모두 해제 = 전체)
  const checkedStatuses = () => Array.from(document.querySelectorAll(".st-check:checked")).map((c) => c.value);

  async function load() {
    const from = $("#fromDate").value;
    const to = $("#toDate").value;
    const statuses = checkedStatuses();
    const body = $("#cardList");
    body.innerHTML = `<div class="hint rc-empty">불러오는 중…</div>`;
    try {
      let rows;
      if (isDemo()) {
        if (!demoRows) demoRows = seedDemo();
        rows = demoRows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!statuses.length || statuses.indexOf(r.status) >= 0));
      } else {
        const res = await API.getReservations(auth(), from, to, statuses.join(","));
        rows = res.reservations || [];
        // 로그인한 관리자 닉네임 표시
        if (res.admin) { myInfo = res.admin; $(".subtitle").textContent = "예약 신청 관리 · " + res.admin.nick + "님"; }
      }
      lastRows = rows;
      updateFilterNow();
      render(rows);
    } catch (e) {
      body.innerHTML = `<div class="hint rc-empty">${escapeHtml(e.message)}</div>`;
      if (/초기 비밀번호/.test(e.message)) { toast("먼저 비밀번호를 설정해 주세요."); openProfile(true); return; }
      if (/토큰|권한|비밀번호|unauthorized/i.test(e.message)) showLogin();
    }
  }

  // 내 정보 변경 창 — 초기 비밀번호로 들어온 첫 로그인도 이 창에서 설정
  function openProfile(firstLogin) {
    const a = auth() || {};
    $("#npId").value = (myInfo && myInfo.id) || a.id || "";
    $("#npNick").value = (myInfo && myInfo.nick) || "";
    $("#npPw").value = ""; $("#npPw2").value = "";
    $("#profileHint").textContent = firstLogin
      ? "첫 로그인입니다. 새 비밀번호를 설정해야 사용할 수 있어요."
      : "바꿀 항목만 입력하세요. 비워두면 그대로 유지됩니다.";
    $("#profileGate").style.display = "flex";
  }
  function closeProfile() { $("#profileGate").style.display = "none"; }

  async function saveProfile() {
    const a = auth();
    if (!a) { closeProfile(); showLogin(); return; }
    const newId = $("#npId").value.trim();
    const newNick = $("#npNick").value.trim();
    const p1 = $("#npPw").value.trim(), p2 = $("#npPw2").value.trim();
    if ((p1 || p2) && p1 !== p2) { toast("비밀번호 두 입력이 서로 달라요."); return; }
    const changes = {};
    if (newId && newId !== a.id) changes.newId = newId;
    if (newNick && (!myInfo || newNick !== myInfo.nick)) changes.newNick = newNick;
    if (p1) changes.newPassword = p1;
    if (!Object.keys(changes).length) { closeProfile(); return; }
    if (isDemo()) { toast("데모 모드에서는 변경할 수 없어요."); return; }
    const btn = $("#profileSaveBtn");
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>저장 중…';
    try {
      const res = await API.updateProfile(a, changes);
      setAuth(res.id, p1 || a.pw);
      myInfo = res;
      closeProfile();
      toast("내 정보가 변경되었습니다.", true);
      load();
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false; btn.textContent = "저장";
    }
  }

  function actionsFor(status) {
    if (status === "대기") return [{ l: "확정", c: "ok", s: "확정" }, { l: "취소", c: "warn", s: "취소" }];
    if (status === "확정") return [{ l: "취소", c: "warn", s: "취소" }];
    return [{ l: "확정", c: "ok", s: "확정" }];
  }

  const WK = ["일", "월", "화", "수", "목", "금", "토"];
  function fmtD(s) {
    const d = new Date(s + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}(${WK[d.getDay()]})`;
  }

  // 정렬: 예약 요청시간(created) 또는 사용일(date) 기준, 오름/내림차순
  function sortRows(rows) {
    const parts = $("#sortSel").value.split("-");
    const key = parts[0], dir = parts[1] === "desc" ? -1 : 1;
    const val = (r) => (key === "created" ? r.createdAt || "" : r.date + " " + r.start);
    return rows.slice().sort((a, b) => val(a).localeCompare(val(b)) * dir);
  }

  // 접힌 상태에서도 현재 검색 조건이 보이도록 요약 표시
  function updateFilterNow() {
    const sts = checkedStatuses();
    const st = sts.length === 0 || sts.length === 3 ? "전체" : sts.join("·");
    const from = $("#fromDate").value, to = $("#toDate").value;
    const period = !from && !to ? "전체 기간" : `${from || "…"} ~ ${to || "…"}`;
    $("#filterNow").textContent = `${st} · ${period}`;
  }

  function render(rows) {
    const body = $("#cardList");
    $("#listCount").textContent = rows.length + "건";
    if (rows.length === 0) {
      body.innerHTML = `<div class="hint rc-empty">조건에 맞는 예약이 없습니다.</div>`;
      return;
    }
    body.innerHTML = "";
    sortRows(rows).forEach((r) => {
      const cssStatus = STATUS_CSS[r.status] || "";
      const card = document.createElement("div");
      card.className = "res-card " + cssStatus;
      const show = r.showName ? ` · ${escapeHtml(r.showName)}` : "";
      const created = r.createdAt ? `<span class="rc-created">신청 ${escapeHtml(r.createdAt.slice(5))}</span>` : "";
      card.innerHTML =
        `<div class="rc-top"><span class="rc-when">${fmtD(r.date)} · ${r.start}~${r.end}</span><span class="badge ${cssStatus}">${escapeHtml(r.status)}</span></div>` +
        `<div class="rc-name">${escapeHtml(r.name)}<a class="rc-tel" href="tel:${escapeHtml(r.phone)}">${escapeHtml(r.phone)}</a></div>` +
        `<div class="rc-meta">${escapeHtml(catLabel(r))}${show} · ${r.people || 1}명 · ${fmtAmount(r.amount)}${created ? " · " : ""}${created}</div>` +
        `<div class="rc-foot">${r.handler ? `<span class="rc-handler">${escapeHtml(r.handler)}</span>` : "<span></span>"}<span class="rc-actions"></span></div>`;
      const cell = card.querySelector(".rc-actions");
      actionsFor(r.status).forEach((a) => cell.appendChild(actionBtn(a.l, a.c, (btn) => change(r.id, a.s, btn))));
      body.appendChild(card);
    });
  }

  function actionBtn(label, cls, fn) {
    const b = document.createElement("button");
    b.className = "mini " + cls;
    b.textContent = label;
    b.onclick = () => fn(b);
    return b;
  }

  async function change(id, status, btn) {
    if (status === "취소" && !confirm("이 예약을 취소할까요? 캘린더 일정이 삭제됩니다.")) return;
    // 처리 중: 같은 행 버튼 잠그고 누른 버튼에 스피너 표시 (성공 시 load()가 표를 새로 그림)
    const cellBtns = btn.closest(".rc-actions").querySelectorAll("button.mini");
    const label = btn.textContent;
    cellBtns.forEach((b) => (b.disabled = true));
    btn.innerHTML = `<span class="spinner"></span>처리중`;
    try {
      if (isDemo()) {
        const row = demoRows.find((r) => r.id === id);
        if (row) row.status = status;
        toast("데모 모드: 상태가 변경되었습니다.", true);
      } else {
        const res = await API.setStatus(auth(), id, status);
        if (res && res.creditWarning) toast("변경되었습니다 · ⚠️ " + res.creditWarning);
        else toast("변경되었습니다.", true);
      }
      load();
    } catch (e) {
      toast(e.message);
      btn.textContent = label;
      cellBtns.forEach((b) => (b.disabled = false));
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function showLogin() {
    $("#loginGate").style.display = "flex";
    $("#adminApp").style.display = "none";
    $("#headerLinks").style.display = "none"; // 로그인 전에는 내 정보 변경/로그아웃 숨김
    $(".subtitle").textContent = "예약 신청 관리";
  }
  function showApp() {
    $("#loginGate").style.display = "none";
    $("#adminApp").style.display = "block";
    $("#headerLinks").style.display = "flex";
  }

  function init() {
    // 예약 페이지와 같은 달력(flatpickr) — 기본은 비움(전체 기간), 값은 Y-m-d로 읽음
    const fpOpts = { altInput: true, altFormat: "Y년 n월 j일 (D)", dateFormat: "Y-m-d", locale: "ko", disableMobile: true };
    const fpFrom = flatpickr("#fromDate", fpOpts);
    const fpTo = flatpickr("#toDate", fpOpts);
    const appVisible = () => $("#adminApp").style.display === "block";
    document.querySelectorAll(".st-check").forEach((c) => c.addEventListener("change", () => {
      if (appVisible()) load(); else updateFilterNow();
    }));
    $("#sortSel").addEventListener("change", () => { if (appVisible()) render(lastRows); });
    $("#clearDatesBtn").addEventListener("click", () => {
      fpFrom.clear(); fpTo.clear();
      if (appVisible()) load(); else updateFilterNow();
    });
    updateFilterNow();

    // 로그인: 서버 검증에 성공해야만 화면 전환 (실패하면 로그인 화면 그대로)
    $("#loginBtn").onclick = async () => {
      const id = $("#idInput").value.trim();
      const pw = $("#pwInput").value.trim();
      if (!id || !pw) { toast("아이디와 비밀번호를 입력해 주세요."); return; }
      const btn = $("#loginBtn");
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>확인 중…';
      try {
        const res = await API.getReservations({ id, pw }, $("#fromDate").value, $("#toDate").value, checkedStatuses().join(","));
        setAuth(id, pw);
        showApp();
        if (res.admin) { myInfo = res.admin; $(".subtitle").textContent = "예약 신청 관리 · " + res.admin.nick + "님"; }
        lastRows = res.reservations || [];
        render(lastRows); // 검증하며 받아온 목록 그대로 표시 (재요청 없음)
      } catch (e) {
        if (/초기 비밀번호/.test(e.message)) {
          // 초기 비밀번호 인증 성공 → 비밀번호 설정부터
          setAuth(id, pw);
          showApp();
          $("#cardList").innerHTML = `<div class="hint rc-empty">${escapeHtml(e.message)}</div>`;
          toast("먼저 비밀번호를 설정해 주세요.");
          openProfile(true);
        } else {
          toast(e.message);
        }
      } finally {
        btn.disabled = false; btn.textContent = "입장";
      }
    };
    $("#pwInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#loginBtn").click(); });
    $("#logoutBtn").onclick = (e) => { e.preventDefault(); sessionStorage.removeItem(AUTH_KEY); myInfo = null; showLogin(); };
    $("#profileBtn").onclick = (e) => { e.preventDefault(); openProfile(false); };
    $("#profileSaveBtn").onclick = saveProfile;
    $("#profileCancelBtn").onclick = closeProfile;
    $("#profileGate").addEventListener("click", (e) => { if (e.target.id === "profileGate") closeProfile(); }); // 바깥(어두운 영역) 클릭 시 닫기
    $("#reloadBtn").onclick = load;

    if (isDemo() || auth()) { showApp(); load(); } else { showLogin(); }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

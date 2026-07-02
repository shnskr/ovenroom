(function () {
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const WK = ["일", "월", "화", "수", "목", "금", "토"];
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const toHHMM = (min) => pad(Math.floor(min / 60)) + ":" + pad(min % 60);
  const isDemo = () => String(CONFIG.API_URL).includes("PASTE_YOUR");
  let fp = null;
  let mode = "single";

  function toast(msg, ok) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (ok ? " ok" : " err");
    setTimeout(() => (t.className = "toast"), 3800);
  }

  function renderCalendar() {
    const wrap = $("#calendarWrap");
    if (String(CONFIG.CALENDAR_EMBED_URL).includes("PASTE_YOUR")) {
      wrap.innerHTML =
        '<div class="cal-placeholder">📅 여기에 <b>예약현황 캘린더</b>가 표시됩니다.' +
        '<br><span class="muted">배포 후 캘린더를 연결하면 실제 일정이 나타납니다.</span></div>';
      return;
    }
    let url = CONFIG.CALENDAR_EMBED_URL;
    if (window.innerWidth < 600 && !/[?&]mode=/.test(url)) {
      url += (url.indexOf("?") >= 0 ? "&" : "?") + "mode=AGENDA";
    }
    wrap.innerHTML =
      '<iframe class="cal-frame" src="' + url + '" frameborder="0" scrolling="no"></iframe>';
  }

  function maxDate() {
    const d = new Date();
    d.setDate(d.getDate() + CONFIG.BOOKABLE_DAYS_AHEAD);
    return d;
  }

  function makeMainPicker() {
    if (fp) fp.destroy();
    const opts = {
      mode: mode === "single" ? "single" : "multiple",
      altInput: true,
      altFormat: mode === "single" ? "Y년 n월 j일 (D)" : "n월 j일(D)",
      dateFormat: "Y-m-d",
      conjunction: ", ",
      locale: "ko",
      minDate: "today",
      maxDate: maxDate(),
      disableMobile: true,
      onChange: () => { updateSummary(); fillStartTimes(); },
    };
    fp = flatpickr("#date", opts);
  }

  function initRepeatPickers() {
    const opts = () => ({ altInput: true, altFormat: "n월 j일(D)", dateFormat: "Y-m-d", locale: "ko", minDate: "today", maxDate: maxDate(), disableMobile: true });
    flatpickr("#repeatFrom", opts());
    flatpickr("#repeatUntil", opts());
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll(".mode-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    $("#recurringBox").hidden = m !== "repeat";
    $("#dateField").hidden = m === "repeat";
    $("#dateSummary").hidden = m === "single";
    $("#multiHint").hidden = m === "single";
    $("#dateTip").textContent =
      m === "single" ? "하루만 선택" : m === "multiple" ? "여러 날을 눌러 선택" : "요일과 기간을 정해 적용하세요";
    makeMainPicker();
    updateSummary();
    fillStartTimes();
  }

  function priceTableHtml() {
    const P = CONFIG.PRICING;
    const section = (label, cls, bands) =>
      bands.map((b, i) => {
        const day = i === 0 ? `<td class="pt-day ${cls}" rowspan="${bands.length}">${label}</td>` : "";
        return `<tr>${day}<td>${pad(b.start)}시~${pad(b.end)}시</td><td class="pt-price ${cls}">${b.rate.toLocaleString()}원</td></tr>`;
      }).join("");
    return '<table class="price-table"><thead><tr><th>요일</th><th>시간</th><th>금액</th></tr></thead><tbody>' +
      section("평일<br>(월~금)", "wd", P.weekdayBands) +
      section("주말<br>(토~일)", "we", P.weekendBands) +
      "</tbody></table>";
  }

  function bandsFor(d) {
    const P = CONFIG.PRICING;
    return P.weekendDays.indexOf(d.getDay()) >= 0 ? P.weekendBands : P.weekdayBands;
  }

  function priceForRange(d, sMin, eMin) {
    let cost = 0;
    bandsFor(d).forEach((b) => {
      const overlap = Math.max(0, Math.min(eMin, b.end * 60) - Math.max(sMin, b.start * 60));
      cost += (overlap / 60) * b.rate;
    });
    return cost;
  }

  function calcTotal() {
    const cat = $("#category").value;
    if (cat === "credit") return null;
    const dates = selectedDates();
    const start = $("#startTime").value, end = $("#endTime").value;
    if (!dates.length || !start || !end) return null;
    const sMin = toMin(start), eMin = toMin(end);
    if (eMin <= sMin) return null;
    const P = CONFIG.PRICING;
    const hours = (eMin - sMin) / 60;
    const people = Number($("#people").value) || 1;
    const extra = Math.max(0, people - P.extraPersonThreshold);
    let total = 0;
    dates.forEach((d) => {
      let cost = priceForRange(d, sMin, eMin);
      if (cat === "general" || cat === "member") cost += extra * P.extraPersonFeePerHour * hours;
      if (cat === "member") cost *= 1 - P.memberDiscount;
      if (cat === "team") cost *= 1 - P.teamDiscount;
      total += cost;
    });
    return Math.round(total);
  }

  function updateTotal() {
    const dates = selectedDates();
    const start = $("#startTime").value, end = $("#endTime").value;
    const hours = start && end && toMin(end) > toMin(start) ? (toMin(end) - toMin(start)) / 60 : 0;
    const totalHours = hours * (dates.length || 0);

    const ttTop = $("#totalTimeTop");
    if (ttTop) {
      ttTop.textContent = totalHours ? totalHours + "시간" : "-";
      const meta = $("#totalTimeMetaTop");
      if (meta) meta.textContent = dates.length > 1 && hours ? ` (${dates.length}일 · 하루 ${hours}시간)` : "";
    }

    const use = $("#creditUse");
    if (use) {
      use.textContent = totalHours ? totalHours + "시간" : "-";
      return;
    }
    const amt = $("#totalAmount");
    if (!amt) return;
    const total = calcTotal();
    amt.textContent = total == null ? "-" : total.toLocaleString() + "원";
    const tt = $("#totalTime");
    if (tt) tt.textContent = totalHours ? totalHours + "시간" : "-";
    const metaB = $("#totalMetaBottom");
    if (metaB) metaB.textContent = dates.length > 1 && hours ? ` (${dates.length}일 · 하루 ${hours}시간)` : "";
  }

  function renderCategoryDetail() {
    const c = $("#category").value;
    const box = $("#categoryDetail");
    let html = "";
    if (c === "credit") {
      html += '<div class="cat-note">쿠금통 적립제 — 이름과 연락처 뒷 4자리로 잔여시간을 조회합니다.</div>';
      html += '<div class="credit-box">' +
        '<div class="credit-row"><span>추가 시간</span><b id="creditUse">-</b></div>' +
        '<div class="credit-row"><span>잔여 시간</span><b>시트 연동 후 표시</b></div>' +
        "</div>";
    } else {
      if (c === "team") {
        html += '<label>현재 참여 중인 공연명 <input type="text" id="showName" maxlength="50" placeholder="공연명" /></label>';
      }
      html += priceTableHtml();
      if (c === "general" || c === "member") {
        html += '<div class="surcharge-note">※ 예약인원 10명 초과 시 1시간당 1,000원(1인당) 추가됩니다.</div>';
      }
      if (c === "member" || c === "team") {
        html += '<div class="discount-note">※ 위 금액의 20% 할인된 금액으로 계산됩니다.</div>';
      }
      html += '<div class="total-box"><span class="tb-item">입금액 <b id="totalAmount">-</b></span><span class="tb-item">총 시간 <b id="totalTime">-</b><span class="total-meta" id="totalMetaBottom"></span></span></div>';
    }
    box.innerHTML = html;
    updateTotal();
  }

  function selectedDates() {
    return fp ? fp.selectedDates.slice().sort((a, b) => a - b) : [];
  }

  function updateSummary() {
    const el = $("#dateSummary");
    const dates = selectedDates();
    if (dates.length === 0) { el.textContent = "선택된 날짜가 없습니다."; return; }
    const parts = dates.map((d) => `${d.getMonth() + 1}월 ${d.getDate()}일(${WK[d.getDay()]})`);
    el.textContent = `선택 ${dates.length}일 · ` + parts.join(", ");
  }

  function fillWeekly() {
    const wdVal = $("#repeatWeekday").value;
    const fromV = $("#repeatFrom").value, untilV = $("#repeatUntil").value;
    if (!wdVal) { toast("반복할 요일을 선택해 주세요."); return; }
    if (!fromV || !untilV) { toast("시작일과 종료일을 선택해 주세요."); return; }
    const wd = Number(wdVal);
    const from = new Date(fromV + "T00:00:00"), until = new Date(untilV + "T00:00:00");
    if (until < from) { toast("종료일이 시작일보다 빠릅니다."); return; }
    const dates = [];
    const cur = new Date(from);
    while (cur <= until) {
      if (cur.getDay() === wd) dates.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    if (dates.length === 0) { toast("해당 요일이 기간 안에 없어요."); return; }
    fp.setDate(dates, true);
    toast(`${WK[wd]}요일 ${dates.length}일 적용됐어요`, true);
  }

  function fillStartTimes() {
    const open = CONFIG.OPEN_HOUR * 60, close = CONFIG.CLOSE_HOUR * 60, step = CONFIG.SLOT_MINUTES;
    const sel = $("#startTime");
    const prev = sel.value;
    const dates = selectedDates();
    const onlyToday = dates.length === 1 && dateStr(dates[0]) === dateStr(new Date());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    sel.innerHTML = '<option value="">시작 시간</option>';
    for (let t = open; t + step <= close; t += step) {
      if (onlyToday && t < nowMin) continue;
      const o = document.createElement("option");
      o.value = toHHMM(t); o.textContent = toHHMM(t);
      sel.appendChild(o);
    }
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    fillEndTimes();
  }

  function fillEndTimes() {
    const sel = $("#endTime");
    const prev = sel.value;
    sel.innerHTML = '<option value="">종료 시간</option>';
    const startVal = $("#startTime").value;
    if (startVal) {
      const step = CONFIG.SLOT_MINUTES, close = CONFIG.CLOSE_HOUR * 60;
      const start = toMin(startVal);
      const maxEnd = CONFIG.MAX_BOOKING_MINUTES > 0 ? Math.min(close, start + CONFIG.MAX_BOOKING_MINUTES) : close;
      for (let t = start + step; t <= maxEnd; t += step) {
        const o = document.createElement("option");
        o.value = toHHMM(t); o.textContent = toHHMM(t);
        sel.appendChild(o);
      }
    }
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    updateTotal();
  }

  function categoryLabel(c) {
    return { general: "일반", member: "쿠키박스 단원", team: "공연팀", credit: "쿠금통" }[c] || c;
  }

  function fmtDate(s) {
    const d = new Date(s + "T00:00:00");
    return `${pad(d.getMonth() + 1)}월 ${pad(d.getDate())}일 (${WK[d.getDay()]})`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function showConfirm(p, total) {
    const rows = [
      ["예약자명", p.name],
      ["예약자 연락처", p.phone],
      ["예약 일자", p.dates.map(fmtDate).join(", ")],
      ["예약 시간", `${p.start} ~ ${p.end}`],
      ["예약 인원", p.people + "명"],
      ["예약 구분", categoryLabel(p.category)],
    ];
    if (p.category === "team" && p.showName) rows.push(["공연명", p.showName]);
    if (p.category === "credit") {
      rows.push(["잔여 시간", "시트 연동 후 표시"]);
    } else {
      rows.push(["입금액", (total || 0).toLocaleString() + "원"]);
    }
    $("#confirmSummary").innerHTML = rows
      .map(([k, v]) => `<div class="cs-row"><span class="cs-k">${k}</span><span class="cs-v">${escapeHtml(v)}</span></div>`)
      .join("");
    $("#confirmAccount").innerHTML = "계좌번호 : <b>" + (CONFIG.BANK_ACCOUNT ? escapeHtml(CONFIG.BANK_ACCOUNT) : "(설정 후 표시)") + "</b>";
    $("#bookingArea").hidden = true;
    $("#confirmView").hidden = false;
    window.scrollTo(0, 0);
  }

  async function submit(e) {
    e.preventDefault();
    const dates = selectedDates().map(dateStr);
    const payload = {
      room: CONFIG.ROOMS[0].id,
      dates: dates,
      start: $("#startTime").value,
      end: $("#endTime").value,
      name: $("#name").value.trim(),
      phone: $("#phone").value.trim(),
      people: Number($("#people").value) || 1,
      category: $("#category").value,
      showName: $("#showName") ? $("#showName").value.trim() : "",
    };
    if (dates.length === 0) { toast("날짜를 선택해 주세요."); return; }
    if (!payload.start || !payload.end) { toast("이용 시간을 선택해 주세요."); return; }
    if (!payload.name || !payload.phone) { toast("이름과 연락처를 입력해 주세요."); return; }
    if (toMin(payload.end) <= toMin(payload.start)) { toast("종료 시간을 시작 시간 이후로 골라 주세요."); return; }

    const total = calcTotal();
    const btn = $("#submitBtn");
    btn.disabled = true; btn.textContent = "신청 중…";
    try {
      if (isDemo()) {
        await new Promise((r) => setTimeout(r, 400));
      } else {
        await API.createReservation(payload);
      }
      showConfirm(payload, total);
      $("#bookingForm").reset();
      fp.clear();
      renderCategoryDetail();
      updateSummary();
      fillStartTimes();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false; btn.textContent = "예약 신청";
    }
  }

  function init() {
    if (isDemo()) toast("데모 모드 미리보기");
    renderCalendar();
    initRepeatPickers();
    document.querySelectorAll(".mode-tab").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("#startTime").addEventListener("change", fillEndTimes);
    $("#endTime").addEventListener("change", updateTotal);
    $("#people").addEventListener("input", updateTotal);
    $("#repeatFillBtn").addEventListener("click", fillWeekly);
    $("#phone").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, ""); });
    $("#category").addEventListener("change", renderCategoryDetail);
    $("#bookingForm").addEventListener("submit", submit);
    renderCategoryDetail();
    setMode("single");
  }

  document.addEventListener("DOMContentLoaded", init);
})();

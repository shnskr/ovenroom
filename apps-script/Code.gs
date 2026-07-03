/* ============================================================
 * 쿠키박스 · 오븐룸 예약 - 백엔드 (Google Apps Script 웹앱)
 * ------------------------------------------------------------
 * 데이터 저장소 = 구글 시트 한 곳 (시트를 DB처럼 사용).
 * 예약이 생기면 구글 캘린더에도 일정을 자동 등록하고, 취소하면 삭제합니다.
 * 이 코드는 구글 서버에서 실행되며 브라우저로 전송되지 않습니다.
 * → SHEET_ID / CALENDAR_ID / ADMIN_TOKEN 같은 비밀값은 코드가 아니라
 *   "스크립트 속성"에 저장하므로 외부에 노출되지 않습니다.
 *
 * 필요한 스크립트 속성 (프로젝트 설정 > 스크립트 속성):
 *   SHEET_ID     : 예약 데이터를 저장할 구글 시트 ID (필수)
 *   ADMIN_TOKEN  : 관리자 페이지 접속 토큰(비밀번호) (필수)
 *   CALENDAR_ID  : 예약 일정을 등록할 구글 캘린더 ID (선택 — 없으면 시트만 저장)
 * ============================================================ */

var SHEET_NAME = "예약목록";
// 열 순서: A~M
var HEADERS = ["예약ID", "생성일시", "날짜", "시작", "종료", "이름", "연락처", "인원", "구분", "공연명", "입금액", "상태", "캘린더ID"];
var COL = { id: 0, createdAt: 1, date: 2, start: 3, end: 4, name: 5, phone: 6, people: 7, category: 8, showName: 9, amount: 10, status: 11, calId: 12 };

// 상태값 (시트에도 한글로 저장)
var ST_PENDING = "대기", ST_CONFIRMED = "확정", ST_CANCELED = "취소";
var VALID_STATUS = [ST_PENDING, ST_CONFIRMED, ST_CANCELED];

// 구분 코드 → 한글 라벨 (시트 가독성용)
var CAT_LABEL = { general: "일반", member: "쿠키박스 단원", team: "공연팀", credit: "쿠금통" };

// 캘린더 일정 제목 = "시작시-종료시/마스킹이름" (예: 19-22/김달*) — 공개 캘린더라 이름은 마스킹

/* ---------- 진입점 ---------- */
function doGet(e) { return route(e); }
function doPost(e) { return route(e); }

function route(e) {
  try {
    var req = parseRequest(e);
    var data;
    switch (req.action) {
      case "getAvailability": data = getAvailability(req); break;
      case "createReservation": data = createReservation(req); break;
      case "getReservations": data = getReservations(req); break;   // 관리자
      case "updateStatus": data = updateStatus(req); break;         // 관리자
      default: throw new Error("알 수 없는 요청: " + req.action);
    }
    return json({ ok: true, data: data });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) });
  }
}

/* ---------- 요청 파싱 / 응답 ---------- */
function parseRequest(e) {
  var req = {};
  if (e && e.parameter) for (var k in e.parameter) req[k] = e.parameter[k];
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var b in body) req[b] = body[b];
    } catch (ignore) {}
  }
  return req;
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 설정/리소스 ---------- */
function prop(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error("스크립트 속성 '" + key + "' 이(가) 설정되지 않았습니다.");
  return v;
}
function optProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}
function sheet() {
  var ss = SpreadsheetApp.openById(prop("SHEET_ID"));
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    // 날짜/시간/이름/연락처 열을 '텍스트'로 고정해 자동 변환(예: 010→10, 14:00→시각) 방지
    sh.getRange("C:G").setNumberFormat("@");
  }
  return sh;
}
function requireAdmin(req) {
  if (!req.token || req.token !== prop("ADMIN_TOKEN")) {
    throw new Error("관리자 토큰이 올바르지 않습니다. (권한 없음)");
  }
}

/* ---------- 유틸 ---------- */
function tz() { return Session.getScriptTimeZone(); }
// 셀 값이 문자열이면 그대로, Date(자동변환된 경우)면 지정 형식으로 변환
function fmtCell(v, pattern) {
  if (v instanceof Date) return Utilities.formatDate(v, tz(), pattern);
  return String(v).trim();
}
// 시각 셀 전용: 텍스트면 그대로, Date(시각 시리얼)면 시트 타임존으로 HH:mm 추출.
// 시트가 시각을 저장한 타임존(Asia/Seoul)과 동일하게 읽어야 왕복이 맞습니다(10:00→10:00).
function fmtTime(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz(), "HH:mm");
  return String(v).trim();
}
function trim(v) { return (v == null ? "" : String(v)).trim(); }
function toMin(hhmm) { var p = hhmm.split(":"); return Number(p[0]) * 60 + Number(p[1]); }
function overlaps(s1, e1, s2, e2) { return toMin(s1) < toMin(e2) && toMin(s2) < toMin(e1); }
// "2026-07-05" + "14:00" → 스크립트 타임존 기준 Date
function mkDate(dateStr, hhmm) {
  var d = dateStr.split("-"), t = hhmm.split(":");
  return new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]), Number(t[0]), Number(t[1]), 0);
}

/* ---------- 캘린더 (선택 기능) ---------- */
// CALENDAR_ID 스크립트 속성이 없으면 캘린더 연동을 건너뜁니다(시트만 저장).
function calGet() {
  var calId = optProp("CALENDAR_ID");
  if (!calId) return null;
  try { return CalendarApp.getCalendarById(calId); } catch (e) { return null; }
}
// 이름 마스킹: 2글자→앞1자+*, 3글자↑→앞2자만 노출하고 나머지는 *
function stars(k) { var s = ""; for (var i = 0; i < k; i++) s += "*"; return s; }
function maskName(name) {
  name = trim(name);
  var n = name.length;
  if (n <= 1) return name;
  if (n === 2) return name.charAt(0) + "*";
  return name.substring(0, 2) + stars(n - 2);
}
// 제목: "시작시-종료시/마스킹이름" ("19:00"~"22:00", 김달님 → 19-22/김달*)
function evTitle(start, end, name) { return start.split(":")[0] + "-" + end.split(":")[0] + "/" + maskName(name); }
// 색상: 연분홍(Flamingo) 고정
function evColor() { return CalendarApp.EventColor.PALE_RED; }

function calCreate(date, start, end, name) {
  var cal = calGet();
  if (!cal) return "";
  try {
    var ev = cal.createEvent(evTitle(start, end, name), mkDate(date, start), mkDate(date, end));
    try { ev.setColor(evColor()); } catch (ignore) {}
    return ev.getId();
  } catch (e) { return ""; }
}
function calDelete(eventId) {
  if (!eventId) return;
  var cal = calGet();
  if (!cal) return;
  try { var ev = cal.getEventById(eventId); if (ev) ev.deleteEvent(); } catch (ignore) {}
}
// 일정이 없으면 무시, 있으면 제목/색 갱신
function calUpdate(eventId, start, end, name) {
  if (!eventId) return;
  var cal = calGet();
  if (!cal) return;
  try {
    var ev = cal.getEventById(eventId);
    if (ev) { ev.setTitle(evTitle(start, end, name)); try { ev.setColor(evColor()); } catch (ignore) {} }
  } catch (ignore) {}
}

/* ============================================================
 *  공개 API (인증 불필요) — 개인정보를 반환하지 않음
 * ============================================================ */

// 특정 날짜의 예약된 시간대(이름/연락처 제외) — 취소된 건 제외
function getAvailability(req) {
  var date = req.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error("date 형식이 올바르지 않습니다.");
  var rows = sheet().getDataRange().getValues();
  var busy = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (fmtCell(r[COL.date], "yyyy-MM-dd") !== date) continue;
    if (String(r[COL.status]) === ST_CANCELED) continue;
    busy.push({ start: fmtTime(r[COL.start]), end: fmtTime(r[COL.end]) });
  }
  return { date: date, busy: busy };
}

// 예약 생성 (고객) — 여러 날짜를 한 번에 받아 중복 검사 후 각각 한 줄씩 추가
// 요청: { dates:[...], start, end, name, phone, people, category, showName, amount }
//       (구버전 호환: dates 대신 date 단일값도 허용)
function createReservation(req) {
  var dates = req.dates;
  if ((!dates || !dates.length) && req.date) dates = [req.date];
  if (!Array.isArray(dates) || dates.length === 0) throw new Error("예약할 날짜가 없습니다.");

  var start = trim(req.start), end = trim(req.end);
  var name = trim(req.name);
  var phone = trim(req.phone);
  var people = Number(req.people) || 1;
  var category = trim(req.category) || "general";
  var showName = trim(req.showName).slice(0, 50);
  var amount = (req.amount === null || req.amount === undefined || req.amount === "") ? "" : Number(req.amount);

  // --- 입력 검증 ---
  for (var d = 0; d < dates.length; d++) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dates[d]))) throw new Error("날짜 형식이 올바르지 않습니다.");
  }
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw new Error("시간 형식이 올바르지 않습니다.");
  if (!name || !phone) throw new Error("이름과 연락처를 입력해 주세요.");
  if (name.length > 30 || phone.length > 20) throw new Error("입력이 너무 깁니다.");
  if (toMin(end) <= toMin(start)) throw new Error("종료 시간이 시작 시간보다 빠릅니다.");
  if (CAT_LABEL[category] === undefined) category = "general";

  // --- 동시 제출로 인한 중복예약 방지: 스크립트 락 ---
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var rows = sh.getDataRange().getValues();

    // 요청한 모든 날짜에 대해 먼저 충돌 검사 (하나라도 겹치면 전체 취소)
    var conflicts = [];
    for (var di = 0; di < dates.length; di++) {
      var date = dates[di];
      for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        if (fmtCell(r[COL.date], "yyyy-MM-dd") !== date) continue;
        if (String(r[COL.status]) === ST_CANCELED) continue;
        if (overlaps(start, end, fmtTime(r[COL.start]), fmtTime(r[COL.end]))) {
          conflicts.push(date);
          break;
        }
      }
    }
    if (conflicts.length) {
      throw new Error("이미 예약된 시간이 있습니다: " + conflicts.join(", ") + " — 해당 날짜를 빼고 다시 신청해 주세요.");
    }

    // 전부 통과 → 날짜별로 한 줄씩 추가 (상태 '대기'. 캘린더는 관리자가 '확정'할 때 등록)
    var created = [];
    for (var ci = 0; ci < dates.length; ci++) {
      var dt = dates[ci];
      var id = Utilities.getUuid();
      sh.appendRow([id, new Date(), dt, start, end, name, phone, people, CAT_LABEL[category], showName, amount, ST_PENDING, ""]);
      created.push({ id: id, date: dt, start: start, end: end });
    }
    return { created: created, count: created.length };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 *  관리자 API (ADMIN_TOKEN 필요)
 * ============================================================ */

// 기간별 예약 목록 (개인정보 포함) — 관리자만
function getReservations(req) {
  requireAdmin(req);
  var from = req.from || "0000-00-00";
  var to = req.to || "9999-99-99";
  var rows = sheet().getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var date = fmtCell(r[COL.date], "yyyy-MM-dd");
    if (date < from || date > to) continue;
    var cat = String(r[COL.category] || "");
    list.push({
      id: String(r[COL.id]), date: date,
      start: fmtTime(r[COL.start]), end: fmtTime(r[COL.end]),
      name: String(r[COL.name]), phone: String(r[COL.phone]),
      people: r[COL.people],
      category: cat, categoryLabel: CAT_LABEL[cat] || cat,
      showName: String(r[COL.showName] || ""),
      amount: r[COL.amount] === "" || r[COL.amount] == null ? null : Number(r[COL.amount]),
      status: String(r[COL.status]),
    });
  }
  return { reservations: list };
}

// 예약 상태 변경 (확정/취소) — 관리자만.
// 캘린더에는 '확정' 건만 표시: 확정하면 일정 등록, 대기/취소로 바꾸면 일정 삭제(시트 행은 유지).
function updateStatus(req) {
  requireAdmin(req);
  var id = req.id, status = req.status;
  if (VALID_STATUS.indexOf(status) === -1) throw new Error("잘못된 상태값입니다.");
  var sh = sheet();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][COL.id]) === id) {
      var rowNum = i + 1;
      var calId = String(rows[i][COL.calId] || "");
      var rStart = fmtTime(rows[i][COL.start]);
      var rEnd = fmtTime(rows[i][COL.end]);
      var rName = String(rows[i][COL.name]);
      var rDate = fmtCell(rows[i][COL.date], "yyyy-MM-dd");

      sh.getRange(rowNum, COL.status + 1).setValue(status);

      if (status === ST_CONFIRMED) {
        // 확정 → 캘린더에 등록 (없으면 새로 생성, 있으면 정보 갱신)
        if (!calId) {
          calId = calCreate(rDate, rStart, rEnd, rName);
          sh.getRange(rowNum, COL.calId + 1).setValue(calId);
        } else {
          calUpdate(calId, rStart, rEnd, rName);
        }
      } else {
        // 대기/취소 → 캘린더에서 제거 (캘린더에는 '확정' 건만 표시)
        if (calId) {
          calDelete(calId);
          sh.getRange(rowNum, COL.calId + 1).setValue("");
        }
      }
      return { id: id, status: status };
    }
  }
  throw new Error("해당 예약을 찾을 수 없습니다.");
}

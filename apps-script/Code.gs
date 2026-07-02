/* ============================================================
 * 쿠키박스 · 오븐룸 예약 - 백엔드 (Google Apps Script 웹앱)
 * ------------------------------------------------------------
 * 데이터 저장소 = 구글 시트 한 곳 (시트를 DB처럼 사용).
 * 이 코드는 구글 서버에서 실행되며 브라우저로 전송되지 않습니다.
 * → SHEET_ID / ADMIN_TOKEN 같은 비밀값은 코드가 아니라
 *   "스크립트 속성"에 저장하므로 외부에 노출되지 않습니다.
 *
 * 필요한 스크립트 속성 (프로젝트 설정 > 스크립트 속성):
 *   SHEET_ID     : 예약 데이터를 저장할 구글 시트 ID
 *   ADMIN_TOKEN  : 관리자 페이지 접속 토큰(비밀번호)
 * ============================================================ */

// 유효한 룸 id (frontend/js/config.js 의 ROOMS[].id 와 일치시키세요)
var VALID_ROOMS = ["oven-room"];

var SHEET_NAME = "Reservations";
// 열 순서: A~K
var HEADERS = ["예약ID", "생성일시", "룸", "날짜", "시작", "종료", "이름", "연락처", "인원", "요청사항", "상태"];
var COL = { id: 0, createdAt: 1, room: 2, date: 3, start: 4, end: 5, name: 6, phone: 7, people: 8, memo: 9, status: 10 };

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
function sheet() {
  var ss = SpreadsheetApp.openById(prop("SHEET_ID"));
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    // 날짜/시간/연락처 열을 '텍스트'로 고정해 자동 변환(예: 010→10, 10:00→시각) 방지
    sh.getRange("D:H").setNumberFormat("@");
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
function toMin(hhmm) { var p = hhmm.split(":"); return Number(p[0]) * 60 + Number(p[1]); }
function overlaps(s1, e1, s2, e2) { return toMin(s1) < toMin(e2) && toMin(s2) < toMin(e1); }

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
    if (String(r[COL.status]) === "canceled") continue;
    busy.push({
      room: String(r[COL.room]),
      start: fmtCell(r[COL.start], "HH:mm"),
      end: fmtCell(r[COL.end], "HH:mm"),
    });
  }
  return { date: date, busy: busy };
}

// 예약 생성 (고객) — 시트를 읽어 중복 검사 후 한 줄 추가
function createReservation(req) {
  var room = req.room, date = req.date, start = req.start, end = req.end;
  var name = (req.name || "").toString().trim();
  var phone = (req.phone || "").toString().trim();
  var people = Number(req.people) || 1;
  var memo = (req.memo || "").toString().trim().slice(0, 200);

  // --- 입력 검증 ---
  if (VALID_ROOMS.indexOf(room) === -1) throw new Error("존재하지 않는 공간입니다.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("날짜 형식이 올바르지 않습니다.");
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw new Error("시간 형식이 올바르지 않습니다.");
  if (!name || !phone) throw new Error("이름과 연락처를 입력해 주세요.");
  if (name.length > 30 || phone.length > 20) throw new Error("입력이 너무 깁니다.");
  if (toMin(end) <= toMin(start)) throw new Error("종료 시간이 시작 시간보다 빠릅니다.");

  // --- 동시 제출로 인한 중복예약 방지: 스크립트 락 ---
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (String(r[COL.room]) !== room) continue;
      if (fmtCell(r[COL.date], "yyyy-MM-dd") !== date) continue;
      if (String(r[COL.status]) === "canceled") continue;
      if (overlaps(start, end, fmtCell(r[COL.start], "HH:mm"), fmtCell(r[COL.end], "HH:mm"))) {
        throw new Error("이미 예약된 시간입니다. 다른 시간을 선택해 주세요.");
      }
    }
    var id = Utilities.getUuid();
    sh.appendRow([id, new Date(), room, date, start, end, name, phone, people, memo, "pending"]);
    return { id: id, room: room, date: date, start: start, end: end };
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
    list.push({
      id: String(r[COL.id]), room: String(r[COL.room]), date: date,
      start: fmtCell(r[COL.start], "HH:mm"), end: fmtCell(r[COL.end], "HH:mm"),
      name: String(r[COL.name]), phone: String(r[COL.phone]),
      people: r[COL.people], memo: String(r[COL.memo]), status: String(r[COL.status]),
    });
  }
  return { reservations: list };
}

// 예약 상태 변경 (확정/취소) — 관리자만. 취소하면 그 시간이 다시 열립니다.
function updateStatus(req) {
  requireAdmin(req);
  var id = req.id, status = req.status;
  if (["pending", "confirmed", "canceled"].indexOf(status) === -1) throw new Error("잘못된 상태값입니다.");
  var sh = sheet();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][COL.id]) === id) {
      sh.getRange(i + 1, COL.status + 1).setValue(status);
      return { id: id, status: status };
    }
  }
  throw new Error("해당 예약을 찾을 수 없습니다.");
}

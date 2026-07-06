/* ============================================================
 * 오븐룸 예약 - 백엔드 (Google Apps Script 웹앱)
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
// 열 순서: A~N
var HEADERS = ["예약ID", "생성일시", "날짜", "시작", "종료", "이름", "연락처", "인원", "구분", "공연명", "입금액", "상태", "캘린더ID", "처리자"];
var COL = { id: 0, createdAt: 1, date: 2, start: 3, end: 4, name: 5, phone: 6, people: 7, category: 8, showName: 9, amount: 10, status: 11, calId: 12, handler: 13 };

// 상태값 (시트에도 한글로 저장)
var ST_PENDING = "대기", ST_CONFIRMED = "확정", ST_CANCELED = "취소";
var VALID_STATUS = [ST_PENDING, ST_CONFIRMED, ST_CANCELED];

// 구분 코드 → 한글 라벨 (시트 가독성용)
var CAT_LABEL = { general: "일반", member: "쿠키박스 단원", team: "공연팀", credit: "쿠금통" };

// 캘린더 일정 제목 = "시작시-종료시/마스킹이름(연락처 뒷4자리)" (예: 19-22/김달*(8627)) — 공개 캘린더라 이름은 마스킹

/* ---------- 진입점 ---------- */
function doGet(e) { return route(e); }
function doPost(e) { return route(e); }

function route(e) {
  try {
    var req = parseRequest(e);
    var data;
    switch (req.action) {
      case "getAvailability": data = getAvailability(req); break;
      case "getPricing": data = getPricing(req); break;
      case "createReservation": data = createReservation(req); break;
      case "getCreditBalance": data = getCreditBalance(req); break;
      case "getReservations": data = getReservations(req); break;   // 관리자
      case "updateStatus": data = updateStatus(req); break;         // 관리자
      case "updateProfile": data = updateProfile(req); break;       // 관리자(초기 비밀번호 허용)
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
    sh.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm"); // 생성일시: 시간까지 표시
  }
  return sh;
}
// 관리자 명단 시트 — "관리자" 탭 (아이디 | 비밀번호 | 닉네임). 없으면 빈 탭 자동 생성.
// 관리자 추가 = 아이디(+닉네임)만 적으면 됨 — 초기 비밀번호로 첫 로그인 후 본인이 설정.
var ACOL = { id: 0, pw: 1, nick: 2 };
function adminSheet() {
  var ss = SpreadsheetApp.openById(prop("SHEET_ID"));
  var sh = ss.getSheetByName("관리자");
  if (!sh) {
    sh = ss.insertSheet("관리자");
    sh.appendRow(["아이디", "비밀번호", "닉네임"]);
    sh.setFrozenRows(1);
    sh.getRange("A:C").setNumberFormat("@");
  }
  return sh;
}

// 아이디 → 닉네임 변환표 (처리자 표시용)
function adminNickMap() {
  var map = {};
  try {
    var rows = adminSheet().getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var id = trim(rows[i][ACOL.id]);
      if (id && !(id in map)) map[id] = trim(rows[i][ACOL.nick]) || id;
    }
  } catch (ignore) {}
  return map;
}

// 처리자 셀("아이디 · MM-dd HH:mm")의 아이디를 닉네임으로 바꿔 표시용 문자열 생성
function resolveHandler(h, nickMap) {
  if (!h) return "";
  var idx = h.indexOf(" · ");
  if (idx < 0) return nickMap[h] || h;
  var who = h.slice(0, idx);
  return (nickMap[who] || who) + h.slice(idx);
}

/* ---------- 관리자 토큰 해시 저장 (시트에 비밀번호 원문을 남기지 않음) ---------- */
// '관리자' 탭 토큰 칸에 비밀번호를 그대로 적으면 서버가 처음 읽을 때 자동으로
// "hmac:솔트:해시"로 바꿔 저장 (일반 DB의 비밀번호 해시 저장과 같은 원리).
// 해시는 서버에만 있는 비밀키(TOKEN_PEPPER, 자동 생성)로 만들어서
// 시트가 유출돼도 비밀번호를 되돌릴 수 없음. 원문 복구 불가 — 잊으면 새로 적으면 됨.
var TOKEN_HASH_PREFIX = "hmac:";

function tokenPepper() {
  var props = PropertiesService.getScriptProperties();
  var p = props.getProperty("TOKEN_PEPPER");
  if (!p) {
    p = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty("TOKEN_PEPPER", p);
  }
  return p;
}

function hashToken(salt, token) {
  var bytes = Utilities.computeHmacSha256Signature(salt + ":" + token, tokenPepper());
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] + 256) % 256;
    hex += (v < 16 ? "0" : "") + v.toString(16);
  }
  return hex;
}

// 초기 비밀번호: 관리자 탭에 아이디만 적고 비밀번호 칸이 비어 있으면 이 값으로 로그인.
// 단, 초기 비밀번호 상태에서는 '내 정보 변경'만 가능(예약 조회/처리 불가).
var DEFAULT_ADMIN_PW = "dhqmsfna";

// '관리자' 탭에서 아이디+비밀번호 대조 — 평문으로 적힌 비밀번호는 이 자리에서 해시로 교체 저장.
// 반환: { id, nick, provisional } 또는 null. provisional=true는 초기 비밀번호 로그인.
function findAdminInSheet(id, pw) {
  var sh = adminSheet();
  var arows = sh.getDataRange().getValues();
  for (var a = 1; a < arows.length; a++) {
    var aid = trim(arows[a][ACOL.id]);
    if (!aid || aid !== id) continue;
    var nick = trim(arows[a][ACOL.nick]) || aid;
    var stored = trim(arows[a][ACOL.pw]);
    if (!stored) {
      // 비밀번호 미설정 → 초기 비밀번호로만 임시 로그인 허용
      return pw === DEFAULT_ADMIN_PW ? { id: aid, nick: nick, provisional: true } : null;
    }
    if (stored.indexOf(TOKEN_HASH_PREFIX) !== 0) {
      var ok = stored === pw;
      var salt = Utilities.getUuid().slice(0, 8);
      sh.getRange(a + 1, ACOL.pw + 1).setValue(TOKEN_HASH_PREFIX + salt + ":" + hashToken(salt, stored));
      return ok ? { id: aid, nick: nick, provisional: false } : null;
    }
    var parts = stored.slice(TOKEN_HASH_PREFIX.length).split(":");
    if (parts.length === 2 && hashToken(parts[0], pw) === parts[1]) return { id: aid, nick: nick, provisional: false };
    return null;
  }
  return null;
}

// 관리자 인증 — 통과하면 { id, nick, provisional } 반환.
// 1순위: 시트 "관리자" 탭 (아이디|비밀번호(해시 저장)|닉네임)
// 2순위(예비): 스크립트 속성 ADMIN_TOKENS = "아이디=비밀번호, ..." / ADMIN_TOKEN 단일(아이디 "관리자")
function authAdmin(req) {
  var id = trim(req.adminId), pw = trim(req.password);
  if (pw) {
    // 같은 아이디+비밀번호의 반복 대조 비용을 줄이는 10분 캐시 (정식 로그인만 캐시)
    var cache = CacheService.getScriptCache();
    var ck = "adm_" + hashToken("cachekey", id + "\n" + pw).slice(0, 48);
    var hit = cache.get(ck);
    if (hit) {
      var cparts = hit.split("\n");
      return { id: cparts[0], nick: cparts[1] || cparts[0], provisional: false };
    }

    var found = null;
    if (id) {
      try { found = findAdminInSheet(id, pw); } catch (ignore) {} // 시트 문제가 있어도 속성으로는 들어올 수 있게
    }
    if (!found && id) {
      var multi = optProp("ADMIN_TOKENS");
      if (multi) {
        var pairs = multi.split(/[,\n]/);
        for (var i = 0; i < pairs.length; i++) {
          var idx = pairs[i].indexOf("=");
          if (idx < 0) continue;
          var pName = trim(pairs[i].slice(0, idx));
          var pTok = trim(pairs[i].slice(idx + 1));
          if (pName === id && pTok && pTok === pw) { found = { id: pName, nick: pName, provisional: false }; break; }
        }
      }
    }
    if (!found) {
      var single = optProp("ADMIN_TOKEN");
      if (single && pw === single) found = { id: "관리자", nick: "관리자", provisional: false };
    }
    if (found) {
      if (!found.provisional) { try { cache.put(ck, found.id + "\n" + found.nick, 600); } catch (ignore) {} }
      return found;
    }
  }
  throw new Error("아이디 또는 비밀번호가 올바르지 않습니다. (권한 없음)");
}

// 정식 인증(초기 비밀번호 불가) — { id, nick } 반환
function requireAdmin(req) {
  var a = authAdmin(req);
  if (a.provisional) throw new Error("초기 비밀번호 상태입니다. 먼저 비밀번호를 변경해 주세요.");
  return a;
}

// 내 정보 변경 — 본인 인증(초기 비밀번호 포함) 후 아이디/비밀번호/닉네임 변경.
// 빈 값은 "그대로 유지". 초기 비밀번호 상태에서는 새 비밀번호가 필수.
function updateProfile(req) {
  var auth = authAdmin(req);
  var newId = trim(req.newId);
  var newPw = trim(req.newPassword);
  var newNick = trim(req.newNick);
  if (auth.provisional && !newPw) throw new Error("초기 비밀번호 상태에서는 새 비밀번호를 꼭 설정해야 해요.");
  if (newPw) {
    if (newPw.length < 6) throw new Error("새 비밀번호는 6자 이상으로 해 주세요.");
    if (newPw === DEFAULT_ADMIN_PW) throw new Error("초기 비밀번호는 새 비밀번호로 쓸 수 없습니다.");
  }
  if (newId.length > 20 || newNick.length > 20) throw new Error("아이디/닉네임은 20자 이하로 해 주세요.");

  var sh = adminSheet();
  var arows = sh.getDataRange().getValues();
  var rowNum = 0;
  for (var i = 1; i < arows.length; i++) {
    var aid = trim(arows[i][ACOL.id]);
    if (aid === auth.id) { if (!rowNum) rowNum = i + 1; continue; }
    if (newId && aid === newId) throw new Error("이미 사용 중인 아이디예요.");
  }
  if (!rowNum) throw new Error("관리자 탭에서 아이디를 찾을 수 없습니다. (속성 토큰 계정은 시트에서 변경할 수 없어요)");

  if (newId) {
    sh.getRange(rowNum, ACOL.id + 1).setValue(newId);
    renameHandlerId(auth.id, newId); // 과거 처리자 기록의 아이디도 일괄 변경
  }
  if (newPw) {
    var salt = Utilities.getUuid().slice(0, 8);
    sh.getRange(rowNum, ACOL.pw + 1).setValue(TOKEN_HASH_PREFIX + salt + ":" + hashToken(salt, newPw));
  }
  if (newNick) sh.getRange(rowNum, ACOL.nick + 1).setValue(newNick);
  // 이전 아이디+비밀번호의 인증 캐시 무효화
  try { CacheService.getScriptCache().remove("adm_" + hashToken("cachekey", trim(req.adminId) + "\n" + trim(req.password)).slice(0, 48)); } catch (ignore) {}
  return { id: newId || auth.id, nick: newNick || auth.nick };
}

// 아이디 변경 시 과거 기록의 처리자 아이디를 일괄 변경 (예약목록 '처리자' 칸 + '처리기록' 탭)
function renameHandlerId(oldId, newId) {
  try {
    var sh = sheet();
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var h = trim(rows[i][COL.handler]);
      if (!h) continue;
      var idx = h.indexOf(" · ");
      var who = idx < 0 ? h : h.slice(0, idx);
      if (who !== oldId) continue;
      sh.getRange(i + 1, COL.handler + 1).setValue(newId + (idx < 0 ? "" : h.slice(idx)));
    }
  } catch (ignore) {}
  try {
    var ss = SpreadsheetApp.openById(prop("SHEET_ID"));
    var lsh = ss.getSheetByName("처리기록");
    if (lsh) {
      var lrows = lsh.getDataRange().getValues();
      for (var j = 1; j < lrows.length; j++) {
        if (trim(lrows[j][1]) === oldId) lsh.getRange(j + 1, 2).setValue(newId);
      }
    }
  } catch (ignore) {}
}

// 처리 이력 기록 — "처리기록" 탭에 누적 (개인정보 없음: 예약ID·일시만)
function logAction(admin, id, date, start, end, from, to) {
  try {
    var ss = SpreadsheetApp.openById(prop("SHEET_ID"));
    var sh = ss.getSheetByName("처리기록");
    if (!sh) {
      sh = ss.insertSheet("처리기록");
      sh.appendRow(["일시", "관리자", "예약ID", "예약일", "시간", "변경"]);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), admin, id, date, start + "~" + end, from + " → " + to]);
  } catch (ignore) {} // 기록 실패가 본 작업을 막지 않도록
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
function digits(v) { return (v == null ? "" : String(v)).replace(/\D/g, ""); }
function round2(n) { return Math.round(n * 100) / 100; }
// 표시용 연락처: 셀이 숫자로 저장돼 앞 0이 사라진 값(1012345678)을 복원
function fmtPhone(v) {
  if (typeof v === "number") return "0" + String(v);
  return trim(v);
}
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
// 이름 마스킹(가운데 가림): 2글자→앞1자+*, 3글자↑→첫·끝만 노출 (김달님→김*님, 남궁민수→남**수)
function stars(k) { var s = ""; for (var i = 0; i < k; i++) s += "*"; return s; }
function maskName(name) {
  name = trim(name);
  var n = name.length;
  if (n <= 1) return name;
  if (n === 2) return name.charAt(0) + "*";
  return name.charAt(0) + stars(n - 2) + name.charAt(n - 1);
}
// 제목: "시작시-종료시/마스킹이름(연락처 뒷4자리)" ("19:00"~"22:00", 김달님, 01012348627 → 19-22/김달*(8627))
function evTitle(start, end, name, phone) {
  var p4 = digits(phone).slice(-4);
  return start.split(":")[0] + "-" + end.split(":")[0] + "/" + maskName(name) + (p4 ? "(" + p4 + ")" : "");
}
// 색상: 연분홍(Flamingo) 고정
function evColor() { return CalendarApp.EventColor.PALE_RED; }

// 종일 일정으로 등록: 시간 일정은 캘린더가 제목 앞에 "오후 7시" 접두어를 강제로 붙임.
// 시간 정보는 제목("19-22/김달*(8627)")에 이미 있으므로 종일 일정이 더 깔끔함.
function calCreate(date, start, end, name, phone) {
  var cal = calGet();
  if (!cal) return "";
  try {
    var ev = cal.createAllDayEvent(evTitle(start, end, name, phone), mkDate(date, start));
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
function calUpdate(eventId, start, end, name, phone) {
  if (!eventId) return;
  var cal = calGet();
  if (!cal) return;
  try {
    var ev = cal.getEventById(eventId);
    if (ev) { ev.setTitle(evTitle(start, end, name, phone)); try { ev.setColor(evColor()); } catch (ignore) {} }
  } catch (ignore) {}
}

/* ---------- 요금표 (시트에서 관리) ---------- */
var PRICING_SHEET_NAME = "요금표";
var PRICING_CACHE_KEY = "pricing_v1";
var PRICING_CACHE_SEC = 300; // 5분 캐시 — 시트 수정 후 최대 5분 안에 반영

// 요금표 탭이 처음 생성될 때 채워 넣는 기본값 (js/config.js와 동일)
var DEFAULT_PRICING = {
  weekdayBands: [{ start: 0, end: 9, rate: 5000 }, { start: 9, end: 17, rate: 7500 }, { start: 17, end: 24, rate: 9000 }],
  weekendBands: [{ start: 0, end: 9, rate: 6000 }, { start: 9, end: 13, rate: 9000 }, { start: 13, end: 22, rate: 10000 }, { start: 22, end: 24, rate: 9000 }],
  extraPersonThreshold: 10,
  extraPersonFeePerHour: 1000,
  memberDiscount: 0.2,
  teamDiscount: 0.2,
};

// 요금표 탭 — 없으면 현재 값으로 자동 생성. A~D열 = 시간대별 요금, F~G열 = 설정값.
function pricingSheet() {
  var ss = SpreadsheetApp.openById(prop("SHEET_ID"));
  var sh = ss.getSheetByName(PRICING_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(PRICING_SHEET_NAME);
    var rows = [["구분", "시작(시)", "종료(시)", "시간당 요금"]];
    DEFAULT_PRICING.weekdayBands.forEach(function (b) { rows.push(["평일", b.start, b.end, b.rate]); });
    DEFAULT_PRICING.weekendBands.forEach(function (b) { rows.push(["주말", b.start, b.end, b.rate]); });
    sh.getRange(1, 1, rows.length, 4).setValues(rows);
    sh.getRange(1, 6, 5, 2).setValues([
      ["설정", "값"],
      ["인원 추가 기준(명 초과)", DEFAULT_PRICING.extraPersonThreshold],
      ["인원당 추가요금(시간당)", DEFAULT_PRICING.extraPersonFeePerHour],
      ["단원 할인율(%)", DEFAULT_PRICING.memberDiscount * 100],
      ["공연팀 할인율(%)", DEFAULT_PRICING.teamDiscount * 100],
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 요금표 읽기 (캐시 우선). 시트 값이 이상하면 기본값으로 동작.
function loadPricing() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(PRICING_CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (ignore) {} }
  var p = {
    weekdayBands: [], weekendBands: [],
    extraPersonThreshold: DEFAULT_PRICING.extraPersonThreshold,
    extraPersonFeePerHour: DEFAULT_PRICING.extraPersonFeePerHour,
    memberDiscount: DEFAULT_PRICING.memberDiscount,
    teamDiscount: DEFAULT_PRICING.teamDiscount,
  };
  var vals = pricingSheet().getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var kind = trim(vals[i][0]);
    if (kind === "평일" || kind === "주말") {
      var band = { start: Number(vals[i][1]), end: Number(vals[i][2]), rate: Number(vals[i][3]) };
      if (!isNaN(band.start) && !isNaN(band.end) && !isNaN(band.rate) && band.end > band.start) {
        (kind === "평일" ? p.weekdayBands : p.weekendBands).push(band);
      }
    }
    var key = vals[i].length > 5 ? trim(vals[i][5]) : "";
    var val = vals[i].length > 6 ? Number(vals[i][6]) : NaN;
    if (key && !isNaN(val)) {
      if (key.indexOf("인원 추가 기준") === 0) p.extraPersonThreshold = val;
      else if (key.indexOf("인원당 추가요금") === 0) p.extraPersonFeePerHour = val;
      else if (key.indexOf("단원 할인율") === 0) p.memberDiscount = val / 100;
      else if (key.indexOf("공연팀 할인율") === 0) p.teamDiscount = val / 100;
    }
  }
  if (!p.weekdayBands.length) p.weekdayBands = DEFAULT_PRICING.weekdayBands;
  if (!p.weekendBands.length) p.weekendBands = DEFAULT_PRICING.weekendBands;
  try { cache.put(PRICING_CACHE_KEY, JSON.stringify(p), PRICING_CACHE_SEC); } catch (ignore) {}
  return p;
}

// 주말 여부: 토(6)·일(0)
function isWeekend(dateStr) {
  var d = mkDate(dateStr, "00:00").getDay();
  return d === 0 || d === 6;
}

// 한 날짜의 시간대 구간요금 합 (시작·종료는 분 단위)
function bandCost(bands, sMin, eMin) {
  var cost = 0;
  for (var i = 0; i < bands.length; i++) {
    var b = bands[i];
    var ov = Math.min(eMin, b.end * 60) - Math.max(sMin, b.start * 60);
    if (ov > 0) cost += (ov / 60) * b.rate;
  }
  return cost;
}

// 입금액 서버 계산 — 프론트(calcTotal)와 동일 공식. 시트 요금표가 유일한 기준.
// 쿠금통은 입금액 없음("").
function calcAmount(category, dates, start, end, people) {
  if (category === "credit") return "";
  var p = loadPricing();
  var sMin = toMin(start), eMin = toMin(end);
  var hours = (eMin - sMin) / 60;
  var extra = Math.max(0, Number(people) - p.extraPersonThreshold);
  var total = 0;
  for (var i = 0; i < dates.length; i++) {
    var cost = bandCost(isWeekend(dates[i]) ? p.weekendBands : p.weekdayBands, sMin, eMin);
    if (category === "general" || category === "member") cost += extra * p.extraPersonFeePerHour * hours;
    if (category === "member") cost *= 1 - p.memberDiscount;
    if (category === "team") cost *= 1 - p.teamDiscount;
    total += cost;
  }
  return Math.round(total);
}

// 요금표 조회 (고객 페이지 표시용 — 공개 정보)
function getPricing(req) {
  return { pricing: loadPricing() };
}

/* ---------- 쿠금통 (선불 시간권) ---------- */
var CREDIT_SHEET_NAME = "쿠금통";
var CREDIT_HEADERS = ["이름", "연락처", "충전시간", "사용시간", "잔여시간"];
var CCOL = { name: 0, phone: 1, charged: 2, used: 3 };

// 회원 시트 — 없으면 자동 생성. 충전시간은 관리자가 시트에서 직접 입력,
// 사용시간은 예약 '확정' 시 자동 증가. 잔여시간 열은 보기용 수식(충전-사용)이며 코드는 읽지 않음.
function creditSheet() {
  var ss = SpreadsheetApp.openById(prop("SHEET_ID"));
  var sh = ss.getSheetByName(CREDIT_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CREDIT_SHEET_NAME);
    sh.appendRow(CREDIT_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange("A:B").setNumberFormat("@"); // 연락처 010 앞자리 0 보존
    sh.getRange("E2").setFormula('=ARRAYFORMULA(IF(A2:A="",,C2:C-D2:D))');
  }
  return sh;
}

// 이름 + 연락처 뒷 4자리가 모두 일치하는 첫 행
function findCreditRow(name, phone4) {
  var sh = creditSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (trim(rows[i][CCOL.name]) !== name) continue;
    if (digits(rows[i][CCOL.phone]).slice(-4) !== phone4) continue;
    return { sh: sh, rowNum: i + 1, charged: Number(rows[i][CCOL.charged]) || 0, used: Number(rows[i][CCOL.used]) || 0 };
  }
  return null;
}

// 확정 시 hours만큼 사용시간 증가, 확정 해제(취소/대기) 시 음수로 복구.
// 회원이 없거나 잔여가 음수가 되면 경고 문자열 반환 (상태 변경 자체는 진행).
function creditAdjust(name, phone, hours) {
  var row = findCreditRow(trim(name), digits(phone).slice(-4));
  if (!row) return "쿠금통 회원(" + name + ")을 시트에서 찾지 못해 사용시간이 조정되지 않았습니다.";
  var used = Math.max(0, round2(row.used + hours));
  row.sh.getRange(row.rowNum, CCOL.used + 1).setValue(used);
  var remain = round2(row.charged - used);
  if (remain < 0) return "차감 후 잔여 시간이 " + remain + "시간입니다 (충전 필요).";
  return "";
}

/* ============================================================
 *  공개 API (인증 불필요) — 개인정보를 반환하지 않음
 * ============================================================ */

// 선택한 날짜들의 예약된 시간대(이름/연락처 제외) — 취소된 건 제외
// 요청: { dates: ["YYYY-MM-DD", ...] } (구버전 호환: date 단일값도 허용)
// 응답: { busy: { "YYYY-MM-DD": [{start,end}, ...], ... } }
function getAvailability(req) {
  var dates = req.dates;
  if ((!dates || !dates.length) && req.date) dates = [req.date];
  if (!Array.isArray(dates) || dates.length === 0) throw new Error("조회할 날짜가 없습니다.");
  if (dates.length > 62) throw new Error("한 번에 조회할 수 있는 날짜가 너무 많습니다.");
  var busy = {};
  for (var d = 0; d < dates.length; d++) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dates[d]))) throw new Error("date 형식이 올바르지 않습니다.");
    busy[dates[d]] = [];
  }
  var rows = sheet().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var date = fmtCell(r[COL.date], "yyyy-MM-dd");
    if (!busy.hasOwnProperty(date)) continue;
    if (String(r[COL.status]) === ST_CANCELED) continue;
    // pending: 아직 확정 전(대기) 신청 — 캘린더에 안 보이는 이유를 고객에게 설명하기 위해 구분
    busy[date].push({ start: fmtTime(r[COL.start]), end: fmtTime(r[COL.end]), pending: String(r[COL.status]) === ST_PENDING });
  }
  return { busy: busy };
}

// 쿠금통 잔여시간 조회 (고객) — 이름+연락처 뒷4자리가 일치하면 잔여시간 숫자만 반환.
// 다른 개인정보(전체 연락처·충전 내역 등)는 반환하지 않음.
function getCreditBalance(req) {
  var name = trim(req.name);
  var phone4 = digits(req.phone4);
  if (!name || name.length > 30) throw new Error("이름을 입력해 주세요.");
  if (phone4.length !== 4) throw new Error("연락처 뒷 4자리를 입력해 주세요.");
  var row = findCreditRow(name, phone4);
  if (!row) return { found: false };
  return { found: true, remaining: round2(row.charged - row.used) };
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

  // --- 입력 검증 ---
  for (var d = 0; d < dates.length; d++) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dates[d]))) throw new Error("날짜 형식이 올바르지 않습니다.");
  }
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw new Error("시간 형식이 올바르지 않습니다.");
  if (!name || !phone) throw new Error("이름과 연락처를 입력해 주세요.");
  if (name.length > 30 || phone.length > 20) throw new Error("입력이 너무 깁니다.");
  if (digits(phone).length < 10) throw new Error("연락처를 숫자 10자리 이상 입력해 주세요.");
  if (toMin(end) <= toMin(start)) throw new Error("종료 시간이 시작 시간보다 빠릅니다.");
  if (CAT_LABEL[category] === undefined) category = "general";

  // 입금액은 클라이언트가 보낸 값을 믿지 않고 서버가 요금표(시트) 기준으로 직접 계산
  var amount = calcAmount(category, dates, start, end, people);

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
          conflicts.push(date + (String(r[COL.status]) === ST_PENDING ? "(대기 중 신청)" : ""));
          break;
        }
      }
    }
    if (conflicts.length) {
      throw new Error("이미 예약된 시간이 있습니다: " + conflicts.join(", ") + " — 해당 날짜를 빼고 다시 신청해 주세요.");
    }

    // 쿠금통: 잔여 시간이 부족하면 접수 거부.
    // 아직 확정 전(대기)인 이 회원의 다른 신청도 합산해 이중 초과 신청을 막음.
    if (category === "credit") {
      var phone4 = digits(phone).slice(-4);
      var member = findCreditRow(name, phone4);
      if (!member) throw new Error("쿠금통 회원 정보를 찾을 수 없습니다. 이름과 연락처를 확인해 주세요.");
      var reqHours = round2(((toMin(end) - toMin(start)) / 60) * dates.length);
      var pendingHours = 0;
      for (var ph = 1; ph < rows.length; ph++) {
        var pr = rows[ph];
        if (String(pr[COL.category]) !== CAT_LABEL.credit) continue;
        if (String(pr[COL.status]) !== ST_PENDING) continue;
        if (trim(pr[COL.name]) !== name || digits(pr[COL.phone]).slice(-4) !== phone4) continue;
        pendingHours += (toMin(fmtTime(pr[COL.end])) - toMin(fmtTime(pr[COL.start]))) / 60;
      }
      pendingHours = round2(pendingHours);
      var creditLeft = round2(member.charged - member.used - pendingHours);
      if (reqHours > creditLeft) {
        var detail = "잔여 " + round2(member.charged - member.used) + "시간";
        if (pendingHours > 0) detail += " (대기 중 신청 " + pendingHours + "시간 제외 시 " + creditLeft + "시간)";
        throw new Error("쿠금통 잔여 시간이 부족해 신청할 수 없습니다. " + detail + " · 요청 " + reqHours + "시간");
      }
    }

    // 전부 통과 → 날짜별로 한 줄씩 추가 (상태 '대기'. 캘린더는 관리자가 '확정'할 때 등록)
    // appendRow는 값을 '타이핑한 것처럼' 해석해 연락처(010…)의 앞 0을 지워버리므로,
    // 해석 없이 그대로 저장하는 setValues를 사용.
    var created = [];
    for (var ci = 0; ci < dates.length; ci++) {
      var dt = dates[ci];
      var id = Utilities.getUuid();
      var newRow = sh.getLastRow() + 1;
      sh.getRange(newRow, 1, 1, HEADERS.length).setValues([
        [id, new Date(), dt, start, end, name, phone, people, CAT_LABEL[category], showName, amount, ST_PENDING, "", ""],
      ]);
      // 생성일시 표시 형식(시간 포함) — 예전에 만들어진 탭에도 적용되도록 행 단위로 지정
      sh.getRange(newRow, COL.createdAt + 1).setNumberFormat("yyyy-mm-dd hh:mm");
      created.push({ id: id, date: dt, start: start, end: end });
    }
    return { created: created, count: created.length, amount: amount };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 *  관리자 API (ADMIN_TOKEN 필요)
 * ============================================================ */

// 예약 목록 (개인정보 포함) — 관리자만.
// from/to(사용일 기준)와 status는 선택 — 비우면 전체.
function getReservations(req) {
  var admin = requireAdmin(req);
  var from = req.from || "0000-00-00";
  var to = req.to || "9999-99-99";
  var stFilter = trim(req.status);
  var nickMap = adminNickMap(); // 처리자 아이디 → 닉네임 표시 변환
  var rows = sheet().getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var date = fmtCell(r[COL.date], "yyyy-MM-dd");
    if (date < from || date > to) continue;
    if (stFilter && String(r[COL.status]) !== stFilter) continue;
    var cat = String(r[COL.category] || "");
    list.push({
      id: String(r[COL.id]), date: date,
      createdAt: fmtCell(r[COL.createdAt], "yyyy-MM-dd HH:mm"),
      start: fmtTime(r[COL.start]), end: fmtTime(r[COL.end]),
      name: String(r[COL.name]), phone: fmtPhone(r[COL.phone]),
      people: r[COL.people],
      category: cat, categoryLabel: CAT_LABEL[cat] || cat,
      showName: String(r[COL.showName] || ""),
      amount: r[COL.amount] === "" || r[COL.amount] == null ? null : Number(r[COL.amount]),
      status: String(r[COL.status]),
      handler: resolveHandler(trim(r[COL.handler]), nickMap),
    });
  }
  return { reservations: list, admin: { id: admin.id, nick: admin.nick } };
}

// 예약 상태 변경 (확정/취소) — 관리자만.
// 캘린더에는 '확정' 건만 표시: 확정하면 일정 등록, 대기/취소로 바꾸면 일정 삭제(시트 행은 유지).
// 쿠금통 예약은 확정 시 사용시간 자동 차감, 확정 해제 시 복구.
function updateStatus(req) {
  var admin = requireAdmin(req);
  var id = req.id, status = req.status;
  if (VALID_STATUS.indexOf(status) === -1) throw new Error("잘못된 상태값입니다.");
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][COL.id]) === id) {
        var rowNum = i + 1;
        var prev = String(rows[i][COL.status]);
        var calId = String(rows[i][COL.calId] || "");
        var rStart = fmtTime(rows[i][COL.start]);
        var rEnd = fmtTime(rows[i][COL.end]);
        var rName = String(rows[i][COL.name]);
        var rPhone = String(rows[i][COL.phone] || "");
        var rDate = fmtCell(rows[i][COL.date], "yyyy-MM-dd");

        // 확정 겹침 가드: 취소했던 건을 다시 확정하는 사이에 같은 시간대에
        // 다른 예약(대기/확정)이 생겼을 수 있음 — 겹치면 확정 거부
        if (status === ST_CONFIRMED && prev !== ST_CONFIRMED) {
          for (var j = 1; j < rows.length; j++) {
            if (j === i) continue;
            var o = rows[j];
            if (String(o[COL.status]) === ST_CANCELED) continue;
            if (fmtCell(o[COL.date], "yyyy-MM-dd") !== rDate) continue;
            if (overlaps(rStart, rEnd, fmtTime(o[COL.start]), fmtTime(o[COL.end]))) {
              throw new Error("같은 시간대에 겹치는 예약(" + String(o[COL.status]) + " " + fmtTime(o[COL.start]) + "~" + fmtTime(o[COL.end]) + ")이 있어 확정할 수 없습니다.");
            }
          }
        }

        sh.getRange(rowNum, COL.status + 1).setValue(status);

        // 처리자 기록(아이디 + 시각) — 예약 행 '처리자' 칸 + '처리기록' 탭 양쪽에 남김.
        // 아이디로 저장하고, 관리자 페이지에서 볼 때 닉네임으로 변환해 표시.
        if (prev !== status) {
          var stamp = admin.id + " · " + Utilities.formatDate(new Date(), tz(), "MM-dd HH:mm");
          if (!trim(sh.getRange(1, COL.handler + 1).getValue())) sh.getRange(1, COL.handler + 1).setValue("처리자");
          sh.getRange(rowNum, COL.handler + 1).setValue(stamp);
          logAction(admin.id, id, rDate, rStart, rEnd, prev, status);
        }

        // 쿠금통: 확정으로 바뀌면 차감, 확정에서 풀리면 복구 (같은 상태 재설정은 무시)
        var warning = "";
        if (String(rows[i][COL.category]) === CAT_LABEL.credit && prev !== status) {
          var hours = (toMin(rEnd) - toMin(rStart)) / 60;
          if (prev !== ST_CONFIRMED && status === ST_CONFIRMED) {
            warning = creditAdjust(rName, rows[i][COL.phone], hours);
          } else if (prev === ST_CONFIRMED && status !== ST_CONFIRMED) {
            warning = creditAdjust(rName, rows[i][COL.phone], -hours);
          }
        }

        if (status === ST_CONFIRMED) {
          // 확정 → 캘린더에 등록 (없으면 새로 생성, 있으면 정보 갱신)
          if (!calId) {
            calId = calCreate(rDate, rStart, rEnd, rName, rPhone);
            sh.getRange(rowNum, COL.calId + 1).setValue(calId);
          } else {
            calUpdate(calId, rStart, rEnd, rName, rPhone);
          }
        } else {
          // 대기/취소 → 캘린더에서 제거 (캘린더에는 '확정' 건만 표시)
          if (calId) {
            calDelete(calId);
            sh.getRange(rowNum, COL.calId + 1).setValue("");
          }
        }
        return { id: id, status: status, creditWarning: warning };
      }
    }
    throw new Error("해당 예약을 찾을 수 없습니다.");
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 *  개인정보 자동 파기 (개인정보 처리방침의 보유 기간 이행)
 * ============================================================ */

// 보유 기간(년) — 전자상거래법상 계약·대금결제 기록 보존 기간(5년)에 맞춤.
// privacy.html의 안내 기간과 반드시 일치시켜야 함.
var RETENTION_YEARS = 5;

// 이용일로부터 RETENTION_YEARS년 지난 예약 행의 이름·연락처를 삭제.
// 행 자체(날짜·시간·금액·상태)는 개인을 알 수 없는 통계 자료로 남김.
function purgeOldPersonalData() {
  var sh = sheet();
  var rows = sh.getDataRange().getValues();
  var cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
  var cutStr = Utilities.formatDate(cutoff, tz(), "yyyy-MM-dd");
  var purged = 0;
  for (var i = 1; i < rows.length; i++) {
    var date = fmtCell(rows[i][COL.date], "yyyy-MM-dd");
    if (!date || date >= cutStr) continue;
    if (String(rows[i][COL.name]) === "(파기)" && !trim(rows[i][COL.phone])) continue; // 이미 파기된 행
    sh.getRange(i + 1, COL.name + 1).setValue("(파기)");
    sh.getRange(i + 1, COL.phone + 1).setValue("");
    purged++;
  }
  return purged;
}

/* ============================================================
 *  시트 서식 복구 (에디터에서 1회 실행용)
 * ============================================================ */

// 연락처 등 텍스트 열이 '자동 서식'이라 숫자로 변환되는 문제 복구:
// 1) 텍스트 서식을 열 전체에 고정 (이후 저장분은 010 그대로 유지)
// 2) 이미 숫자로 저장돼 앞 0이 사라진 연락처를 문자열로 되살림
function fixSheetFormats() {
  var sh = sheet();
  sh.getRange("C:G").setNumberFormat("@"); // 날짜/시작/종료/이름/연락처
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (typeof rows[i][COL.phone] === "number") {
      sh.getRange(i + 1, COL.phone + 1).setValue("0" + String(rows[i][COL.phone]));
    }
  }
  var csh = creditSheet();
  csh.getRange("A:B").setNumberFormat("@"); // 이름/연락처
  var crows = csh.getDataRange().getValues();
  for (var j = 1; j < crows.length; j++) {
    if (typeof crows[j][CCOL.phone] === "number") {
      csh.getRange(j + 1, CCOL.phone + 1).setValue("0" + String(crows[j][CCOL.phone]));
    }
  }
}

// 에디터에서 이 함수를 딱 한 번 실행하면 매일 새벽 4시경 자동 파기가 등록됨.
// (여러 번 실행해도 트리거가 중복 생성되지 않도록 기존 것을 지우고 다시 만듦)
function setupPurgeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "purgeOldPersonalData") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("purgeOldPersonalData").timeBased().everyDays(1).atHour(4).create();
}

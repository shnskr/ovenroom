# 오븐룸 예약 시스템 · 설치/배포 가이드

서버·DB 없이 **구글 캘린더 + 구글 시트 + Google Apps Script(무료 서버리스)** 로 동작합니다.
아래 순서대로 한 번만 설정하면 됩니다.

---

## 1. 구글 캘린더 만들기
1. [Google 캘린더](https://calendar.google.com) → 왼쪽 "다른 캘린더" 옆 **+** → **새 캘린더 만들기**
2. 이름: `오븐룸 예약` → 만들기
3. 만든 캘린더 **설정** → 아래로 스크롤 → **캘린더 통합** → **캘린더 ID** 복사
   (예: `xxxxxxxx@group.calendar.google.com`) — 예약 시 일정이 여기에 **자동 등록**됩니다.
4. **사이트의 '예약 현황'에 이 캘린더를 표시**하려면 (선택):
   - 같은 설정 화면의 **액세스 권한** → **"일반 공개 사용 설정"** 체크 → **"모든 일정 세부정보 보기"**
     (일정 제목이 익명 `예약됨`/`예약확정` 이라 이름·연락처 등 개인정보는 노출되지 않습니다.)
   - **캘린더 통합** → **"삽입 코드"** 의 `src="..."` 안의 URL
     (`https://calendar.google.com/calendar/embed?src=...`) 복사 → 5단계에서 사용

## 2. 구글 시트 만들기
1. [Google 시트](https://sheets.google.com)에서 새 스프레드시트 생성 → 이름 `오븐룸 예약기록`
2. 주소창 URL에서 **시트 ID** 복사
   `https://docs.google.com/spreadsheets/d/`**`여기가_시트ID`**`/edit`
   (시트 탭/헤더는 코드가 자동으로 생성하니 비워 둬도 됩니다.)

## 3. Apps Script 프로젝트 만들기
1. [script.google.com](https://script.google.com) → **새 프로젝트**
2. 기본 `Code.gs` 내용을 지우고 `apps-script/Code.gs` 내용을 **전부 붙여넣기**
3. 상단 톱니(프로젝트 설정) → **"appsscript.json 매니페스트 파일 표시"** 체크
   → 편집기에 생긴 `appsscript.json` 을 `apps-script/appsscript.json` 내용으로 교체
4. **VALID_ROOMS** (Code.gs 상단)를 실제 룸 목록과 맞추기
   (frontend `config.js` 의 `ROOMS[].id` 와 동일해야 함)

### 3-1. 스크립트 속성(비밀값) 등록  ← 중요
프로젝트 설정(톱니) → **스크립트 속성** → 아래 3개 추가:

| 속성 이름 | 값 |
|---|---|
| `SHEET_ID` | 2단계에서 복사한 시트 ID **(필수)** |
| `ADMIN_TOKEN` | 관리자 비밀번호(원하는 임의 문자열, 길고 복잡하게) **(필수)** |
| `CALENDAR_ID` | 1단계에서 복사한 캘린더 ID **(선택 — 넣으면 예약 시 캘린더 자동 등록)** |

> 이 값들은 구글 서버에만 저장되고 브라우저로 전송되지 않아 안전합니다.
> `CALENDAR_ID` 를 비워두면 캘린더 연동 없이 **시트에만** 저장됩니다.

## 4. 웹앱 배포
1. 오른쪽 위 **배포 → 새 배포**
2. 유형 선택(톱니) → **웹 앱**
3. 설정:
   - 설명: `오븐룸 예약 API`
   - **다음 사용자로 실행: 나(본인)**
   - **액세스 권한이 있는 사용자: 모든 사용자**  ← 고객이 로그인 없이 예약 가능
4. **배포** → 처음이면 권한 승인(캘린더/시트 접근) 팝업 허용
5. 발급된 **웹 앱 URL**(`.../exec`) 복사

## 5. 프론트엔드 연결
1. `js/config.js` 의 `API_URL` 에 4번 웹 앱 URL(`.../exec`) 붙여넣기
2. `js/config.js` 의 `CALENDAR_EMBED_URL` 에 1-4단계에서 복사한 삽입용 URL 붙여넣기
   (`https://calendar.google.com/calendar/embed?src=...`) — 넣으면 '예약 현황'에 캘린더가 표시됩니다.
3. `OPEN_HOUR / CLOSE_HOUR / SLOT_MINUTES / ROOMS / PRICING` 등 운영값 확인
4. 커밋 후 푸시 → **GitHub Pages** 로 자동 배포 (현재 이 레포가 그렇게 설정돼 있습니다)
   - 로컬 테스트: 프로젝트 폴더에서 `python -m http.server` 후 `localhost:8000`

## 6. 사용
- 고객: `index.html`
- 관리자: `admin.html` → 3-1의 `ADMIN_TOKEN` 입력

---

## 코드 수정 후 재배포
Code.gs 를 고치면 **배포 → 배포 관리 → 기존 배포 편집(연필) → 버전: 새 버전 → 배포**
로 갱신하세요. (URL 은 그대로 유지됩니다.)

## 자주 겪는 문제
- **응답을 못 읽음 / CORS 오류**: 배포 액세스가 "모든 사용자"인지, URL 이 `/exec`로 끝나는지 확인.
- **권한 오류**: 4번 배포 시 권한 승인을 건너뛰었을 수 있음. 재배포하며 승인.
- **시간이 밀림**: `appsscript.json` 의 `timeZone` 이 `Asia/Seoul` 인지 확인.

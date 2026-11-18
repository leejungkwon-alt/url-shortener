# 자체 단축 URL 서버

Node.js + Express + Base62 인코딩으로 동작하는 자체 호스팅 URL 단축 서버입니다.

## 요구 사항

- Node.js 18 이상

## 설치 및 실행

```bash
npm install
npm start        # http://localhost:3000
# 개발 모드(파일 변경 시 자동 재시작)
npm run dev
# 스모크 테스트 (node:test 기반, 별도 의존성 없음)
npm test
```

로컬에서 환경 변수를 파일로 관리하려면 `.env.example` 을 참고하세요(`.env` 는 커밋되지 않습니다).

## API

### 1) 단축 URL 생성 — `POST /api/shorten`

요청:

```bash
curl -X POST http://localhost:3000/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"long_url":"https://www.example.com/very/long/path?with=query&and=params"}'
```

응답 `201 Created` (동일 URL 재사용 시 `200 OK`, `reused: true`):

```json
{
  "shortCode": "k3Xb9Qa",
  "shortUrl": "http://localhost:3000/k3Xb9Qa",
  "longUrl": "https://www.example.com/very/long/path?with=query&and=params",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "reused": false
}
```

오류 응답:

| 상태 | 상황 |
| --- | --- |
| 400 | `long_url` 누락, URL 형식 오류, 허용되지 않은 스킴, 길이 초과, 자기 자신 URL |
| 500 | 서버 내부 오류 |

```json
{ "error": "BAD_REQUEST", "message": "유효한 URL 형식이 아닙니다. (예: https://example.com/path)" }
```

### 2) 리다이렉트 — `GET /:shortCode`

```bash
curl -i http://localhost:3000/k3Xb9Qa
# HTTP/1.1 302 Found
# Location: https://www.example.com/very/long/path?with=query&and=params
```

존재하지 않는 코드는 `404 Not Found`:

```json
{ "error": "NOT_FOUND", "message": "해당 단축 코드를 찾을 수 없습니다: noSuch1" }
```

### 3) 메타데이터 조회(선택) — `GET /api/:shortCode`

리다이렉트하지 않고 원본 URL/생성 시각/방문 수를 JSON으로 반환합니다.

### 4) 헬스체크 — `GET /health`

## Base62 인코딩 방식

`src/utils/base62.js` 에서 `0-9A-Za-z` 62문자 집합으로 숫자 ID를 문자열로 변환합니다.
- 7자리 코드 = 62⁷ ≈ 3.5조 가지 조합 → 충돌 확률이 극히 낮음
- URL에 특수문자가 필요 없어 `+`, `/`, `=` 이스케이프 문제가 없음
- 코드 생성 시 무작위 Base62 문자열을 만들고, 저장소의 원자적 중복 검사에서 충돌하면 길이를 늘려 재시도(최대 5회)

## 저장소

기본은 메모리 저장소이며, `STORAGE_DRIVER=json` 으로 파일 영속 저장이 가능합니다.

```bash
STORAGE_DRIVER=json STORAGE_FILE=./data/urls.json npm start
```

새 저장소(SQLite, Redis 등)를 추가하려면 `src/storage/urlStore.js` 인터페이스를 구현한 클래스를 만들고
`src/storage/index.js` 의 `createStore()` 에 분기만 추가하면 됩니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | 서버 포트 (Render 등 PaaS는 자동 주입) |
| `BASE_URL` | `RENDER_EXTERNAL_URL` → `http://localhost:PORT` | 응답에 사용할 단축 URL 기준 주소 |
| `RENDER_EXTERNAL_URL` | (Render 자동 주입) | `BASE_URL` 미설정 시 사용 |
| `STORAGE_DRIVER` | `memory` | `memory` \| `json` |
| `STORAGE_FILE` | `./data/urls.json` | JSON 저장 경로 |
| `SHORT_CODE_LENGTH` | `7` | 생성 코드 길이 |
| `REDIRECT_STATUS` | `302` | `301` \| `302` |

## 배포 (Render 등)

Node.js 단독 실행 구조이므로 별도 빌드 없이 `npm start` 로 동작합니다.

- Build Command: `npm ci --omit=dev`
- Start Command: `npm start`
- Health Check Path: `/health`
- `BASE_URL` 을 설정하지 않으면 Render의 `RENDER_EXTERNAL_URL` 이 자동 사용되어
  `https://<서비스명>.onrender.com/<code>` 형태의 단축 URL이 발급됩니다.
- 저장소 루트의 `render.yaml`(Blueprint)로 원클릭 배포도 가능합니다.

GitHub 저장소 연동·푸시·배포 절차 및 무료 플랜의 데이터 영속성 주의사항은 **[DEPLOY.md](./DEPLOY.md)** 를 참고하세요.

## 프로젝트 구조

```
server.js                     실행 진입점 (listen, graceful shutdown)
render.yaml                   Render Blueprint 배포 설정
DEPLOY.md                     Git/GitHub/Render 배포 가이드
test/smoke.test.js            스모크 테스트 (node:test)
src/
  app.js                      Express 앱 구성 (미들웨어, 라우터, 에러 핸들러)
  config.js                   환경 변수 기반 설정
  routes/urlRouter.js         POST /api/shorten, GET /api/:shortCode, GET /:shortCode
  services/urlService.js      URL 검증, 코드 생성, 중복 처리
  storage/
    urlStore.js               저장소 인터페이스 (확장 포인트)
    memoryStore.js            메모리 저장소 (기본)
    jsonFileStore.js          JSON 파일 저장소
    index.js                  저장소 팩토리
  utils/base62.js             Base62 encode/decode/randomCode
data/                         JSON 저장소 사용 시 생성되는 디렉터리 (git 제외)
```

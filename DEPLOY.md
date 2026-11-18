# Git 저장소 세팅 및 Render 배포 가이드

이 문서는 `c:\url-shortener` 프로젝트를 GitHub에 올리고 Render 등 PaaS에 배포하는 절차를 정리한 것입니다.
Git for Windows가 설치되어 있어야 합니다(`git --version`으로 확인).

---

## 1. 사전 점검 (배포 적합성)

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| `package.json` `scripts.start` | ✅ `node server.js` | Node.js 단독 실행만 사용, 프로세스 매니저 불필요 |
| `dependencies` | ✅ `express` 만 포함 | devDependencies 없음 → `npm ci --omit=dev`로 설치 |
| `engines.node` | ✅ `>=18` | Render 무료 플랜 기본 Node 20/22 호환 |
| 포트 | ✅ `process.env.PORT` 사용 | PaaS가 주입하는 포트를 그대로 사용 |
| 외부 접속 URL | ✅ `BASE_URL` → `RENDER_EXTERNAL_URL` → localhost 순 자동 판별 | 배포 시 단축 URL이 `https://<서비스>.onrender.com/...` 로 발급됨 |
| 헬스체크 | ✅ `GET /health` | Render `healthCheckPath` 로 사용 |
| 정상 종료 | ✅ SIGTERM 처리 | 재배포 시 요청/파일 flush 후 종료 |
| `node_modules` 커밋 | ✅ 차단 | `.gitignore` 포함 |
| 로컬 데이터(`data/`) | ✅ 차단 | `data/`, `*.tmp` 포함 |
| 비밀값(`.env`) | ✅ 차단 | `.env`, `.env.*` 차단 + `.env.example` 제공 |

테스트 실행:

```bash
npm install
npm test        # node:test 기반 스모크 테스트 (HTTP 201/302/404/400, Base62 등)
```

---

## 2. 로컬 Git 저장소 초기화

```bash
cd c:\url-shortener

git init -b main                 # main 브랜치로 초기화
git add .                        # .gitignore 규칙이 적용되어 node_modules/data 등은 제외됨
git status                       # 커밋될 파일 목록 확인 (node_modules 가 없어야 정상)
git commit -m "feat: 단축 URL 서버 초기 구현 (Express + Base62 + JSON 저장소)"
```

커밋 전 확인 팁:

```bash
git check-ignore -v node_modules data .env    # 어떤 규칙으로 제외되는지 확인
git ls-files                                  # 실제로 추적 중인 파일만 출력
```

> 최초 커밋 시 Git 사용자 정보가 없다면 한 번만 설정합니다.
> ```bash
> git config --global user.name "Your Name"
> git config --global user.email "you@example.com"
> ```

---

## 3. GitHub 원격 저장소 연동 및 푸시

### 3-1. GitHub에서 빈 저장소 생성

1. https://github.com/new 접속
2. Repository name 입력 (예: `url-shortener`)
3. **README, .gitignore, license 는 추가하지 않음** (이미 로컬에 있으므로 충돌 방지)
4. `Create repository` 클릭

### 3-2. 원격 연결 후 푸시

```bash
# HTTPS 방식 (가장 간단, 최초 푸시 시 브라우저 인증 또는 PAT 입력)
git remote add origin https://github.com/<USERNAME>/url-shortener.git

# 또는 SSH 방식 (SSH 키 등록 후)
# git remote add origin git@github.com:<USERNAME>/url-shortener.git

git push -u origin main          # -u: 이후부터는 git push 만으로 푸시
```

- 이미 원격이 등록되어 있다면 변경: `git remote set-url origin <새 URL>`
- 확인: `git remote -v`
- GitHub CLI를 쓴다면 저장소 생성까지 한 번에:
  ```bash
  gh repo create url-shortener --public --source=. --remote=origin --push
  ```

### 3-3. 이후 작업 흐름

```bash
git add -A
git commit -m "fix: ..."
git push
```

---

## 4. Render 배포

### 방법 A — 대시보드 수동 설정

1. https://dashboard.render.com → **New + → Web Service** → GitHub 저장소 연결
2. 입력값:
   | 항목 | 값 |
   | --- | --- |
   | Environment | `Node` |
   | Build Command | `npm ci --omit=dev` |
   | Start Command | `npm start` |
   | Health Check Path | `/health` |
   | Instance Type | `Free` (테스트용) |
3. **Environment Variables**:
   | Key | Value |
   | --- | --- |
   | `NODE_VERSION` | `20` |
   | `STORAGE_DRIVER` | `json` |
   | `STORAGE_FILE` | `./data/urls.json` |
   | `BASE_URL` | (선택) 커스텀 도메인 사용 시 `https://<도메인>`. 미설정 시 `RENDER_EXTERNAL_URL` 자동 사용 |
4. **Create Web Service** → 빌드 로그 확인 → 배포 완료 후 `https://<서비스명>.onrender.com/health` 접속

### 방법 B — Blueprint(`render.yaml`)

저장소 루트의 `render.yaml` 을 사용하면 설정이 자동화됩니다.

1. **New + → Blueprint** → 저장소 선택 → `Apply`
2. `render.yaml` 에 정의된 서비스/환경 변수로 자동 생성

### 배포 확인

```bash
curl https://<서비스명>.onrender.com/health
# {"status":"ok","storage":"json","baseUrl":"https://<서비스명>.onrender.com", ...}

curl -X POST https://<서비스명>.onrender.com/api/shorten \
  -H "Content-Type: application/json" \
  -d "{\"long_url\":\"https://www.example.com/long/path\"}"

curl -i https://<서비스명>.onrender.com/<shortCode>
# HTTP/2 302, location: https://www.example.com/long/path
```

---

## 5. 주의 사항 (영속성)

- **Render 무료 플랜은 파일 시스템이 영속적이지 않습니다.** 재배포/재시작 시 `data/urls.json` 이 초기화되고,
  무료 인스턴스는 15분 내외 미사용 시 슬립됩니다(첫 요청이 느려짐).
- 영속 저장이 필요한 경우 선택지:
  1. Render **Persistent Disk** 를 `/var/data` 에 마운트 → `STORAGE_FILE=/var/data/urls.json`
  2. 외부 DB 사용 → `src/storage/urlStore.js` 인터페이스를 구현한 `PostgresStore`/`SqliteStore` 를 만들어
     `src/storage/index.js` 의 `createStore()` 에 분기 추가 (서비스/라우터 코드는 수정 불필요)
- `STORAGE_DRIVER=memory` 는 서버 재시작 시 모든 단축 URL이 사라지므로 배포 환경에서는 권장하지 않습니다.
- Render 서비스명을 바꾸면 도메인이 바뀌므로, 기존에 발급한 단축 URL은 동작하지 않습니다. `BASE_URL` 을 명시하는 편이 안전합니다.

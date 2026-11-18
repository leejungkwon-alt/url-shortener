'use strict';

/**
 * 애플리케이션 전역 설정.
 *
 * 모든 값은 환경 변수로 덮어쓸 수 있으므로 코드를 수정하지 않고도
 * 실행 환경(로컬/스테이징/운영)에 맞춰 동작을 바꿀 수 있습니다.
 *
 *   PORT            : 서버가 리슨할 포트 (기본 3000)
 *   BASE_URL        : 단축 URL을 만들 때 사용할 외부 기준 URL (기본 http://localhost:PORT)
 *   STORAGE_DRIVER  : 'memory' | 'json' (기본 'memory')
 *   STORAGE_FILE    : STORAGE_DRIVER=json 일 때 사용할 파일 경로 (기본 ./data/urls.json)
 *   SHORT_CODE_LENGTH: 생성할 짧은 코드의 길이 (기본 7)
 *   REDIRECT_STATUS : 리다이렉트 HTTP 상태 코드 (301 | 302, 기본 302)
 *
 * 배포 환경 자동 감지
 *   RENDER_EXTERNAL_URL : Render.com 이 자동 주입하는 외부 접속 URL.
 *                         BASE_URL 이 없을 때 이 값을 대신 사용하므로,
 *                         별도 설정 없이도 올바른 단축 URL이 발급됩니다.
 */

const path = require('path');

/** 문자열 환경 변수를 정수로 파싱하고, 실패하면 기본값을 사용합니다. */
function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const port = toInt(process.env.PORT, 3000);

/**
 * 단축 URL 생성 시 사용할 베이스 URL.
 * 우선순위: BASE_URL → RENDER_EXTERNAL_URL → http://localhost:PORT
 * 끝의 '/' 는 제거해서 `${baseUrl}/${code}` 형태로 안전하게 조합할 수 있게 합니다.
 */
const baseUrl = (
  process.env.BASE_URL
  || process.env.RENDER_EXTERNAL_URL
  || `http://localhost:${port}`
).replace(/\/+$/, '');

module.exports = {
  port,
  baseUrl,

  // 저장소 선택: 기본은 메모리. 'json' 으로 바꾸면 파일에 영속 저장됩니다.
  storageDriver: (process.env.STORAGE_DRIVER || 'memory').toLowerCase(),
  storageFile: process.env.STORAGE_FILE
    ? path.resolve(process.env.STORAGE_FILE)
    : path.join(__dirname, '..', 'data', 'urls.json'),

  // Base62 코드 길이(새 코드를 무작위로 생성할 때 사용하는 길이)
  shortCodeLength: Math.max(1, toInt(process.env.SHORT_CODE_LENGTH, 7)),

  // 리다이렉트 상태 코드 (301: 영구 이동, 302: 임시 이동)
  redirectStatus: toInt(process.env.REDIRECT_STATUS, 302) === 301 ? 301 : 302,

  // 허용할 원본 URL 최대 길이 (DB 컬럼/VARCHAR 한계를 고려한 안전값)
  maxUrlLength: 2048,
};

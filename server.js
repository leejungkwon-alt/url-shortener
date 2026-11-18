'use strict';

/**
 * 서버 실행 진입점.
 *
 * 사용법
 *   npm install      # 최초 1회 (express 설치)
 *   npm start        # 서버 실행 (기본 http://localhost:3000)
 *
 * 환경 변수 예시
 *   PORT=8080 STORAGE_DRIVER=json npm start
 */

const http = require('node:http');
const { createApp } = require('./src/app');
const config = require('./src/config');

async function main() {
  // 1) Express 앱 생성 (저장소 초기화 포함)
  const app = await createApp({ config });

  // 2) HTTP 서버 생성
  const server = http.createServer(app);

  // 3) 포트 바인딩
  server.listen(config.port, () => {
    console.log('------------------------------------------------------------');
    console.log(` 단축 URL 서버가 실행되었습니다: ${config.baseUrl}`);
    console.log(` 저장소 드라이버: ${config.storageDriver}${config.storageDriver === 'json' ? ` (${config.storageFile})` : ''}`);
    console.log(` 리다이렉트 상태 코드: ${config.redirectStatus}`);
    console.log('------------------------------------------------------------');
    console.log(` URL 단축  : POST ${config.baseUrl}/api/shorten  { "long_url": "https://..." }`);
    console.log(` 정보 조회 : GET  ${config.baseUrl}/api/:shortCode`);
    console.log(` 리다이렉트: GET  ${config.baseUrl}/:shortCode`);
    console.log('------------------------------------------------------------');
  });

  /**
   * 정상 종료 처리(SIGINT/SIGTERM).
   * - 새 연결 수락을 중단하고, 남은 요청을 마친 뒤 저장소를 닫습니다.
   * - JSON 저장소의 경우 남아 있는 쓰기 작업을 flush 합니다.
   */
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[${signal}] 서버를 종료합니다...`);

    server.close(async () => {
      try {
        await app.locals.store.close();
      } catch (error) {
        console.error('저장소 종료 중 오류:', error.message);
      }
      console.log('서버가 정상적으로 종료되었습니다.');
      process.exit(0);
    });

    // 10초 내에 종료되지 않으면 강제 종료
    setTimeout(() => {
      console.error('종료 시간이 초과되어 강제 종료합니다.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

// 모듈로 불러올 때(테스트 등)는 서버를 자동 실행하지 않습니다.
if (require.main === module) {
  main().catch((error) => {
    console.error('서버 시작 실패:', error);
    process.exit(1);
  });
}

module.exports = { main };

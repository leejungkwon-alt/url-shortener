'use strict';

const express = require('express');
const defaultConfig = require('./config');
const { createStore } = require('./storage');
const { UrlService } = require('./services/urlService');
const { createUrlRouter } = require('./routes/urlRouter');

/**
 * Express 앱을 생성합니다.
 *
 * server.js(실행 진입점)와 테스트 코드가 같은 앱 구성 로직을 공유할 수 있도록
 * 앱 생성과 서버 리슨(listen)을 분리했습니다.
 * (테스트에서는 app을 메모리 저장소와 함께 만들어 supertest 등으로 검증할 수 있습니다.)
 *
 * @param {object} [options]
 * @param {object} [options.config] 설정 객체 (기본: src/config.js)
 * @param {import('./storage/urlStore').UrlStore} [options.store] 사용할 저장소 (기본: 설정 기반 생성)
 * @returns {Promise<import('express').Express>}
 */
async function createApp({ config = defaultConfig, store: providedStore } = {}) {
  const store = providedStore || createStore(config);
  // 저장소 초기화(JSON 파일 로드 등). 메모리 저장소는 아무 일도 하지 않습니다.
  await store.init();

  const urlService = new UrlService({ store, config });

  const app = express();

  // 저장소에 접근할 수 있도록 앱에 부착해 둡니다. (종료 처리/테스트에서 사용)
  app.locals.store = store;
  app.locals.config = config;
  app.locals.urlService = urlService;

  // JSON 본문 파싱 미들웨어 (Content-Type: application/json)
  app.use(express.json({ limit: '16kb' }));
  // URL-encoded 폼 데이터도 허용 (HTML form 전송 지원)
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  // 접근 로그 (개발 편의용)
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
  });

  // 서비스 상태/사용법 안내용 루트 헬스체크는 API 경로와 충돌하지 않도록 '/health' 사용
  // Render 등 PaaS 의 헬스체크 프로브로도 사용할 수 있습니다.
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      storage: config.storageDriver,
      // 배포 환경에서 BASE_URL 설정이 올바른지 바로 확인할 수 있도록 노출합니다.
      baseUrl: config.baseUrl,
      nodeVersion: process.version,
      uptime: Math.round(process.uptime()),
    });
  });

  // 단축 URL 라우터 (POST /api/shorten, GET /:shortCode 등)
  app.use(createUrlRouter({ urlService, config }));

  // 404 처리: 위 라우터에서 매칭되지 않은 모든 요청
  app.use((req, res) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `요청한 리소스를 찾을 수 없습니다: ${req.method} ${req.originalUrl}`,
    });
  });

  // 공통 에러 핸들러: 예기치 못한 오류를 500 JSON 응답으로 정규화합니다.
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    // express.json() 이 잘못된 JSON 본문에 대해 던지는 에러(SyntaxError + status) 처리
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: '요청 본문이 올바른 JSON 형식이 아닙니다.',
      });
    }

    console.error('[ERROR]', error);
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
    });
  });

  return app;
}

module.exports = { createApp };

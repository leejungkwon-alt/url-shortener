'use strict';

const express = require('express');
const { ValidationError } = require('../services/urlService');

/**
 * 단축 URL 관련 라우터.
 *
 * 라우팅 우선순위 설계
 *  - Express는 라우터를 등록한 순서대로 매칭하므로, 'GET /:shortCode' 와일드카드가
 *    '/api/...' 요청까지 삼켜버리지 않도록 API 경로를 먼저 등록합니다.
 *  - 등록 순서: POST /api/shorten → GET /api/:shortCode → GET /:shortCode
 *
 * @param {object} deps
 * @param {import('../services/urlService').UrlService} deps.urlService
 * @param {object} deps.config 설정 객체
 * @returns {import('express').Router}
 */
function createUrlRouter({ urlService, config }) {
  const router = express.Router();

  /* ------------------------------------------------------------------ *
   * 1) POST /api/shorten — 단축 URL 생성
   *
   * 요청 본문(JSON):
   *   { "long_url": "https://example.com/some/very/long/path?x=1" }
   *
   * 성공 응답: 201 Created
   *   {
   *     "shortCode": "aB3dE9x",
   *     "shortUrl": "http://localhost:3000/aB3dE9x",
   *     "longUrl": "https://example.com/some/very/long/path?x=1",
   *     "createdAt": "2026-01-01T00:00:00.000Z",
   *     "reused": false
   *   }
   *
   * 실패 응답:
   *   400 — long_url 누락/형식 오류
   * ------------------------------------------------------------------ */
  router.post('/api/shorten', async (req, res, next) => {
    try {
      // 명세상 필드명은 long_url 이지만, 사용 편의를 위해 url 도 함께 허용합니다.
      const rawUrl = req.body?.long_url ?? req.body?.url;

      const result = await urlService.shorten(rawUrl);

      // 새로 생성했으면 201, 기존 단축 URL을 재사용했으면 200을 반환합니다.
      res.status(result.reused ? 200 : 201).json({
        shortCode: result.shortCode,
        shortUrl: result.shortUrl,
        longUrl: result.longUrl,
        createdAt: result.createdAt,
        reused: result.reused,
      });
    } catch (error) {
      // 검증 오류는 400, 그 외 오류는 공통 에러 핸들러(500)로 전달합니다.
      if (error instanceof ValidationError) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: error.message,
        });
      }
      return next(error);
    }
  });

  /* ------------------------------------------------------------------ *
   * 2) GET /api/:shortCode — 리다이렉트 없이 메타데이터 조회 (선택 기능)
   *
   * 단축 URL 정보를 JSON으로 확인하고 싶을 때 사용합니다.
   * ------------------------------------------------------------------ */
  router.get('/api/:shortCode', async (req, res, next) => {
    try {
      const record = await urlService.resolve(req.params.shortCode);
      if (!record) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: `해당 단축 코드를 찾을 수 없습니다: ${req.params.shortCode}`,
        });
      }
      return res.json({
        shortCode: record.shortCode,
        shortUrl: `${config.baseUrl}/${record.shortCode}`,
        longUrl: record.longUrl,
        createdAt: record.createdAt,
        visits: record.visits || 0,
      });
    } catch (error) {
      return next(error);
    }
  });

  /* ------------------------------------------------------------------ *
   * 3) GET /:shortCode — 짧은 코드로 원본 URL로 리다이렉트
   *
   * 성공: 302 Found (또는 REDIRECT_STATUS=301 로 설정 시 301)
   *   Location: https://example.com/...
   *
   * 실패: 404 — 존재하지 않는 코드
   * ------------------------------------------------------------------ */
  router.get('/:shortCode', async (req, res, next) => {
    try {
      const { shortCode } = req.params;
      const record = await urlService.resolve(shortCode);

      if (!record) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: `해당 단축 코드를 찾을 수 없습니다: ${shortCode}`,
        });
      }

      // 통계 집계(확장 포인트). 실패하더라도 리다이렉트 자체는 막지 않습니다.
      urlService.store.incrementVisits(shortCode).catch(() => {});

      // 302를 기본값으로 사용하는 이유:
      //  - 301은 브라우저/프록시가 영구 캐시하므로, 이후 통계 집계나 대상 URL 변경이 반영되지 않을 수 있습니다.
      //  - 단축 서비스는 대상이 바뀔 수 있으므로 임시 이동(302/307)이 일반적입니다.
      return res.redirect(config.redirectStatus, record.longUrl);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createUrlRouter };

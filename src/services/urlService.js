'use strict';

const base62 = require('../utils/base62');

/**
 * 입력값 검증 실패를 나타내는 도메인 에러.
 * 라우터에서 이 에러 타입을 구분해 400(Bad Request) 응답으로 변환합니다.
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

/**
 * URL 단축 도메인 서비스.
 *
 * 라우터(HTTP 계층)와 저장소(영속 계층) 사이에서 비즈니스 규칙을 담당합니다.
 *  - 원본 URL 검증/정규화
 *  - Base62 기반 고유 코드 생성 및 충돌 처리
 *  - 중복 URL 재사용 정책
 *
 * 이렇게 계층을 나눠두면 HTTP 프레임워크를 바꾸거나, 단위 테스트를 작성할 때
 * Express에 의존하지 않고 로직만 검증할 수 있습니다.
 */
class UrlService {
  /**
   * @param {object} deps
   * @param {import('../storage/urlStore').UrlStore} deps.store 저장소 구현체
   * @param {object} deps.config 설정 객체 (baseUrl, shortCodeLength, maxUrlLength)
   */
  constructor({ store, config }) {
    this.store = store;
    this.config = config;
    /** 코드 충돌 시 재시도할 최대 횟수 */
    this.maxAttempts = 5;
  }

  /**
   * 사용자 입력(원본 URL 문자열)을 검증하고 정규화합니다.
   *
   * 허용 범위
   *  - http / https 프로토콜만 허용 (javascript:, data: 등 스킴 인젝션 차단)
   *  - 최대 길이 제한
   *  - 자기 자신(단축 서버)을 가리키는 URL은 무한 리다이렉트를 유발하므로 차단
   *
   * @param {string} rawUrl
   * @returns {string} 정규화된 URL 문자열
   * @throws {ValidationError}
   */
  validateUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      throw new ValidationError('long_url 값이 필요합니다.');
    }

    const trimmed = rawUrl.trim();

    if (trimmed.length > this.config.maxUrlLength) {
      throw new ValidationError(
        `URL이 너무 깁니다. 최대 ${this.config.maxUrlLength}자까지 허용됩니다.`,
      );
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new ValidationError('유효한 URL 형식이 아닙니다. (예: https://example.com/path)');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError('http 또는 https 프로토콜의 URL만 단축할 수 있습니다.');
    }

    // 스스로를 가리키는 URL은 리다이렉트 루프를 만들므로 거부합니다.
    if (parsed.origin === this.config.baseUrl || trimmed.startsWith(`${this.config.baseUrl}/`)) {
      throw new ValidationError('단축 서버 자신의 URL은 단축할 수 없습니다.');
    }

    // new URL().toString() 으로 정규화하면 중복 판단(중복 URL 재사용)이 정확해집니다.
    return parsed.toString();
  }

  /**
   * 하나의 단축 코드를 저장소에 저장합니다. 충돌하면 예외를 던집니다.
   * @param {string} code
   * @param {string} longUrl
   * @returns {Promise<object>} 저장된 레코드
   */
  async #persist(code, longUrl) {
    const record = {
      shortCode: code,
      longUrl,
      createdAt: new Date().toISOString(),
      visits: 0,
    };
    return this.store.save(record);
  }

  /**
   * 원본 URL을 단축합니다.
   *
   * 코드 생성 전략
   *  1. 이미 동일 URL을 단축한 기록이 있으면 그 코드를 그대로 재사용합니다. (저장 공간 절약 + 멱등성)
   *  2. 그렇지 않으면 설정된 길이의 Base62 무작위 코드를 생성합니다.
   *  3. 코드가 이미 사용 중이면(Base62 인코딩 결과 충돌) 재시도합니다.
   *
   * @param {string} rawUrl 사용자가 보낸 원본 URL
   * @returns {Promise<{ shortCode: string, shortUrl: string, longUrl: string, createdAt: string, reused: boolean }>}
   */
  async shorten(rawUrl) {
    const longUrl = this.validateUrl(rawUrl);

    // 1) 동일 URL 재사용: 같은 URL을 여러 번 요청해도 같은 단축 URL을 돌려줍니다.
    const existing = await this.store.findByLongUrl(longUrl);
    if (existing) {
      return this.#toResponse(existing, true);
    }

    // 2~3) Base62 무작위 코드 생성 + 충돌 시 재시도
    let lastError;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      // 충돌 확률이 매우 낮지만, 재시도할 때마다 길이를 1씩 늘려 공간을 확보합니다.
      const candidate = base62.randomCode(this.config.shortCodeLength + Math.floor(attempt / 2));

      // 저장소의 원자적 save() 가 중복 검사를 수행하므로, 굳이 조회 후 저장하는
      // 'check-then-act' 경쟁 조건을 만들지 않습니다.
      try {
        const saved = await this.#persist(candidate, longUrl);
        return this.#toResponse(saved, false);
      } catch (error) {
        lastError = error;
      }
    }

    // 5회 모두 실패하는 것은 비정상적인 상황(코드 공간 고갈 등)입니다.
    throw new Error(`짧은 코드 생성에 실패했습니다: ${lastError ? lastError.message : '알 수 없는 오류'}`);
  }

  /**
   * 주어진 코드에 대응하는 레코드를 찾습니다. 없으면 null 을 반환합니다.
   * @param {string} shortCode
   * @returns {Promise<object | null>}
   */
  async resolve(shortCode) {
    // Base62 형식이 아닌 코드는 저장소를 조회할 필요가 없습니다.
    if (!base62.isBase62(shortCode)) return null;
    return this.store.findByCode(shortCode);
  }

  /**
   * 내부 레코드를 API 응답 형태로 변환합니다.
   * @param {object} record
   * @param {boolean} reused 기존 단축 URL 재사용 여부
   */
  #toResponse(record, reused) {
    return {
      shortCode: record.shortCode,
      shortUrl: `${this.config.baseUrl}/${record.shortCode}`,
      longUrl: record.longUrl,
      createdAt: record.createdAt,
      reused,
    };
  }
}

module.exports = { UrlService, ValidationError };

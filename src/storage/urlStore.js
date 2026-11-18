'use strict';

/**
 * 저장소(Repository) 인터페이스.
 *
 * 이 프로젝트는 "확장하기 쉬운 구조"를 목표로 하므로, 실제 저장 방식은
 * 이 인터페이스를 구현한 클래스(MemoryStore, JsonFileStore, 추후 SqliteStore 등)에게 위임합니다.
 * 라우터/서비스 계층은 이 인터페이스만 알면 되므로, 저장소를 바꿔도 나머지 코드는 그대로 동작합니다.
 *
 * 모든 메서드는 비동기(Promise)로 정의하여, 나중에 DB(MySQL, SQLite, Redis 등)로
 * 교체하더라도 호출부 코드를 수정하지 않아도 되게 합니다.
 *
 * @typedef {Object} UrlRecord
 * @property {string} shortCode      짧은 코드
 * @property {string} longUrl        원본 URL
 * @property {string} createdAt      생성 시각 (ISO 8601)
 * @property {number} [id]           숫자 ID (Base62 encode용, 선택)
 * @property {string} [urlId]        중복 URL 재사용 시 참조하는 기존 레코드 코드 (선택)
 */
class UrlStore {
  /**
   * 저장소 초기화(파일 열기, DB 연결 등). 기본 구현은 할 일이 없습니다.
   * @returns {Promise<void>}
   */
  async init() {}

  /**
   * 코드로 레코드를 조회합니다.
   * @param {string} shortCode
   * @returns {Promise<UrlRecord | null>}
   */
  async findByCode(shortCode) { // eslint-disable-line no-unused-vars
    throw new Error('findByCode()는 반드시 구현해야 합니다.');
  }

  /**
   * 원본 URL로 레코드를 조회합니다. (이미 단축된 URL의 중복 생성을 막는 용도)
   * @param {string} longUrl
   * @returns {Promise<UrlRecord | null>}
   */
  async findByLongUrl(longUrl) { // eslint-disable-line no-unused-vars
    throw new Error('findByLongUrl()는 반드시 구현해야 합니다.');
  }

  /**
   * 새로운 레코드를 저장합니다. 이미 같은 코드가 있으면 에러를 던져 충돌을 알립니다.
   * @param {UrlRecord} record
   * @returns {Promise<UrlRecord>} 저장된 레코드
   */
  async save(record) { // eslint-disable-line no-unused-vars
    throw new Error('save()는 반드시 구현해야 합니다.');
  }

  /**
   * 리다이렉트가 발생할 때 방문 수를 1 증가시킵니다. (통계용 확장 포인트)
   * @param {string} shortCode
   * @returns {Promise<void>}
   */
  async incrementVisits(shortCode) {} // eslint-disable-line no-unused-vars

  /**
   * 저장소 종료 처리(파일 플러시, 커넥션 종료 등).
   * @returns {Promise<void>}
   */
  async close() {}
}

module.exports = { UrlStore };

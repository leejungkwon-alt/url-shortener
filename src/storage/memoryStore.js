'use strict';

const { UrlStore } = require('./urlStore');

/**
 * 메모리(Map) 기반 저장소. 기본 드라이버로 사용됩니다.
 *
 * 특징
 *  - 가장 빠르고 의존성이 없습니다.
 *  - 서버 프로세스가 종료되면 데이터가 사라집니다. (개발/테스트에 적합)
 *  - 코드 저장 시 Map.has() 로 O(1) 충돌 검사를 수행합니다.
 */
class MemoryStore extends UrlStore {
  constructor() {
    super();
    /** @type {Map<string, object>} 코드 → 레코드 */
    this.records = new Map();
    /** @type {Map<string, string>} 원본 URL → 코드 (중복 URL 재사용을 위한 인덱스) */
    this.byLongUrl = new Map();
  }

  /**
   * @param {string} shortCode
   * @returns {Promise<object | null>}
   */
  async findByCode(shortCode) {
    return this.records.get(shortCode) || null;
  }

  /**
   * @param {string} longUrl
   * @returns {Promise<object | null>}
   */
  async findByLongUrl(longUrl) {
    const code = this.byLongUrl.get(longUrl);
    return code ? this.records.get(code) || null : null;
  }

  /**
   * 레코드를 저장합니다. 코드가 이미 존재하면 에러를 던집니다.
   * @param {object} record
   * @returns {Promise<object>}
   */
  async save(record) {
    if (this.records.has(record.shortCode)) {
      // 충돌 시 서비스 계층에서 다른 코드로 재시도합니다.
      throw new Error(`이미 사용 중인 짧은 코드입니다: ${record.shortCode}`);
    }
    this.records.set(record.shortCode, record);
    this.byLongUrl.set(record.longUrl, record.shortCode);
    return record;
  }

  /**
   * 방문 수를 증가시킵니다. (조회 성능을 위해 비동기적으로 처리)
   * @param {string} shortCode
   */
  async incrementVisits(shortCode) {
    const record = this.records.get(shortCode);
    if (record) record.visits = (record.visits || 0) + 1;
  }

  /** @returns {number} 저장된 레코드 수 (테스트/디버깅용) */
  get size() {
    return this.records.size;
  }
}

module.exports = { MemoryStore };

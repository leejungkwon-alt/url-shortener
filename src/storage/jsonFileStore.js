'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { UrlStore } = require('./urlStore');

/**
 * JSON 파일 기반 저장소.
 *
 * 용도
 *  - 서버를 재시작해도 단축 URL이 유지되도록 하는 간단한 영속 저장소입니다.
 *  - STORAGE_DRIVER=json 환경 변수로 활성화합니다.
 *
 * 동작 방식
 *  - 파일 전체를 메모리에 올려 조회/검사하고, 변경 시 파일에 저장(원자적 쓰기)합니다.
 *  - 소규모 서비스나 로컬 개발용으로 충분하며, 대규모 트래픽에는 SQLite/Redis 등으로 교체하세요.
 *
 * 파일 형식 (예시)
 *  {
 *    "version": 1,
 *    "records": {
 *      "abc1234": { "shortCode": "abc1234", "longUrl": "https://...", "createdAt": "...", "visits": 3 }
 *    }
 *  }
 */
class JsonFileStore extends UrlStore {
  /**
   * @param {string} filePath 저장할 JSON 파일 경로
   */
  constructor(filePath) {
    super();
    this.filePath = filePath;
    /** @type {Map<string, object>} */
    this.records = new Map();
    /** @type {Map<string, string>} */
    this.byLongUrl = new Map();
    /** 동시 쓰기로 인한 파일 손상을 막기 위한 저장 큐(Promise 체이닝) */
    this.saveQueue = Promise.resolve();
  }

  /**
   * 파일을 읽어 메모리에 로드합니다. 파일이 없으면 빈 저장소로 시작합니다.
   */
  async init() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      const records = (data && data.records) || {};
      for (const [code, record] of Object.entries(records)) {
        this.records.set(code, record);
        this.byLongUrl.set(record.longUrl, code);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // 첫 실행: 파일이 아직 없으므로 디렉터리만 만들어 둡니다.
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await this.flush();
        return;
      }
      throw new Error(`저장 파일을 읽을 수 없습니다 (${this.filePath}): ${error.message}`);
    }
  }

  /** @param {string} shortCode */
  async findByCode(shortCode) {
    return this.records.get(shortCode) || null;
  }

  /** @param {string} longUrl */
  async findByLongUrl(longUrl) {
    const code = this.byLongUrl.get(longUrl);
    return code ? this.records.get(code) || null : null;
  }

  /**
   * @param {object} record
   * @returns {Promise<object>}
   */
  async save(record) {
    if (this.records.has(record.shortCode)) {
      throw new Error(`이미 사용 중인 짧은 코드입니다: ${record.shortCode}`);
    }
    this.records.set(record.shortCode, record);
    this.byLongUrl.set(record.longUrl, record.shortCode);
    await this.flush();
    return record;
  }

  /** @param {string} shortCode */
  async incrementVisits(shortCode) {
    const record = this.records.get(shortCode);
    if (record) {
      record.visits = (record.visits || 0) + 1;
      await this.flush();
    }
  }

  /**
   * 메모리 상태를 파일에 저장합니다.
   * - 저장 요청을 큐로 직렬화하여 동시 요청에도 파일이 깨지지 않게 합니다.
   * - 임시 파일에 먼저 쓴 뒤 rename 하여 원자적으로 교체합니다.
   */
  async flush() {
    this.saveQueue = this.saveQueue.then(async () => {
      const data = {
        version: 1,
        records: Object.fromEntries(this.records),
      };
      const tmpPath = `${this.filePath}.tmp`;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmpPath, this.filePath);
    }, () => {}); // 이전 작업이 실패하더라도 큐는 계속 진행되도록 합니다.

    return this.saveQueue;
  }

  /** 종료 전 남은 쓰기 작업을 마무리합니다. */
  async close() {
    await this.flush();
  }
}

module.exports = { JsonFileStore };

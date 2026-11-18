'use strict';

const { MemoryStore } = require('./memoryStore');
const { JsonFileStore } = require('./jsonFileStore');

/**
 * 팩토리 함수: 설정값에 따라 적절한 저장소 인스턴스를 생성합니다.
 *
 * 새 저장소(예: SqliteStore)를 추가할 때는 아래 switch 에 한 줄만 추가하면 됩니다.
 * 이처럼 저장소 생성 로직을 한 곳에 모아두면 서비스/라우터 코드는 수정할 필요가 없습니다.
 *
 * @param {object} config src/config.js 의 설정 객체
 * @returns {import('./urlStore').UrlStore}
 */
function createStore(config) {
  switch (config.storageDriver) {
    case 'json':
      return new JsonFileStore(config.storageFile);
    case 'memory':
    default:
      return new MemoryStore();
  }
}

module.exports = { createStore, MemoryStore, JsonFileStore };

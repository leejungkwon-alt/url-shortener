'use strict';

/**
 * 배포 전/후 동작 확인용 스모크 테스트.
 *
 * 추가 의존성 없이 Node.js 내장 테스트 러너(node:test)와 내장 fetch(Node 18+)만 사용합니다.
 *   npm test
 *
 * 메모리 저장소로 실제 HTTP 서버를 임시 포트에 띄운 뒤, 핵심 시나리오를 검증합니다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/app');
const defaultConfig = require('../src/config');
const { MemoryStore } = require('../src/storage/memoryStore');
const base62 = require('../src/utils/base62');

/**
 * 임시 포트로 서버를 띄우고 테스트용 핸들을 반환합니다.
 */
async function startTestServer() {
  const store = new MemoryStore();
  const config = { ...defaultConfig, storageDriver: 'memory', redirectStatus: 302 };

  const app = await createApp({ config, store });
  const server = http.createServer(app);
  // 포트 0 = OS가 빈 포트를 할당합니다.
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  // 응답에 사용하는 baseUrl 을 실제 테스트 서버 주소로 교체합니다.
  app.locals.config.baseUrl = baseUrl;
  app.locals.urlService.config.baseUrl = baseUrl;

  return {
    baseUrl,
    store,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** JSON POST 헬퍼 (리다이렉트는 수동 처리) */
async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // JSON 이 아닌 응답은 json = null 로 둡니다.
  }
  return { status: response.status, headers: response.headers, json, text };
}

test('Base62: encode/decode 왕복 및 경계값', () => {
  assert.equal(base62.encode(0), '0');
  assert.equal(base62.encode(61), 'z');
  assert.equal(base62.encode(62), '10');
  assert.equal(base62.encode(3844), '100');

  for (const value of [0, 1, 61, 62, 12345, 987654321, Number.MAX_SAFE_INTEGER]) {
    assert.equal(base62.decode(base62.encode(value)), value, `roundtrip 실패: ${value}`);
  }

  assert.equal(base62.isBase62('aB3'), true);
  assert.equal(base62.isBase62('a-b'), false);
  assert.equal(base62.isBase62(''), false);
  assert.throws(() => base62.decode('a-b'));
});

test('POST /api/shorten → 201 및 단축 URL 반환', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const longUrl = 'https://www.example.com/very/long/path?a=1&b=2';
  const { status, json } = await postJson(`${server.baseUrl}/api/shorten`, { long_url: longUrl });

  assert.equal(status, 201);
  assert.match(json.shortCode, /^[0-9A-Za-z]{7}$/);
  assert.equal(json.shortUrl, `${server.baseUrl}/${json.shortCode}`);
  assert.equal(json.longUrl, longUrl);
  assert.equal(json.reused, false);
  assert.ok(Date.parse(json.createdAt), 'createdAt 이 ISO 날짜여야 합니다.');
});

test('GET /:shortCode → 원본 URL로 302 리다이렉트', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const longUrl = 'https://nodejs.org/en/docs';
  const created = await postJson(`${server.baseUrl}/api/shorten`, { long_url: longUrl });

  const response = await fetch(`${server.baseUrl}/${created.json.shortCode}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), longUrl);
});

test('존재하지 않는 코드 → 404 JSON', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/doesNotExist1`, { redirect: 'manual' });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, 'NOT_FOUND');
});

test('동일 URL 재요청 시 같은 코드 재사용 (200, reused=true)', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const longUrl = 'https://reuse.example.com/a';
  const first = await postJson(`${server.baseUrl}/api/shorten`, { long_url: longUrl });
  const second = await postJson(`${server.baseUrl}/api/shorten`, { long_url: longUrl });

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.shortCode, first.json.shortCode);
  assert.equal(second.json.reused, true);
});

test('잘못된 입력 → 400 (누락/형식 오류/허용되지 않은 스킴/깨진 JSON)', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const missing = await postJson(`${server.baseUrl}/api/shorten`, {});
  assert.equal(missing.status, 400);

  const malformed = await postJson(`${server.baseUrl}/api/shorten`, { long_url: 'not-a-url' });
  assert.equal(malformed.status, 400);

  const badScheme = await postJson(`${server.baseUrl}/api/shorten`, {
    long_url: 'javascript:alert(1)',
  });
  assert.equal(badScheme.status, 400);

  const invalidJson = await postJson(`${server.baseUrl}/api/shorten`, '{"long_url": ');
  assert.equal(invalidJson.status, 400);
});

test('GET /health → 상태 및 baseUrl 노출', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.baseUrl, server.baseUrl);
});

test('BASE_URL 미설정 시 RENDER_EXTERNAL_URL 을 사용한다', () => {
  // config.js 는 로드 시점에 환경 변수를 읽으므로, 캐시를 비우고 재로드해 검증합니다.
  const configPath = require.resolve('../src/config');
  const saved = {
    BASE_URL: process.env.BASE_URL,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
  };

  try {
    delete process.env.BASE_URL;
    process.env.RENDER_EXTERNAL_URL = 'https://my-shortener.onrender.com/';
    delete require.cache[configPath];
    const reloaded = require(configPath);
    // 끝의 '/' 는 제거되어야 합니다.
    assert.equal(reloaded.baseUrl, 'https://my-shortener.onrender.com');
  } finally {
    // 환경 변수를 원래대로 복원하고 실제 설정을 다시 로드합니다.
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[configPath];
    require(configPath);
  }
});


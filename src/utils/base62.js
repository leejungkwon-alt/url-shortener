'use strict';

/**
 * Base62 인코딩/디코딩 유틸리티.
 *
 * 왜 Base62인가?
 *  - 알파벳 대소문자(52자) + 숫자(10자) = 62진법을 사용하므로 URL에 그대로
 *    써도 안전하고(URL-safe), 64진법(Base64)의 '+', '/', '=' 같은 특수문자가 없습니다.
 *  - 7자리 코드면 62^7 ≈ 3.5조 개의 조합을 표현할 수 있어 충돌 확률이 매우 낮습니다.
 *
 * 이 모듈은 두 가지 방식의 코드 생성을 모두 지원합니다.
 *  1) encode(number)          : 숫자 ID(auto-increment)를 Base62 문자열로 변환 (결정적, 충돌 없음)
 *  2) randomCode(length)      : 무작위 Base62 문자열 생성 (메모리 저장소처럼 ID 개념이 없을 때 사용)
 */

// 62진법 문자 집합. 순서가 곧 "값"을 의미하므로 임의로 바꾸면 기존 코드와 호환되지 않습니다.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length; // 62

// 문자 → 값(0~61) 역방향 조회 테이블. 디코딩 성능을 위해 미리 만들어 둡니다.
const CHAR_TO_VALUE = new Map(
  Array.from(ALPHABET).map((char, index) => [char, index]),
);

/**
 * 0 이상의 안전한 정수를 Base62 문자열로 인코딩합니다.
 * 예) 0 -> '0', 61 -> 'z', 62 -> '10', 3844 -> '100'
 *
 * @param {number} value 인코딩할 정수 (0 이상)
 * @returns {string} Base62 문자열
 */
function encode(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('encode()는 0 이상의 안전한 정수만 처리할 수 있습니다.');
  }
  if (value === 0) return ALPHABET[0];

  let remainder = value;
  let result = '';
  while (remainder > 0) {
    // 나머지를 알파벳 인덱스로 매핑하고, 앞쪽에 쌓아 최종 문자열을 만듭니다.
    result = ALPHABET[remainder % BASE] + result;
    remainder = Math.floor(remainder / BASE);
  }
  return result;
}

/**
 * Base62 문자열을 정수로 디코딩합니다. (encode의 역함수)
 * 예) '10' -> 62, '100' -> 3844
 *
 * @param {string} code Base62 문자열
 * @returns {number} 디코딩된 정수
 */
function decode(code) {
  if (typeof code !== 'string' || code.length === 0) {
    throw new TypeError('decode()는 비어 있지 않은 문자열만 처리할 수 있습니다.');
  }

  let result = 0;
  for (const char of code) {
    const digit = CHAR_TO_VALUE.get(char);
    if (digit === undefined) {
      // 알파벳에 없는 문자(예: '-', '_', 한글 등)가 들어오면 잘못된 코드로 간주합니다.
      throw new Error(`Base62 알파벳에 없는 문자입니다: '${char}'`);
    }
    result = result * BASE + digit;
  }

  if (!Number.isSafeInteger(result)) {
    // 코드가 너무 길어 안전한 정수 범위를 넘어서는 경우
    throw new RangeError('디코딩 결과가 안전한 정수 범위를 초과했습니다.');
  }
  return result;
}

/**
 * 지정한 길이의 무작위 Base62 코드를 생성합니다.
 *
 * 암호학적으로 강한 난수를 사용하지 않는 이유:
 *  - 단축 코드는 비밀이 아니며, 충돌 시 재시도 로직으로 안전성을 확보합니다.
 *  - crypto.randomInt를 사용하면 예측 불가능성이 높아집니다(여기서는 crypto 사용).
 *
 * @param {number} [length=7] 코드 길이
 * @returns {string} 무작위 Base62 코드
 */
function randomCode(length = 7) {
  const size = Math.max(1, Number(length) || 7);
  // crypto.randomInt(0, 62) 는 0~61 범위 정수를 균등 분포로 반환합니다.
  const { randomInt } = require('node:crypto');

  let code = '';
  for (let i = 0; i < size; i += 1) {
    code += ALPHABET[randomInt(0, BASE)];
  }
  return code;
}

/**
 * 주어진 문자열이 Base62 코드 형식(알파벳 내 문자로만 구성)인지 검사합니다.
 * 라우터에서 불필요한 저장소 조회(예: 'favicon.ico' 같은 요청)를 거르는 데 사용합니다.
 *
 * @param {string} code 검사할 코드
 * @returns {boolean}
 */
function isBase62(code) {
  return typeof code === 'string' && code.length > 0 && /^[0-9A-Za-z]+$/.test(code);
}

module.exports = {
  ALPHABET,
  BASE,
  encode,
  decode,
  randomCode,
  isBase62,
};

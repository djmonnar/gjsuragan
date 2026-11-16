'use strict';

const crypto = require('crypto');

// 포포하우스(같은 사장님의 다른 가게 앱, Vercel)가 로젠을 부를 때 쓰는 중계 창구.
// 로젠은 화이트리스트에 등록된 고정 IP에서 온 요청만 받는다. Vercel 은 나가는 IP가
// 고정이 아니라서, 이 함수가 궁중수라간과 같은 고정 IP(34.50.34.252)로 대신 불러 준다.
//
// 지키는 것
// - 토큰(LOGEN_RELAY_TOKEN)이 맞는 요청만 받는다.
// - 로젠 주소 4개만, 로젠 test/prod 기본 주소로만 보낸다. 다른 곳으로는 못 보낸다.
// - 로젠 키(secretKey)는 요청 헤더로 받아 그대로 전달만 한다. 저장하거나 기록하지 않는다.
//   (이 저장소는 공개라 로그·코드에 키가 남으면 안 된다.)
// - 받는 분 이름·주소·전화는 기록하지 않는다.
// - 궁중수라간 고객 데이터(Firestore)와 궁중수라간 로젠 키는 쓰지 않는다.

const LOGEN_BASES = Object.freeze({
  test: 'https://topenapi.ilogen.com/lrm02b-edi/edi',
  prod: 'https://openapi.ilogen.com/lrm02b-edi/edi'
});

const ALLOWED_PATHS = new Set([
  '/registerOrderData',
  '/inquirySlipNoMulti',
  '/inquiryCargoTrackingMulti',
  '/contPickFares'
]);

const MAX_BODY_BYTES = 200 * 1024;
const LOGEN_TIMEOUT_MS = 20000;

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createLogenRelayHandler({ token, fetchImpl = (...args) => fetch(...args), logger = console }) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }
    const expected = String((typeof token === 'function' ? token() : token) || '').trim();
    if (!expected || !sameSecret(req.get('x-logen-relay-token'), expected)) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }
    const secretKey = String(req.get('x-logen-secret-key') || '').trim();
    const { env, path, body } = req.body || {};
    if (!secretKey) {
      res.status(400).json({ ok: false, error: 'x-logen-secret-key header is required' });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(LOGEN_BASES, env) || !ALLOWED_PATHS.has(path)) {
      res.status(400).json({ ok: false, error: 'env or path is not allowed' });
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ ok: false, error: 'body must be an object' });
      return;
    }
    const raw = JSON.stringify(body);
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      res.status(413).json({ ok: false, error: 'body is too large' });
      return;
    }

    try {
      const response = await fetchImpl(`${LOGEN_BASES[env]}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', secretKey },
        body: raw,
        signal: AbortSignal.timeout(LOGEN_TIMEOUT_MS)
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { error: text.slice(0, 500) };
      }
      // 무엇을 보냈는지 추적할 만큼만 남긴다 (키·받는 분 정보는 남기지 않는다).
      logger.info('Logen relay', {
        caller: 'popohouse',
        env,
        path,
        status: response.status,
        sttsCd: String(data?.sttsCd || ''),
        rows: Array.isArray(body.data) ? body.data.length : 0
      });
      res.status(200).json({ ok: true, status: response.status, data });
    } catch (error) {
      logger.warn('Logen relay failed', { caller: 'popohouse', env, path, message: error?.message || String(error) });
      res.status(502).json({ ok: false, error: 'Logen request failed' });
    }
  };
}

module.exports = {
  createLogenRelayHandler,
  LOGEN_BASES,
  ALLOWED_PATHS,
  MAX_BODY_BYTES
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogenRelayHandler, LOGEN_BASES } = require('../../logenRelay');

function fakeReq({ method = 'POST', headers = {}, body } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, body, get: name => lower[name.toLowerCase()] };
}

function fakeRes() {
  const out = { statusCode: 0, body: null };
  return {
    out,
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; return this; }
  };
}

const quietLogger = { infos: [], warns: [], info(...a) { this.infos.push(a); }, warn(...a) { this.warns.push(a); } };
const goodHeaders = { 'x-logen-relay-token': 'relay-token-123', 'x-logen-secret-key': 'popo-secret' };
const goodBody = { env: 'prod', path: '/inquirySlipNoMulti', body: { userId: '1', data: [{ custCd: '1', fixTakeNo: 'PP1' }] } };

test('맞는 토큰이면 로젠 주소로 키를 붙여 그대로 보낸다', async () => {
  const calls = [];
  const handler = createLogenRelayHandler({
    token: () => 'relay-token-123',
    logger: quietLogger,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 200, text: async () => JSON.stringify({ sttsCd: 'SUCCESS', data: [] }) };
    }
  });
  const res = fakeRes();
  await handler(fakeReq({ headers: goodHeaders, body: goodBody }), res);
  assert.equal(res.out.statusCode, 200);
  assert.deepEqual(res.out.body, { ok: true, status: 200, data: { sttsCd: 'SUCCESS', data: [] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${LOGEN_BASES.prod}/inquirySlipNoMulti`);
  assert.equal(calls[0].init.headers.secretKey, 'popo-secret');
  assert.deepEqual(JSON.parse(calls[0].init.body), goodBody.body);
});

test('토큰이 틀리거나 없으면 403, 로젠은 부르지 않는다', async () => {
  let called = 0;
  const handler = createLogenRelayHandler({ token: 'relay-token-123', logger: quietLogger, fetchImpl: async () => { called++; } });
  for (const token of ['wrong', '', undefined]) {
    const res = fakeRes();
    await handler(fakeReq({ headers: { ...goodHeaders, 'x-logen-relay-token': token }, body: goodBody }), res);
    assert.equal(res.out.statusCode, 403);
  }
  // 서버에 토큰이 비어 있으면 아무도 못 쓴다
  const empty = createLogenRelayHandler({ token: '', logger: quietLogger, fetchImpl: async () => { called++; } });
  const res = fakeRes();
  await empty(fakeReq({ headers: { ...goodHeaders, 'x-logen-relay-token': '' }, body: goodBody }), res);
  assert.equal(res.out.statusCode, 403);
  assert.equal(called, 0);
});

test('정해진 로젠 주소·환경 말고는 보내지 않는다', async () => {
  let called = 0;
  const handler = createLogenRelayHandler({ token: 'relay-token-123', logger: quietLogger, fetchImpl: async () => { called++; } });
  for (const body of [
    { ...goodBody, path: '/deleteEverything' },
    { ...goodBody, path: 'https://evil.example/x' },
    { ...goodBody, env: 'staging' },
    { ...goodBody, env: '__proto__' },
    { ...goodBody, body: [1, 2] },
    { ...goodBody, body: null }
  ]) {
    const res = fakeRes();
    await handler(fakeReq({ headers: goodHeaders, body }), res);
    assert.equal(res.out.statusCode, 400, JSON.stringify(body));
  }
  const noKey = fakeRes();
  await handler(fakeReq({ headers: { 'x-logen-relay-token': 'relay-token-123' }, body: goodBody }), noKey);
  assert.equal(noKey.out.statusCode, 400);
  const get = fakeRes();
  await handler(fakeReq({ method: 'GET', headers: goodHeaders }), get);
  assert.equal(get.out.statusCode, 405);
  assert.equal(called, 0);
});

test('로그에 키와 받는 분 정보를 남기지 않는다', async () => {
  const logger = { infos: [], warns: [], info(...a) { this.infos.push(a); }, warn(...a) { this.warns.push(a); } };
  const handler = createLogenRelayHandler({
    token: 'relay-token-123',
    logger,
    fetchImpl: async () => ({ status: 401, text: async () => 'Unauthorized' })
  });
  const res = fakeRes();
  const body = { env: 'test', path: '/registerOrderData', body: { userId: '1', data: [{ rcvCustNm: '김손님', rcvCustAddr: '진주시 비밀 1', rcvTelNo: '01099998888' }] } };
  await handler(fakeReq({ headers: goodHeaders, body }), res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.status, 401);
  const logged = JSON.stringify(logger.infos) + JSON.stringify(logger.warns);
  for (const secret of ['popo-secret', 'relay-token-123', '김손님', '진주시 비밀', '01099998888']) {
    assert.ok(!logged.includes(secret), `logged ${secret}`);
  }
});

test('로젠에 닿지 못하면 502', async () => {
  const handler = createLogenRelayHandler({
    token: 'relay-token-123',
    logger: quietLogger,
    fetchImpl: async () => { throw new TypeError('fetch failed'); }
  });
  const res = fakeRes();
  await handler(fakeReq({ headers: goodHeaders, body: goodBody }), res);
  assert.equal(res.out.statusCode, 502);
  assert.equal(res.out.body.ok, false);
});

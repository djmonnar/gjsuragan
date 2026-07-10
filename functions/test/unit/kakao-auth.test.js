'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkKakaoAuth,
  isKakaoAuthEnforcementEnabled
} = require('../../kakaoAuth');

function timestamp(ms) {
  return { toMillis: () => ms };
}

function fakeDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  let writes = 0;
  return {
    store,
    get writes() { return writes; },
    collection(name) {
      assert.equal(name, 'kakaoBotSessions');
      return {
        doc(id) {
          return {
            async get() {
              const data = store.get(id);
              return { exists: Boolean(data), data: () => data };
            },
            async set(value) {
              writes += 1;
              store.set(id, { ...(store.get(id) || {}), ...value });
            }
          };
        }
      };
    }
  };
}

function options(overrides = {}) {
  return {
    db: fakeDb(),
    env: { KAKAO_ADMIN_PIN: 'test-pin' },
    userKey: 'test-user',
    utterance: '',
    params: {},
    sessionTtlMs: 6000,
    timestampFromMillis: timestamp,
    serverTimestamp: () => timestamp(1),
    now: () => 1000,
    ...overrides
  };
}

test('auth enforcement is disabled by default', () => {
  assert.equal(isKakaoAuthEnforcementEnabled({}), false);
  assert.equal(isKakaoAuthEnforcementEnabled({ KAKAO_AUTH_ENFORCEMENT: 'false' }), false);
  assert.equal(isKakaoAuthEnforcementEnabled({ KAKAO_AUTH_ENFORCEMENT: 'true' }), true);
});

test('missing or wrong PIN is rejected without creating a session', async () => {
  const db = fakeDb();
  const missing = await checkKakaoAuth(options({ db }));
  assert.deepEqual(missing, { ok: false, reason: 'need_auth' });
  const wrong = await checkKakaoAuth(options({ db, utterance: '인증 wrong-pin' }));
  assert.deepEqual(wrong, { ok: false, reason: 'need_auth' });
  assert.equal(db.writes, 0);
});

test('valid PIN creates a temporary authenticated session', async () => {
  const db = fakeDb();
  const result = await checkKakaoAuth(options({ db, utterance: '인증 test-pin' }));
  assert.deepEqual(result, { ok: true, justAuthed: true });
  assert.equal(db.writes, 1);
  const session = [...db.store.values()][0];
  assert.equal(session.userKey, 'test-user');
  assert.equal(session.expiresAt.toMillis(), 7000);
});

test('active session is accepted and expired session requires PIN again', async () => {
  const sessionId = Buffer.from('test-user').toString('base64url').slice(0, 120);
  const activeDb = fakeDb({ [sessionId]: { expiresAt: timestamp(1001) } });
  assert.deepEqual(await checkKakaoAuth(options({ db: activeDb })), { ok: true, justAuthed: false });

  const expiredDb = fakeDb({ [sessionId]: { expiresAt: timestamp(999) } });
  assert.deepEqual(await checkKakaoAuth(options({ db: expiredDb })), { ok: false, reason: 'need_auth' });
});

test('allowlist blocks unknown users before session access', async () => {
  const db = fakeDb();
  const result = await checkKakaoAuth(options({
    db,
    env: { KAKAO_ADMIN_PIN: 'test-pin', KAKAO_ALLOWED_USERS: 'allowed-user' }
  }));
  assert.deepEqual(result, { ok: false, reason: 'not_allowed', userKey: 'test-user' });
  assert.equal(db.writes, 0);
});

test('missing PIN configuration fails closed when enforcement calls the gate', async () => {
  const result = await checkKakaoAuth(options({ env: {} }));
  assert.deepEqual(result, { ok: false, reason: 'pin_missing' });
});

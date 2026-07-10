'use strict';

function isKakaoAuthEnforcementEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.KAKAO_AUTH_ENFORCEMENT || '').trim());
}

function kakaoAllowedUsersFromEnv(env = process.env) {
  return String(env.KAKAO_ALLOWED_USERS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

async function checkKakaoAuth(options) {
  const {
    db,
    env = process.env,
    userKey = 'anonymous',
    utterance = '',
    params = {},
    sessionTtlMs,
    timestampFromMillis,
    serverTimestamp,
    now = Date.now
  } = options || {};

  const allowed = kakaoAllowedUsersFromEnv(env);
  if (allowed.length && !allowed.includes(userKey)) {
    return { ok: false, reason: 'not_allowed', userKey };
  }

  const expected = String(env.KAKAO_ADMIN_PIN || '').trim();
  if (!expected) return { ok: false, reason: 'pin_missing' };

  const sessionId = Buffer.from(userKey).toString('base64url').slice(0, 120) || 'anonymous';
  const sessionRef = db.collection('kakaoBotSessions').doc(sessionId);
  const session = await sessionRef.get().catch(() => null);
  const expiresAt = session?.exists ? session.data()?.expiresAt?.toMillis?.() : 0;
  if (expiresAt && expiresAt > now()) return { ok: true, justAuthed: false };

  let given = String(params.pin || params.adminPin || '').trim();
  if (!given) {
    const match = String(utterance || '').match(/(?:인증|핀|pin)\s*[:：]?\s*([^\s]+)/i);
    given = match ? String(match[1]).trim() : '';
  }

  if (given && given === expected) {
    await sessionRef.set({
      userKey,
      authedAt: serverTimestamp(),
      expiresAt: timestampFromMillis(now() + sessionTtlMs)
    }, { merge: true });
    return { ok: true, justAuthed: true };
  }

  return { ok: false, reason: 'need_auth' };
}

module.exports = {
  checkKakaoAuth,
  isKakaoAuthEnforcementEnabled,
  kakaoAllowedUsersFromEnv
};

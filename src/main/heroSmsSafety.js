const DEFINITIVE_ORDER_REJECTIONS = new Set([
  'NO_BALANCE',
  'NO_NUMBERS',
  'BAD_KEY',
  'BAD_ACTION',
  'BAD_SERVICE',
  'BAD_COUNTRY',
  'WRONG_SERVICE',
  'ACCOUNT_INACTIVE',
  'BANNED'
]);

function classifyHeroSmsOrderResponse(result) {
  const response = result && typeof result === 'object' ? result : {};
  const raw = String(response.text || '').trim();
  const parts = raw.split(':');
  const code = String(parts[0] || '').trim().toUpperCase();

  if (response.ok === true && code === 'ACCESS_NUMBER') {
    const id = String(parts[1] || '').trim();
    const number = String(parts.slice(2).join(':') || '').trim();
    if (id && number) return { state:'success', code, id, number, text:raw };
    return { state:'uncertain', code:'MALFORMED_ACCESS_NUMBER', text:raw };
  }

  if (response.sent === false) {
    return {
      state:'rejected',
      code:code || String(response.code || 'LOCAL_REJECTION'),
      text:raw,
      error:String(response.error || '')
    };
  }

  if (response.ok === true && DEFINITIVE_ORDER_REJECTIONS.has(code)) {
    return { state:'rejected', code, text:raw };
  }

  return {
    state:'uncertain',
    code:code || String(response.code || 'UNCERTAIN_RESPONSE'),
    text:raw,
    error:String(response.error || '')
  };
}

function normalizeHeroSmsOwnerIdentity(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    profileName:String(input.profileName || input.profile || '').trim()
  };
}

function sameHeroSmsOwnerIdentity(left, right) {
  const a = normalizeHeroSmsOwnerIdentity(left);
  const b = normalizeHeroSmsOwnerIdentity(right);
  return !!a.profileName && a.profileName === b.profileName;
}

function classifyHeroSmsRefundResponse(result) {
  const response = result && typeof result === 'object' ? result : {};
  const text = String(response.text || '').trim();
  if (response.ok === true && (text === 'ACCESS_CANCEL' || text === 'STATUS_CANCEL')) {
    return { state:'canceled', text };
  }
  if (response.sent === false) {
    return {
      state:'rejected',
      text,
      error:String(response.error || '')
    };
  }
  return {
    state:'uncertain',
    text,
    error:String(response.error || '')
  };
}

module.exports = {
  DEFINITIVE_ORDER_REJECTIONS,
  classifyHeroSmsOrderResponse,
  classifyHeroSmsRefundResponse,
  normalizeHeroSmsOwnerIdentity,
  sameHeroSmsOwnerIdentity
};

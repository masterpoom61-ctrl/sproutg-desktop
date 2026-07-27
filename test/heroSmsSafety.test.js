const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyHeroSmsOrderResponse,
  classifyHeroSmsRefundResponse,
  normalizeHeroSmsOwnerIdentity,
  sameHeroSmsOwnerIdentity
} = require('../src/main/heroSmsSafety');

test('HeroSMS valid ACCESS_NUMBER is a definitive success', () => {
  assert.deepEqual(
    classifyHeroSmsOrderResponse({
      ok:true,
      sent:true,
      text:'ACCESS_NUMBER:abc123:+15551234567'
    }),
    {
      state:'success',
      code:'ACCESS_NUMBER',
      id:'abc123',
      number:'+15551234567',
      text:'ACCESS_NUMBER:abc123:+15551234567'
    }
  );
});

test('HeroSMS HTTP failure after sending remains uncertain', () => {
  const result = classifyHeroSmsOrderResponse({
    ok:false,
    sent:true,
    status:500,
    text:'upstream timeout',
    error:'HeroSMS HTTP 500'
  });
  assert.equal(result.state, 'uncertain');
});

test('HeroSMS malformed success and transport loss remain uncertain', () => {
  assert.equal(
    classifyHeroSmsOrderResponse({ ok:true, sent:true, text:'ACCESS_NUMBER:only-id' }).state,
    'uncertain'
  );
  assert.equal(
    classifyHeroSmsOrderResponse({ ok:false, sent:true, error:'socket closed' }).state,
    'uncertain'
  );
});

test('HeroSMS explicit provider rejection and local no-key rejection are definitive', () => {
  assert.equal(
    classifyHeroSmsOrderResponse({ ok:true, sent:true, text:'NO_NUMBERS' }).state,
    'rejected'
  );
  assert.equal(
    classifyHeroSmsOrderResponse({ ok:false, sent:false, error:'missing key' }).state,
    'rejected'
  );
  assert.equal(
    classifyHeroSmsOrderResponse({ ok:true, sent:true, text:'ERROR_SQL' }).state,
    'uncertain'
  );
});

test('HeroSMS owner identity is exact and case-sensitive', () => {
  assert.deepEqual(
    normalizeHeroSmsOwnerIdentity({ profileName:'  Profile P  ' }),
    { profileName:'Profile P' }
  );
  assert.equal(
    sameHeroSmsOwnerIdentity(
      { profileName:'Profile P' },
      { profileName:'Profile P' }
    ),
    true
  );
  assert.equal(
    sameHeroSmsOwnerIdentity(
      { profileName:'Profile P' },
      { profileName:'profile p' }
    ),
    false
  );
  assert.equal(
    sameHeroSmsOwnerIdentity({}, {}),
    false
  );
});

test('HeroSMS refund clears state only on a definitive canceled response', () => {
  assert.deepEqual(
    classifyHeroSmsRefundResponse({ ok:true, sent:true, text:'ACCESS_CANCEL' }),
    { state:'canceled', text:'ACCESS_CANCEL' }
  );
  assert.deepEqual(
    classifyHeroSmsRefundResponse({ ok:true, sent:true, text:'STATUS_CANCEL' }),
    { state:'canceled', text:'STATUS_CANCEL' }
  );
  assert.equal(
    classifyHeroSmsRefundResponse({ ok:false, sent:true, error:'socket closed' }).state,
    'uncertain'
  );
  assert.equal(
    classifyHeroSmsRefundResponse({ ok:true, sent:true, text:'STATUS_WAIT_CODE' }).state,
    'uncertain'
  );
});

'use strict';

// Google Ads dollar amounts are read in the English UI. Empty / suppressed metrics are not zero.
function usd(value) {
  const match = /^(?:USD\s*|\$\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*USD)?$/i.exec(String(value ?? '').trim());
  if (!match) throw Error('Unrecognized USD cost: '+String(value).slice(0,40));
  const [dollars, cents=''] = match[1].replace(/,/g,'').split('.');
  return BigInt(dollars).toString()+'.'+cents.padEnd(2,'0');
}
function paymentWarning(input) {
  return /\b(?:make (?:a|an|the|your|a minimum) (?:pre)?payment|pay with your payment method|outstanding balance|past.due balance|overdue (?:balance|payment)|unpaid balance|pre-?payment (?:is )?required|payment (?:is )?required|pay (?:your|the) (?:balance|amount)|pay at least)\b/i.test(input);
}
function paymentAmount(warnings) {
  if (!warnings.length) throw Error('Payment task present, but the red payment notice has not been read.');
  const amounts=new Set();
  for (const warning of warnings) {
    if (/\b(?:EUR|GBP|BGN|KGS|RUB|CAD|AUD|NZD)\b|[€£₽]/i.test(warning)) throw Error('Unexpected payment currency.');
    for (const m of warning.matchAll(/(?:US\s*\$|\$|USD\s*)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:US\s*\$|\$|\bUSD\b)/gi)) {
      const amount=usd(m[1] || m[2]);
      if (!/^(?:[1-9]0|100)\.00$/.test(amount)) throw Error('PrePay dropdown does not include '+amount+' USD.');
      amounts.add(amount.split('.')[0]+'$');
    }
  }
  if (amounts.size>1) throw Error('Several different amounts in the payment warning.');
  return amounts.size?[...amounts][0]:'20$';
}
function documentStatus(panel) {
  const qr=/\bOrganization\b/i.test(panel) && /\bPersonal details\b/i.test(panel) && /provide information for|legal entity you.ll be verifying/i.test(panel);
  const papers=/registration (?:document|certificate)|organization registration|proof of (?:organization |business )?registration/i.test(panel) &&
    /proof of identity|(?:photo|government.issued|identity) (?:ID|document)|passport|driver.s licen[cs]e/i.test(panel);
  if (qr===papers) throw Error('Unrecognized Submit your documents panel.');
  return qr?'QR':'Взять в работу';
}
function dateISO(value) {
  const s=String(value??'').trim();
  let iso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso=s;
  else {
    const match=/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s);
    const us=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (match) {
      const mm=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].slice(0,3).toLowerCase())+1;
      iso=match[3]+'-'+String(mm).padStart(2,'0')+'-'+match[2].padStart(2,'0');
    } else if (us) iso=us[3]+'-'+us[1].padStart(2,'0')+'-'+us[2].padStart(2,'0');
    else return null;
  }
  const d=new Date(iso+'T12:00:00Z');
  return Number.isNaN(+d) || d.toISOString().slice(0,10)!==iso ? null : iso;
}
function nextWeek(today) {
  if (dateISO(today)!==today) throw Error('Invalid recheck date.');
  const d=new Date(today+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+7);
  return d.toISOString().slice(0,10);
}
module.exports={usd,paymentWarning,paymentAmount,documentStatus,dateISO,nextWeek};

'use strict';

function formatExpense(value) {
  const text = String(value ?? '');
  const match = /^([+-]?)(\d*)(?:[.,](\d*))?\s*([$€]?)$/.exec(text.trim());
  if (!match || (!match[2] && !match[3])) return text;
  const fraction = (match[3] || '').replace(/0+$/, '');
  if (fraction.length > 2) return null;
  const whole = (match[2] || '0').replace(/^0+(?=\d)/, '');
  const sign = match[1] === '-' && (whole !== '0' || fraction) ? '-' : '';
  return sign + whole + '.' + fraction.padEnd(2, '0') + match[4];
}

if (typeof module === 'object' && module.exports) module.exports = { formatExpense };
else window.SproutExpense = { formatExpense };

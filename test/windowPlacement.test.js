'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validRect, displayLayoutKey } = require('../src/main/windowPlacement');

test('window placement accepts exact integer rectangles on secondary screens', () => {
  assert.equal(validRect({ x:-1533, y:-7, width:669, height:873 }), true);
  for (const rect of [
    { x:1.25, y:0, width:669, height:873 },
    { x:0, y:0, width:0, height:873 },
    { x:0, y:0, width:669, height:Infinity }
  ]) assert.equal(validRect(rect), false);
});

test('physical placement is bound to the display layout and DPI', () => {
  const left = { id:3, bounds:{x:-900,y:0,width:900,height:800}, workArea:{x:-900,y:0,width:900,height:760}, scaleFactor:1 };
  const right = { id:2, bounds:{x:0,y:0,width:1536,height:864}, workArea:{x:0,y:0,width:1536,height:816}, scaleFactor:1.25 };
  const saved = displayLayoutKey([left,right]);
  assert.equal(displayLayoutKey([right,left]),saved);
  assert.notEqual(displayLayoutKey([left,{...right,scaleFactor:1.5}]),saved);
  assert.notEqual(displayLayoutKey([right]),saved);
});

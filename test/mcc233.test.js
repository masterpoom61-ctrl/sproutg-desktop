"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return text.slice(from, to);
}

test("release version is aligned across package, renderer, and release history", () => {
  const packageJson = JSON.parse(source("package.json"));
  const renderer = source("src/renderer/app.js");
  const settings = source("src/settings/settings.js");

  assert.ok(renderer.includes(`const APP_VERSION = '${packageJson.version}'`));
  assert.match(settings, new RegExp(`const RELEASE_HISTORY = \\[\\s*\\{\\s*version: '${packageJson.version.replaceAll('.', '\\.')}'`));
});

test("MCC verification identity reads AC while S is reserved for PrePay", () => {
  const renderer = source("src/renderer/app.js");
  const inlineVerification = section(
    renderer,
    "function appendMccAccountVerificationRows",
    "function renderMccProfile"
  );

  assert.match(inlineVerification, /mccWrapFieldLabel\('AC'/);
  assert.doesNotMatch(inlineVerification, /mccWrapFieldLabel\('S'/);
  assert.match(renderer, /grid2\.appendChild\(mccWrapFieldLabel\('AC', mccBuildFioControl_/);
  assert.match(renderer, /MCC_PREPAY_OPTIONS = Array\.from\(\{ length:10 \}/);
  assert.match(renderer, /MCC_PREPAY_OPTIONS\.includes\(rawPrePayValue\) \? rawPrePayValue : ''/);
  assert.match(renderer, /mccBuildSelect\(rowObj, 'S', prePayValue, MCC_PREPAY_OPTIONS/);
});

test("MCC selfie statuses use the requested verification colors", () => {
  const renderer = source("src/renderer/app.js");
  const colors = section(
    renderer,
    "function applyMccVerificationColors",
    "// ---------- Utils ----------"
  );

  assert.match(renderer, /'Селфи','Отказ Селфи'/);
  assert.match(colors, /u === 'На рассмотрении Селфи'[\s\S]*uSelect\.classList\.add\('blueLight'\)/);
  assert.match(colors, /u === 'Отказ Селфи'[\s\S]*uSelect\.classList\.add\('redLight'\)/);
  assert.match(colors, /u === 'Успешно Селфи'[\s\S]*uSelect\.classList\.add\('greenLight'\)/);
});

test("MCC validity uses P, mirrors ban styling, and is settings-controlled", () => {
  const renderer = source("src/renderer/app.js");
  const main = source("src/main.js");
  const settingsHtml = source("src/settings/index.html");
  const settingsJs = source("src/settings/settings.js");

  assert.match(renderer, /if\(desktopSettings\.mccValidityInline !== false\)/);
  assert.match(renderer, /mccBuildSelect\(rowObj, 'P', validityValue, mccProfile\.dropdowns\?\.P/);
  assert.match(renderer, /if\(col === 'O' \|\| col === 'P'\)/);
  assert.match(main, /mccValidityInline: raw\.mccValidityInline !== false/);
  assert.match(settingsHtml, /id="mccValidityOn"/);
  assert.match(settingsHtml, /id="mccValidityOff"/);
  assert.match(settingsJs, /setSetting\(\{ mccValidityInline: false \}\)/);
  assert.match(settingsJs, /setSetting\(\{ mccValidityInline: true \}\)/);
});

test("rollback copy uses a stable two-column layout", () => {
  const html = source("src/settings/index.html");
  const css = source("src/settings/settings.css");
  const js = source("src/settings/settings.js");

  assert.match(html, /id="rollbackInfo">Поиск предыдущей версии…/);
  assert.match(css, /\.rollbackRow\{display:grid;grid-template-columns:minmax\(0,1fr\) 116px/);
  assert.match(js, /Предыдущая версия: v\$\{version\}/);
  assert.match(js, /Назад к v\$\{version\}/);
});

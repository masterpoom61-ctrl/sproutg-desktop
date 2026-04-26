# SproutG Desktop v1.3.6

Electron-обертка для SproutG web app с локальной статистикой, настройками, persistent Google-сессией и GitHub auto-update.

## Главное в v1.3.6

- Добавлены автообновления через GitHub Releases (`electron-updater`).
- В настройках добавлен блок `Обновления`: проверить, скачать, установить.
- Добавлена автопроверка обновлений при запуске установленной Windows-сборки.
- Подготовлен GitHub Actions workflow: `.github/workflows/release.yml`.
- Сохранение кеша и статистики при обновлении: `appId` и `productName` не менялись, NSIS не удаляет `userData`.

## Быстрый старт разработки

```bash
npm install
npm start
```

## Сборка Windows

```bash
npm install
npm run make-ico
npm run dist:win
```

## Публикация релиза с автообновлением

1. Замени `CHANGE_ME_GITHUB_OWNER` в:
   - `electron-builder.yml`
   - `package.json`
   - `sproutg.config.json`
2. Запушь проект в GitHub.
3. Подними версию в `package.json`.
4. Создай tag вида `v1.3.7` и запушь его:

```bash
git tag v1.3.7
git push origin v1.3.7
```

GitHub Actions соберет Windows installer и прикрепит его к GitHub Release.

Подробная инструкция: `docs/GITHUB_AUTO_UPDATE.md`.

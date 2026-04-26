# Базовый промт для Codex: SproutG Desktop

Ты работаешь с проектом SproutG Desktop — Electron wrapper для SproutG web app.

Критически важно:

1. Не менять `appId: com.sproutg.desktop`.
2. Не менять `productName: SproutG` без отдельного решения.
3. Не удалять и не сбрасывать `electron-store` данные:
   - `points`
   - `workDays`
   - `statusState`
   - `settings`
   - `window`
   - `web.url`
4. Не менять Electron session partition `persist:sproutg`, иначе слетит вход Google/сессия.
5. Любые обновления должны ставиться поверх старой версии и сохранять userData.
6. При новой версии обязательно поднять `package.json.version`.
7. Для GitHub auto-update релизы должны содержать installer и `latest.yml`.
8. Перед изменениями проверить, не ломаются:
   - настройки;
   - статистика;
   - points anti-cheat;
   - URL web-приложения;
   - theme sync с web app;
   - clear cache/logout;
   - updater IPC.

Задача Codex:
- Вносить точечные изменения.
- Давать changelog.
- Указывать затронутые файлы.
- Не переписывать весь проект без необходимости.
- Если меняется update flow, проверить `src/main.js`, `src/settings/preload.js`, `src/settings/settings.js`, `electron-builder.yml`, `.github/workflows/release.yml`.

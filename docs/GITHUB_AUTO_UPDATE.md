# SproutG Desktop: GitHub + автообновления

Эта версия подготовлена как база для GitHub/Codex и автообновлений через GitHub Releases.

## Что добавлено в v1.3.6

- `electron-updater` в `dependencies`.
- `publish` в `electron-builder.yml` для GitHub Releases.
- Кнопки в `Настройки → Обновления`:
  - `Проверить`
  - `Скачать`
  - `Установить`
- Автопроверка обновлений при запуске установленной Windows-сборки.
- Состояние обновления передается в UI через IPC.
- `appId`, `productName` и `electron-store` не менялись, чтобы сохранить существующий `userData`.
- NSIS настроен с `deleteAppDataOnUninstall: false`.

## Что сохраняется при обновлении

При установке новой версии поверх старой сохраняются:

- вход Google внутри persistent session `persist:sproutg`;
- сохраненный URL web-приложения;
- настройки темы/масштаба/always-on-top;
- локальная статистика/points;
- `statusState`;
- положение окон.

Важно: не меняй `appId: com.sproutg.desktop` и `productName: SproutG`, если хочешь сохранить тот же профиль приложения.

## Первый перенос в GitHub

В папке проекта выполни:

```bash
git init
git add .
git commit -m "Initial SproutG Desktop v1.3.6 with GitHub auto-updates"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_OWNER/sproutg-desktop.git
git push -u origin main
```

## Что обязательно заменить перед первой сборкой

В `electron-builder.yml`:

```yml
publish:
  provider: github
  owner: CHANGE_ME_GITHUB_OWNER
  repo: sproutg-desktop
  releaseType: release
```

Замени `CHANGE_ME_GITHUB_OWNER` на свой GitHub username или organization.

В `package.json` желательно заменить:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/CHANGE_ME_GITHUB_OWNER/sproutg-desktop.git"
}
```

В `sproutg.config.json` тоже можно заменить `updates.owner`. Это полезно для явного runtime feed:

```json
"updates": {
  "enabled": true,
  "provider": "github",
  "owner": "YOUR_GITHUB_OWNER",
  "repo": "sproutg-desktop",
  "channel": "latest",
  "autoCheckOnStart": true,
  "allowPrerelease": false
}
```

## Как выпускать новую версию

1. Внеси изменения в код.
2. Подними версию в `package.json`, например `1.3.7`.
3. Сделай commit и push.
4. Создай tag строго под версию:

```bash
git tag v1.3.7
git push origin v1.3.7
```

5. GitHub Actions запустит `.github/workflows/release.yml` и создаст Release с файлами:
   - `SproutG-Setup-1.3.7.exe`
   - `latest.yml`
   - блоки для differential update, если electron-builder их создаст.

`latest.yml` критически важен. Без него `electron-updater` не поймет, какая версия последняя.

## Как работает кнопка обновления

В dev-режиме (`npm start`) обновления не устанавливаются. Это нормально.

В установленной Windows-сборке:

1. `Проверить` вызывает `autoUpdater.checkForUpdates()`.
2. Если GitHub Release новее текущей версии, появляется состояние `Есть новая`.
3. `Скачать` скачивает новую сборку.
4. `Установить` вызывает `quitAndInstall(false, true)`.

## Важно про приватный репозиторий

Для автообновления проще и надежнее использовать публичный GitHub repo или отдельный публичный release repo. Приватный repo потребует токен доступа на машине пользователя, а это плохо для безопасности и неудобно.

## Проверка перед релизом

```bash
npm install
npm run dist:win
```

После успешной локальной сборки можно пушить tag и выпускать релиз через GitHub Actions.

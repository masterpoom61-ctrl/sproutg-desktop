# SproutG Desktop v1.3.6

Сборка сделана заново поверх актуальной v1.3.5.

## Добавлено

- GitHub auto-update через `electron-updater`.
- Ручной update flow в настройках:
  - проверить обновления;
  - скачать обновление;
  - установить скачанное обновление.
- Автопроверка обновлений при запуске установленной Windows-сборки.
- IPC-каналы для updater state.
- GitHub Actions workflow для сборки и публикации Windows installer в GitHub Releases.
- Документация по переносу проекта в GitHub и выпуску релизов.
- Базовый Codex prompt для будущих безопасных изменений.

## Сохранение данных

Не изменены:

- `appId: com.sproutg.desktop`;
- `productName: SproutG`;
- session partition `persist:sproutg`;
- структура `electron-store`.

Обновление поверх старой версии должно сохранить кеш, вход Google, URL, настройки, статистику и points.

## Важно перед релизом

Заменить `CHANGE_ME_GITHUB_OWNER` в:

- `electron-builder.yml`;
- `package.json`;
- `sproutg.config.json`.

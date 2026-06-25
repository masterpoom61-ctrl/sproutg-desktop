# League icons for SproutG statistics cards

Файлы:
- `league-none.svg` — Без лиги
- `league-bronze.svg` — Бронза
- `league-silver.svg` — Серебро
- `league-gold.svg` — Золото
- `league-diamond.svg` — Алмаз
- `league-legendary.svg` — Легендарно

Также есть PNG-превью 512×512, CSS-пример и `league-sprite.svg` для inline `<use>`.

Иконки сделаны монохромными через `currentColor`, поэтому они универсальные под любые темы. Цвет должен задаваться не внутри SVG, а снаружи через класс лиги / CSS-переменную темы.

Рекомендация для карточек FullHD:
- badge/container: 44–56px
- сама иконка: 28–36px
- не использовать emoji в карточках лиг
- SVG лучше вставлять inline или как CSS mask, чтобы нормально красить под тему

Пример inline:

```html
<span class="leagueBadge league--gold" title="Золото">
  <svg class="leagueBadgeIcon" viewBox="0 0 96 96" aria-hidden="true">
    <use href="#league-gold"></use>
  </svg>
</span>
```

Пример через mask:

```html
<span class="leagueBadge league--gold" title="Золото">
  <span class="leagueMaskIcon" aria-hidden="true"></span>
</span>
```

Смысл символов:
- none: пустой ранг / отсутствие достижения
- bronze: первый щит / стартовая лига
- silver: улучшенный щит с двумя шевронами
- gold: корона
- diamond: кристалл
- legendary: кубок со звездой и короной

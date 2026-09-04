// Maps the catalog's ~104 raw Vizaje `products.category` values into a
// small set of business-level UI groups. Built by inspecting every distinct
// website-confirmed category and a sample of its product names (see the
// milestone report for the full audit) - not by fuzzy/substring matching,
// since a few raw values (e.g. "Спонжи") mix product types and a blind
// keyword match would misfile them.
//
// "Men" deliberately overlaps Perfume/Hair: a men's fragrance or men's
// shampoo counts toward both its natural group and Men, so switching to
// Perfume still shows every fragrance (men's included) while Men remains a
// convenience cut across categories - not a duplicate-producing filter,
// since a request only ever selects one group at a time.
//
// A handful of raw categories genuinely don't fit any group (general
// deodorant, cosmetic bags, gift certificates) and are left out of every
// list on purpose - those products stay visible under "All" only rather
// than being force-fit.

export type CategoryGroupKey = 'perfume' | 'makeup' | 'skincare' | 'hair' | 'men';

export const CATEGORY_GROUP_LABELS: Record<CategoryGroupKey, string> = {
  perfume: 'Perfume',
  makeup: 'Makeup',
  skincare: 'Skincare',
  hair: 'Hair',
  men: 'Men',
};

export const CATEGORY_GROUPS: Record<CategoryGroupKey, readonly string[]> = {
  perfume: [
    'Парфюмированная вода для женщин',
    'Нишевая парфюмерия',
    'Туалетная вода для женщин',
    'Парфюмированная вода для мужчин',
    'Туалетная вода для мужчин',
    'Наборы Женской парфюмерии',
    'Банная линия женской парфюмерии',
    'Мужские Ароматы',
    'Наборы Мужской парфюмерии',
    'Банная линия мужской парфюмерии',
    'Парфюмерия',
  ],
  makeup: [
    'Помада для губ',
    'Тональные средства',
    'Тени',
    'Блеск для губ',
    'Карандаши для глаз',
    'Карандаши для губ',
    'Румяна',
    'Лаки',
    'Тушь',
    'Корректоры и консилеры',
    'Пудры',
    'Кисти',
    'Карандаши для бровей',
    'Подводки/Лайнеры',
    'Палетки теней',
    'Бронзеры и контуринг',
    'Гель для бровей',
    'Хайлайтеры',
    'Основа для макияжа / Праймер',
    'Наборы для макияжа',
    'База/Праймер под макияж',
    'BB и CC кремы',
    'Макияж',
    'Фиксатор для макияжа',
    'Спонжи',
    'Палетки',
    'Накладные ресницы',
    'Тени для бровей',
    'Кушоны',
    'Точилки',
    'Аппликаторы',
    'Помада для бровей',
    'Мыло для бровей',
    'Глитеры',
    'Кёрлер для ресниц',
    'База для ресниц',
    'Пигменты',
    // Nail top coat / polish remover - consumables that go with "Лаки"
    // (nail polish), not generic manicure tools.
    'Маникюрные принадлежности',
  ],
  skincare: [
    'Увлажнение и Питание для лица',
    'Увлажнение и Питание для тела',
    'Уход за лицом',
    'Антивозсрастные средства для лица',
    'Очищение для лица',
    'Бальзам для губ',
    'Уход за кожей вокруг глаз',
    'Скрабы / Пилинги для тела',
    'Сыворотки',
    'Наборы по уходу за лицом',
    'Маски для лица',
    'Уход за руками',
    'Уход за губами',
    'Уход за ноктями',
    'Очищение для тела',
    'Скрабы/Пилинги для лица',
    'Солнечная защита для лица',
    'Средства для коррекции фигуры',
    'Уход за кожей',
    'Солнечная защита для тела',
    'Масло',
    'Солнечная линия',
    'После загара',
    'Уход за телом',
    'Уход за шеей и зоной декольте',
    'Маникюр',
    'Антивозсрастные средства за телом',
    'Против растяжек',
    'Матирующие салфетки',
    'Автозагар',
    // General/unisex body-cleansing products - body skincare, not a
    // fragrance or grooming category.
    'Гели для душа общие',
    'Мочалки',
    'Средства для ванны',
  ],
  hair: [
    'Окращивание',
    'Шампуни для всех',
    'Специальный уход за волосами',
    'Лак для волос',
    'Маски для волос',
    'Кондиционеры',
    'Шампуни и кондиционеры для мужчин',
    'Гель для волос',
    'Термозащита',
    'Пенка, мусс для волос',
    'Пудра для волос',
    'Сухой шампунь',
    'Скраб для кожи головы',
    // Verified against real product names: overwhelmingly hairbrushes,
    // combs and hair ties (Tangle Teezer, Invisibobble, JANEKE), not a
    // generic accessories bucket.
    'Аксессуары',
  ],
  men: [
    'Парфюмированная вода для мужчин',
    'Туалетная вода для мужчин',
    'Мужские Ароматы',
    'Наборы Мужской парфюмерии',
    'Банная линия мужской парфюмерии',
    'Шампуни и кондиционеры для мужчин',
    'Средства для бритья',
    'Наборы для мужчин',
    'Гели для душа для мужчин',
    'Дезодоранты для мужчин',
    // Source data carries a trailing space on this one raw value - matching
    // is done against TRIM(products.category), so this still matches.
    'Уход за бородой',
  ],
};

export function isCategoryGroupKey(value: string): value is CategoryGroupKey {
  return value in CATEGORY_GROUPS;
}

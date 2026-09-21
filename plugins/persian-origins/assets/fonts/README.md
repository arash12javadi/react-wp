# Fonts

Drop font files here, one folder per language code and (ideally) one folder per family:

```text
assets/fonts/
  fa/
    vazirmatn/
      Vazirmatn-Regular.woff2
      Vazirmatn-Bold.woff2
  en/
    inter/
      Inter-Regular.woff2
      Inter-SemiBold.woff2
      Inter-Italic.woff2
```

Then rebuild (`npm start` rebuilds; `npm run dev` picks them up on reload). Each family appears in
the `[site_settings]` font selector for its language and under Persian Origins → Appearance.

- **Family and slug.** The folder name (`vazirmatn` → "Vazirmatn", slug `vazirmatn`). A file
  placed directly in `fa/` is grouped by its name without the style words (`Sahel-Bold.woff2` →
  "Sahel").
- **Weight.** From the file name: Thin 100, ExtraLight 200, Light 300, Regular/Normal/Book 400,
  Medium 500, SemiBold 600, Bold 700, ExtraBold 800, Black/Heavy 900, or a number such as `700`.
  A variable font (`VariableFont`, `[wght]`, `-VF`) covers 100–900.
- **Style.** `Italic` or `Oblique` in the name.
- **Formats.** `.woff2` (preferred), `.woff`, `.ttf`, `.otf`. Several formats of the same weight
  become one `@font-face` with the best format first.

Every face is declared with `font-display: swap`. Declaring costs nothing: a browser downloads a
file only once text on the page uses that family and weight.

Check the licence before committing a font. Vazirmatn, Inter and the Noto families are under the
SIL Open Font License, which allows bundling them.

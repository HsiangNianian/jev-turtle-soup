# Bundled brand fonts

These are the same font families used by the website in `index.html` and `src/index.css`.
They are bundled so the native Chinese interface never depends on a system serif fallback
or a font download. Both families are distributed under the SIL Open Font License 1.1;
the unmodified font files, embedded copyright notices, and license texts ship together.

- Noto Serif SC Regular and SemiBold: [Noto CJK](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/SubsetOTF/SC), revision `f8d157532fbfaeda587e826d4cd5b21a49186f7c`.
  License: `NotoSerif-OFL.txt`.
- JetBrains Mono Regular: [JetBrains Mono v2.304](https://github.com/JetBrains/JetBrainsMono/tree/v2.304/fonts/ttf).
  License: `JetBrainsMono-OFL.txt`.

The `Fonts` resource folder and `UIAppFonts` entries must stay in sync.
Debug launches assert that all three PostScript names resolve before presenting the UI.

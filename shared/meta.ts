/**
 * 分享卡片的元信息。爬虫不执行 JS，所以客户端 i18n 帮不上忙：
 * 这里在 Worker 里按请求的 Accept-Language 改写 index.html 里的那一段。
 */
export type MetaLocale = "zh-CN" | "en" | "ja";

interface PageMeta {
  htmlLang: string;
  title: string;
  description: string;
  siteName: string;
}

const META: Record<MetaLocale, PageMeta> = {
  "zh-CN": {
    htmlLang: "zh-CN",
    title: "海龟汤调查局 · 情境推理",
    description: "向主持人砚（Ellis）提出是非问题，一步步还原被隐去的真相。",
    siteName: "海龟汤调查局",
  },
  en: {
    htmlLang: "en",
    title: "Turtle Soup Bureau · a guessing game",
    description:
      "One strange line, and only yes-or-no questions. Ask Ellis and piece the hidden truth back together.",
    siteName: "Turtle Soup Bureau",
  },
  ja: {
    htmlLang: "ja",
    title: "海亀スープ調査局 · 状況推理",
    description:
      "奇妙な一文と、はい／いいえの質問だけ。司会 Ellis に訊きながら隠された真相を組み立てるゲーム。",
    siteName: "海亀スープ調査局",
  },
};

/**
 * 按 q 值排序的 Accept-Language 里，第一个认得的语言说了算；认不出回落英文。
 * 注意：爬虫不一定发这个头（Discord 时有时无），那就只能给默认语言。
 */
export function pickMetaLocale(header: string | null): MetaLocale {
  if (!header) return "en";
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((item) => item.trim().startsWith("q="));
      return {
        tag: tag.trim().toLowerCase(),
        q: q ? Number(q.split("=")[1]) || 0 : 1,
      };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    if (tag.startsWith("zh")) return "zh-CN";
    if (tag.startsWith("ja")) return "ja";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface MetaOverride {
  title?: string;
  description?: string;
}

export const META_START = "<!--meta:start-->";
export const META_END = "<!--meta:end-->";

/** 生成要替换进占位块的那段标签（不含 <html>）。 */
export function renderMetaTags(
  locale: MetaLocale,
  url: string,
  override: MetaOverride = {},
): string {
  const base = META[locale];
  const title = override.title
    ? `${override.title} · ${base.siteName}`
    : base.title;
  const description = override.description ?? base.description;
  const image = `${new URL(url).origin}/og.png`;
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(base.siteName)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join("\n    ");
}

export function applyMeta(
  html: string,
  locale: MetaLocale,
  url: string,
  override: MetaOverride = {},
): string {
  const withLang = html.replace(
    /<html[^>]*>/,
    `<html lang="${META[locale].htmlLang}">`,
  );
  const start = withLang.indexOf(META_START);
  const end = withLang.indexOf(META_END);
  if (start === -1 || end === -1) return withLang;
  return (
    withLang.slice(0, start + META_START.length) +
    "\n    " +
    renderMetaTags(locale, url, override) +
    "\n    " +
    withLang.slice(end)
  );
}

import type { DailyLocale, DailyRoll } from './daily.ts'

/** 整条生成链使用同一套语言，包括避重、审核回炉和结构校验反馈。 */
export const DAILY_COPY = {
  'zh-CN': {
    languageRule:
      'title、story、key_twist、tags、truth、surface、hint 必须全部使用自然的简体中文。仅 difficulty 保留指定枚举值；不要因为参考资料或反馈的语言而改变输出语言。',
    writeStory: '请按要求写一则完整故事，以 JSON 输出。',
    avoid: '以下是往期题目，仅用于避重。请更换场景与手法，不要模仿它们的语言：',
    retry: '上一轮未通过审核，请修正以下问题：',
    story: '完整故事',
    twist: '关键反转',
    condense:
      '请凝练出 truth（汤底）、surface（汤面）、hint（提示），全部用简体中文，以 JSON 输出。',
    invalidSchema: 'JSON 结构不合法',
    length: (field: string, actual: number, min: number, max: number, unit: string) =>
      `${field} 长度为 ${actual}，要求 ${min}–${max} ${unit}。`,
    sentence: 'surface 必须只有一句话。',
    mismatch: (field: string) => `${field} 语言不符：必须使用简体中文，请重写该字段。`,
  },
  en: {
    languageRule:
      'Write title, story, key_twist, tags, truth, surface and hint entirely in natural English. Only difficulty keeps its required enum value. Never switch languages to match reference material or feedback.',
    writeStory: 'Write a complete story following the requirements and return JSON.',
    avoid:
      'Previous puzzles below are reference material only. Choose a different setting and method; do not imitate their language:',
    retry: 'The previous draft failed review. Correct these issues:',
    story: 'Complete story',
    twist: 'Key twist',
    condense: 'Distill truth, surface and hint from this story, all in English, and return JSON.',
    invalidSchema: 'Invalid JSON structure',
    length: (field: string, actual: number, min: number, max: number, unit: string) =>
      `${field} length is ${actual}; required: ${min}–${max} ${unit}.`,
    sentence: 'surface must contain only one sentence.',
    mismatch: (field: string) =>
      `${field} has the wrong language: rewrite the entire field in English.`,
  },
  ja: {
    languageRule:
      'title、story、key_twist、tags、truth、surface、hint はすべて自然な日本語で書いてください。difficulty だけは指定の列挙値を保ち、参考資料やフィードバックの言語に合わせて出力言語を変えないでください。',
    writeStory: '条件に従って完全な物語を書き、JSON で出力してください。',
    avoid:
      '以下は重複を避けるための過去の問題です。別の舞台と仕掛けを選び、資料の言語をまねしないでください：',
    retry: '前回の案は審査に通りませんでした。以下の問題を修正してください：',
    story: '物語の全文',
    twist: '重要な反転',
    condense:
      'この物語から truth（真相）、surface（湯面）、hint（ヒント）を凝縮し、すべて日本語の JSON で出力してください。',
    invalidSchema: 'JSON の構造が不正です',
    length: (field: string, actual: number, min: number, max: number, unit: string) =>
      `${field} の長さは ${actual} です。${min}–${max} ${unit}にしてください。`,
    sentence: 'surface は一文だけにしてください。',
    mismatch: (field: string) =>
      `${field} の言語が違います。フィールド全体を自然な日本語で書き直してください。`,
  },
}

// Roll/storage keep stable Chinese motif names; prompts use native-language names.
const MOTIFS: Record<string, [string, string]> = {
  都市: ['city life', '都会'],
  悬疑: ['mystery', '謎'],
  推理: ['deduction', '推理'],
  密室: ['a locked room', '密室'],
  误会: ['a misunderstanding', '誤解'],
  身份: ['identity', '正体'],
  时间线: ['a timeline', '時系列'],
  心理: ['psychology', '心理'],
  记忆: ['memory', '記憶'],
  反转: ['a reversal', '逆転'],
  雨夜: ['a rainy night', '雨の夜'],
  老房子: ['an old house', '古い家'],
  医院: ['a hospital', '病院'],
  电梯: ['an elevator', 'エレベーター'],
  婚礼: ['a wedding', '結婚式'],
  葬礼: ['a funeral', '葬儀'],
  书信: ['letters', '手紙'],
  照片: ['photographs', '写真'],
  镜子: ['a mirror', '鏡'],
  民俗: ['folklore', '民間伝承'],
  禁忌: ['a taboo', '禁忌'],
  诅咒: ['a curse', '呪い'],
  诡物: ['an uncanny object', '奇妙な品物'],
  怪力乱神: ['supernatural forces', '超自然の力'],
  替身: ['a double', '身代わり'],
  幻觉: ['a hallucination', '幻覚'],
  灵异: ['a haunting', '心霊現象'],
}

const GENRES = {
  en: [
    'Strict logical mystery: a realistic world, with an answer fully deducible from clues. No supernatural elements.',
    'Mostly realistic: coincidences, obscure facts or timeline shifts may explain the mystery. No supernatural elements.',
    'A realistic framework focused on psychology, mistaken identity or hallucination. Any hallucination must have a real-world cause.',
    'Uncanny settings such as folklore, curses, doubles or strange objects are allowed, but their rules must be consistent and inferable from clues.',
    'Explicit ghosts, spirits or supernatural forces are allowed. Their rules must be consistent and established in the story. Never resolve it as just a dream or hallucination; no gore or jump scares.',
  ],
  ja: [
    '本格推理。現実世界を舞台とし、手がかりだけで真相を推理できること。超自然的な要素は禁止。',
    '本格寄り。偶然、専門知識、時系列のずれを使ってよいが、超自然的な要素は禁止。',
    '現実的な枠組みの中で、心理、人物の取り違え、幻覚を中心にする。幻覚には現実の原因が必要。',
    '変格寄り。民間伝承、呪い、身代わり、奇妙な品物を使ってよいが、規則は一貫させ、手がかりから推理できること。',
    '変格。幽霊や超自然の力を使ってよいが、規則は一貫させ、物語の中で示すこと。夢や幻覚だったという結末、残虐描写、ジャンプスケアは禁止。',
  ],
}

export function localizedGenreBrief(roll: DailyRoll): string | null {
  if (roll.locale === 'zh-CN') return null
  const band = [15, 40, 60, 85].findIndex((limit) => roll.genreTarget <= limit)
  const genre = GENRES[roll.locale][band < 0 ? 4 : band]
  const tag = MOTIFS[roll.tag]?.[roll.locale === 'en' ? 0 : 1] ?? roll.tag
  return roll.locale === 'en'
    ? `${genre} Build the story around ${tag}.`
    : `${genre}「${tag}」を題材にしてください。`
}

/**
 * 轻量的文字脚本检查，拦截整段串语言，不冒充完整的语言识别。
 * 比例允许少量外文人名/引文；日文正文必须有足够假名，标题和标签可全为汉字。
 * difficulty 不属于自然语言正文，不交给这里检查。
 */
export function dailyLanguageIssues(locale: DailyLocale, fields: Record<string, string>): string[] {
  return Object.entries(fields).flatMap(([field, text]) => {
    const letters = (text.match(/\p{L}/gu) ?? []).length
    const han = (text.match(/\p{Script=Han}/gu) ?? []).length
    const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length
    const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length
    const label = field === 'title' || field.startsWith('tags[')
    const matches =
      letters > 0 &&
      (locale === 'en'
        ? latin / letters >= 0.9
        : locale === 'ja'
          ? (han + kana) / letters >= 0.7 && (label || kana / letters >= 0.1)
          : han / letters >= 0.7 && kana / letters <= 0.05)
    return matches ? [] : [DAILY_COPY[locale].mismatch(field)]
  })
}

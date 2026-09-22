import { useState } from 'react'
import { ArrowRight, Check, Copy } from 'lucide-react'

import { Button, PageShell } from '@/components/Bits'
import { Link } from '@/components/Link'
import { navigate } from '@/lib/router'
import { useI18n, type Locale } from '@/lib/i18n'

/**
 * 《怎么写一碗好汤》——从「玩」到「写」那一脚。
 *
 * 内容刻意写成「可照着做」：一条原则、三条标准、四个常见毛病、一组好/坏对照、
 * 一个能直接抄的模板。不追求把海龟汤讲全，只求看完敢动手写第一碗。
 */

const RULES = [
  {
    title: '一句话能说清',
    body: '真相要能用一句话概括。如果一句话说不清，多半是谜题还没想利落——玩家也很难问到点上。',
  },
  {
    title: '每个细节都有交代',
    body: '汤面里写下的每样东西，汤底都必须解释。为了吓人而加的红伞、半夜的猫叫，汤底没提就是耍赖。',
  },
  {
    title: '反转之后，回头看是合理的',
    body: '好的反转是「原来如此」，不是「凭什么」。揭晓之后玩家回头看汤面，应该觉得线索一直都在。',
  },
]

const MISTAKES = [
  { title: '汤面剧透', body: '汤面直接写出了原因或真相，等于把谜底摆在桌上。' },
  { title: '细节没交代', body: '汤面提到的东西，汤底一字未提——玩家会一直追问那个无关的细节。' },
  { title: '靠灵异兜底', body: '真相是「鬼做的」。除非规则提前给了，否则玩家永远问不出来。' },
  { title: '没有唯一解', body: '汤底的解释只是许多种可能里的一种，玩家凭现有信息无法排除其它。' },
]

const GOOD = {
  surface: '男人走进餐馆，要了一碗海龟汤，喝了一口，回家自杀了。',
  truth:
    '他多年前海难漂流，同伴说给他喝的是海龟汤，他才活下来。今天他尝到真正的海龟汤，发现味道完全不同——他意识到当年喝的是同伴的肉，同伴为了救他而死。',
  why: '汤面只给反常（为什么喝一口汤就自杀），汤底一句话能说清，又解释了「喝汤」和「自杀」的关系。',
}

const BAD = {
  surface: '男人在雨夜杀了出轨的妻子，因为看到一把红伞。',
  truth: '他杀了妻子，因为发现她出轨。',
  why: '汤面直接写了动机（剧透）；「红伞」在汤底里没有任何解释，是个为吓人而加的细节。',
}

/**
 * 模板按语言各存一份，而不是塞进 i18n 字典：它是一整块多行文本，
 * 放进字典会变成一条又长又难读的 key，放这里和对照例子挨着反而清楚。
 */
const TEMPLATES: Record<Locale, string> = {
  'zh-CN': [
    '标题：（一句话，最多 40 字）',
    '',
    '汤面：（只写现象，不解释原因。1–3 句，最多 200 字）',
    '',
    '汤底：（谁、做了什么、为什么。逐条解释汤面里提到的每个细节。最多 2000 字）',
    '',
    '提示：（可选。主持人被求提示时说的那一句，最多 200 字）',
    '',
    '标签：（空格或逗号分隔，最多 5 个）',
  ].join('\n'),
  en: [
    'Title: (one line, up to 40 characters)',
    '',
    'Surface: (the oddity only, no explanation. 1–3 sentences, up to 200 characters)',
    '',
    'Truth: (who, did what, and why. Account for every detail in the surface. Up to 2000 characters)',
    '',
    'Hint: (optional. The line the host gives when asked for a hint, up to 200 characters)',
    '',
    'Tags: (space or comma separated, up to 5)',
  ].join('\n'),
  ja: [
    'タイトル：（一言で、40 字まで）',
    '',
    '湯面：（現象だけを書く。理由は書かない。1〜3 文、200 字まで）',
    '',
    '湯底：（誰が・何をした・なぜ。湯面に書いた細部を一つずつ説明する。2000 字まで）',
    '',
    'ヒント：（任意。司会がヒントを求められたときに言う一言、200 字まで）',
    '',
    'タグ：（スペースまたはカンマ区切り、最大 5 個）',
  ].join('\n'),
}

function Example({ tone, surface, truth, why }: { tone: 'good' | 'bad'; surface: string; truth: string; why: string }) {
  const { t } = useI18n()
  const good = tone === 'good'
  return (
    <div
      className={
        good
          ? 'border-l-2 border-l-[var(--v-yes)] bg-card px-4 py-4'
          : 'border-l-2 border-l-stamp bg-card px-4 py-4'
      }
    >
      <div
        className={
          good
            ? 'font-mono text-[10px] tracking-[0.2em] text-[var(--v-yes)]'
            : 'font-mono text-[10px] tracking-[0.2em] text-stamp'
        }
      >
        {t(good ? '好的例子' : '不好的例子')}
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            {t('汤面')}
          </div>
          <p className="mt-1 font-serif text-[14px] leading-7 text-foreground/85">{surface}</p>
        </div>
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            {t('汤底')}
          </div>
          <p className="mt-1 font-serif text-[14px] leading-7 text-foreground/85">{truth}</p>
        </div>
        <p className="border-t border-dashed border-foreground/20 pt-3 font-serif text-[13px] leading-7 text-muted-foreground">
          {why}
        </p>
      </div>
    </div>
  )
}

export function GuidePage() {
  const { t, locale } = useI18n()
  const [copied, setCopied] = useState(false)
  const template = TEMPLATES[locale]

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(template)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 剪贴板不可用就忽略，模板本身在页面上能选中复制 */
    }
  }

  return (
    <PageShell
      label={t('出题')}
      title={t('怎么写一碗好汤')}
      meta={
        <Link
          to="/upload"
          className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('直接去写 →')}
        </Link>
      }
    >
      <p className="mt-6 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
        {t(
          '一句话：汤面写「反常」，汤底写「为什么」，而且汤底要能解释汤面里的每一个反常。剩下的都是这句话的展开。',
        )}
      </p>

      <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
        {t('三条标准')}
      </div>
      <ol className="mt-3 border-t border-foreground/20">
        {RULES.map((rule, index) => (
          <li key={rule.title} className="rule-dashed flex items-start gap-4 py-3.5">
            <span className="w-6 shrink-0 pt-0.5 font-mono text-[11px] text-stamp">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span>
              <span className="block font-serif text-[15px]">{t(rule.title)}</span>
              <span className="mt-1 block font-serif text-[13px] leading-7 text-foreground/75">
                {t(rule.body)}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
        {t('常见毛病')}
      </div>
      <ul className="mt-3 border-t border-foreground/20">
        {MISTAKES.map((item) => (
          <li key={item.title} className="rule-dashed flex items-start gap-4 py-3.5">
            <span className="w-24 shrink-0 pt-0.5 font-mono text-[11px] leading-5 break-words text-muted-foreground">
              {t(item.title)}
            </span>
            <span className="font-serif text-[14px] leading-7 text-foreground/80">
              {t(item.body)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
        {t('一组对照')}
      </div>
      <div className="mt-3 space-y-4">
        <Example tone="bad" surface={t(BAD.surface)} truth={t(BAD.truth)} why={t(BAD.why)} />
        <Example tone="good" surface={t(GOOD.surface)} truth={t(GOOD.truth)} why={t(GOOD.why)} />
      </div>

      <div className="mt-9 flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
          {t('起手模板')}
        </div>
        <Button size="sm" variant="outline" onClick={() => void copyTemplate()}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t('已复制') : t('复制模板')}
        </Button>
      </div>
      <pre className="mt-3 overflow-auto border border-foreground/20 bg-card p-4 font-serif text-[13px] leading-7 whitespace-pre-wrap text-foreground/85">
        {template}
      </pre>

      <p className="mt-6 max-w-xl font-serif text-[13px] leading-7 text-muted-foreground">
        {t('没有灵感？把生活里一件「说不通的小事」放大成汤面：为什么他每天绕远路，为什么她把礼物退了回去。')}
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button
          onClick={() => navigate('/upload')}
          className="flex items-center gap-2"
        >
          {t('去写一碗')} <ArrowRight className="size-3.5" />
        </Button>
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
          {t('写完记得选「公开到题库」，别人才玩得到。')}
        </span>
      </div>
    </PageShell>
  )
}

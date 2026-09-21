const DEVICE_KEY = 'turtle-soup.device.v1'

export interface LuckTier {
  key: string
  min: number
  tone: string
}

const TIERS: LuckTier[] = [
  {
    key: 'great',
    min: 90,
    tone: 'var(--v-yes)',
  },
  {
    key: 'good',
    min: 70,
    tone: 'var(--v-yes)',
  },
  {
    key: 'plain',
    min: 45,
    tone: 'var(--v-irrelevant)',
  },
  {
    key: 'minor',
    min: 25,
    tone: 'var(--v-partly)',
  },
  {
    key: 'bad',
    min: 0,
    tone: 'var(--stamp)',
  },
]

/**
 * 宜 / 忌 在这边只是「第几个槽位」。用词由服务端按**回复语言**取
 * （shared/game.ts 的 LUCK_WORDS），所以前端不需要、也不该保存这些词——
 * 否则中文词会漏进英文或日文的回答里。这里的槽位数量要和那两张表对齐。
 */
const GOOD_SLOTS = 8
const BAD_SLOTS = 8

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing) return existing
    const created = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, created)
    return created
  } catch {
    return 'anonymous-device'
  }
}

export function todayKey(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic PRNG seeded by a single integer (xorshift-ish mixer). */
function seeded(seed: number): () => number {
  let state = seed || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DailyLuck {
  date: string
  score: number
  tier: LuckTier
  goodIndex: number
  badIndex: number
  salt: string
  device: string
}

/**
 * 今日人品：盐值（站点域名）+ 日期 + 设备识别码三者哈希，得到当天唯一且稳定的结果。
 */
export function dailyLuck(date: string, salt: string, device: string): DailyLuck {
  const random = seeded(fnv1a(`${salt}|${date}|${device}`))
  const score = Math.floor(random() * 101)
  const tier = TIERS.find((item) => score >= item.min) ?? TIERS[TIERS.length - 1]
  const goodIndex = Math.floor(random() * GOOD_SLOTS)
  let badIndex = Math.floor(random() * BAD_SLOTS)
  if (badIndex === goodIndex) badIndex = (badIndex + 1) % BAD_SLOTS

  return { date, score, tier, goodIndex, badIndex, salt, device }
}

import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import Storage from 'expo-sqlite/kv-store'
import { getLocales } from 'expo-localization'
import { ArchiveStore, type Owner } from '@turtle-soup/client-core/archive-store'
import { SaveSync } from '@turtle-soup/client-core/save-sync'
import { createClient, SaveRequestError } from '@turtle-soup/client-core/transport'
import { upsertGame, toSession, type ArchivedGame } from '@turtle-soup/client-core/archive'
import {
  beginTurn,
  failTurn,
  finishTurn,
  newGame,
  isDailyLocked,
  revealTurn,
  touchGame,
  turnInput,
} from '@turtle-soup/client-core/game'
import { translate } from '@turtle-soup/client-core/i18n'
import { dailyLuck, todayKey } from '@turtle-soup/client-core/luck'
import type {
  AuthUser,
  DailyDetail,
  LibraryPuzzle,
  Locale,
  TokenSession,
} from '@turtle-soup/client-core/public-types'

const SESSION = 'turtle-soup.native.session'
const UUID = () => Crypto.randomUUID()
const cached = <T>(key: string, fallback: T): T => {
  try {
    const value = Storage.getItemSync(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}
const preferred = (): Locale => {
  const code = getLocales()[0]?.languageCode
  return code === 'ja' ? 'ja' : code === 'en' ? 'en' : 'zh-CN'
}
export const apiOrigin = process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:8787'
export const buildNumber = process.env.EXPO_PUBLIC_BUILD_NUMBER || '1'
export const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV || 'development'

export class NativeRuntime {
  store = new ArchiveStore(
    {
      getItem: (key) => Storage.getItemSync(key),
      setItem: (key, value) => Storage.setItemSync(key, value),
    },
    UUID,
  )
  private token: string | null = null
  api = createClient({ baseUrl: apiOrigin, getToken: () => this.token })
  sync = new SaveSync(this.store, this.api)
  user: AuthUser | null = null
  confirmed = false
  ready = false
  authError: string | null = null
  locale: Locale = cached('native.locale', preferred())
  theme: 'system' | 'light' | 'dark' = cached('native.theme', 'system')
  private deviceId = cached<string | null>('native.device', null) ?? UUID()
  private listeners = new Set<() => void>()
  private revision = 0
  private generation = 0
  private verification: AbortController | null = null
  private requests = new Map<string, AbortController>()
  private hydratedOwners = new Set<Owner>()
  private started = false
  private credentialWrite: Promise<void> = Promise.resolve()
  private writeCredentials(action: () => Promise<void>) {
    const next = this.credentialWrite.catch(() => undefined).then(action)
    this.credentialWrite = next
    return next
  }
  get owner() {
    return this.user?.uid ?? null
  }
  get games() {
    return this.store.space(this.owner).games
  }
  getSnapshot = () => this.revision
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private emit = () => {
    this.revision++
    for (const fn of this.listeners) fn()
  }
  t = (key: string, params?: Record<string, string | number>) => translate(this.locale, key, params)

  constructor() {
    this.store.subscribe(this.emit)
    this.sync.subscribe(this.emit)
    try {
      Storage.setItemSync('native.device', JSON.stringify(this.deviceId))
    } catch {
      this.authError = '设备信息尚未保存'
    }
  }
  async start() {
    if (this.started) return
    this.started = true
    try {
      const raw = await SecureStore.getItemAsync(SESSION)
      if (raw) {
        const session = JSON.parse(raw) as TokenSession
        if (typeof session.token === 'string' && typeof session.user?.uid === 'string') {
          this.token = session.token
          this.user = session.user
        }
      }
    } catch {
      this.authError = '无法读取登录信息，请重新登录'
    }
    this.restoreInterrupted()
    this.ready = true
    this.sync.setUser(this.owner, false)
    this.emit()
    if (this.token) await this.verify()
  }
  private restoreInterrupted() {
    if (this.hydratedOwners.has(this.owner)) return
    this.hydratedOwners.add(this.owner)
    const games = this.games.map((game) =>
      game.pendingAsk?.state === 'sending' ? failTurn(game, game.pendingAsk.id) : game,
    )
    if (games.some((game, index) => game !== this.games[index])) this.store.save(this.owner, games)
  }
  async verify() {
    if (!this.token) return
    this.verification?.abort()
    const controller = new AbortController()
    this.verification = controller
    const generation = this.generation
    try {
      const user = await this.api.me(controller.signal)
      if (generation !== this.generation || controller.signal.aborted) return
      // A credential cannot silently change the owner of locally cached progress.
      if (this.user && user.uid !== this.user.uid)
        throw new SaveRequestError(401, '登录身份已变化，请重新登录')
      this.user = user
      this.confirmed = true
      this.authError = null
      this.restoreInterrupted()
      this.sync.setUser(user.uid, true)
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return
      this.confirmed = false
      this.authError =
        error instanceof SaveRequestError && error.status === 401
          ? '登录已过期，请重新登录；本机进度已保留'
          : '网络暂不可用，进度保留在本机'
      this.sync.setUser(this.owner, false)
    }
    this.emit()
  }
  async login(email: string, code: string) {
    const generation = this.generation
    const result = await this.api.verifyCode(email, code, this.locale)
    if (generation !== this.generation) return
    if (!result.token || !result.user?.uid)
      throw new Error(this.t('服务器尚未支持 App 登录，请更新服务端'))
    // Persist credentials before enabling an account's queue.
    await this.writeCredentials(async () => {
      if (generation === this.generation)
        await SecureStore.setItemAsync(SESSION, JSON.stringify(result))
    })
    if (generation !== this.generation) return
    this.stopRequests()
    this.generation++
    this.verification?.abort()
    this.sync.stop()
    this.token = result.token
    this.user = result.user
    this.confirmed = true
    this.authError = null
    this.restoreInterrupted()
    this.sync.setUser(this.owner, true)
    this.emit()
  }
  async logout() {
    const token = this.token
    this.stopRequests()
    this.generation++
    this.verification?.abort()
    this.sync.stop()
    // If secure deletion fails, retain a visible paused identity rather than pretending logout succeeded.
    this.confirmed = false
    try {
      await this.writeCredentials(() => SecureStore.deleteItemAsync(SESSION))
    } catch {
      this.authError = '无法清除登录信息，请重试'
      this.emit()
      return
    }
    this.token = null
    this.user = null
    this.authError = null
    this.restoreInterrupted()
    this.sync.setUser(null, false)
    this.emit()
    if (token)
      await createClient({ baseUrl: apiOrigin, getToken: () => token })
        .logout()
        .catch(() => undefined)
  }
  resume = () => {
    this.emit() // Re-evaluate UTC day and appearance after the app resumes.
    if (this.token && (!this.confirmed || this.sync.getSnapshot().status === 'auth'))
      void this.verify()
    else this.sync.retry()
  }
  setLocale(locale: Locale) {
    Storage.setItemSync('native.locale', JSON.stringify(locale))
    this.locale = locale
    this.emit()
  }
  setTheme(theme: 'system' | 'light' | 'dark') {
    Storage.setItemSync('native.theme', JSON.stringify(theme))
    this.theme = theme
    this.emit()
  }
  game(id: string) {
    return this.games.find((game) => game.id === id)
  }
  private save(game: ArchivedGame) {
    return this.store.save(this.owner, upsertGame(this.games, game))
  }
  setDraft(id: string, draft: string) {
    const game = this.game(id)
    if (game && game.draft !== draft) this.save(touchGame(game, { draft }))
  }
  startGame(input: DailyDetail | LibraryPuzzle) {
    if ('puzzleId' in input) {
      const existing = this.game(input.puzzleId)
      if (existing) return existing.id
    }
    const game = newGame(
      input,
      this.t('汤面已经端上来了。开始提问吧，我只回答「是」「不是」「无关」。'),
      UUID,
    )
    this.save(game)
    return game.id
  }
  private stopRequests() {
    for (const id of [...this.requests.keys()]) this.interrupt(id)
  }
  interrupt(id: string) {
    this.requests.get(id)?.abort()
    this.requests.delete(id)
    const game = this.game(id)
    if (game?.pendingAsk?.state === 'sending') this.save(failTurn(game, game.pendingAsk.id))
  }
  async repairLibraryId(id: string) {
    const game = this.game(id)
    const generation = this.generation
    if (!game || game.source !== 'library' || game.libraryId) return
    const matches = (await this.api.puzzles({ q: game.title })).filter(
      (p) => p.title === game.title,
    )
    const latest = this.game(id)
    if (generation === this.generation && latest && matches.length === 1)
      this.save(touchGame(latest, { libraryId: matches[0].id }))
  }
  async send(id: string, text: string, retry = false) {
    let game = this.game(id)
    if (!game || this.requests.has(id)) return
    if (game.source === 'library' && !game.libraryId) {
      await this.repairLibraryId(id)
      game = this.game(id)
      if (!game?.libraryId) throw new Error(this.t('无法找到原题，请从题库重新打开'))
    }
    const generation = this.generation
    const sending = beginTurn(game, text, UUID, retry)
    const controller = new AbortController()
    this.requests.set(id, controller)
    if (!this.save(sending)) {
      this.requests.delete(id)
      this.save(failTurn(sending, sending.pendingAsk!.id))
      return
    }
    const requestId = sending.pendingAsk!.id
    try {
      const input = turnInput(sending)
      const luck = dailyLuck(todayKey(), new URL(apiOrigin).host, this.deviceId)
      const turn = await this.api.ask(
        toSession(sending),
        input.message,
        input.history,
        {
          locale: this.locale,
          playerKey: this.deviceId,
          seq: sending.turnCount,
          luck: {
            date: luck.date,
            score: luck.score,
            tierKey: luck.tier.key,
            goodIndex: luck.goodIndex,
            badIndex: luck.badIndex,
          },
        },
        controller.signal,
      )
      const current = this.game(id)
      if (generation !== this.generation || controller.signal.aborted || !current) return
      this.save(finishTurn(current, requestId, turn, UUID))
      if ((turn.solved || turn.revealed) && !turn.truth) {
        const truth = await this.api.reveal(toSession(sending), this.locale, controller.signal)
        const latest = this.game(id)
        if (generation === this.generation && !controller.signal.aborted && latest?.revealed)
          this.save(revealTurn(latest, truth))
      }
    } catch (error) {
      const current = this.game(id)
      if (generation === this.generation && !controller.signal.aborted && current)
        this.save(
          failTurn(
            current,
            requestId,
            error instanceof Error ? error.message : '请求失败，请稍后再试',
          ),
        )
    } finally {
      if (this.requests.get(id) === controller) this.requests.delete(id)
    }
  }
  async reveal(id: string) {
    const game = this.game(id)
    const generation = this.generation
    if (!game || game.status !== 'active' || game.pendingAsk || this.requests.has(id)) return
    if (isDailyLocked({ ...game }))
      throw new Error(this.t('今天的官方汤不能提前揭晓——明天它就会解锁，到时候你随时可以翻看。'))
    const controller = new AbortController()
    this.requests.set(id, controller)
    try {
      const result = await this.api.reveal(toSession(game), this.locale, controller.signal)
      const current = this.game(id)
      if (
        generation === this.generation &&
        !controller.signal.aborted &&
        current?.status === 'active'
      )
        this.save(revealTurn(current, result))
    } finally {
      if (this.requests.get(id) === controller) this.requests.delete(id)
    }
  }
  abandon(id: string) {
    this.interrupt(id)
    const game = this.game(id)
    if (game) this.save(touchGame(game, { status: 'abandoned', pendingAsk: undefined }))
  }
  remove(id: string) {
    this.interrupt(id)
    this.store.save(
      this.owner,
      this.games.filter((game) => game.id !== id),
    )
  }
  async report(id: string, note: string, platform: string) {
    const game = this.game(id)
    if (!game) return
    await this.api.report({
      puzzleId: game.libraryId ?? game.id,
      kind: game.libraryId ? 'library' : 'session',
      note,
      playerKey: this.deviceId,
      locale: this.locale,
      snapshot: {
        ...game,
        url: `turtlesoup://game/${game.id}`,
        platform,
        appVersion: '0.1.0',
        build: buildNumber,
        locale: this.locale,
      },
    })
  }
}

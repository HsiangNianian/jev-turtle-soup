package games.mmstudio.turtlesoup

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

sealed interface Page {
    data class PuzzleDetail(val puzzle: Puzzle): Page
    data class PuzzleLoader(val id: String): Page
    data class DailyDetail(val daily: Daily): Page
    data class Investigation(val id: String): Page
    data class Author(val handle: String): Page
    data class OwnSoup(val item: JSONObject): Page
    data object Search: Page
    data object Login: Page
    data object Compose: Page
    data object MySoups: Page
    data object Guide: Page
}

class AppState(context: Context) {
    private val prefs = context.getSharedPreferences("soup.app", Context.MODE_PRIVATE)
    val api = SoupApi(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    val stack = mutableStateListOf<Page>()
    var tab by mutableIntStateOf(0)
    var daily by mutableStateOf<Daily?>(null)
    var history by mutableStateOf<List<Daily>>(emptyList())
    var curated by mutableStateOf<List<Puzzle>>(emptyList())
    var puzzles by mutableStateOf<List<Puzzle>>(emptyList())
    var sort by mutableStateOf("new")
    var communityBusy by mutableStateOf(false)
    var communityError by mutableStateOf("")
    var dailyError by mutableStateOf("")
    var user by mutableStateOf<User?>(null)
    var unread by mutableIntStateOf(0)
    var events by mutableStateOf<List<JSONObject>>(emptyList())
    var ownSoups by mutableStateOf<List<JSONObject>>(emptyList())
    var games = mutableStateListOf<Game>()
        private set
    var busy by mutableStateOf(false)
    var error by mutableStateOf("")
    var syncNote by mutableStateOf("")

    private val dirty = mutableSetOf<String>()
    private val syncMutex = Mutex()
    private var archiveWritable = true
    private var communityRequest = 0
    private val archiveOwner get() = user?.uid ?: "guest"

    init {
        user = prefs.getString("cachedUser", null)?.let { raw ->
            runCatching { User.from(JSONObject(raw)) }.getOrNull()
        }
        loadArchive()
        scope.launch {
            launch { refreshDaily() }
            launch { refreshCommunity() }
            launch { refreshCurated() }
            launch { refreshAccount() }
        }
    }

    fun open(page: Page) { stack.add(page) }
    fun back() { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
    fun selectTab(value: Int) { stack.clear(); tab = value; if (value == 2) refreshActivity() }
    fun game(id: String) = games.firstOrNull { it.id == id }
    fun toast(message: String) { error = message }
    fun clearError() { error = "" }

    private fun launchRequest(block: suspend () -> Unit) = scope.launch {
        try { block() }
        catch (_: CancellationException) { /* navigation cancellation is not a service failure */ }
        catch (e: Exception) { error = e.message ?: "暂时无法连接，请稍后再试" }
    }

    fun refreshDaily() = launchRequest {
        dailyError = ""
        try {
            val result = api.request("/api/daily")
            daily = result.optJSONObject("today")?.let(Daily::from)
            history = result.arr("history").objects().map(Daily::from)
                .filter { it.date < java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString() }
        } catch (_: CancellationException) { }
        catch (_: Exception) { dailyError = "官汤暂未更新，轻点下方重新加载" }
    }

    fun refreshCommunity(query: String = "", offset: Int = 0): kotlinx.coroutines.Job {
        val request = ++communityRequest
        return launchRequest {
        communityBusy = true
        communityError = ""
        try {
            val path = "/api/library/puzzles?sort=$sort&q=${api.segment(query)}&limit=30&offset=$offset"
            val fetched = api.request(path).arr("items").objects().map(Puzzle::from)
            if (request == communityRequest) puzzles = if (offset == 0) fetched else puzzles + fetched.filter { p -> puzzles.none { it.id == p.id } }
        } catch (_: CancellationException) { }
        catch (_: Exception) { if (request == communityRequest) communityError = "广场暂时没连上，轻点下方重新加载" }
        finally { if (request == communityRequest) communityBusy = false }
        }
    }

    fun refreshCurated() = launchRequest {
        try {
            curated = api.request("/api/library/puzzles?scope=community&featuredOnly=1&limit=3")
                .arr("items").objects().map(Puzzle::from)
        } catch (_: Exception) { /* keep the last curated selection */ }
    }

    suspend fun search(query: String): List<Puzzle> = api.request(
        "/api/library/puzzles?q=${api.segment(query)}&limit=30"
    ).arr("items").objects().map(Puzzle::from)

    fun refreshAccount() = launchRequest {
        val account = try { api.request("/api/auth/me").optJSONObject("user")?.let(User::from) }
        catch (e: ApiException) {
            if (e.status == 401) null else { syncNote = "账号暂未更新，联网后可再次同步"; return@launchRequest }
        }
        catch (_: Exception) { syncNote = "账号暂未更新，联网后可再次同步"; return@launchRequest }
        activate(account)
        if (account != null) {
            sync()
            refreshUnread()
        }
    }

    private fun activate(account: User?) {
        val cached = account?.let { JSONObject().put("uid", it.uid).put("email", it.email)
            .put("name", it.name).put("handle", it.handle).toString() }
        prefs.edit().putString("cachedUser", cached).apply()
        if (account?.uid == user?.uid) { user = account; return }
        val guests = if (user == null && account != null) games.toList() else emptyList()
        user = account
        loadArchive()
        if (guests.isNotEmpty()) {
            for (game in guests) if (games.none { it.id == game.id }) { games.add(game); dirty.add(game.id) }
            persist()
        }
        events = emptyList(); ownSoups = emptyList(); unread = 0
    }

    suspend fun requestCode(email: String): JSONObject = api.request("/api/auth/request", "POST",
        JSONObject().put("email", email.trim()).put("locale", "zh-CN"))

    suspend fun verify(email: String, code: String) {
        val result = api.request("/api/auth/verify", "POST", JSONObject()
            .put("email", email.trim()).put("code", code.trim()).put("locale", "zh-CN"))
        val account = User.from(result.obj("user"))
        activate(account)
        refreshAccount()
        back()
    }

    fun signOut() = launchRequest {
        api.request("/api/auth/logout", "POST")
        api.clearSession()
        activate(null)
    }

    fun refreshUnread() = launchRequest {
        if (user != null) unread = api.request("/api/me/notifications").optInt("unread")
    }

    fun refreshActivity() = launchRequest {
        if (user == null) return@launchRequest
        events = api.request("/api/me/activity?limit=30").arr("items").objects()
        api.request("/api/me/notifications/seen", "POST")
        unread = 0
    }

    fun refreshOwnSoups() = launchRequest {
        if (user == null) return@launchRequest
        ownSoups = api.request("/api/me/puzzles").arr("items").objects()
    }

    fun start(puzzle: Puzzle) {
        if (!archiveWritable) { toast("本机案卷读取失败，原文件已保留；请暂时不要开始新调查"); return }
        val existing = games.firstOrNull { it.libraryId == puzzle.id && it.status == "active" }
        val game = existing ?: Game.from(puzzle).also(::save)
        open(Page.Investigation(game.id))
        track("puzzle_open", puzzle.id)
    }

    fun start(dailyPuzzle: Daily) {
        if (!archiveWritable) { toast("本机案卷读取失败，原文件已保留；请暂时不要开始新调查"); return }
        if (dailyPuzzle.puzzleId.isBlank() || dailyPuzzle.surface.isBlank()) {
            toast("这碗汤暂时无法开始，请稍后重试"); return
        }
        val game = games.firstOrNull { it.id == dailyPuzzle.puzzleId } ?: Game.from(dailyPuzzle).also(::save)
        open(Page.Investigation(game.id))
        track("puzzle_open", dailyPuzzle.puzzleId)
    }

    fun ask(id: String, raw: String) = launchRequest {
        val current = game(id) ?: return@launchRequest
        val question = raw.trim()
        if (question.isBlank() || question.length > 600 || current.status != "active" || busy) return@launchRequest
        val previousFailed = current.messages.lastOrNull()?.error == true &&
            current.messages.dropLast(1).lastOrNull()?.role == "player"
        val context = if (previousFailed) current.copy(messages = current.messages.dropLast(2),
            turnCount = maxOf(0, current.turnCount - 1)) else current
        val previous = context.messages.filterNot { it.error }
        val body = JSONObject().put("puzzleId", context.id).put("message", question)
            .put("history", previous.map { JSONObject().put("role", it.role).put("text", it.text) }.jsonArray())
            .put("locale", "zh-CN").put("playerKey", api.playerKey).put("seq", context.turnCount + 1)
        save(context.copy(messages = context.messages + Message("player", question), turnCount = context.turnCount + 1))
        busy = true
        try {
            val path = if (current.libraryId.isNotBlank()) "/api/library/puzzles/${api.segment(current.libraryId)}/ask" else "/api/game/ask"
            val reply = api.request(path, "POST", body)
            val solved = reply.optBoolean("solved")
            val revealed = reply.optBoolean("revealed")
            val latest = game(id) ?: return@launchRequest
            save(latest.copy(
                messages = latest.messages + Message("host", reply.str("reply"), reply.str("verdict")),
                truth = reply.str("truth", latest.truth),
                status = if (solved) "solved" else if (revealed) "revealed" else "active",
            ))
            if (context.turnCount == 0) track("first_question", context.libraryId.ifBlank { context.id })
        } catch (e: Exception) {
            game(id)?.let { save(it.copy(messages = it.messages + Message("host", e.message ?: "砚暂时没有回答", error = true))) }
        } finally { busy = false }
    }

    fun retry(id: String) {
        val messages = game(id)?.messages ?: return
        if (messages.lastOrNull()?.error == true && messages.dropLast(1).lastOrNull()?.role == "player") {
            ask(id, messages[messages.lastIndex - 1].text)
        }
    }

    fun reveal(id: String) = launchRequest {
        val current = game(id) ?: return@launchRequest
        if (current.locked) { toast("今日官汤要到 UTC 零点后才会揭晓"); return@launchRequest }
        if (busy) return@launchRequest
        busy = true
        try {
            val path = if (current.libraryId.isNotBlank()) "/api/library/puzzles/${api.segment(current.libraryId)}/reveal" else "/api/game/reveal"
            val result = api.request(path, "POST", JSONObject().put("puzzleId", current.id)
                .put("locale", "zh-CN").put("manual", current.status == "active")
                .put("playerKey", api.playerKey))
            save(current.copy(truth = result.str("truth"), hint = result.str("hint"),
                status = if (current.status == "solved") "solved" else "revealed"))
        } finally { busy = false }
    }

    fun publish(title: String, surface: String, truth: String, hint: String, difficulty: String,
        tags: List<String>, visibility: String, onSuccess: () -> Unit) = launchRequest {
        if (user == null) { toast("请先登录"); return@launchRequest }
        val body = JSONObject().put("title", title.trim()).put("surface", surface.trim())
            .put("truth", truth.trim()).put("hint", hint.trim()).put("difficulty", difficulty)
            .put("tags", tags.jsonArray()).put("visibility", visibility).put("locale", "zh-CN")
        busy = true
        try {
            api.request("/api/library/puzzles", "POST", body)
            refreshCommunity(); refreshOwnSoups(); refreshCurated()
            onSuccess()
        } finally { busy = false }
    }

    fun save(game: Game) {
        if (!archiveWritable) { toast("本机案卷读取失败，原文件已保留；请暂时不要开始新调查"); return }
        val fresh = game.copy(updatedAt = maxOf(System.currentTimeMillis(), game.updatedAt + 1))
        games.removeAll { it.id == fresh.id }
        games.add(0, fresh)
        dirty.add(fresh.id)
        persist()
        if (user != null) scope.launch { sync() }
    }

    private fun loadArchive() {
        games.clear(); dirty.clear()
        archiveWritable = true
        val data = prefs.getString("games.$archiveOwner", "[]") ?: "[]"
        try { games.addAll(JSONArray(data).objects().map(Game::from)) }
        catch (_: Exception) { archiveWritable = false; syncNote = "本机案卷读取失败，原文件已保留" }
        dirty.addAll(prefs.getStringSet("dirty.$archiveOwner", emptySet()) ?: emptySet())
    }

    private fun persist() {
        if (!archiveWritable) return
        prefs.edit().putString("games.$archiveOwner", games.map { it.json() }.jsonArray().toString())
            .putStringSet("dirty.$archiveOwner", dirty.toSet()).apply()
    }

    private suspend fun sync() = syncMutex.withLock {
        val account = user ?: return@withLock
        if (!archiveWritable) return@withLock
        try {
            val remote = api.request("/api/me/saves", owner = account.uid).arr("items").objects().map(Game::from)
            if (account.uid != user?.uid) return@withLock
            val merged = (games + remote).groupBy { it.id }.values.map { same -> same.maxBy { it.updatedAt } }
                .sortedByDescending { it.updatedAt }
            games.clear(); games.addAll(merged); persist()
            for (id in dirty.toList()) {
                val game = games.firstOrNull { it.id == id } ?: continue
                api.request("/api/me/saves/${api.segment(id)}", "PUT", JSONObject().put("game", game.json()), account.uid)
                if (games.firstOrNull { it.id == id }?.updatedAt == game.updatedAt) dirty.remove(id)
                persist()
            }
            syncNote = "已与云端同步"
        } catch (_: Exception) { syncNote = "本机已保存，稍后可再同步" }
    }

    fun syncNow() = launchRequest { sync() }

    private fun track(event: String, puzzleId: String) = launchRequest {
        runCatching { api.request("/api/engagement", "POST", JSONObject().put("event", event)
            .put("actorKey", api.playerKey).put("puzzleId", puzzleId).put("platform", "android")
            .put("source", "app").put("internal", false)) }
    }
}

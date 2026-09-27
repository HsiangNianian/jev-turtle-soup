package games.mmstudio.turtlesoup

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

fun tablePhaseLabel(phase: String): String = when (phase) {
    "waiting" -> "等待入座"; "playing" -> "推理中"; "solved" -> "共同解开"
    "revealed" -> "共同揭晓"; else -> "已中止"
}
fun tableInvitationCode(input: String): String? {
    var code = input.trim()
    if (code.startsWith("http", ignoreCase = true)) {
        val url = Uri.parse(code)
        if (url.scheme != "https" || url.host != "hgt.mmstudio.games" || url.port != -1 || url.userInfo != null || url.path != "/rooms/join") return null
        code = url.getQueryParameter("code").orEmpty()
    }
    code = code.replace(" ", "").replace("-", "").uppercase(java.util.Locale.ROOT)
    return code.takeIf { it.matches(Regex("^[A-HJ-NP-Z2-9]{12}$")) }
}
fun tableCommand(type: String, vararg fields: Pair<String, Any>): JSONObject = JSONObject()
    .put("commandId", UUID.randomUUID().toString()).put("type", type).also { o -> fields.forEach { o.put(it.first, it.second) } }

/** One account and room per store. Pending commands are committed before reaching the socket. */
class TableStore(context: Context, val owner: String, val roomId: String, private val api: SoupApi) {
    var snapshot by mutableStateOf<JSONObject?>(null); private set
    var events by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var status by mutableStateOf("正在连接"); private set
    var online by mutableStateOf(false); private set
    var error by mutableStateOf("")
    var hasEarlier by mutableStateOf(false); private set
    var pendingCount by mutableStateOf(0); private set
    var rejected by mutableStateOf<JSONObject?>(null); private set
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val prefs = context.getSharedPreferences("soup.room.pending", Context.MODE_PRIVATE)
    private val key = "$owner:$roomId"
    private var pending = emptyList<JSONObject>()
    private var socket: WebSocket? = null
    private var requestJob: Job? = null
    private var retryJob: Job? = null
    private var stopped = false
    private var terminal = false
    private var generation = 0
    private var cursor = 0L
    private var attempt = 0
    companion object {
        private val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS)
            .pingInterval(25, TimeUnit.SECONDS).retryOnConnectionFailure(false).followRedirects(false).build()
    }
    fun start() {
        pending = runCatching { JSONArray(prefs.getString(key, "[]")).objects().filter {
            System.currentTimeMillis() - it.optLong("at") < 600_000
        }.takeLast(12) }.getOrDefault(emptyList())
        pendingCount = pending.size
        connect()
    }
    fun stop() { stopped = true; generation++; online = false; socket?.close(1000, null); socket = null; scope.cancel() }
    fun resume() {
        if (stopped || terminal) return
        generation++; requestJob?.cancel(); retryJob?.cancel(); socket?.cancel(); socket = null; online = false
        connect()
    }
    private fun persist() {
        check(prefs.edit().putString(key, pending.jsonArray().toString()).commit()) { "无法保存待确认操作，请检查手机存储空间" }
        pendingCount = pending.size
    }
    private fun accept(value: JSONObject, incoming: List<JSONObject>) {
        if (value.str("meId") != owner || value.str("roomId") != roomId || value.optInt("protocol") != 1) {
            end("auth", "账号或协议已变化，请重新登录"); return
        }
        if (snapshot == null || value.optLong("revision") >= snapshot!!.optLong("revision")) snapshot = value
        events = (events + incoming).associateBy { it.optLong("seq") }.toSortedMap().values.toList()
        cursor = maxOf(cursor, incoming.maxOfOrNull { it.optLong("seq") } ?: 0)
    }
    private fun connect() {
        if (stopped || terminal) return
        val current = ++generation
        status = "正在连接"
        requestJob = scope.launch {
            try {
                if (snapshot == null) {
                    val page = api.request("/api/rooms/$roomId")
                    if (current != generation || stopped) return@launch
                    accept(page.obj("snapshot"), page.arr("events").objects()); hasEarlier = page.optBoolean("hasMore")
                }
                if (terminal) return@launch
                if (snapshot?.arr("members")?.objects()?.firstOrNull { it.str("uid") == owner }?.str("seat") == "removed") {
                    terminal = true; status = "已被移出同桌"; return@launch
                }
                val ticket = api.request("/api/rooms/$roomId/ticket", "POST", JSONObject()).str("ticket")
                if (current != generation || stopped) return@launch
                require(ticket.matches(Regex("^[a-f0-9]{64}$")) && runCatching { UUID.fromString(roomId) }.isSuccess)
                val req = Request.Builder().url("${api.origin.replace("https://","wss://").replace("http://","ws://")}/api/rooms/$roomId/ws?after=$cursor")
                    .header("Cookie", api.roomSessionCookie()).header("Sec-WebSocket-Protocol", "soup-room-v1, ticket.$ticket").build()
                socket = client.newWebSocket(req, object: WebSocketListener() {
                    override fun onOpen(ws: WebSocket, response: Response) {
                        scope.launch {
                            if (current != generation || stopped) { ws.cancel(); return@launch }
                            if (response.header("Sec-WebSocket-Protocol") != "soup-room-v1") { ws.cancel(); end("auth", "同桌协议不匹配，请更新客户端") }
                        }
                    }
                    override fun onMessage(ws: WebSocket, text: String) {
                        scope.launch {
                            if (current != generation || stopped || text == "pong") return@launch
                            try {
                                val message = JSONObject(text)
                                when (message.str("type")) {
                                    "snapshot", "update" -> {
                                        accept(message.obj("snapshot"), message.arr("events").objects())
                                        if (!terminal && !online) {
                                            online = true; status = "实时连接"; attempt = 0; error = ""
                                            for (item in pending) if (!ws.send(item.obj("command").toString())) { retryLater(); break }
                                        }
                                    }
                                    "ack", "error" -> {
                                        val reason = message.str("terminal")
                                        if (reason.isNotBlank()) { end(reason, message.str("error")); return@launch }
                                        val id = message.str("commandId")
                                        if (message.str("type") == "error") {
                                            error = message.str("error")
                                            rejected = pending.firstOrNull { it.obj("command").str("commandId") == id }?.obj("command")
                                        }
                                        if (id.isNotBlank()) { pending = pending.filterNot { it.obj("command").str("commandId") == id }; persist() }
                                    }
                                }
                            } catch (e: Exception) { error = e.message ?: "同桌消息无法读取" }
                        }
                    }
                    override fun onClosing(ws: WebSocket, code: Int, reason: String) { ws.close(code, reason) }
                    override fun onClosed(ws: WebSocket, code: Int, reason: String) { scope.launch {
                        if (current == generation && !stopped) {
                            if (code == 4001 || code == 4003) end(if (code == 4001) "auth" else "removed", reason)
                            else retryLater()
                        }
                    } }
                    override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) { scope.launch {
                        if (current == generation && !stopped) retryLater()
                    } }
                })
            } catch (_: CancellationException) { }
            catch (e: ApiException) { if (current == generation) {
                if (e.status in listOf(401, 403, 404)) end(if(e.status == 401) "auth" else "removed", e.message)
                else retryLater()
            } }
            catch (_: Exception) { if (current == generation) retryLater() }
        }
    }
    private fun retryLater() {
        if (stopped || terminal) return
        generation++; online = false; status = "正在重连，记录会自动补齐"
        socket?.cancel(); socket = null; retryJob?.cancel()
        val wait = minOf(30_000L, 3000L shl minOf(attempt++, 4))
        retryJob = scope.launch { delay(wait); connect() }
    }
    private fun end(reason: String, message: String) {
        terminal = true; generation++; online = false; status = message; error = message
        retryJob?.cancel(); socket?.close(1000, null); socket = null; snapshot = null; events = emptyList()
        if (reason == "removed") {
            pending = emptyList(); runCatching { persist() }
            scope.launch { runCatching { api.request("/api/rooms/$roomId") }.getOrNull()?.let {
                if (!stopped) { accept(it.obj("snapshot"), it.arr("events").objects()); hasEarlier = it.optBoolean("hasMore") }
            } }
        }
    }
    fun send(command: JSONObject): Boolean {
        if (!online || stopped || terminal || socket == null) { error = "连接恢复后再发送，内容可以先留在输入框"; return false }
        if (pending.size >= 12) { error = "请等前面的操作确认后再试"; return false }
        pending = pending + JSONObject().put("at", System.currentTimeMillis()).put("command", command)
        try { persist() } catch (e: Exception) { pending = pending.dropLast(1); error = e.message.orEmpty(); return false }
        if (socket?.send(command.toString()) != true) retryLater()
        return true
    }
    suspend fun earlier() {
        val first = events.firstOrNull()?.optLong("seq") ?: return
        val current = generation
        try {
            val page = api.request("/api/rooms/$roomId/events?before=$first")
            if (current == generation && !stopped) { accept(page.obj("snapshot"), page.arr("events").objects()); hasEarlier = page.optBoolean("hasMore") }
        } catch (_: CancellationException) { } catch (e: Exception) { error = e.message.orEmpty() }
    }
}

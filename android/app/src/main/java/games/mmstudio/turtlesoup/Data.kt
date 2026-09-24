package games.mmstudio.turtlesoup

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

internal fun JSONObject.str(key: String, fallback: String = ""): String = optString(key, fallback).takeUnless { it == "null" } ?: fallback
internal fun JSONObject.obj(key: String): JSONObject = optJSONObject(key) ?: JSONObject()
internal fun JSONObject.arr(key: String): JSONArray = optJSONArray(key) ?: JSONArray()
internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
internal fun JSONArray.strings(): List<String> = (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }
internal fun List<*>.jsonArray(): JSONArray = JSONArray().also { array -> forEach { array.put(it) } }

data class Puzzle(
    val id: String,
    val title: String,
    val surface: String,
    val difficulty: String,
    val tags: List<String>,
    val plays: Int,
    val solves: Int,
    val ownerName: String,
    val ownerHandle: String,
    val official: Boolean,
    val featuredNote: String,
    val genreScore: Int?,
    val shortestSolveTurns: Int?,
    val longestSolveTurns: Int?,
) {
    companion object {
        fun from(o: JSONObject): Puzzle = Puzzle(
            o.str("id"), o.str("title"), o.str("surface"), o.str("difficulty"),
            o.arr("tags").strings(), o.optInt("plays"), o.optInt("solves"),
            o.obj("owner").str("displayName", "汤友"), o.obj("owner").str("handle"),
            o.optBoolean("official"), o.str("featuredNote"),
            if (o.isNull("genreScore") || !o.has("genreScore")) null else o.optInt("genreScore"),
            if (o.isNull("shortestSolveTurns") || !o.has("shortestSolveTurns")) null else o.optInt("shortestSolveTurns"),
            if (o.isNull("longestSolveTurns") || !o.has("longestSolveTurns")) null else o.optInt("longestSolveTurns"),
        )
    }
}

data class Daily(
    val date: String,
    val title: String,
    val surface: String,
    val difficulty: String,
    val locale: String,
    val puzzleId: String,
    val genreScore: Int?,
    val truth: String,
    val story: String,
    val shortestSolveTurns: Int?,
    val longestSolveTurns: Int?,
) {
    val language: String get() = when (locale) { "en" -> "英文"; "ja" -> "日文"; else -> "中文" }
    val isLocked: Boolean get() = date >= java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString()
    companion object {
        fun from(o: JSONObject): Daily = Daily(
            o.str("date"), o.str("title"), o.str("surface"), o.str("difficulty"),
            o.str("locale"), o.str("puzzleId"),
            if (o.isNull("genreScore") || !o.has("genreScore")) null else o.optInt("genreScore"),
            o.str("truth"), o.str("story"),
            if (o.isNull("shortestSolveTurns") || !o.has("shortestSolveTurns")) null else o.optInt("shortestSolveTurns"),
            if (o.isNull("longestSolveTurns") || !o.has("longestSolveTurns")) null else o.optInt("longestSolveTurns"),
        )
    }
}

data class User(val uid: String, val email: String, val name: String, val handle: String) {
    val displayName get() = name.ifBlank { email.substringBefore('@') }
    companion object {
        fun from(o: JSONObject) = User(o.str("uid"), o.str("email"), o.str("name"), o.str("handle"))
    }
}

data class Message(val role: String, val text: String, val verdict: String = "", val error: Boolean = false,
    val id: String = UUID.randomUUID().toString(), val raw: JSONObject? = null) {
    fun json() = JSONObject(raw?.toString() ?: "{}").put("id", id).put("role", role).put("text", text).put("verdict", verdict)
        .put("tone", if (error) "error" else if (verdict.isNotBlank()) "verdict" else JSONObject.NULL)
    companion object {
        fun from(o: JSONObject) = Message(o.str("role"), o.str("text"), o.str("verdict"), o.str("tone") == "error",
            o.str("id").ifBlank { UUID.randomUUID().toString() }, o)
    }
}

data class Game(
    val id: String,
    val title: String,
    val surface: String,
    val difficulty: String,
    val source: String,
    val libraryId: String = "",
    val dailyDate: String = "",
    val messages: List<Message> = listOf(Message("host", "汤面已经端上来了。开始提问吧，我只回答「是」「不是」「无关」。")),
    val truth: String = "",
    val hint: String = "",
    val status: String = "active",
    val turnCount: Int = 0,
    val updatedAt: Long = System.currentTimeMillis(),
    val createdAt: Long = System.currentTimeMillis(),
    val raw: JSONObject? = null,
) {
    val locked get() = dailyDate.isNotBlank() && dailyDate >= java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString()
    fun json() = JSONObject(raw?.toString() ?: "{}")
        .put("id", id).put("title", title).put("surface", surface).put("difficulty", difficulty)
        .put("source", source).put("hostGreeting", "汤面已经端上来了。开始提问吧，我只回答「是」「不是」「无关」。")
        .put("libraryId", libraryId.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
        .put("dailyDate", dailyDate.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
        .put("messages", messages.map { it.json() }.jsonArray())
        .put("truth", truth.takeIf { it.isNotBlank() } ?: JSONObject.NULL).put("hint", hint)
        .put("revealed", status == "revealed" || status == "solved")
        .put("solved", status == "solved").put("status", status)
        .put("turnCount", turnCount).put("createdAt", createdAt).put("updatedAt", updatedAt)
    companion object {
        fun from(o: JSONObject): Game = Game(
            o.str("id"), o.str("title"), o.str("surface"), o.str("difficulty"), o.str("source"),
            o.str("libraryId"), o.str("dailyDate"), o.arr("messages").objects().map(Message::from),
            o.str("truth"), o.str("hint"), o.str("status", "active"), o.optInt("turnCount"),
            o.optLong("updatedAt", System.currentTimeMillis()), o.optLong("createdAt", System.currentTimeMillis()), o,
        )
        fun from(puzzle: Puzzle) = Game(UUID.randomUUID().toString(), puzzle.title, puzzle.surface,
            puzzle.difficulty, "library", libraryId = puzzle.id)
        fun from(daily: Daily) = Game(daily.puzzleId, daily.title, daily.surface,
            daily.difficulty, "daily", dailyDate = daily.date)
    }
}

/** HTTPS-only client; stores the session cookie separately from the WebView cookie jar. */
class SoupApi(context: Context) {
    private val prefs = context.getSharedPreferences("soup.api", Context.MODE_PRIVATE)
    val playerKey: String = prefs.getString("playerKey", null) ?: UUID.randomUUID().toString().also {
        prefs.edit().putString("playerKey", it).apply()
    }

    suspend fun request(path: String, method: String = "GET", body: JSONObject? = null,
        owner: String? = null): JSONObject = withContext(Dispatchers.IO) {
        require(path.startsWith("/api/"))
        val connection = (URL("https://hgt.mmstudio.games$path").openConnection() as HttpURLConnection)
        try {
            connection.requestMethod = method
            connection.connectTimeout = 20_000
            connection.readTimeout = 150_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "TurtleSoup-Android/0.1.2")
            prefs.getString("sessionCookie", null)?.let { connection.setRequestProperty("Cookie", it) }
            owner?.let { connection.setRequestProperty("X-Save-Owner", it) }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val cookie = connection.getHeaderField("Set-Cookie")?.substringBefore(';')
            if (cookie != null) {
                if (cookie.substringAfter('=', "").isBlank()) prefs.edit().remove("sessionCookie").apply()
                else prefs.edit().putString("sessionCookie", cookie).apply()
            }
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            val result = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            if (status !in 200..299) throw ApiException(status, result.str("error", "请求失败（$status）"))
            result
        } finally { connection.disconnect() }
    }

    fun clearSession() { prefs.edit().remove("sessionCookie").apply() }
    fun segment(value: String): String = Uri.encode(value)
}

class ApiException(val status: Int, override val message: String): Exception(message)

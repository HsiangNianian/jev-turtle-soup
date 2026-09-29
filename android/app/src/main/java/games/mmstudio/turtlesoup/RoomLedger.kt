package games.mmstudio.turtlesoup

import org.json.JSONObject

enum class TableVerdict(val wire: String, val glyph: String, val label: String) {
    YES("yes", "是", "是"), NO("no", "否", "不是"), PARTLY("partly", "半", "部分正确"),
    IRRELEVANT("irrelevant", "—", "无关"), SOLVED("solved", "中", "已破案")
}

fun tableVerdict(turn: JSONObject?): TableVerdict? {
    if (turn?.optBoolean("solved") == true) return TableVerdict.SOLVED
    return TableVerdict.entries.firstOrNull { it != TableVerdict.SOLVED && it.wire == turn?.str("verdict") }
}

data class TableLedgerItem(val id: String, val question: String, val actorId: String, val verdict: TableVerdict)

fun tableLedger(events: List<JSONObject>): List<TableLedgerItem> {
    val questions = linkedMapOf<String, JSONObject>()
    val answers = mutableMapOf<String, TableVerdict>()
    for (event in events.sortedBy { it.optLong("seq") }) {
        val id = event.str("questionId")
        if (id.isBlank()) continue
        if (event.str("type") == "question") questions[id] = event
        if (event.str("type") == "answer") tableVerdict(event.optJSONObject("turn"))?.let { answers[id] = it }
    }
    return questions.mapNotNull { (id, question) ->
        answers[id]?.let { TableLedgerItem(id, question.str("text"), question.str("actorId"), it) }
    }
}

data class TableTranscriptEntry(val event: JSONObject, val answers: List<JSONObject>)
fun tableTranscript(events: List<JSONObject>): List<TableTranscriptEntry> {
    val ordered = events.sortedBy { it.optLong("seq") }
    val questions = ordered.filter { it.str("type") == "question" }.map { it.str("questionId") }.filter { it.isNotBlank() }.toSet()
    val answers = ordered.filter { it.str("type") == "answer" && it.str("questionId").isNotBlank() }.groupBy { it.str("questionId") }
    return ordered.mapNotNull { event ->
        if(event.str("type") == "answer" && event.str("questionId") in questions) null
        else TableTranscriptEntry(event, if(event.str("type") == "question") answers[event.str("questionId")].orEmpty() else emptyList())
    }
}

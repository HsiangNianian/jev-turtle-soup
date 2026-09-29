package games.mmstudio.turtlesoup

import android.content.Context
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

/** Personal annotations never enter Game.json(), cloud saves or room commands. */
class LocalQuestionMarks(context: Context, owner: String?, kind: String, id: String) {
    private val prefs = context.getSharedPreferences("soup.question-marks", Context.MODE_PRIVATE)
    private val key = JSONArray().put(owner ?: JSONObject.NULL).put(kind).put(id).toString()
    private fun read(): Map<String, String> = runCatching {
        val data = JSONObject(prefs.getString(key, "{}") ?: "{}")
        data.keys().asSequence().map { it to data.optString(it) }
            .filter { it.second in listOf("useful", "not-useful") }.toMap()
    }.getOrDefault(emptyMap())
    var values by mutableStateOf(read()); private set
    var filter by mutableStateOf("all")
    fun toggle(id: String, value: String) {
        if (value !in listOf("useful", "not-useful")) return
        val next = read().toMutableMap()
        if (next[id] == value) next.remove(id) else next[id] = value
        prefs.edit().apply { if (next.isEmpty()) remove(key) else putString(key, JSONObject(next as Map<*, *>).toString()) }.apply()
        values = next.toMap()
    }
    fun includes(id: String?): Boolean = filter == "all" || (id != null && values[id]?.let { filter == "marked" || filter == it } == true)
}

@Composable fun rememberQuestionMarks(owner: String?, kind: String, id: String): LocalQuestionMarks {
    val context = LocalContext.current.applicationContext
    return remember(owner, kind, id) { LocalQuestionMarks(context, owner, kind, id) }
}

data class SoloTranscriptEntry(val message: Message, val answer: Message?, val number: Int?)
fun soloTranscript(messages: List<Message>): List<SoloTranscriptEntry> {
    val rows = mutableListOf<SoloTranscriptEntry>()
    var index = 0; var number = 0
    while (index < messages.size) {
        val message = messages[index]
        var answer: Message? = null
        if (message.role == "player") {
            number++
            if (messages.getOrNull(index + 1)?.role == "host") answer = messages[++index]
        }
        rows += SoloTranscriptEntry(message, answer, if(message.role == "player") number else null)
        index++
    }
    return rows
}
fun soloVerdict(message: Message?): TableVerdict? = if(message?.raw?.str("tone") == "celebrate") TableVerdict.SOLVED else TableVerdict.entries.firstOrNull { it.wire == message?.verdict }
data class PlayAnswer(val text: String, val verdict: TableVerdict?, val error: Boolean = false)

@Composable fun QuestionMarkControls(marks: LocalQuestionMarks, id: String, quote: (() -> Unit)? = null) {
    var menu by remember { mutableStateOf(false) }
    Column {
        IconButton(onClick = { marks.toggle(id, "useful") }, modifier = Modifier.size(36.dp, 44.dp).semantics { selected = marks.values[id] == "useful" }) {
            Icon(if(marks.values[id] == "not-useful") Icons.Outlined.Remove else if(marks.values[id] == "useful") Icons.Outlined.BookmarkAdded else Icons.Outlined.BookmarkBorder,
                "有用", Modifier.size(14.dp), tint = if(marks.values[id] == null) mutedColor() else redColor())
        }
        Box {
            IconButton(onClick = { menu = true }, modifier = Modifier.size(36.dp, 28.dp)) { Icon(Icons.Outlined.MoreHoriz, "这组问答的更多操作", Modifier.size(14.dp), tint = mutedColor()) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = paperColor()) {
                listOf("useful" to "有用", "not-useful" to "暂时无用").forEach { (value, label) ->
                    DropdownMenuItem(text = { Prose(if(marks.values[id] == value) "取消${label}标记" else label, size = 14) }, onClick = { marks.toggle(id, value); menu = false })
                }
                if (quote != null) DropdownMenuItem(text = { Prose("引用提问", size = 14) }, onClick = { menu = false; quote() })
                Mono("仅保存在本机，自己可见。", Modifier.padding(12.dp), size = 9)
            }
        }
    }
}

@Composable fun QuestionFilterBar(marks: LocalQuestionMarks, verdicts: List<TableVerdict>, selected: TableVerdict?, select: (TableVerdict?) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Column {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            TableVerdict.entries.forEach { v ->
                val count = verdicts.count { it == v }
                if(v != TableVerdict.SOLVED || count > 0) {
                    Column(Modifier.widthIn(min = 32.dp).clickable { select(if(selected == v) null else v) }.semantics { contentDescription = "${v.label}，${count} 条"; this.selected = selected == v }) {
                        Row(Modifier.heightIn(min = 42.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                            Prose(v.glyph, size = 12, color = if(v == TableVerdict.NO) redColor() else mutedColor())
                            Mono("$count", size = 9)
                        }
                        Box(Modifier.height(2.dp).width(30.dp).background(if(selected == v) redColor() else paperColor()))
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            val choices = listOf("all" to "全部记录", "marked" to "我的标记", "useful" to "只看有用", "not-useful" to "暂时无用")
            Box {
                TextButton(onClick = { menu = true }, contentPadding = PaddingValues(horizontal = 4.dp), modifier = Modifier.semantics { contentDescription = "筛选我的标记" }) {
                    Icon(Icons.Outlined.BookmarkBorder, null, Modifier.size(11.dp), tint = mutedColor())
                    Mono(choices.first { it.first == marks.filter }.second, Modifier.padding(start = 4.dp), color = if(marks.filter == "all") mutedColor() else redColor())
                    Icon(Icons.Outlined.KeyboardArrowDown, null, Modifier.size(13.dp), tint = mutedColor())
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = paperColor()) {
                    choices.forEach { (value, label) -> DropdownMenuItem(text = { Prose(label, size = 14) }, onClick = { marks.filter = value; menu = false }) }
                }
            }
        }
        Rule()
    }
}

@Composable fun PlayQuestionPair(id: String, number: Int?, speaker: String, question: String, answers: List<PlayAnswer>, marks: LocalQuestionMarks,
    reference: String? = null, pending: String? = null, quote: (() -> Unit)? = null) {
    Column {
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            Box(Modifier.width(2.dp).fillMaxHeight().background(if(marks.values[id] == "useful") redColor() else paperColor()))
            Row(Modifier.weight(1f).padding(start = 13.dp, end = 8.dp, top = 10.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Column(Modifier.width(24.dp).padding(top = 5.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    if(number != null) Mono(number.toString().padStart(2, '0'), size = 9)
                    Text(speaker, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 9.sp, color = mutedColor())
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if(reference != null) Mono("↳ $reference")
                    SelectionContainer { Prose(question, size = 15, lineHeight = 26) }
                    answers.forEach { answer ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            answer.verdict?.let { TableVerdictStamp(it) }
                            SelectionContainer { Prose(answer.text, size = 14, lineHeight = 24, color = if(answer.error) redColor() else mutedColor()) }
                        }
                    }
                    if(pending != null) Mono(pending)
                }
                QuestionMarkControls(marks, id, quote)
            }
        }
        Rule()
    }
}

@Composable fun PlayComposer(text: String, change: (String) -> Unit, send: () -> Unit, enabled: Boolean,
    mode: String? = null, changeMode: ((String) -> Unit)? = null) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().border(1.dp, lineColor()).background(sheetColor()).padding(5.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if(mode != null && changeMode != null) Box {
            TextButton(onClick = { menu = true }, contentPadding = PaddingValues(horizontal = 4.dp), modifier = Modifier.height(44.dp).testTag("tableRecipient")) {
                Mono(if(mode == "ask") "问砚" else "桌聊", color = redColor())
                Icon(Icons.Outlined.KeyboardArrowDown, "发送给", Modifier.size(12.dp), tint = redColor())
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = paperColor()) {
                listOf("ask" to "问砚", "discuss" to "和大家聊").forEach { (value, label) ->
                    DropdownMenuItem(text = { Prose(label, size = 14) }, onClick = { changeMode(value); menu = false }, modifier = Modifier.testTag("tableMode.$value"))
                }
            }
        } else Prose("›", Modifier.width(24.dp).height(44.dp).padding(top = 8.dp), color = redColor(), size = 19)
        BasicTextField(text, { change(it.take(600)) }, Modifier.weight(1f).heightIn(min = 44.dp).padding(vertical = 10.dp).semantics { contentDescription = if(mode == "discuss") "桌内讨论" else "向砚提问" },
            textStyle = TextStyle(fontFamily = Ink.serif, fontSize = 16.sp, lineHeight = 24.sp, color = inkColor()), maxLines = 4,
            cursorBrush = SolidColor(redColor()), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { if(enabled && text.isNotBlank()) send() }),
            decorationBox = { inner -> Box { if(text.isEmpty()) Prose(if(mode == "discuss") "和同桌聊聊…" else "还有什么，值得一问…", size = 16, lineHeight = 24, color = mutedColor()); inner() } })
        IconButton(onClick = send, enabled = enabled && text.isNotBlank(), modifier = Modifier.size(44.dp).background(inkColor().copy(alpha = if(enabled && text.isNotBlank()) 1f else .3f))) {
            Icon(Icons.Outlined.ArrowUpward, if(mode == null) "发送问题" else "发送", Modifier.size(20.dp), tint = paperColor())
        }
    }
}

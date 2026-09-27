package games.mmstudio.turtlesoup

import android.content.Intent
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

@Composable fun TableEntryButton(state: AppState, puzzleId: String? = null) {
    OutlinedButton(onClick = { state.open(Page.TableLobby(puzzleId)) }, shape = RectangleShape) {
        Icon(Icons.Outlined.Group, null, Modifier.size(16.dp), tint = inkColor()); Spacer(Modifier.width(8.dp))
        Prose(if(puzzleId == null) "凭邀请入座" else "邀朋友同桌", size = 12)
    }
}
@Composable fun TableLobbyScreen(state: AppState, puzzleId: String?) {
    var code by rememberSaveable { mutableStateOf("") }
    val requestId = rememberSaveable { UUID.randomUUID().toString() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    PageScroll {
        Heading("同桌", if(puzzleId == null) "朋友留了一桌给你" else "为这碗汤，留几个座位",
            "2—6 人围坐一桌。各自提问，一起讨论，由砚主持；想提前看答案，需要全体同意。")
        if(state.user == null) {
            Prose("登录后入座，提问和讨论都会留在你们共同的案卷里。", color = mutedColor())
            InkButton("登录后入座", { state.open(Page.Login) })
        } else {
            if(puzzleId == null) OutlinedTextField(code, { code = it.take(512) }, Modifier.fillMaxWidth(),
                label = { Mono("邀请码或邀请链接") }, placeholder = { Mono("ABCD EFGH 2345") }, shape = RectangleShape,
                textStyle = TextStyle(fontFamily = Ink.serif, fontSize = 16.sp))
            InkButton(if(busy) "正在入座…" else if(puzzleId == null) "入座" else "开一桌，邀请朋友", {
                val owner = state.user?.uid ?: return@InkButton
                busy = true; error = ""
                scope.launch {
                    try {
                        val room = if(puzzleId != null) state.api.request("/api/rooms", "POST", JSONObject().put("puzzleId", puzzleId).put("requestId", requestId))
                        else {
                            val valid = tableInvitationCode(code) ?: throw IllegalArgumentException("请输入有效的邀请码或海龟汤邀请链接")
                            state.api.request("/api/rooms/join", "POST", JSONObject().put("code", valid))
                        }
                        if(state.user?.uid == owner && room.str("meId") == owner) state.open(Page.Table(room.str("roomId")))
                    } catch(e: CancellationException) { throw e } catch(e: Exception) { error = e.message.orEmpty() } finally { busy = false }
                }
            }, enabled = !busy)
        }
        if(error.isNotBlank()) Prose(error, color = redColor(), size = 13)
    }
}
@Composable fun MyTablesScreen(state: AppState) {
    var items by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(state.user?.uid) {
        val owner = state.user?.uid
        items = emptyList()
        if(owner != null) try { val result = state.api.request("/api/me/rooms").arr("items").objects();if(state.user?.uid == owner) items = result }
        catch(e: CancellationException) { throw e } catch(e: Exception) { error = e.message.orEmpty() }
    }
    PageScroll {
        Heading("共同案卷", "我的同桌", "那天的提问、讨论和结案，都留在这里。")
        TableEntryButton(state)
        if(items.isEmpty()) Prose("还没有同桌案卷。去广场选一碗汤，邀请朋友一起玩吧。", color = mutedColor())
        items.forEach { item ->
            Column(Modifier.fillMaxWidth().clickable { state.open(Page.Table(item.str("roomId"))) }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Mono("${tablePhaseLabel(item.str("phase"))} · ${item.optInt("turns")} 轮")
                Prose(item.str("title"), size = 22)
                TextButton(onClick = { scope.launch { try {
                    state.api.request("/api/me/rooms/${item.str("roomId")}/hide", "POST", JSONObject())
                    items = items.filterNot { it.str("roomId") == item.str("roomId") }
                } catch(e: CancellationException) { throw e } catch(e: Exception) { error = e.message.orEmpty() } } }) { Mono("从我的列表隐藏") }
                Rule()
            }
        }
        if(error.isNotBlank()) Prose(error, color = redColor(), size = 13)
    }
}

@Composable fun TableScreen(state: AppState, roomId: String) {
    val owner = state.user?.uid
    if(owner == null) { PageScroll { Heading("同桌", "登录后继续"); InkButton("登录", { state.open(Page.Login) }) }; return }
    key(owner, roomId) { ConnectedTableScreen(state, roomId, owner) }
}
@Composable private fun ConnectedTableScreen(state: AppState, roomId: String, owner: String) {
    val context = LocalContext.current
    val table = remember { TableStore(context.applicationContext, owner, roomId, state.api) }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current
    var tab by rememberSaveable { mutableStateOf("ask") }
    var question by rememberSaveable { mutableStateOf("") }
    var discussion by rememberSaveable { mutableStateOf("") }
    var reference by remember { mutableStateOf<JSONObject?>(null) }
    var surface by remember { mutableStateOf(false) }
    var members by remember { mutableStateOf(false) }
    var reportOpen by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf<JSONObject?>(null) }
    var confirmText by remember { mutableStateOf("") }
    val list = rememberLazyListState()
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    val s = table.snapshot
    val roster = s?.arr("members")?.objects().orEmpty()
    val seats = roster.filter { it.str("seat") == "seated" }
    val vote = s?.optJSONObject("vote")
    val available = table.online && s?.optBoolean("readOnly") == false
    val mine = s?.arr("queue")?.objects()?.firstOrNull { it.str("uid") == owner }
    val failed = s?.arr("failed")?.objects()?.firstOrNull { it.str("uid") == owner }
    val active = s?.optJSONObject("processing")
    val draft = if(tab == "ask") question else discussion
    val canAsk = s?.str("phase") == "playing" && mine == null && active?.str("uid") != owner && vote == null && !s.optBoolean("revealPending") && seats.size >= 2
    DisposableEffect(table) { table.start(); onDispose { table.stop() } }
    DisposableEffect(lifecycle, table) {
        var first = true
        val observer = LifecycleEventObserver { _, event -> if(event == Lifecycle.Event.ON_RESUME) { if(first) first = false else table.resume() } }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(vote?.str("id")) { while(true) { now = System.currentTimeMillis(); delay(if(vote != null) 1000 else 60_000) } }
    LaunchedEffect(table.rejected?.str("commandId")) {
        table.rejected?.let { if(it.str("type") == "ask" && question.isBlank()) question = it.str("text"); if(it.str("type") == "discuss" && discussion.isBlank()) discussion = it.str("text") }
    }
    LaunchedEffect(s?.str("phase")) { if(s?.str("phase") == "waiting") { surface = true; tab = "discuss" } }
    LaunchedEffect(table.status) { if(table.status.contains("登录")) state.refreshAccount() }
    val filtered = table.events.filter { it.str("type") == "system" || if(tab == "ask") it.str("type") != "discussion" else it.str("type") == "discussion" }
    LaunchedEffect(table.events.lastOrNull()?.str("id"), tab, s?.optJSONObject("report")) {
        val nearEnd = list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= list.layoutInfo.totalItemsCount - 3 } ?: true
        if(nearEnd && list.layoutInfo.totalItemsCount > 0) list.animateScrollToItem(list.layoutInfo.totalItemsCount - 1)
    }
    fun invite() { s?.str("inviteCode")?.takeIf { it.isNotBlank() }?.let { code -> context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "https://hgt.mmstudio.games/rooms/join?code=$code") }, "邀请朋友同桌")) } }
    if(confirmation != null) AlertDialog(onDismissRequest = { confirmation = null }, title = { Prose("同桌操作", size = 20) }, text = { Prose(confirmText, size = 14) },
        confirmButton = { TextButton(onClick = { confirmation?.let(table::send); confirmation = null }) { Prose("确认", size = 14, color = redColor()) } },
        dismissButton = { TextButton(onClick = { confirmation = null }) { Prose("取消", size = 14) } })
    if(reportOpen) AlertDialog(onDismissRequest = { reportOpen = false }, title = { Prose("这桌遇到了什么问题？", size = 20) },
        text = { OutlinedTextField(feedback, { feedback = it.take(1000) }, minLines = 3, shape = RectangleShape) },
        confirmButton = { TextButton(enabled = feedback.isNotBlank(), onClick = { scope.launch { try {
            state.api.request("/api/rooms/$roomId/report", "POST", JSONObject().put("note", feedback)); reportOpen = false; feedback = ""; table.error = "反馈已收到，谢谢。"
        } catch(e: CancellationException) { throw e } catch(e: Exception) { table.error = e.message.orEmpty() } } }) { Prose("提交反馈", size = 14) } },
        dismissButton = { TextButton(onClick = { reportOpen = false }) { Prose("取消", size = 14) } })
    Column(Modifier.fillMaxSize().imePadding()) {
        if(s != null) Column(Modifier.padding(horizontal = 20.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Mono("${tablePhaseLabel(s.str("phase"))} · ${s.optInt("turns")} 轮"); Prose(s.obj("puzzle").str("title"), size = 20) }
                TextButton(onClick = { members = !members }) { Icon(Icons.Outlined.Group, null, Modifier.size(16.dp), tint = inkColor()); Mono(" ${seats.size}/6") } }
            TextButton(onClick = { surface = !surface }, contentPadding = PaddingValues(0.dp)) { Mono(if(surface) "收起汤面 ↑" else "汤面 ↓") }
            if(surface) Box(Modifier.heightIn(max = 150.dp).verticalScroll(rememberScrollState())) { Prose(s.obj("puzzle").str("surface"), size = 14) }
        }
        if(members && s != null) Column(Modifier.heightIn(max = 300.dp).verticalScroll(rememberScrollState()).background(sheetColor()).padding(16.dp)) {
            seats.forEach { m -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(vertical = 8.dp)) { Prose(m.str("name"), size = 14); Mono("${if(m.str("uid") == s.str("hostId")) "房主" else if(m.isNull("disconnectedAt")) "在座" else "暂时离线"} · ${m.optInt("questions")} 轮") }
                if(s.str("hostId") == owner && m.str("uid") != owner && available) {
                    TextButton(onClick = { confirmText = "把房主交给 ${m.str("name")}？"; confirmation = tableCommand("transfer", "uid" to m.str("uid")) }) { Mono("转交") }
                    TextButton(onClick = { confirmText = "移出后，这位汤友不能重新进入这一桌。"; confirmation = tableCommand("kick", "uid" to m.str("uid")) }) { Mono("移出", color = redColor()) }
                }
            } }
            if(s.str("inviteCode").isNotBlank()) { SelectionContainer { Mono(s.str("inviteCode"), size = 13) }; TextButton(onClick = ::invite) { Prose("邀请朋友", size = 13) } }
            if(available && s.str("hostId") == owner) TextButton(onClick = { table.send(tableCommand("invitations", "open" to !s.optBoolean("invitationsOpen"))) }) { Mono(if(s.optBoolean("invitationsOpen")) "停止新成员入座" else "开放新成员入座") }
            if(available) TextButton(onClick = { confirmText = "离座后保留共同案卷；有空位时可以再次入座。"; confirmation = tableCommand("leave") }) { Mono("离座") }
        }
        if(!table.online) Mono(table.status, Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
        if(vote != null) Column(Modifier.fillMaxWidth().background(sheetColor()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Prose("这碗汤，一起揭晓吗？", size = 15)
            Mono("需全员同意 · ${vote.arr("agreed").length()}/${vote.arr("members").length()} · ${maxOf(0, (vote.optLong("expiresAt") - now) / 1000)}s")
            Row { TextButton(enabled = available, onClick = { table.send(tableCommand("vote", "voteId" to vote.str("id"), "agree" to false)) }) { Prose("继续推理", size = 13) }
                TextButton(enabled = available && owner !in vote.arr("agreed").strings(), onClick = { table.send(tableCommand("vote", "voteId" to vote.str("id"), "agree" to true)) }) { Prose(if(owner in vote.arr("agreed").strings()) "已同意" else "同意揭晓", size = 13) } }
        }
        Rule()
        Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            listOf("ask" to "问砚", "discuss" to "桌内讨论").forEach { (value, label) -> TextButton(onClick = { tab = value }) { Mono(label, size = 11, color = if(tab == value) redColor() else mutedColor()) } }
            Spacer(Modifier.weight(1f)); IconButton(onClick = { reportOpen = true }) { Icon(Icons.Outlined.Flag, "反馈", Modifier.size(16.dp), tint = mutedColor()) }
        }
        Rule()
        LazyColumn(Modifier.weight(1f), state = list, contentPadding = PaddingValues(20.dp)) {
            if(s?.str("phase") == "waiting") item { TableWaiting(s, owner, available, ::invite) { table.send(tableCommand("start")) } }
            if(table.hasEarlier) item { TextButton(onClick = { scope.launch { table.earlier() } }, modifier = Modifier.fillMaxWidth()) { Mono("查看更早的记录 ↑") } }
            items(filtered, key = { it.str("id") }) { e ->
                if(e.str("type") == "system") Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) { Mono(e.str("text")) }
                else Column(Modifier.fillMaxWidth().padding(start = if(e.str("type") == "answer") 16.dp else 0.dp).padding(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row { Mono(if(e.str("type") == "answer") "砚" else (roster.firstOrNull { it.str("uid") == e.str("actorId") }?.str("name") ?: "汤友") + if(e.str("actorId") == owner && e.str("type") != "answer") " · 你" else "", color = if(e.str("type") == "answer") redColor() else mutedColor())
                        Spacer(Modifier.weight(1f)); Mono(java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date(e.optLong("at")))) }
                    if(e.str("referenceId").isNotBlank()) Mono("↳ ${table.events.firstOrNull { it.str("type") == "question" && it.str("questionId") == e.str("referenceId") }?.str("text") ?: "接着前面的问题"}")
                    SelectionContainer { Prose(e.str("text"), size = 15) }
                    if(e.str("type") == "question" && available) TextButton(onClick = { reference = e; tab = "ask" }) { Mono("引用提问 ↳") }
                    Rule()
                }
            }
            if(tab == "discuss" && table.events.none { it.str("type") == "discussion" }) item { Column(Modifier.fillMaxWidth().padding(vertical = 30.dp), horizontalAlignment = Alignment.CenterHorizontally) { Prose("把你的猜想说给同桌听。", color = mutedColor(), size = 14); Mono("讨论不计轮数，也不会作为正式提问交给砚。") } }
            s?.optJSONObject("report")?.let { report -> item { TableReport(report, roster) } }
        }
        if(table.error.isNotBlank()) Row(Modifier.fillMaxWidth().background(sheetColor()).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Prose(table.error, Modifier.weight(1f), size = 12, color = redColor()); TextButton(onClick = { table.error = "" }) { Mono("关闭") }
        }
        if(s != null && !s.optBoolean("readOnly")) Column(Modifier.padding(horizontal = 14.dp).padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Rule()
            if(active != null) Mono("砚正在回答 · ${roster.firstOrNull { it.str("uid") == active.str("uid") }?.str("name") ?: "汤友"}")
            if(mine != null) Row(verticalAlignment = Alignment.CenterVertically) { Mono("你的问题正在排队"); TextButton(onClick = { table.send(tableCommand("cancel", "questionId" to mine.str("id"))) }) { Mono("撤回") } }
            if(failed != null) Row(verticalAlignment = Alignment.CenterVertically) { Mono(failed.str("error"), Modifier.weight(1f)); TextButton(onClick = { table.send(tableCommand("retry", "questionId" to failed.str("id"))) }) { Mono("重试问题", color = redColor()) } }
            if(reference != null && tab == "ask") TextButton(onClick = { reference = null }) { Mono("↳ ${reference!!.str("text")}  ×") }
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(draft, { if(tab == "ask") question = it.take(600) else discussion = it.take(600) }, Modifier.weight(1f), shape = RectangleShape, maxLines = 4,
                    placeholder = { Prose(if(tab == "ask") "把你的问题交给砚……" else "和同桌说说你的猜想……", size = 14, color = mutedColor()) }, textStyle = TextStyle(fontFamily = Ink.serif, fontSize = 16.sp))
                IconButton(enabled = available && draft.isNotBlank() && (tab != "ask" || canAsk), onClick = {
                    val command = tableCommand(if(tab == "ask") "ask" else "discuss", "text" to draft.trim())
                    if(tab == "ask") { command.put("locale", "zh-CN"); reference?.let { command.put("referenceId", it.str("questionId")) } }
                    if(table.send(command)) { if(tab == "ask") question = "" else discussion = ""; reference = null }
                }, modifier = Modifier.background(inkColor())) { Icon(Icons.Outlined.ArrowUpward, "发送", tint = paperColor()) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) { Mono(if(table.pendingCount > 0) "等待服务器确认" else if(tab == "ask") "正式提问按顺序回答" else "讨论仅在这一桌可见", Modifier.weight(1f))
                if(s.str("phase") == "playing") TextButton(enabled = available && vote == null && !s.optBoolean("revealPending") && s.obj("puzzle").str("dailyDate") != java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString(), onClick = { table.send(tableCommand("reveal")) }) { Mono("提议揭晓") } }
        } else if(s != null && roster.firstOrNull { it.str("uid") == owner }?.str("seat") == "left" && s.str("inviteCode").isNotBlank()) {
            InkButton("再次入座", { scope.launch { try { state.api.request("/api/rooms/join", "POST", JSONObject().put("code", s.str("inviteCode"))); table.resume() } catch(e: CancellationException) { throw e } catch(e: Exception) { table.error = e.message.orEmpty() } } }, Modifier.align(Alignment.CenterHorizontally))
        }
    }
}

@Composable private fun TableWaiting(s: JSONObject, owner: String, available: Boolean, invite: () -> Unit, start: () -> Unit) {
    val seats = s.arr("members").objects().filter { it.str("seat") == "seated" }
    Column(Modifier.fillMaxWidth().border(1.dp, lineColor()).background(sheetColor()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Mono("入座后就开汤", color = redColor()); Prose("空着的座位，留给朋友", size = 23)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { repeat(6) { i -> Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Prose(seats.getOrNull(i)?.str("name")?.take(1) ?: "＋", Modifier.background(if(i < seats.size) inkColor() else sheetColor()).padding(6.dp), color = if(i < seats.size) paperColor() else mutedColor(), size = 15)
            Mono(seats.getOrNull(i)?.str("name")?.take(3) ?: "空位", size = 9); Rule()
        } } }
        Prose("把邀请发给朋友。至少两人在线，房主就可以开始。", size = 14, color = mutedColor())
        SelectionContainer { Mono(s.str("inviteCode"), size = 13) }
        OutlinedButton(onClick = invite, shape = RectangleShape) { Prose("邀请朋友", size = 13) }
        if(s.str("hostId") == owner) InkButton("开始同桌", start, enabled = available && seats.count { it.isNull("disconnectedAt") } >= 2)
    }
}
@Composable private fun TableReport(report: JSONObject, roster: List<JSONObject>) {
    Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Rule(); SectionTitle("共同结案报告", "${report.optInt("turns")} 轮"); Prose(tablePhaseLabel(report.str("outcome")), size = 26)
        Mono(roster.filter { it.str("seat") != "removed" }.joinToString("、") { it.str("name") })
        if(report.str("truth").isNotBlank()) { Mono("汤底"); SelectionContainer { Prose(report.str("truth"), size = 15) } }
        if(report.str("story").isNotBlank()) { Mono("完整背景故事"); SelectionContainer { Prose(report.str("story"), size = 15) } }
        Mono(if(report.optBoolean("authorParticipated")) "作者参与过这一桌，不计入同桌轮数纪录。" else "同桌轮数单独记录，不影响单人纪录。")
    }
}

package games.mmstudio.turtlesoup

import android.content.Context
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun InvestigationScreen(state: AppState, id: String) {
    val game = state.game(id)
    var question by remember(id) { mutableStateOf("") }
    var confirmReveal by remember { mutableStateOf(false) }
    if (game == null) {
        PageScroll { Prose("这份案卷暂时没找到。", color = mutedColor()) }
        return
    }
    if (confirmReveal) {
        AlertDialog(onDismissRequest = { confirmReveal = false }, title = { Prose("现在看汤底？", size = 20) },
            text = { Prose("这会结束这次推理。作者能看到主动揭晓的人数。", size = 14) },
            confirmButton = { TextButton(onClick = { confirmReveal = false; state.reveal(id) }) { Prose("揭晓", size = 14) } },
            dismissButton = { TextButton(onClick = { confirmReveal = false }) { Mono("继续推理") } })
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp, vertical = 22.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Heading(if (game.source == "daily") "每日官汤" else "汤友原创", game.title,
                "${game.difficulty}  ·  已问 ${game.turnCount} 轮")
            Surface(game.surface)
            SectionTitle("调查记录", when (game.status) { "solved" -> "已破案"; "revealed" -> "已揭晓"; else -> "调查中" })
            game.messages.forEach { message ->
                Column(Modifier.fillMaxWidth().background(if (message.role == "player") sheetColor() else paperColor())
                    .padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Mono(if (message.role == "player") "你问" else "砚答", color = if (message.role == "player") redColor() else mutedColor())
                    if (message.verdict.isNotBlank()) Mono(when (message.verdict) {
                        "yes" -> "是"; "no" -> "不是"; "partly" -> "部分正确"; "irrelevant" -> "无关"; else -> message.verdict
                    }, color = redColor())
                    Prose(message.text, size = 15, color = if (message.error) redColor() else inkColor())
                }
                Rule()
            }
            if (game.messages.lastOrNull()?.error == true && game.messages.dropLast(1).lastOrNull()?.role == "player") {
                TextButton(onClick = { state.retry(id) }, enabled = !state.busy) { Prose("重试刚才的问题 →", size = 14) }
            }
            if (state.busy) Mono("砚正在想这条线索…", color = redColor())
            if (game.status != "active") {
                SectionTitle("汤底")
                if (game.truth.isNotBlank()) Prose(game.truth, size = 15)
                else TextButton(onClick = { state.reveal(id) }) { Prose("调取汤底 →", size = 14) }
                if (game.hint.isNotBlank()) Prose("提示：${game.hint}", size = 14, color = mutedColor())
            } else if (!game.locked) {
                TextButton(onClick = { confirmReveal = true }) { Mono("主动看答案 →", color = mutedColor()) }
            } else Mono("今日官汤明日解锁答案")
        }
        if (game.status == "active") {
            Rule()
            Row(Modifier.fillMaxWidth().background(sheetColor()).padding(10.dp).imePadding(),
                verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(question, { question = it.take(600) }, Modifier.weight(1f),
                    placeholder = { Mono("问砚一个问题…") }, maxLines = 4, shape = RectangleShape)
                InkButton("发送", {
                    val sent = question.trim()
                    if (sent.isNotEmpty()) { question = ""; state.ask(id, sent) }
                }, enabled = question.trim().isNotBlank() && !state.busy)
            }
        }
    }
}

@Composable fun ActivityScreen(state: AppState) {
    LaunchedEffect(state.user?.uid) { if (state.user != null) state.refreshActivity() }
    PageScroll {
        Heading("汤友之间", "有了回响", "你熬的汤，有人来问；你留下的故事，有人记得。")
        if (state.user == null) {
            Prose("登录后，在这里收到作品的留言、喜欢和推理动态。", color = mutedColor())
            InkButton("登录，看看回响", { state.open(Page.Login) })
        } else {
            if (state.events.isEmpty()) Prose("第一声回响，值得等待。写下一碗汤，邀请大家来解。", color = mutedColor())
            state.events.forEach { event ->
                Column(Modifier.fillMaxWidth().clickable {
                    val puzzleId = event.str("puzzleId")
                    if (puzzleId.isNotBlank()) {
                        state.open(Page.PuzzleLoader(puzzleId))
                    } else state.user?.handle?.takeIf(String::isNotBlank)?.let { state.open(Page.Author(it)) }
                }.padding(vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Prose(when (event.str("kind")) {
                        "comment" -> "${event.str("actor", "一位汤友")} 留了言"
                        "like" -> "一位汤友赞了你的故事"
                        "solve" -> "一位汤友解开了这碗汤"
                        else -> "一位汤友开始了推理"
                    }, size = 15, weight = FontWeight.SemiBold)
                    if (event.str("body").isNotBlank()) Prose(event.str("body"), size = 14)
                    if (event.str("puzzleTitle").isNotBlank()) Mono("《${event.str("puzzleTitle")}》")
                }
                Rule()
            }
            TextButton(onClick = { state.refreshActivity() }) { Mono("更新动态") }
        }
    }
}

@Composable fun AccountScreen(state: AppState) {
    var finished by remember { mutableStateOf(false) }
    PageScroll {
        Heading("汤友档案", state.user?.displayName ?: "故事里，等你入座")
        if (state.user == null) {
            Prose("和汤友聊推理，也把自己的故事熬成一碗汤。登录后，作品与案卷随账号保存。", color = mutedColor())
            InkButton("邮箱登录", { state.open(Page.Login) })
        } else {
            Mono(state.user!!.email)
            Mono(state.syncNote.ifBlank { "进度保存在本机" })
            TextButton(onClick = { state.syncNow() }) { Prose("同步案卷 →", size = 14) }
            if (state.user!!.handle.isNotBlank()) AccountLink("我的主页", "让汤友认识你") {
                state.open(Page.Author(state.user!!.handle))
            }
            AccountLink("我熬的汤", "作品与私藏") { state.open(Page.MySoups) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
            Statistic("在办", state.games.count { it.status == "active" })
            Statistic("已破案", state.games.count { it.status == "solved" })
            Statistic("提问", state.games.sumOf { it.turnCount })
        }
        SectionTitle("我的案卷", "${state.games.size} 份")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !finished, onClick = { finished = false }, label = { Mono("调查中") }, shape = RectangleShape)
            FilterChip(selected = finished, onClick = { finished = true }, label = { Mono("已归档") }, shape = RectangleShape)
        }
        val visible = state.games.filter { if (finished) it.status != "active" else it.status == "active" }
        if (visible.isEmpty()) Prose(if (finished) "结案之后，在这里重读。" else "案头还很安静，去广场找一碗汤。", color = mutedColor())
        visible.forEach { game ->
            Column(Modifier.fillMaxWidth().clickable { state.open(Page.Investigation(game.id)) }
                .padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Prose(game.title, size = 19)
                Mono("${if (game.status == "active") "调查中" else if (game.status == "solved") "已破案" else "已揭晓"}  ·  已问 ${game.turnCount} 轮")
            }
            Rule()
        }
        SectionTitle("偏好与帮助")
        AccountLink("调查员手册", "学会提问") { state.open(Page.Guide) }
        if (state.user != null) TextButton(onClick = { state.signOut() }) { Prose("退出登录", color = redColor(), size = 14) }
        Mono("海龟汤 · Android 0.1.0\n一人熬汤，众人寻味。")
    }
}

@Composable private fun Statistic(label: String, number: Int) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Mono("%02d".format(number), size = 24, color = inkColor())
        Mono(label)
    }
}

@Composable private fun AccountLink(title: String, detail: String, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 15.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Prose(title, size = 16)
            Mono("$detail  →")
        }
        Spacer(Modifier.height(12.dp)); Rule()
    }
}

@Composable fun LoginScreen(state: AppState) {
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var sent by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    PageScroll {
        Heading("账号", "加入汤友之间", "用同一个邮箱，接着推理、熬汤和聊天。")
        Mono("邮箱地址")
        OutlinedTextField(email, { email = it.trim().lowercase() }, Modifier.fillMaxWidth(),
            placeholder = { Mono("you@example.com") }, singleLine = true, shape = RectangleShape,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), enabled = !sent && !loading)
        if (sent) {
            Mono("六位验证码")
            OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, Modifier.fillMaxWidth(),
                placeholder = { Mono("000000") }, singleLine = true, shape = RectangleShape,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            InkButton("进入汤友之间", {
                scope.launch {
                    loading = true; localError = ""
                    try { state.verify(email, code) }
                    catch (e: Exception) { localError = e.message ?: "验证码未通过" }
                    finally { loading = false }
                }
            }, enabled = code.length == 6 && !loading)
            TextButton(onClick = { sent = false; code = "" }) { Mono("换个邮箱 / 重新发送") }
        } else InkButton("发送验证码", {
            scope.launch {
                loading = true; localError = ""
                try { state.requestCode(email); sent = true }
                catch (e: Exception) { localError = e.message ?: "暂时无法发送验证码" }
                finally { loading = false }
            }
        }, enabled = email.contains('@') && !loading)
        if (localError.isNotBlank()) Prose(localError, color = redColor(), size = 14)
        Mono("验证码发到你的邮箱；若没有收到，请查看垃圾邮件。")
    }
}

@Composable fun MySoupsScreen(state: AppState) {
    LaunchedEffect(state.user?.uid) { state.refreshOwnSoups() }
    PageScroll {
        Heading("我的作品", "我熬的汤")
        if (state.ownSoups.isNotEmpty()) {
            Mono("${state.ownSoups.sumOf { it.optInt("reveals") }} 人主动揭晓 · 按玩家去重，通关不算")
        }
        if (state.ownSoups.isEmpty()) Prose("轮到你讲故事了。那些不合常理的细节，也许就是下一碗好汤。", color = mutedColor())
        state.ownSoups.forEach { item ->
            Column(Modifier.fillMaxWidth().clickable {
                if (item.str("visibility") == "private") state.open(Page.OwnSoup(item))
                else state.open(Page.PuzzleLoader(item.str("id")))
            }.padding(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Mono(if (item.str("visibility") == "public") "公开" else "仅自己可见")
                Prose(item.str("title"), size = 20, weight = FontWeight.SemiBold)
                Mono("${item.optInt("plays")} 人问过 · ${item.optInt("solves")} 人解开")
                Mono("${item.optInt("reveals")} 人主动揭晓")
            }
            Rule()
        }
        InkButton("写一碗汤", { state.open(Page.Compose) })
        TextButton(onClick = { state.refreshOwnSoups() }) { Mono("更新作品") }
    }
}

@Composable fun OwnSoupScreen(item: JSONObject) {
    PageScroll {
        Mono("仅自己可见", color = redColor())
        Heading("我的私藏", item.str("title"))
        Surface(item.str("surface"))
        SectionTitle("汤底")
        Prose(item.str("truth"), size = 15)
        if (item.str("hint").isNotBlank()) {
            SectionTitle("提示")
            Prose(item.str("hint"), size = 15)
        }
    }
}

@Composable fun ComposeScreen(state: AppState) {
    val context = LocalContext.current
    val prefs = remember(state.user?.uid) { context.getSharedPreferences("soup.draft.${state.user?.uid}", Context.MODE_PRIVATE) }
    var title by remember { mutableStateOf(prefs.getString("title", "").orEmpty()) }
    var surface by remember { mutableStateOf(prefs.getString("surface", "").orEmpty()) }
    var truth by remember { mutableStateOf(prefs.getString("truth", "").orEmpty()) }
    var hint by remember { mutableStateOf(prefs.getString("hint", "").orEmpty()) }
    var tags by remember { mutableStateOf(prefs.getString("tags", "").orEmpty()) }
    var difficulty by remember { mutableStateOf(prefs.getString("difficulty", "中等").orEmpty()) }
    var visibility by remember { mutableStateOf(prefs.getString("visibility", "public").orEmpty()) }
    var error by remember { mutableStateOf("") }
    var published by remember { mutableStateOf(false) }
    LaunchedEffect(title, surface, truth, hint, tags, difficulty, visibility) {
        if (!published) prefs.edit().putString("title", title).putString("surface", surface)
            .putString("truth", truth).putString("hint", hint).putString("tags", tags)
            .putString("difficulty", difficulty).putString("visibility", visibility).apply()
    }
    PageScroll {
        if (published) {
            Heading("新汤出锅", title, "你的故事已经来到汤友之间。")
            InkButton("回到广场", { state.back(); state.selectTab(0) })
        } else {
            Heading("汤友投稿", "把故事藏进汤里", "汤面留悬念，汤底藏真相。让大家来问出你的故事。")
            DraftField("标题", title, { title = it }, 40, 1)
            DraftField("汤面", surface, { surface = it }, 200, 4)
            DraftField("汤底", truth, { truth = it }, 2000, 6)
            DraftField("提示 · 可选", hint, { hint = it }, 200, 2)
            DraftField("标签，用逗号隔开，最多 5 个", tags, { tags = it }, 100, 1)
            SectionTitle("难度")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("简单", "中等", "困难").forEach { value ->
                    FilterChip(selected = difficulty == value, onClick = { difficulty = value }, label = { Mono(value) }, shape = RectangleShape)
                }
            }
            SectionTitle("谁能看到")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = visibility == "public", onClick = { visibility = "public" }, label = { Mono("公开给汤友") }, shape = RectangleShape)
                FilterChip(selected = visibility == "private", onClick = { visibility = "private" }, label = { Mono("仅自己可见") }, shape = RectangleShape)
            }
            if (error.isNotBlank()) Prose(error, color = redColor(), size = 14)
            InkButton(if (visibility == "public") "发布到广场" else "保存到我的汤", {
                val parsed = tags.split(',', '，', '、').map(String::trim).filter(String::isNotBlank).distinct()
                error = when {
                    title.trim().isBlank() || title.length > 40 -> "标题请写 1–40 字"
                    surface.trim().isBlank() || surface.length > 200 -> "汤面请写 1–200 字"
                    truth.trim().isBlank() || truth.length > 2000 -> "汤底请写 1–2000 字"
                    hint.length > 200 -> "提示最多 200 字"
                    parsed.size > 5 || parsed.any { it.length > 12 } -> "最多 5 个标签，每个不超过 12 字"
                    else -> ""
                }
                if (error.isBlank()) state.publish(title, surface, truth, hint, difficulty, parsed, visibility) {
                    published = true; prefs.edit().clear().apply()
                }
            }, enabled = !state.busy)
            Mono("草稿会自动保存在本机。")
        }
    }
}

@Composable private fun DraftField(label: String, value: String, onChange: (String) -> Unit, limit: Int, lines: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Prose(label, size = 15, weight = FontWeight.SemiBold)
            Mono("${value.length}/$limit", color = if (value.length > limit) redColor() else mutedColor())
        }
        OutlinedTextField(value, onChange, Modifier.fillMaxWidth(), minLines = lines, maxLines = maxOf(lines, 10), shape = RectangleShape)
    }
}

@Composable fun GuideScreen() {
    PageScroll {
        Heading("玩法指南", "调查员手册")
        listOf(
            "01" to ("先读汤面" to "表面上说不通的故事，背后有一条完整的因果链。注意时间、人物和不寻常的细节。"),
            "02" to ("一次确认一件事" to "向主持人砚提问，例如「她认识那个人吗？」。优先提出能用是或不是回答的问题。"),
            "03" to ("把线索连起来" to "确认动机、手法和转折，最后直接说出你的完整推理。需要帮助时，可以请砚给一点提示。"),
            "04" to ("让案件留在案头" to "随时返回，调查进度会保存在本机。登录同一账号后，可与网页端同步案卷。"),
        ).forEach { (number, step) ->
            SectionTitle(number, step.first)
            Prose(step.second, size = 15)
        }
    }
}

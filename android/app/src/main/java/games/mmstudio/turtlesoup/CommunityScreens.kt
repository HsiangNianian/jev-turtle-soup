package games.mmstudio.turtlesoup

import android.content.Intent
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun PageScroll(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(horizontal = 22.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp), content = content)
}

@Composable fun CommunityScreen(state: AppState) {
    PageScroll {
        Heading("一人熬汤，众人寻味", "汤友广场", "发现大家出的汤，问出故事里的真相。")
        state.daily?.let { today ->
            Row(Modifier.fillMaxWidth().border(1.dp, lineColor()).background(sheetColor())
                .clickable { state.selectTab(1) }.padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Mono("今日官汤", color = redColor())
                Prose(today.title, Modifier.weight(1f), size = 15, weight = FontWeight.SemiBold)
                Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, Modifier.size(18.dp), tint = mutedColor())
            }
        }
        if (state.curated.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SectionTitle("编辑精选", "汤友原创")
                state.curated.forEach { puzzle ->
                    Column(Modifier.fillMaxWidth().clickable { state.open(Page.PuzzleDetail(puzzle)) }
                        .padding(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Mono("@${puzzle.ownerName}  ·  编辑荐", color = redColor())
                        Prose(puzzle.title, size = 20, weight = FontWeight.SemiBold)
                        Prose(puzzle.surface, size = 13, color = mutedColor())
                        if (puzzle.featuredNote.isNotBlank()) Mono("编者按：${puzzle.featuredNote}")
                    }
                    Rule()
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            SectionTitle("汤友新作", "一起开猜")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("new" to "最新", "featured" to "精选", "hot" to "热门").forEach { (sort, label) ->
                    FilterChip(selected = state.sort == sort, onClick = { state.sort = sort; state.refreshCommunity() },
                        label = { Mono(label, color = if (state.sort == sort) paperColor() else inkColor()) },
                        shape = RectangleShape,
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = inkColor()),
                    )
                }
            }
            if (state.communityBusy && state.puzzles.isEmpty()) CircularProgressIndicator(color = redColor())
            if (state.communityError.isNotBlank()) Mono(state.communityError, color = redColor())
            if (!state.communityBusy && state.puzzles.isEmpty()) Prose("广场暂时安静，来熬第一碗汤吧。", color = mutedColor())
            state.puzzles.forEach { PuzzleCard(state, it) }
            if (state.puzzles.size >= 30 && !state.communityBusy) {
                TextButton(onClick = { state.refreshCommunity(offset = state.puzzles.size) }) { Prose("再看一些汤 →", size = 14) }
            }
            TextButton(onClick = { state.refreshCommunity(); state.refreshCurated() }) { Mono("重新看看广场") }
        }
    }
}

@Composable fun PuzzleCard(state: AppState, puzzle: Puzzle) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(34.dp).border(1.dp, lineColor()), contentAlignment = Alignment.Center) {
                Prose(if (puzzle.official) "官" else puzzle.ownerName.take(1), size = 15, color = redColor())
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Prose(if (puzzle.official) "海龟汤 · 官方" else puzzle.ownerName, size = 13,
                    weight = FontWeight.SemiBold)
                Mono("熬了一碗汤")
            }
            if (puzzle.ownerHandle.isNotBlank() && !puzzle.official) {
                TextButton(onClick = { state.open(Page.Author(puzzle.ownerHandle)) }) { Mono("主页 →") }
            }
        }
        Column(Modifier.fillMaxWidth().clickable { state.open(Page.PuzzleDetail(puzzle)) },
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Prose(puzzle.title, size = 22, weight = FontWeight.SemiBold)
            Prose(puzzle.surface, size = 15, lineHeight = 25)
            Mono((listOf(puzzle.difficulty) + puzzle.tags.take(2).map { "#$it" }).joinToString("  ·  "))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            SocialActions(state, "puzzle", puzzle.id)
            TextButton(onClick = { state.start(puzzle) }) { Prose("去推理  →", size = 13) }
        }
        Rule()
    }
}

@Composable fun SearchScreen(state: AppState) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("soup.search", 0) }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Puzzle>>(emptyList()) }
    var history by remember { mutableStateOf(prefs.getString("history", "").orEmpty().split('|').filter(String::isNotBlank)) }
    var loading by remember { mutableStateOf(false) }
    var searchError by remember { mutableStateOf("") }
    fun commit() {
        if (query.trim().isNotBlank()) {
            history = (listOf(query.trim()) + history.filterNot { it == query.trim() }).take(8)
            prefs.edit().putString("history", history.joinToString("|")).apply()
        }
    }
    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); loading = false; return@LaunchedEffect }
        delay(300)
        loading = true; searchError = ""
        try { results = state.search(query.trim()) }
        catch (e: Exception) { searchError = e.message ?: "搜索暂不可用" }
        finally { loading = false }
    }
    PageScroll {
        Heading("汤友之间", "找一碗汤", "按标题、汤面或标签，找到让你好奇的故事。")
        OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), singleLine = true,
            placeholder = { Mono("搜索汤面、标题、标签") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) }, shape = RectangleShape,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { commit() }))
        if (query.isBlank()) {
            SectionTitle("最近搜索")
            if (history.isEmpty()) Prose("还没有搜索记录", color = mutedColor())
            history.forEach { term ->
                Row(Modifier.fillMaxWidth().clickable { query = term }.padding(vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Prose(term, size = 15)
                    Mono("再次搜索 →")
                }
                Rule()
            }
            if (history.isNotEmpty()) TextButton(onClick = { history = emptyList(); prefs.edit().remove("history").apply() }) {
                Mono("清除历史")
            }
        } else {
            SectionTitle("搜索结果", if (loading) "查找中" else "${results.size} 碗")
            if (loading) CircularProgressIndicator(color = redColor())
            if (searchError.isNotBlank()) Prose(searchError, color = redColor())
            if (!loading && results.isEmpty() && searchError.isBlank()) Prose("还没有找到这碗汤，试试别的线索。", color = mutedColor())
            results.forEach { puzzle ->
                Column(Modifier.fillMaxWidth().clickable { commit(); state.open(Page.PuzzleDetail(puzzle)) }
                    .padding(vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Mono("${if (puzzle.official) "官方官汤" else "@${puzzle.ownerName}"}  ·  ${puzzle.difficulty}")
                    Prose(puzzle.title, size = 20, weight = FontWeight.SemiBold)
                    Prose(puzzle.surface, size = 13, color = mutedColor())
                }
                Rule()
            }
        }
    }
}

@Composable fun DailyScreen(state: AppState) {
    PageScroll {
        Heading("官方汤", "每日官方汤", "每天零点（UTC）由砚熬一碗，所有人都拿到同一道题。当天只能问，过了午夜便能回看汤底。")
        state.daily?.let { today ->
            Column(Modifier.fillMaxWidth().border(1.dp, inkColor()).background(sheetColor()),
                verticalArrangement = Arrangement.spacedBy(0.dp)) {
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Mono("今日 · ${today.date}")
                    Mono("明日解锁", color = redColor())
                }
                Rule()
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    Prose(today.title, size = 23, weight = FontWeight.SemiBold)
                    PuzzleMeta(today.difficulty, today.language, today.genreScore)
                    Surface(today.surface)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        InkButton(if (state.games.any { it.id == today.puzzleId }) "继续调查" else "开始推理", { state.start(today) })
                        TextButton(onClick = { state.open(Page.DailyDetail(today)) }) { Mono("查看案卷") }
                    }
                }
            }
        } ?: Prose("今日官汤正在路上。", color = mutedColor())
        if (state.dailyError.isNotBlank()) Mono(state.dailyError, color = redColor())
        Column {
            SectionTitle("往期", "%02d 碗".format(state.history.size))
            state.history.forEach { item ->
                Column(Modifier.fillMaxWidth().clickable { state.open(Page.DailyDetail(item)) }
                    .padding(vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Mono(item.date)
                        Mono("${item.language} · ${item.difficulty}")
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Prose(item.title, size = 19)
                        Prose("→", color = mutedColor())
                    }
                }
                Rule()
            }
        }
        TextButton(onClick = { state.refreshDaily() }) { Mono("重新调取官汤") }
    }
}

@Composable fun PuzzleMeta(difficulty: String, language: String = "", genreScore: Int? = null) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Mono(difficulty, Modifier.border(1.dp, lineColor()).padding(horizontal = 7.dp, vertical = 3.dp))
        if (language.isNotBlank()) Mono(language)
        if (genreScore != null) Mono(if (genreScore >= 50) "变格度 $genreScore" else "本格度 ${100 - genreScore}", color = redColor())
    }
}

@Composable fun DailyDetailScreen(state: AppState, summary: Daily) {
    var item by remember(summary.date) { mutableStateOf(summary) }
    var loadError by remember(summary.date) { mutableStateOf("") }
    var showTruth by remember { mutableStateOf(false) }
    LaunchedEffect(summary.date) {
        try { item = Daily.from(state.api.request("/api/daily/${state.api.segment(summary.date)}").obj("daily")) }
        catch (e: Exception) { loadError = e.message ?: "案卷暂不可用" }
    }
    val context = LocalContext.current
    PageScroll {
        Heading("官方案卷 · ${item.date}", item.title)
        PuzzleMeta(item.difficulty, item.language, item.genreScore)
        if (item.surface.isNotBlank()) Surface(item.surface)
        InkButton("开始推理", { state.start(item) })
        if (item.isLocked) Prose("明日解锁汤底，今天只管大胆提问。", color = mutedColor())
        else {
            TextButton(onClick = { showTruth = !showTruth }) { Prose(if (showTruth) "收起汤底 ↑" else "查看汤底 ↓", size = 15) }
            if (showTruth) {
                Prose(item.truth.ifBlank { "汤底暂不可用" }, size = 15)
                if (item.story.isNotBlank()) Prose(item.story, size = 15)
            }
        }
        TextButton(onClick = { share(context, "https://hgt.mmstudio.games/daily/${item.date}") }) { Prose("分享这桩案件", size = 14) }
        if (!item.isLocked && item.puzzleId.isNotBlank()) SocialPanel(state, "puzzle", item.puzzleId)
        if (loadError.isNotBlank()) Mono(loadError, color = redColor())
    }
}

@Composable fun PuzzleDetailScreen(state: AppState, puzzle: Puzzle) {
    val context = LocalContext.current
    PageScroll {
        if (puzzle.ownerHandle.isNotBlank() && !puzzle.official) {
            Row(Modifier.fillMaxWidth().clickable { state.open(Page.Author(puzzle.ownerHandle)) },
                horizontalArrangement = Arrangement.SpaceBetween) {
                Prose("@${puzzle.ownerName}", size = 14, weight = FontWeight.SemiBold)
                Mono("拜访主页 →")
            }
        } else Mono("海龟汤 · 官方", color = redColor())
        Heading(if (puzzle.official) "往期官汤" else "汤友原创", puzzle.title)
        PuzzleMeta(puzzle.difficulty, genreScore = puzzle.genreScore)
        Surface(puzzle.surface)
        if (puzzle.tags.isNotEmpty()) Mono(puzzle.tags.joinToString("  ") { "#$it" })
        InkButton("开始推理", { state.start(puzzle) })
        Mono("${puzzle.plays} 人问过    ${puzzle.solves} 人解开")
        TextButton(onClick = { share(context, "https://hgt.mmstudio.games/library/${puzzle.id}") }) {
            Prose("分享这桩案件", size = 14)
        }
        SocialPanel(state, "puzzle", puzzle.id)
    }
}

@Composable fun PuzzleLoaderScreen(state: AppState, id: String) {
    var puzzle by remember(id) { mutableStateOf<Puzzle?>(null) }
    var loadError by remember(id) { mutableStateOf("") }
    LaunchedEffect(id) {
        try { puzzle = Puzzle.from(state.api.request("/api/library/puzzles/${state.api.segment(id)}")) }
        catch (e: Exception) { loadError = e.message ?: "暂时无法打开这碗汤" }
    }
    if (puzzle != null) PuzzleDetailScreen(state, puzzle!!)
    else PageScroll { Prose(if (loadError.isBlank()) "正在取来这碗汤…" else loadError, color = mutedColor()) }
}

@Composable fun SocialActions(state: AppState, kind: String, id: String) {
    var snapshot by remember(kind, id) { mutableStateOf<JSONObject?>(null) }
    val scope = rememberCoroutineScope()
    val path = "/api/social/$kind/${state.api.segment(id)}"
    LaunchedEffect(path, state.user?.uid) {
        runCatching { state.api.request("$path?playerKey=${state.api.segment(state.api.playerKey)}") }
            .onSuccess { snapshot = it }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = {
            scope.launch {
                try {
                    val next = state.api.request("$path/like?playerKey=${state.api.segment(state.api.playerKey)}",
                        if (snapshot?.optBoolean("liked") == true) "DELETE" else "POST")
                    snapshot = JSONObject(snapshot.toString()).put("likes", next.optInt("likes"))
                        .put("liked", next.optBoolean("liked"))
                } catch (e: Exception) { state.toast(e.message ?: "暂时无法点赞") }
            }
        }, enabled = snapshot != null) {
            Icon(if (snapshot?.optBoolean("liked") == true) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,
                contentDescription = "赞这碗汤", tint = if (snapshot?.optBoolean("liked") == true) redColor() else mutedColor())
        }
        Mono(snapshot?.optInt("likes")?.toString() ?: "赞")
        Spacer(Modifier.width(16.dp))
        Mono("${snapshot?.arr("comments")?.length() ?: 0} 讨论")
    }
}

@Composable fun SocialPanel(state: AppState, kind: String, id: String) {
    var snapshot by remember(kind, id) { mutableStateOf<JSONObject?>(null) }
    var draft by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val path = "/api/social/$kind/${state.api.segment(id)}"
    fun load() { scope.launch {
        try { snapshot = state.api.request("$path?playerKey=${state.api.segment(state.api.playerKey)}") }
        catch (e: Exception) { state.toast(e.message ?: "讨论暂不可用") }
    } }
    LaunchedEffect(path, state.user?.uid) { load() }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        SectionTitle("汤友讨论", "${snapshot?.arr("comments")?.length() ?: 0} 条")
        SocialActions(state, kind, id)
        snapshot?.arr("comments")?.objects()?.forEach { comment ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Mono("@${comment.obj("author").str("displayName", "汤友")}", color = redColor())
                Prose(comment.str("body"), size = 14)
                if (comment.optBoolean("canDelete")) TextButton(onClick = {
                    scope.launch {
                        try { state.api.request("/api/social/comments/${state.api.segment(comment.str("id"))}", "DELETE"); load() }
                        catch (e: Exception) { state.toast(e.message ?: "删除失败") }
                    }
                }) { Mono("删除") }
            }
            Rule()
        }
        if (state.user == null) TextButton(onClick = { state.open(Page.Login) }) { Prose("登录后参与讨论 →", size = 14) }
        else {
            OutlinedTextField(draft, { draft = it.take(300) }, Modifier.fillMaxWidth(),
                placeholder = { Prose("说说你的推理…", color = mutedColor(), size = 14) },
                minLines = 2, shape = RectangleShape)
            InkButton("发表留言", {
                scope.launch {
                    try {
                        state.api.request("$path/comments", "POST", JSONObject().put("body", draft.trim()))
                        draft = ""; load()
                    } catch (e: Exception) { state.toast(e.message ?: "留言未送达") }
                }
            }, enabled = draft.trim().length in 2..300)
        }
    }
}

@Composable fun AuthorScreen(state: AppState, handle: String) {
    var profile by remember(handle) { mutableStateOf<JSONObject?>(null) }
    var loadError by remember(handle) { mutableStateOf("") }
    LaunchedEffect(handle) {
        try { profile = state.api.request("/api/u/${state.api.segment(handle)}").obj("profile") }
        catch (e: Exception) { loadError = e.message ?: "主页暂不可用" }
    }
    PageScroll {
        if (profile == null) Prose(if (loadError.isBlank()) "正在拜访这位汤友…" else loadError, color = mutedColor())
        profile?.let { person ->
            Heading("汤友档案", person.str("displayName", handle), "@${person.str("handle", handle)}")
            if (!person.optBoolean("profilePublic", true)) Prose("这位汤友暂未公开主页。", color = mutedColor())
            else {
                if (person.str("bio").isNotBlank()) Prose(person.str("bio"))
                val recognition = person.obj("recognition")
                Mono("${recognition.optInt("puzzles")} 碗汤   ${recognition.optInt("plays")} 人问过   ${recognition.optInt("likes")} 份喜欢")
                SectionTitle("TA 熬的汤", "${person.arr("puzzles").length()} 碗")
                person.arr("puzzles").objects().map(Puzzle::from).forEach { PuzzleCard(state, it) }
                SocialPanel(state, "profile", handle)
            }
        }
    }
}

fun share(context: android.content.Context, url: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
    context.startActivity(Intent.createChooser(send, "分享这碗汤"))
}

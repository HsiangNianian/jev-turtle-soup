package games.mmstudio.turtlesoup

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(242, 239, 230)
        window.navigationBarColor = android.graphics.Color.rgb(242, 239, 230)
        setContent {
            SoupTheme {
                val dark = androidx.compose.foundation.isSystemInDarkTheme()
                SideEffect {
                    window.statusBarColor = if (dark) android.graphics.Color.rgb(20, 19, 15) else android.graphics.Color.rgb(242, 239, 230)
                    window.navigationBarColor = if (dark) android.graphics.Color.rgb(20, 19, 15) else android.graphics.Color.rgb(242, 239, 230)
                    window.decorView.systemUiVisibility = if (dark) 0 else
                        android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                }
                val state = remember { AppState(applicationContext) }
                AppShell(state)
            }
        }
    }
}

@Composable fun AppShell(state: AppState) {
    val page = state.stack.lastOrNull()
    BackHandler(page != null) { state.back() }
    if (state.error.isNotBlank()) {
        AlertDialog(onDismissRequest = state::clearError, title = { Prose("稍等一下", size = 20) },
            text = { Prose(state.error, size = 14) },
            confirmButton = { TextButton(onClick = state::clearError) { Prose("知道了", size = 13) } })
    }
    Scaffold(
        containerColor = paperColor(),
        topBar = { AppTopBar(state, page) },
        bottomBar = { if (page == null) AppTabs(state) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).background(paperColor())) {
            when (page) {
                null -> when (state.tab) {
                    0 -> CommunityScreen(state)
                    1 -> DailyScreen(state)
                    2 -> ActivityScreen(state)
                    else -> AccountScreen(state)
                }
                is Page.PuzzleDetail -> PuzzleDetailScreen(state, page.puzzle)
                is Page.PuzzleLoader -> PuzzleLoaderScreen(state, page.id)
                is Page.DailyDetail -> DailyDetailScreen(state, page.daily)
                is Page.Investigation -> InvestigationScreen(state, page.id)
                is Page.Author -> AuthorScreen(state, page.handle)
                is Page.OwnSoup -> OwnSoupScreen(page.item)
                Page.Search -> SearchScreen(state)
                Page.Login -> LoginScreen(state)
                Page.Compose -> ComposeScreen(state)
                Page.MySoups -> MySoupsScreen(state)
                Page.Guide -> GuideScreen()
            }
        }
    }
}

@Composable private fun AppTopBar(state: AppState, page: Page?) {
    Column(Modifier.statusBarsPadding().background(paperColor())) {
        Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (page != null) {
                IconButton(onClick = state::back) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回", tint = inkColor())
                }
            } else if (state.tab == 0) {
                IconButton(onClick = { state.open(Page.Search) }) {
                    Icon(Icons.Outlined.Search, contentDescription = "搜索汤面", tint = inkColor())
                }
            } else Spacer(Modifier.width(48.dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                Prose(when (page) {
                    null -> listOf("汤友广场", "每日官汤", "动态", "我的")[state.tab]
                    is Page.PuzzleDetail -> "这碗汤"
                    is Page.PuzzleLoader -> "这碗汤"
                    is Page.DailyDetail -> "官方案卷"
                    is Page.Investigation -> "推理中"
                    is Page.Author -> "汤友主页"
                    is Page.OwnSoup -> "我的私藏"
                    Page.Search -> "找一碗汤"
                    Page.Login -> "邮箱登录"
                    Page.Compose -> "写一碗汤"
                    Page.MySoups -> "我熬的汤"
                    Page.Guide -> "调查员手册"
                }, size = 15)
            }
            if (page == null && state.tab == 0) {
                IconButton(onClick = { if (state.user == null) state.open(Page.Login) else state.open(Page.Compose) }) {
                    Icon(Icons.Outlined.Edit, contentDescription = "写汤", tint = redColor())
                }
            } else Spacer(Modifier.width(48.dp))
        }
        Rule()
    }
}

@Composable private fun AppTabs(state: AppState) {
    Column(Modifier.background(sheetColor())) {
        Rule()
        Row(Modifier.fillMaxWidth().navigationBarsPadding().height(62.dp),
            horizontalArrangement = Arrangement.SpaceEvenly) {
            val tabs: List<Triple<String, ImageVector, Int>> = listOf(
                Triple("广场", Icons.Outlined.People, 0),
                Triple("每日", Icons.Outlined.DateRange, 1),
                Triple("动态", Icons.Outlined.ChatBubbleOutline, 2),
                Triple("我的", Icons.Outlined.PersonOutline, 3),
            )
            tabs.forEach { (label, icon, index) ->
                Column(Modifier.weight(1f).fillMaxHeight().clickable { state.selectTab(index) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center) {
                    Box {
                        Icon(icon, contentDescription = null, tint = if (state.tab == index) redColor() else mutedColor(),
                            modifier = Modifier.size(23.dp))
                        if (index == 2 && state.unread > 0) {
                            Box(Modifier.align(Alignment.TopEnd).offset(x = 5.dp, y = (-2).dp)
                                .size(7.dp).background(redColor()))
                        }
                    }
                    Mono(label, size = 10, color = if (state.tab == index) redColor() else mutedColor())
                }
            }
        }
    }
}

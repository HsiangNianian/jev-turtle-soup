package games.mmstudio.turtlesoup

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class RoomRuntimeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun nativeTableUsesAuthenticatedSocketsAndSharedArchive(): Unit = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        val alice = args.getString("alice").orEmpty(); val bob = args.getString("bob").orEmpty()
        assumeTrue("Start the isolated rooms preview and pass fixture sessions", alice.isNotBlank() && bob.isNotBlank())
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val markCase = java.util.UUID.randomUUID().toString()
        withContext(Dispatchers.Main) {
            val marks = LocalQuestionMarks(context, "alice", "solo", markCase)
            marks.toggle("q1", "useful")
            val restored = LocalQuestionMarks(context, "alice", "solo", markCase)
            assertEquals("useful", restored.values["q1"])
            for ((owner, kind, id) in listOf(Triple("bob", "solo", markCase), Triple(null, "solo", markCase), Triple("alice", "room", markCase), Triple("alice", "solo", "other-$markCase"))) {
                assertTrue(LocalQuestionMarks(context, owner, kind, id).values.isEmpty())
            }
            restored.toggle("q2", "not-useful")
            marks.toggle("q1", "useful")
            assertEquals(mapOf("q2" to "not-useful"), marks.values)
            marks.filter = "not-useful"
            assertTrue(marks.includes("q2")); assertFalse(marks.includes("q1")); assertFalse(marks.includes(null))
            marks.toggle("q2", "not-useful")
        }
        val a = SoupApi(context,"http://127.0.0.1:8799","ts_session=$alice")
        val b = SoupApi(context,"http://127.0.0.1:8799","ts_session=$bob")
        assertEquals("ABCDEFGH2345",tableInvitationCode("abcd efgh-2345"))
        assertNull(tableInvitationCode("https://evil.test/rooms/join?code=ABCDEFGH2345"))
        assertNull(tableInvitationCode("https://user@hgt.mmstudio.games/rooms/join?code=ABCDEFGH2345"))
        val room=a.request("/api/rooms","POST",JSONObject().put("puzzleId","room-preview-puzzle").put("requestId",java.util.UUID.randomUUID().toString()))
        val id=room.str("roomId")
        b.request("/api/rooms/join","POST",JSONObject().put("code",room.str("inviteCode")))
        val guest=withContext(Dispatchers.Main) {TableStore(context,"bob",id,b).also {it.start()}}
        try {
            val state=withContext(Dispatchers.Main) {AppState(context,a).also {it.user=User("alice","alice@example.test","阿简","alice");it.open(Page.Table(id))}}
            compose.setContent {SoupTheme {AppShell(state)}}
            suspend fun until(check:()->Boolean) {withTimeout(20_000) {while(!withContext(Dispatchers.Main){check()}) delay(50)}}
            until {guest.online && guest.snapshot?.arr("members")?.objects()?.count {it.isNull("disconnectedAt")}==2}
            compose.onNodeWithText("开始同桌").performClick()
            until {guest.snapshot?.str("phase")=="playing"}
            compose.onNodeWithTag("tableSurface").performClick()
            compose.onNodeWithText("完成").performClick()
            compose.onNodeWithTag("tableRecipient").performClick()
            compose.onNodeWithTag("tableMode.ask").performClick()
            compose.onNode(hasSetTextAction()).performTextInput("A neighbor leaves the elevator?")
            compose.onNodeWithContentDescription("发送").performClick()
            until {guest.snapshot?.optInt("turns")==1}
            compose.onNodeWithText("是。").assertExists()
            compose.onNodeWithText("问答记录").performClick()
            compose.onNodeWithText("1 条").assertExists()
            compose.onNode(hasContentDescription("是") and hasAnyAncestor(hasTestTag("tableSheet.问答记录"))).assertExists()
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().also { image ->
                File(context.getExternalFilesDir(null),"rooms-native-ledger.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
            }
            compose.onNodeWithText("完成").performClick()
            val recorded = withContext(Dispatchers.Main) { tableLedger(guest.events) }
            assertEquals("A neighbor leaves the elevator?", recorded.single().question)
            assertEquals(TableVerdict.YES, recorded.single().verdict)

            compose.onNodeWithTag("tableRecipient").performClick()
            compose.onNodeWithTag("tableMode.discuss").performClick()
            compose.onNodeWithText("是。").assertExists()
            compose.onNode(hasSetTextAction()).performTextInput("A shared clue from Android")
            compose.onNodeWithContentDescription("发送").performClick()
            until {guest.events.any {it.str("text")=="A shared clue from Android"}}
            compose.onNodeWithTag("tableRecipient").performClick()
            compose.onNodeWithTag("tableMode.ask").performClick()
            compose.onNodeWithText("A shared clue from Android").assertExists()
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().also { image ->
                File(context.getExternalFilesDir(null),"rooms-native-answer.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
            }
            withContext(Dispatchers.Main) {guest.send(tableCommand("discuss","text" to "Android discussion"));guest.resume()}
            until {guest.online && guest.events.any {it.str("text")=="Android discussion"}}
            assertEquals(1,withContext(Dispatchers.Main) {guest.events.count{it.str("type")=="answer"}})
            withContext(Dispatchers.Main) { guest.send(tableCommand("leave")) }
            until { guest.archived && !guest.online && guest.pendingCount == 0 }
            withContext(Dispatchers.Main) { guest.resume() }
            compose.onNodeWithTag("tableRecipient").performClick()
            compose.onNodeWithTag("tableMode.discuss").performClick()
            compose.onNode(hasSetTextAction()).performTextInput("Android archive refresh")
            compose.onNodeWithContentDescription("发送").performClick()
            compose.waitUntil(5000) { compose.onAllNodesWithText("Android archive refresh").fetchSemanticsNodes().isNotEmpty() }
            assertFalse(withContext(Dispatchers.Main) { guest.events.any { it.str("text") == "Android archive refresh" } })
            withContext(Dispatchers.Main) { guest.refresh() }
            until { guest.archived && guest.events.any { it.str("text") == "Android archive refresh" } }
            b.request("/api/rooms/join", "POST", JSONObject().put("code", room.str("inviteCode")))
            withContext(Dispatchers.Main) { guest.refresh() }
            until { guest.online && !guest.archived }
            compose.onNodeWithTag("tableRecipient").performClick()
            compose.onNodeWithTag("tableMode.ask").performClick()
            compose.onNodeWithText("提议揭晓").performClick()
            until {guest.snapshot?.optJSONObject("vote") != null}
            withContext(Dispatchers.Main) {guest.send(tableCommand("vote","voteId" to guest.snapshot!!.obj("vote").str("id"),"agree" to true))}
            until {guest.snapshot?.str("phase")=="revealed" && guest.archived && !guest.online}
            compose.onNodeWithText("共同揭晓").assertExists()
            assertTrue(withContext(Dispatchers.Main){guest.snapshot!!.obj("report").str("truth").isNotBlank()})
            val archive = withContext(Dispatchers.Main) { TableStore(context, "bob", id, b).also { it.start() } }
            try { until { archive.archived && !archive.online && archive.snapshot!!.obj("report").str("truth").isNotBlank() } }
            finally { withContext(Dispatchers.Main) { archive.stop() } }

            // The same paired UI is used for solo play, with an independent local mark scope.
            val puzzle = Puzzle.from(a.request("/api/library/puzzles/room-preview-puzzle"))
            withContext(Dispatchers.Main) { state.start(puzzle) }
            compose.onNode(hasSetTextAction()).performTextInput("Someone left the elevator for her?")
            compose.onNodeWithContentDescription("发送问题").performClick()
            until { state.game((state.stack.last() as Page.Investigation).id)?.turnCount == 1 }
            compose.onNodeWithContentDescription("有用").performClick()
            compose.onNodeWithContentDescription("有用").assertIsSelected()
            compose.onNodeWithContentDescription("筛选我的标记").performClick()
            compose.onNodeWithText("只看有用").performClick()
            compose.onNodeWithText("Someone left the elevator for her?").assertExists()
            compose.onNodeWithContentDescription("有用").performClick()
            compose.onNodeWithText("查看全部记录").performClick()
            compose.onNodeWithText("Someone left the elevator for her?").assertExists()
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().also { image ->
                File(context.getExternalFilesDir(null),"play-solo.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
            }
        } finally {withContext(Dispatchers.Main){guest.stop()}}
    }
}

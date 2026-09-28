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
    @Test fun nativeTableUsesAuthenticatedSocketsAndSharedArchive() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        val alice = args.getString("alice").orEmpty(); val bob = args.getString("bob").orEmpty()
        assumeTrue("Start the isolated rooms preview and pass fixture sessions", alice.isNotBlank() && bob.isNotBlank())
        val context = InstrumentationRegistry.getInstrumentation().targetContext
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
            compose.onNodeWithTag("tableMode.ask").performClick()
            compose.onNode(hasSetTextAction()).performTextInput("A neighbor leaves the elevator?")
            compose.onNodeWithContentDescription("发送").performClick()
            until {guest.snapshot?.optInt("turns")==1}
            compose.onNodeWithText("是。").assertExists()
            compose.onNodeWithTag("tableMode.discuss").performClick()
            compose.onNodeWithText("是。").assertExists()
            compose.onNode(hasSetTextAction()).performTextInput("A shared clue from Android")
            compose.onNodeWithContentDescription("发送").performClick()
            until {guest.events.any {it.str("text")=="A shared clue from Android"}}
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
        } finally {withContext(Dispatchers.Main){guest.stop()}}
    }
}

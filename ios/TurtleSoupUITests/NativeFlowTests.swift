import XCTest

@MainActor
final class NativeFlowTests: XCTestCase {
  func testACommunityAndInvestigationOnPublicAPI() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments.append("--internal-qa")
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["广场"].waitForExistence(timeout: 15))
    XCTAssertEqual(app.webViews.count, 0)
    for tab in ["广场", "每日", "动态", "我的"] { XCTAssertTrue(app.tabBars.buttons[tab].exists) }
    let firstPuzzle = app.buttons.matching(
      NSPredicate(format: "identifier BEGINSWITH 'puzzleRow.'")
    ).firstMatch
    XCTAssertTrue(firstPuzzle.waitForExistence(timeout: 45))
    capture("01-community-live")
    firstPuzzle.tap()
    XCTAssertTrue(app.buttons["startLibrary"].waitForExistence(timeout: 5))
    capture("02-puzzle-live")
    let discussion = app.buttons["showDiscussion"]
    reveal(discussion, in: app)
    discussion.tap()
    let join = app.buttons["joinDiscussion"]
    reveal(join, in: app)
    XCTAssertTrue(join.exists)
    capture("03-discussion-live")
    join.tap()
    XCTAssertTrue(app.textFields["emailInput"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.webViews.count, 0)
    app.buttons["取消"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let author = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'author.'"))
      .firstMatch
    XCTAssertTrue(author.waitForExistence(timeout: 5))
    author.tap()
    XCTAssertTrue(app.staticTexts["TA 熬的汤"].waitForExistence(timeout: 30))
    capture("04-author-live")

    app.tabBars.buttons["动态"].tap()
    XCTAssertTrue(app.buttons["activityLogin"].waitForExistence(timeout: 5))
    capture("05-activity-guest")
    app.tabBars.buttons["我的"].tap()
    XCTAssertTrue(app.buttons["emailLogin"].waitForExistence(timeout: 5))
    capture("06-account")
    app.buttons["emailLogin"].tap()
    XCTAssertTrue(app.textFields["emailInput"].waitForExistence(timeout: 5))
    capture("07-login")
    app.buttons["取消"].tap()

    app.tabBars.buttons["每日"].tap()
    XCTAssertTrue(app.buttons["startDaily"].waitForExistence(timeout: 30))
    XCTAssertFalse(app.staticTexts["已取消"].exists)
    capture("08-daily")
    reveal(app.buttons["startDaily"], in: app)
    app.buttons["startDaily"].tap()
    let question = app.descendants(matching: .any).matching(identifier: "questionInput").firstMatch
    XCTAssertTrue(question.waitForExistence(timeout: 5))
    XCTAssertEqual(app.webViews.count, 0)
    question.tap()
    question.typeText("Does she leave at the same time every day?")
    XCTAssertTrue(app.buttons["sendQuestion"].isEnabled)
    XCTAssertTrue(app.buttons["sendQuestion"].isHittable)
    capture("09-investigation-keyboard")
    // Public API tests never send questions, likes, comments or publications.
    app.buttons["收起推理"].tap()
    app.terminate()
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["每日"].waitForExistence(timeout: 10))
    app.tabBars.buttons["每日"].tap()
    XCTAssertTrue(app.buttons["startDaily"].waitForExistence(timeout: 30))
    XCTAssertTrue(app.buttons["startDaily"].label.contains("继续调查"))
  }

  func testBWritingAndSocialActionsWithoutNetwork() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchEnvironment["NATIVE_UI_FIXTURE"] = "community"
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout: 15))
    app.tabBars.buttons["我的"].tap()
    XCTAssertTrue(app.buttons["mySoups"].waitForExistence(timeout: 15))
    app.tabBars.buttons["广场"].tap()
    XCTAssertTrue(app.staticTexts["编者按：第四封信，让一扇窗有了答案。"].waitForExistence(timeout: 15))
    app.buttons["writeSoup"].tap()
    let title = app.descendants(matching: .any).matching(identifier: "soupTitle").firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    capture("10-composer-fixture")
    title.tap()
    title.typeText("Midnight Note")
    app.buttons["收起键盘"].tap()
    app.buttons["收起"].tap()
    app.buttons["writeSoup"].tap()
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertTrue(
      String(describing: title.value).contains("Midnight Note"),
      "Draft survives closing the composer")
    let surface = app.descendants(matching: .any).matching(identifier: "soupSurface").firstMatch
    reveal(surface, in: app)
    surface.tap()
    surface.typeText("A letter arrives every night. On day four, she closes the window.")
    app.buttons["收起键盘"].tap()
    let truth = app.descendants(matching: .any).matching(identifier: "soupTruth").firstMatch
    reveal(truth, in: app)
    truth.tap()
    truth.typeText("The letters were carried by the wind from her own desk.")
    app.buttons["收起键盘"].tap()
    reveal(app.buttons["publishSoup"], in: app)
    capture("11-composer-ready-fixture")
    app.buttons["publishSoup"].tap()
    app.buttons["确认发布"].tap()
    XCTAssertTrue(app.buttons["publishDone"].waitForExistence(timeout: 10))
    capture("12-published-fixture")
    app.buttons["publishDone"].tap()
    app.tabBars.buttons["我的"].tap()
    app.buttons["mySoups"].tap()
    XCTAssertTrue(app.staticTexts["Midnight Note"].waitForExistence(timeout: 5))
    capture("13-my-soups-fixture")

    app.tabBars.buttons["广场"].tap()
    let like = app.buttons["赞这碗汤"].firstMatch
    reveal(like, in: app)
    XCTAssertTrue(like.isEnabled)
    like.tap()
    XCTAssertTrue(app.buttons["取消赞"].waitForExistence(timeout: 5))
    app.buttons["puzzleRow.fixture-puzzle"].tap()
    reveal(app.buttons["showDiscussion"], in: app)
    app.buttons["showDiscussion"].tap()
    let comment = app.descendants(matching: .any).matching(identifier: "commentInput").firstMatch
    reveal(comment, in: app)
    comment.tap()
    comment.typeText("Is the window the key to the story?")
    // Scroll to dismiss the keyboard and expose the explicit send control.
    app.swipeUp()
    reveal(app.buttons["postComment"], in: app)
    app.buttons["postComment"].tap()
    XCTAssertTrue(
      app.staticTexts["Is the window the key to the story?"].waitForExistence(timeout: 5))
    capture("14-discussion-fixture")
    let menu = app.buttons["留言操作"].firstMatch
    reveal(menu, in: app)
    menu.tap()
    app.buttons["删除留言"].tap()
    app.buttons["删除留言"].tap()
    XCTAssertTrue(app.staticTexts["还没有留言。聊聊你发现的细节？"].waitForExistence(timeout: 5))
    app.tabBars.buttons["动态"].tap()
    XCTAssertTrue(app.buttons["activityEvent.0"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["activityEvent.0"].label.contains("小满"))
    capture("15-activity-fixture")
    app.buttons["activityEvent.0"].tap()
    XCTAssertTrue(app.buttons["startLibrary"].waitForExistence(timeout: 5))
    app.buttons["startLibrary"].tap()
    XCTAssertTrue(app.buttons["案件操作"].waitForExistence(timeout: 5))
    app.buttons["案件操作"].tap()
    app.buttons["汤友讨论 · 可能含汤底"].tap()
    XCTAssertTrue(app.buttons["继续推理"].waitForExistence(timeout: 5))
    capture("16-discussion-from-investigation-fixture")
    app.buttons["继续推理"].tap()
    app.buttons["收起推理"].tap()
    XCTAssertEqual(app.webViews.count, 0)
  }

  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    for _ in 0..<7 {
      if element.isHittable { return }
      app.swipeUp()
    }
    XCTAssertTrue(element.isHittable, "Expected control should be reachable by scrolling")
  }
  private func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

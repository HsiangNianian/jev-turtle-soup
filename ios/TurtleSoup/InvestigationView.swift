import SwiftUI

struct InvestigationScreen: View {
  let caseID: String
  @EnvironmentObject private var store: SoupStore
  @Environment(\.dismiss) private var dismiss
  @State private var draft = ""
  @State private var showSurface = true
  @State private var showLedger = false
  @State private var showDiscussion = false
  @State private var confirmReveal = false
  @State private var confirmAbandon = false
  @State private var error: String?
  @FocusState private var composing: Bool
  private var game: CaseFile? { store.games.first { $0.id == caseID } }
  private var asking: Bool { store.pending.contains(caseID) }
  private var discussionTarget: SocialTarget? {
    guard let game, game.source == "library" || (game.dailyDate != nil && !game.isLocked) else {
      return nil
    }
    return SocialTarget(kind: .puzzle, id: game.libraryId ?? game.id)
  }

  var body: some View {
    Group {
      if let game {
        ScrollViewReader { reader in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
              VStack(alignment: .leading, spacing: 16) {
                HStack {
                  Text("案号 \(String(game.id.prefix(8)).uppercased())").font(
                    SoupFont.mono(10)
                  ).foregroundStyle(SoupTheme.muted)
                  Spacer()
                  Stamp(text: game.statusLabel)
                }
                PaperRule(strong: true)
                Text(game.title).font(SoupFont.serif(26, weight: .semibold, relativeTo: .title))
                DisclosureGroup("汤面", isExpanded: $showSurface) {
                  Text(game.surface).font(SoupFont.prose).lineSpacing(9)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 12)
                    .textSelection(.enabled)
                }.font(SoupFont.mono(11))
                HStack {
                  Text("已问 \(game.turnCount) 轮")
                  Spacer()
                  if let score = game.closeness { Text("接近真相 \(Int(score))%") }
                }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
                if let score = game.closeness {
                  ProgressView(value: min(max(score, 0), 100), total: 100).tint(SoupTheme.red)
                }
              }
              .padding(.bottom, 4)

              SectionCaption(title: "问询笔录", detail: "主持人 · 砚")

              ForEach(game.messages) { message in
                MessageRow(message: message)
              }
              if asking {
                HStack(spacing: 10) {
                  ProgressView()
                  Text("砚正在核对线索…").font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
                }
                .padding(.vertical, 8).accessibilityIdentifier("hostThinking")
              }
              if game.messages.last?.tone == "error", !asking,
                let last = game.messages.dropLast().last, last.role == "player"
              {
                Button {
                  Task { await store.ask(caseID: caseID, text: last.text, retry: true) }
                } label: {
                  Label("重新发送刚才的问题", systemImage: "arrow.clockwise")
                }.font(SoupFont.prose)
              }
              if game.isFinished {
                report(game)
                if discussionTarget != nil {
                  InkButton(title: "和汤友聊聊", icon: "text.bubble") { showDiscussion = true }
                }
              }
              Color.clear.frame(height: 1).id("bottom")
            }.padding(.horizontal, 20).padding(.vertical, 20)
          }
          .scrollDismissesKeyboard(.interactively)
          .onChange(of: game.messages.count) { _, _ in
            withAnimation(.easeOut(duration: 0.2)) { reader.scrollTo("bottom", anchor: .bottom) }
          }
          .onChange(of: asking) { _, _ in
            withAnimation(.easeOut(duration: 0.2)) { reader.scrollTo("bottom", anchor: .bottom) }
          }
          .safeAreaInset(edge: .bottom, spacing: 0) {
            if !game.isFinished { composer }
          }
        }
      } else {
        ContentUnavailableView("这份案卷暂不可用", systemImage: "folder")
      }
    }
    .background { PaperBackground() }.foregroundStyle(SoupTheme.ink)
    .navigationBarTitleDisplayMode(.inline)
    .navigationTitle("与砚推理")
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button {
          dismiss()
        } label: {
          Image(systemName: "chevron.down")
        }
        .accessibilityLabel("收起推理")
      }
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button("线索笔记", systemImage: "list.bullet.clipboard") { showLedger = true }
          if discussionTarget != nil {
            Button("汤友讨论 · 可能含汤底", systemImage: "text.bubble") { showDiscussion = true }
          }
          if let game {
            if let url = game.shareURL {
              ShareLink(item: url) { Label("分享案件", systemImage: "square.and.arrow.up") }
            }
            if !game.isFinished {
              Button("请求提示", systemImage: "lightbulb") {
                Task { await store.ask(caseID: caseID, text: "请给我一点提示") }
              }.disabled(asking)
              Button(game.isLocked ? "今日汤底尚未解锁" : "揭晓汤底", systemImage: "lock.open") {
                confirmReveal = true
              }.disabled(asking || game.isLocked)
              Button("中止本案", systemImage: "archivebox", role: .destructive) {
                confirmAbandon = true
              }.disabled(asking)
            }
          }
        } label: {
          Image(systemName: "ellipsis")
        }.accessibilityLabel("案件操作")
      }
    }
    .confirmationDialog("揭晓后，本案将结束推理。", isPresented: $confirmReveal, titleVisibility: .visible) {
      Button("揭晓汤底", role: .destructive) { Task { await reveal() } }
    }
    .confirmationDialog(
      "中止后，本案会移入已归档，已有问答仍会保留。", isPresented: $confirmAbandon, titleVisibility: .visible
    ) {
      Button("中止并归档", role: .destructive) { store.abandon(caseID: caseID) }
    }
    .alert("暂时无法揭晓", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
      Button("好", role: .cancel) { error = nil }
    } message: {
      Text(error ?? "")
    }
    .sheet(isPresented: $showLedger) { NavigationStack { ledger }.tint(SoupTheme.ink) }
    .sheet(isPresented: $showDiscussion) {
      NavigationStack {
        PaperPage {
          if let discussionTarget { SocialPanel(target: discussionTarget, expanded: true) }
        }.navigationTitle("汤友讨论")
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button("继续推理") { showDiscussion = false }
            }
          }
      }.tint(SoupTheme.ink)
    }
  }

  private var composer: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .bottom, spacing: 0) {
        TextField(
          "试着问一个是非问题…", text: $draft,
          prompt: Text("试着问一个是非问题…").foregroundStyle(SoupTheme.muted), axis: .vertical
        )
        .lineLimit(1...5).focused($composing).font(SoupFont.prose)
        .padding(.horizontal, 12).padding(.vertical, 14)
        .accessibilityIdentifier("questionInput")
        Button {
          let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
          draft = ""
          composing = false
          Task { await store.ask(caseID: caseID, text: text) }
        } label: {
          Image(systemName: "arrow.up").font(.system(size: 19, weight: .regular))
            .frame(width: 48, height: 50).foregroundStyle(SoupTheme.paper)
            .background(SoupTheme.ink)
        }
        .disabled(
          asking || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || draft.utf16.count > 600
        )
        .opacity(asking || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
        .accessibilityLabel("发送问题").accessibilityIdentifier("sendQuestion")
      }.background(SoupTheme.sheet).overlay(Rectangle().stroke(SoupTheme.line, lineWidth: 0.75))
      if draft.utf16.count > 500 {
        Text("\(draft.utf16.count) / 600 字").font(SoupFont.mono(10)).foregroundStyle(
          draft.utf16.count > 600 ? SoupTheme.red : SoupTheme.muted)
      }
    }
    .padding(.horizontal, 16).padding(.vertical, 12)
    .background(SoupTheme.paper).overlay(alignment: .top) {
      Rectangle().fill(SoupTheme.line).frame(height: 0.5)
    }
  }

  @ViewBuilder private func report(_ game: CaseFile) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      SectionCaption(title: game.solved ? "结案报告" : "案卷记录", detail: game.statusLabel)
      if game.solved {
        Label("真相已被你还原", systemImage: "checkmark.seal").font(
          SoupFont.serif(20, relativeTo: .title3)
        )
        .foregroundStyle(SoupTheme.red)
      }
      if let truth = game.truth {
        Text(truth).font(SoupFont.body).lineSpacing(8).textSelection(.enabled)
      } else if game.isLocked {
        Label("今日官汤的汤底明日公开", systemImage: "lock").font(SoupFont.prose).foregroundStyle(
          SoupTheme.muted)
      } else {
        Button("读取汤底") { Task { await reveal() } }.disabled(asking)
      }
      Button("回到调查局") { dismiss() }.font(SoupFont.mono(12))
    }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(SoupTheme.sheet)
  }

  private var ledger: some View {
    PaperPage {
      Text("把确定的，留在纸上。").font(SoupFont.serif(24, relativeTo: .title2))
      if let messages = game?.messages {
        ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
          if let label = message.verdictLabel, index > 0, messages[index - 1].role == "player" {
            VStack(alignment: .leading, spacing: 12) {
              Stamp(text: label)
              Text(messages[index - 1].text).font(SoupFont.body)
              Divider()
            }
          }
        }
        if !messages.contains(where: { $0.verdictLabel != nil }) {
          ContentUnavailableView(
            "还没有已确认的线索", systemImage: "pencil.and.list.clipboard",
            description: Text("向砚提问后，关键判断会自动记在这里。"))
        }
      }
    }.navigationTitle("线索笔记").toolbar {
      ToolbarItem(placement: .confirmationAction) { Button("完成") { showLedger = false } }
    }
  }

  private func reveal() async {
    do { try await store.reveal(caseID: caseID) } catch { self.error = error.localizedDescription }
  }
}

private struct MessageRow: View {
  let message: SoupMessage
  private var verdictColor: Color {
    switch message.verdict {
    case "yes": SoupTheme.green
    case "partly": SoupTheme.amber
    case "irrelevant": SoupTheme.muted
    default: SoupTheme.red
    }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 8) {
        Text(message.role == "player" ? "你 · 提问" : "砚 · ELLIS").tracking(2)
          .foregroundStyle(message.role == "player" ? SoupTheme.muted : SoupTheme.red)
        Spacer()
        if let verdict = message.verdictLabel {
          Stamp(text: verdict, color: verdictColor)
        } else if message.tone == "celebrate" {
          Stamp(text: "破案", tilted: true, color: SoupTheme.green)
        }
      }.font(SoupFont.mono(10))
      Text(message.text).font(SoupFont.prose)
        .foregroundStyle(message.tone == "error" ? SoupTheme.red : SoupTheme.ink.opacity(0.86))
        .lineSpacing(8).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
      PaperRule(dashed: true).padding(.top, 4)
    }
  }
}

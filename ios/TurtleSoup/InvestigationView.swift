import SwiftUI

struct InvestigationScreen: View {
  let caseID: String
  @StateObject private var marks: LocalQuestionMarks
  @State private var verdictFilter: TableVerdict?
  @State private var jumpID: String?
  init(caseID: String, owner: String?) {
    self.caseID = caseID
    _marks = StateObject(wrappedValue: LocalQuestionMarks(owner: owner, kind: "solo", id: caseID))
  }
  @EnvironmentObject private var store: SoupStore
  @Environment(\.dismiss) private var dismiss
  @State private var draft = ""
  @State private var showSurface = false
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
        let entries = soloTranscript(game.messages)
        let visible = entries.filter { entry in
          marks.includes(entry.message.role == "player" ? entry.id : nil) &&
            (verdictFilter == nil || soloVerdict(entry.answer) == verdictFilter)
        }
        VStack(spacing: 0) {
          HStack(spacing: 8) {
            Button { showSurface = true } label: {
              HStack(spacing: 10) {
                Text("汤面").font(SoupFont.mono(10)).foregroundStyle(SoupTheme.red)
                Text(game.surface).font(SoupFont.mono(11)).lineLimit(1).foregroundStyle(SoupTheme.muted)
                Image(systemName: "chevron.right").font(.system(size: 10))
              }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }.accessibilityLabel("查看汤面")
            Button { showLedger = true } label: { Image(systemName: "list.bullet.clipboard").frame(width: 36, height: 44) }.accessibilityLabel("问答记录")
          }.padding(.horizontal, 16)
          PaperRule()
          QuestionFilterBar(marks: marks, verdicts: game.messages.compactMap(soloVerdict), selected: $verdictFilter)
          ScrollViewReader { reader in
            ScrollView {
              LazyVStack(alignment: .leading, spacing: 0) {
                if visible.isEmpty && (marks.filter != .all || verdictFilter != nil) {
                  Button("查看全部记录") { marks.filter = .all; verdictFilter = nil }
                    .font(SoupFont.mono(12)).frame(maxWidth: .infinity, minHeight: 60)
                }
                ForEach(visible) { entry in
                  if entry.message.role == "player" {
                    SoloQuestionRow(entry: entry, marks: marks, asking: asking && entry.answer == nil).id(entry.id)
                  } else { MessageRow(message: entry.message).padding(.horizontal, 12).padding(.vertical, 8) }
                }
                if game.messages.last?.tone == "error", !asking,
                  let last = game.messages.dropLast().last, last.role == "player" {
                  Button { Task { await store.ask(caseID: caseID, text: last.text, retry: true) } } label: {
                    Label("重新发送刚才的问题", systemImage: "arrow.clockwise")
                  }.font(SoupFont.prose).padding(16)
                }
                if game.isFinished && marks.filter == .all && verdictFilter == nil {
                  report(game).padding(16)
                  if discussionTarget != nil {
                    InkButton(title: "和汤友聊聊", icon: "text.bubble") { showDiscussion = true }.padding(16)
                  }
                }
                Color.clear.frame(height: 1).id("bottom")
              }
            }.scrollDismissesKeyboard(.interactively)
              .onChange(of: game.messages.count) { _, _ in
                if marks.filter == .all && verdictFilter == nil {
                  withAnimation(.easeOut(duration: 0.2)) { reader.scrollTo("bottom", anchor: .bottom) }
                }
              }
              .onChange(of: asking) { _, _ in
                if marks.filter == .all && verdictFilter == nil { reader.scrollTo("bottom", anchor: .bottom) }
              }
              .onChange(of: jumpID) { _, id in
                if let id { reader.scrollTo(id, anchor: .center); jumpID = nil }
              }
              .safeAreaInset(edge: .bottom, spacing: 0) { if !game.isFinished { composer } }
          }
        }
      } else {
        ContentUnavailableView("这份案卷暂不可用", systemImage: "folder")
      }
    }
    .background { PaperBackground() }.foregroundStyle(SoupTheme.ink)
    .navigationBarTitleDisplayMode(.inline)
    .navigationTitle(game?.title ?? "与砚推理")
    .toolbar {
      ToolbarItem(placement: .principal) {
        VStack(spacing: 3) {
          Text(game?.title ?? "与砚推理").font(SoupFont.serif(17)).lineLimit(1)
          Text("已问 \(game?.turnCount ?? 0) 轮 · 砚主持").font(SoupFont.mono(9)).foregroundStyle(SoupTheme.muted)
        }
      }
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
                marks.filter = .all
                verdictFilter = nil
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
    .sheet(isPresented: $showSurface) {
      NavigationStack {
        PaperPage {
          if let game {
            Text(game.title).font(SoupFont.title)
            Text(game.surface).font(SoupFont.body).lineSpacing(7).textSelection(.enabled)
            Text("\(game.difficulty) · 已问 \(game.turnCount) 轮").font(SoupFont.mono(11)).foregroundStyle(SoupTheme.muted)
          }
        }.navigationTitle("汤面").navigationBarTitleDisplayMode(.inline)
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showSurface = false } } }
      }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
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
        .padding(.horizontal, 12).padding(.vertical, 10)
        .accessibilityIdentifier("questionInput")
        Button {
          let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
          draft = ""
          marks.filter = .all
          verdictFilter = nil
          composing = false
          Task { await store.ask(caseID: caseID, text: text) }
        } label: {
          Image(systemName: "arrow.up").font(.system(size: 19, weight: .regular))
            .frame(width: 44, height: 44).foregroundStyle(SoupTheme.paper)
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
    .padding(.horizontal, 12).padding(.vertical, 8)
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
      if let game {
        ForEach(soloTranscript(game.messages).filter { $0.answer != nil && $0.number != nil }) { entry in
          Button {
            marks.filter = .all; verdictFilter = nil; showLedger = false; jumpID = entry.id
          } label: {
            HStack(alignment: .top, spacing: 12) {
              if let verdict = soloVerdict(entry.answer) { TableVerdictStamp(verdict: verdict) }
              Text(entry.message.text).font(SoupFont.prose).frame(maxWidth: .infinity, alignment: .leading)
              if marks.values[entry.id] == "useful" { Image(systemName: "bookmark.fill").font(.system(size: 11)).foregroundStyle(SoupTheme.red) }
            }.padding(.vertical, 5)
          }
          PaperRule()
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

private struct SoloQuestionRow: View {
  let entry: SoloTranscriptEntry
  @ObservedObject var marks: LocalQuestionMarks
  let asking: Bool
  var body: some View {
    HStack(alignment: .top, spacing: 9) {
      VStack(spacing: 6) {
        Text(String(format: "%02d", entry.number ?? 0))
        Text("你")
      }.font(SoupFont.mono(9)).foregroundStyle(SoupTheme.muted).frame(width: 23).padding(.top, 5)
      VStack(alignment: .leading, spacing: 7) {
        Text(entry.message.text).font(SoupFont.prose).lineSpacing(4).textSelection(.enabled)
        if let answer = entry.answer {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let verdict = soloVerdict(answer) { TableVerdictStamp(verdict: verdict) }
            Text(answer.text).font(SoupFont.serif(14)).foregroundStyle(answer.tone == "error" ? SoupTheme.red : SoupTheme.muted).lineSpacing(4).textSelection(.enabled)
          }
        } else if asking {
          HStack(spacing: 8) { ProgressView().controlSize(.mini); Text("砚正在核对线索…").font(SoupFont.mono(10)) }
            .foregroundStyle(SoupTheme.muted).accessibilityIdentifier("hostThinking")
        }
      }.frame(maxWidth: .infinity, alignment: .leading)
      QuestionMarkControls(marks: marks, id: entry.id).padding(.top, -5)
    }.padding(.leading, 15).padding(.trailing, 10).padding(.vertical, 10)
      .overlay(alignment: .bottom) { PaperRule() }
      .overlay(alignment: .leading) { if marks.values[entry.id] == "useful" { Rectangle().fill(SoupTheme.red).frame(width: 2) } }
  }
}

private struct MessageRow: View {
  let message: SoupMessage
  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Text("砚").font(SoupFont.mono(10)).foregroundStyle(SoupTheme.red)
      Text(message.text).font(SoupFont.serif(14)).lineSpacing(4).textSelection(.enabled)
        .foregroundStyle(message.tone == "error" ? SoupTheme.red : SoupTheme.muted)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

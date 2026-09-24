import SwiftUI

// Keep these tokens aligned with src/index.css. The Chinese serif must be bundled:
// the system's .serif design falls back to a sans face for Chinese characters.
enum SoupTheme {
  static func adaptive(_ light: UInt32, _ dark: UInt32, alpha: CGFloat = 1) -> UIColor {
    UIColor { traits in
      let value = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(
        red: CGFloat((value >> 16) & 255) / 255,
        green: CGFloat((value >> 8) & 255) / 255,
        blue: CGFloat(value & 255) / 255, alpha: alpha)
    }
  }

  static let paper = Color(adaptive(0xF2EFE6, 0x14130F))
  static let sheet = Color(adaptive(0xF8F6EE, 0x1B1915))
  static let ink = Color(adaptive(0x17150F, 0xECE7DB))
  static let muted = Color(adaptive(0x8C8677, 0x9A9384))
  static let red = Color(adaptive(0xB5342A, 0xE0736A))
  static let green = Color(adaptive(0x2F6B4F, 0x7FB98F))
  static let amber = Color(adaptive(0xA8791F, 0xD8AE62))
  static let line = ink.opacity(0.22)

  @MainActor static func configureChrome() {
    #if DEBUG
      for name in ["NotoSerifSC-Regular", "NotoSerifSC-SemiBold", "JetBrainsMono-Regular"] {
        assert(UIFont(name: name, size: 16) != nil, "Missing bundled brand font: \(name)")
      }
    #endif
    let navigation = UINavigationBarAppearance()
    navigation.configureWithOpaqueBackground()
    navigation.backgroundColor = adaptive(0xF2EFE6, 0x14130F)
    navigation.shadowColor = adaptive(0x17150F, 0xECE7DB, alpha: 0.18)
    navigation.titleTextAttributes = [
      .font: UIFont(name: "NotoSerifSC-Regular", size: 15)!,
      .foregroundColor: adaptive(0x17150F, 0xECE7DB), .kern: 2,
    ]
    UINavigationBar.appearance().standardAppearance = navigation
    UINavigationBar.appearance().scrollEdgeAppearance = navigation
    UINavigationBar.appearance().compactAppearance = navigation

    let tabs = UITabBarAppearance()
    tabs.configureWithOpaqueBackground()
    tabs.backgroundColor = adaptive(0xF2EFE6, 0x14130F)
    for item in [
      tabs.stackedLayoutAppearance, tabs.inlineLayoutAppearance, tabs.compactInlineLayoutAppearance,
    ] {
      item.normal.iconColor = adaptive(0x8C8677, 0x9A9384)
      item.selected.iconColor = adaptive(0xB5342A, 0xE0736A)
      item.normal.titleTextAttributes = [
        .font: UIFont(name: "NotoSerifSC-Regular", size: 10)!,
        .foregroundColor: adaptive(0x8C8677, 0x9A9384),
      ]
      item.selected.titleTextAttributes = [
        .font: UIFont(name: "NotoSerifSC-SemiBold", size: 10)!,
        .foregroundColor: adaptive(0xB5342A, 0xE0736A),
      ]
    }
    UITabBar.appearance().standardAppearance = tabs
    UITabBar.appearance().scrollEdgeAppearance = tabs
  }
}

enum SoupFont {
  static func serif(
    _ size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body
  ) -> Font {
    .custom(
      weight == .regular ? "NotoSerifSC-Regular" : "NotoSerifSC-SemiBold", size: size,
      relativeTo: style)
  }
  static func mono(_ size: CGFloat = 11) -> Font {
    .custom("JetBrainsMono-Regular", size: size, relativeTo: .caption)
  }
  static let body = serif(16)
  static let prose = serif(15)
  static let title = serif(28, weight: .semibold, relativeTo: .title)
}

struct PaperBackground: View {
  var body: some View {
    SoupTheme.paper.overlay {
      Canvas(rendersAsynchronously: true) { context, size in
        // Quiet, deterministic paper grain, drawn natively and with no bitmap dependency.
        for row in 0..<Int(size.height / 5) {
          for column in 0..<Int(size.width / 5) {
            let seed = (row &* 73_856_093) ^ (column &* 19_349_663)
            let x = CGFloat(column * 5) + CGFloat(seed % 17) / 4
            let y = CGFloat(row * 5) + CGFloat(seed % 13) / 3
            context.fill(
              Path(ellipseIn: CGRect(x: x, y: y, width: 0.55, height: 0.55)),
              with: .color(SoupTheme.ink.opacity(0.055)))
          }
        }
      }.allowsHitTesting(false).accessibilityHidden(true)
    }.ignoresSafeArea()
  }
}

private struct HorizontalLine: Shape {
  func path(in rect: CGRect) -> Path {
    Path { path in
      path.move(to: CGPoint(x: 0, y: rect.midY))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
    }
  }
}

struct PaperRule: View {
  var strong = false
  var dashed = false
  var body: some View {
    HorizontalLine().stroke(
      strong ? SoupTheme.ink : SoupTheme.line,
      style: StrokeStyle(lineWidth: strong ? 1.25 : 0.75, dash: dashed ? [3, 3] : [])
    )
    .frame(height: strong ? 1.25 : 0.75).accessibilityHidden(true)
  }
}

struct PaperPage<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) { content }
        .frame(maxWidth: 620, alignment: .leading)
        .padding(.horizontal, 24).padding(.top, 28).padding(.bottom, 32)
        .frame(maxWidth: .infinity)
    }
    .font(SoupFont.body).foregroundStyle(SoupTheme.ink)
    .scrollDismissesKeyboard(.interactively)
    .background { PaperBackground() }
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct PageHeading: View {
  let eyebrow: String
  let title: String
  var subtitle: String? = nil
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(eyebrow).font(SoupFont.mono(10)).tracking(3).foregroundStyle(SoupTheme.muted)
      Text(title).font(SoupFont.serif(32, weight: .semibold, relativeTo: .largeTitle))
        .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
      PaperRule(strong: true).padding(.top, 5)
      if let subtitle {
        Text(subtitle).font(SoupFont.prose).lineSpacing(8)
          .foregroundStyle(SoupTheme.ink.opacity(0.76)).padding(.top, 4)
      }
    }
  }
}

struct SectionCaption: View {
  let title: String
  var detail: String? = nil
  var body: some View {
    VStack(spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        Text(title).tracking(2)
        Spacer()
        if let detail { Text(detail).monospacedDigit() }
      }.font(SoupFont.mono(10)).foregroundStyle(SoupTheme.muted)
      PaperRule()
    }
  }
}

struct Stamp: View {
  let text: String
  var icon: String? = nil
  var tilted = false
  var color: Color = SoupTheme.red
  var body: some View {
    HStack(spacing: 5) {
      if let icon { Image(systemName: icon).font(.system(size: 10, weight: .regular)) }
      Text(text).tracking(1.2)
    }
    .font(SoupFont.mono(10)).foregroundStyle(color)
    .padding(.horizontal, 7).padding(.vertical, 4)
    .overlay(Rectangle().stroke(color, lineWidth: tilted ? 1.5 : 0.75))
    .rotationEffect(.degrees(tilted ? -6 : 0)).fixedSize()
  }
}

struct InkButton: View {
  let title: String
  var icon = "arrow.right"
  var expanded = false
  var action: () -> Void
  var body: some View {
    Button(action: action) {
      HStack(spacing: 14) {
        Text(title).font(SoupFont.mono(12)).tracking(1.5)
        if expanded { Spacer() }
        Image(systemName: icon).font(.system(size: 15, weight: .regular))
      }
      .padding(.horizontal, 20).frame(minHeight: 46)
      .foregroundStyle(SoupTheme.paper).background(SoupTheme.ink)
    }.buttonStyle(InkPressStyle())
  }
}

private struct InkPressStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.opacity(!enabled ? 0.35 : configuration.isPressed ? 0.7 : 1)
  }
}

struct PaperFilters: View {
  let options: [(String, String)]
  @Binding var selection: String
  var body: some View {
    HStack(spacing: 0) {
      ForEach(options, id: \.0) { value, label in
        Button {
          selection = value
        } label: {
          Text(label).font(SoupFont.mono(11)).tracking(1.5)
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(selection == value ? SoupTheme.ink : SoupTheme.muted)
            .overlay(alignment: .bottom) {
              Rectangle().fill(selection == value ? SoupTheme.ink : SoupTheme.line)
                .frame(height: selection == value ? 2 : 0.75)
            }
        }.buttonStyle(.plain)
          .accessibilityAddTraits(selection == value ? .isSelected : [])
      }
    }
  }
}

struct ErrorNote: View {
  let message: String
  var retry: (() -> Void)? = nil
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(message).font(SoupFont.prose).lineSpacing(5)
      if let retry { Button("重新加载", action: retry).font(SoupFont.mono(12)) }
    }
    .foregroundStyle(SoupTheme.muted).padding(18).frame(maxWidth: .infinity, alignment: .leading)
    .background(SoupTheme.sheet).overlay(alignment: .leading) {
      Rectangle().fill(SoupTheme.line).frame(width: 2)
    }
  }
}

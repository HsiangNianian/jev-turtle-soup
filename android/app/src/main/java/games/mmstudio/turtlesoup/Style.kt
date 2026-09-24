package games.mmstudio.turtlesoup

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object Ink {
    val paperLight = Color(0xFFF2EFE6)
    val sheetLight = Color(0xFFF8F6EE)
    val inkLight = Color(0xFF17150F)
    val mutedLight = Color(0xFF8C8677)
    val redLight = Color(0xFFB5342A)
    val paperDark = Color(0xFF14130F)
    val sheetDark = Color(0xFF1B1915)
    val inkDark = Color(0xFFECE7DB)
    val mutedDark = Color(0xFF9A9384)
    val redDark = Color(0xFFE0736A)
    val serif = FontFamily(Font(R.font.noto_serif_sc_regular, FontWeight.Normal),
        Font(R.font.noto_serif_sc_semibold, FontWeight.SemiBold))
    val mono = FontFamily(Font(R.font.jetbrains_mono_regular))
}

@Composable fun inkColor() = if (androidx.compose.foundation.isSystemInDarkTheme()) Ink.inkDark else Ink.inkLight
@Composable fun mutedColor() = if (androidx.compose.foundation.isSystemInDarkTheme()) Ink.mutedDark else Ink.mutedLight
@Composable fun paperColor() = if (androidx.compose.foundation.isSystemInDarkTheme()) Ink.paperDark else Ink.paperLight
@Composable fun sheetColor() = if (androidx.compose.foundation.isSystemInDarkTheme()) Ink.sheetDark else Ink.sheetLight
@Composable fun redColor() = if (androidx.compose.foundation.isSystemInDarkTheme()) Ink.redDark else Ink.redLight
@Composable fun lineColor() = inkColor().copy(alpha = 0.22f)

@Composable fun SoupTheme(content: @Composable () -> Unit) {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) darkColorScheme(primary = Ink.redDark, onPrimary = Ink.paperDark,
            background = Ink.paperDark, onBackground = Ink.inkDark, surface = Ink.sheetDark,
            onSurface = Ink.inkDark) else lightColorScheme(primary = Ink.redLight,
            onPrimary = Ink.sheetLight, background = Ink.paperLight, onBackground = Ink.inkLight,
            surface = Ink.sheetLight, onSurface = Ink.inkLight),
        content = content,
    )
}

@Composable fun Prose(text: String, modifier: Modifier = Modifier, size: Int = 15,
    color: Color = inkColor(), weight: FontWeight = FontWeight.Normal, lineHeight: Int = size + 10) {
    Text(text, modifier, color = color, fontFamily = Ink.serif, fontWeight = weight,
        fontSize = size.sp, lineHeight = lineHeight.sp)
}

@Composable fun Mono(text: String, modifier: Modifier = Modifier, size: Int = 10,
    color: Color = mutedColor()) {
    Text(text, modifier, color = color, fontFamily = Ink.mono, fontSize = size.sp,
        lineHeight = (size + 5).sp)
}

@Composable fun Rule(modifier: Modifier = Modifier) {
    Spacer(modifier.fillMaxWidth().height(1.dp).background(lineColor()))
}

@Composable fun Heading(eyebrow: String, title: String, subtitle: String = "") {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Mono(eyebrow, size = 11)
        Prose(title, size = 30, weight = FontWeight.SemiBold, lineHeight = 40)
        Rule()
        if (subtitle.isNotBlank()) Prose(subtitle, color = mutedColor(), size = 14)
    }
}

@Composable fun SectionTitle(title: String, detail: String = "") {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Mono(title, size = 11)
            if (detail.isNotBlank()) Mono(detail)
        }
        Rule()
    }
}

@Composable fun Surface(text: String) {
    Prose(text, Modifier.fillMaxWidth().border(BorderStroke(2.dp, lineColor()), RectangleShape)
        .padding(14.dp), size = 16, lineHeight = 28)
}

@Composable fun InkButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier,
    enabled: Boolean = true) {
    Button(onClick, modifier.heightIn(min = 48.dp), enabled = enabled, shape = RectangleShape,
        colors = ButtonDefaults.buttonColors(containerColor = inkColor(), contentColor = paperColor())) {
        Text(label, fontFamily = Ink.serif, fontSize = 14.sp, letterSpacing = 2.sp)
    }
}

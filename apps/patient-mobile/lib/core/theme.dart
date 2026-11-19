import 'app_preferences.dart';
import 'design_tokens.dart';
import 'package:flutter/material.dart';

/// Human Care foundations; clinical state colours retain their meaning.
///
/// [clay] means act now, [amber] means something needs you. Neither appears as
/// decoration anywhere, so a calm screen reads as calm — which matters more
/// here than on most products, because the person holding this phone is often
/// unwell, worried, and reading in poor light.
class AppColors {
  static const medicalBlue = Color(0xFF123B64);
  static const tealGreen = Color(0xFF12A99A);
  static const ink = Color(0xFF172B3F);
  static const inkSoft = Color(0xFF526577);
  static const paper = Color(0xFFF3F5F6);
  static const paperSunk = Color(0xFFEDF2F6);
  static const line = Color(0xFFE1E6EA);
  static const petrol = Color(0xFF123B64);
  static const petrolLift = Color(0xFF1B517E);
  static const deepOcean = Color(0xFF102E4C);
  static const mintWash = Color(0xFFE3F5F1);
  static const amber = Color(0xFF805000);
  static const clay = Color(0xFFA63D2F);
}

/// Semantic colors for each appearance. Brand meaning stays stable while
/// foreground and surface tones adapt to the system theme.
class AppPalette {
  const AppPalette({
    required this.ink,
    required this.inkSoft,
    required this.paper,
    required this.surface,
    required this.paperSunk,
    required this.line,
    required this.petrol,
    required this.petrolLift,
    required this.deepOcean,
    required this.mintWash,
    required this.amber,
    required this.clay,
    required this.urgentWash,
    required this.action,
    required this.onAction,
    required this.heroStart,
    required this.heroMiddle,
    required this.heroEnd,
  });

  final Color ink;
  final Color inkSoft;
  final Color paper;
  final Color surface;
  final Color paperSunk;
  final Color line;
  final Color petrol;
  final Color petrolLift;
  final Color deepOcean;
  final Color mintWash;
  final Color amber;
  final Color clay;
  final Color urgentWash;
  final Color action;
  final Color onAction;
  final Color heroStart;
  final Color heroMiddle;
  final Color heroEnd;

  static const light = AppPalette(
    ink: AppColors.ink,
    inkSoft: AppColors.inkSoft,
    paper: AppColors.paper,
    surface: Colors.white,
    paperSunk: AppColors.paperSunk,
    line: AppColors.line,
    petrol: AppColors.petrol,
    petrolLift: AppColors.petrolLift,
    deepOcean: AppColors.deepOcean,
    mintWash: AppColors.mintWash,
    amber: AppColors.amber,
    clay: AppColors.clay,
    urgentWash: Color(0xFFF8E5E1),
    action: AppColors.petrol,
    onAction: Colors.white,
    heroStart: AppColors.deepOcean,
    heroMiddle: AppColors.petrol,
    heroEnd: AppColors.petrolLift,
  );

  static const dark = AppPalette(
    ink: Color(0xFFECF2FA),
    inkSoft: Color(0xFFB6C6D8),
    paper: Color(0xFF0B1724),
    surface: Color(0xFF12263A),
    paperSunk: Color(0xFF193249),
    line: Color(0xFF344E65),
    petrol: Color(0xFFA5C9EF),
    petrolLift: Color(0xFFC2DCF6),
    deepOcean: Color(0xFF102E4C),
    mintWash: Color(0xFF153E43),
    amber: Color(0xFFFFD08A),
    clay: Color(0xFFFFA397),
    urgentWash: Color(0xFF4B2C27),
    action: Color(0xFF123B64),
    onAction: Colors.white,
    heroStart: Color(0xFF102E4C),
    heroMiddle: Color(0xFF123B64),
    heroEnd: Color(0xFF1B517E),
  );

  static AppPalette accessible(AppPalette base, ColorVisionMode mode,
      {required bool darkMode}) {
    if (mode == ColorVisionMode.standard) return base;
    final high = mode == ColorVisionMode.highContrast;
    final danger = switch (mode) {
      ColorVisionMode.redGreen =>
        darkMode ? const Color(0xFFE5B5F3) : const Color(0xFF713A8A),
      ColorVisionMode.blueYellow =>
        darkMode ? const Color(0xFFFFB3D1) : const Color(0xFFA52C5B),
      _ => darkMode ? const Color(0xFFFFD0DB) : const Color(0xFF851D36),
    };
    final warning = mode == ColorVisionMode.blueYellow
        ? (darkMode ? const Color(0xFFEAD4E2) : const Color(0xFF66505E))
        : (darkMode ? const Color(0xFFFFD89A) : const Color(0xFF805000));
    return AppPalette(
        ink: high ? (darkMode ? Colors.white : Colors.black) : base.ink,
        inkSoft: high
            ? (darkMode ? const Color(0xFFE0E8F4) : const Color(0xFF263445))
            : base.inkSoft,
        paper: high
            ? (darkMode ? const Color(0xFF050B12) : Colors.white)
            : base.paper,
        surface: high
            ? (darkMode ? const Color(0xFF0B1724) : Colors.white)
            : base.surface,
        paperSunk: base.paperSunk,
        line: high
            ? (darkMode ? const Color(0xFFBDCEDE) : const Color(0xFF67778A))
            : base.line,
        petrol: base.petrol,
        petrolLift: base.petrolLift,
        deepOcean: base.deepOcean,
        mintWash: base.mintWash,
        amber: warning,
        clay: danger,
        urgentWash: high ? base.surface : base.urgentWash,
        action: base.action,
        onAction: base.onAction,
        heroStart: base.heroStart,
        heroMiddle: base.heroMiddle,
        heroEnd: base.heroEnd);
  }

  static AppPalette of(BuildContext context) {
    final darkMode = Theme.of(context).brightness == Brightness.dark;
    final mode = MediaQuery.maybeOf(context)?.highContrast == true
        ? ColorVisionMode.highContrast
        : AppPreferences.instance.colorVision;
    return accessible(darkMode ? dark : light, mode, darkMode: darkMode);
  }
}

ThemeData buildTheme({ColorVisionMode? vision}) =>
    _buildTheme(Brightness.light, vision: vision);
ThemeData buildDarkTheme({ColorVisionMode? vision}) =>
    _buildTheme(Brightness.dark, vision: vision);

class AccessiblePageTransitions extends PageTransitionsBuilder {
  const AccessiblePageTransitions();
  @override
  Widget buildTransitions<T>(
      PageRoute<T> route,
      BuildContext context,
      Animation<double> animation,
      Animation<double> secondaryAnimation,
      Widget child) {
    if (AppPreferences.instance.reduceMotion ||
        MediaQuery.maybeOf(context)?.disableAnimations == true) {
      return child;
    }
    // Preserve native predictive-back and iOS gestures when motion is allowed.
    return const PageTransitionsTheme()
        .buildTransitions(route, context, animation, secondaryAnimation, child);
  }
}

ThemeData _buildTheme(Brightness brightness, {ColorVisionMode? vision}) {
  final palette = AppPalette.accessible(
      brightness == Brightness.dark ? AppPalette.dark : AppPalette.light,
      vision ?? AppPreferences.instance.colorVision,
      darkMode: brightness == Brightness.dark);
  final base =
      TextStyle(fontFamily: 'OpenSans', color: palette.ink, height: 1.5);

  return ThemeData(
    brightness: brightness,
    useMaterial3: true,
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: AccessiblePageTransitions(),
      TargetPlatform.iOS: AccessiblePageTransitions(),
      TargetPlatform.linux: AccessiblePageTransitions(),
      TargetPlatform.macOS: AccessiblePageTransitions(),
      TargetPlatform.windows: AccessiblePageTransitions(),
    }),
    fontFamily: 'OpenSans',
    materialTapTargetSize: MaterialTapTargetSize.padded,
    scaffoldBackgroundColor: palette.paper,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.petrol,
      brightness: brightness,
      primary: palette.petrol,
      secondary: brightness == Brightness.dark
          ? const Color(0xFF75DACB)
          : const Color(0xFF087F74),
      error: palette.clay,
      surface: palette.surface,
    ),
    // 17px rather than the usual 14: read on a small, cheap screen by someone
    // who is not at their best.
    textTheme: TextTheme(
      bodyLarge: base.copyWith(fontSize: 17),
      bodyMedium: base.copyWith(fontSize: 16),
      bodySmall:
          base.copyWith(fontSize: 14, color: palette.inkSoft, height: 1.45),
      titleLarge: base.copyWith(fontSize: 22, fontWeight: FontWeight.w700),
      titleMedium:
          base.copyWith(fontSize: 18, fontWeight: FontWeight.w700, height: 1.3),
      headlineSmall: base.copyWith(
          fontSize: 28,
          fontWeight: FontWeight.w700,
          height: 1.2,
          letterSpacing: -.4),
      titleSmall: base.copyWith(
          fontSize: 16, fontWeight: FontWeight.w600, height: 1.35),
      labelLarge: base.copyWith(fontSize: 16, fontWeight: FontWeight.w500),
    ),
    appBarTheme: const AppBarTheme(
      elevation: 0,
      centerTitle: false,
    ).copyWith(
      backgroundColor: palette.paper,
      foregroundColor: palette.ink,
      actionsPadding: const EdgeInsets.only(right: 12),
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 1,
      toolbarHeight: 64,
      titleTextStyle: base.copyWith(fontSize: 18, fontWeight: FontWeight.w700),
    ),
    listTileTheme: ListTileThemeData(
        iconColor: palette.inkSoft,
        textColor: palette.ink,
        minVerticalPadding: 12),
    outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
            minimumSize: const Size(48, 48),
            foregroundColor: palette.petrol,
            side: BorderSide(color: palette.line),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12)))),
    textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
            minimumSize: const Size(48, 48), foregroundColor: palette.petrol)),
    navigationBarTheme: NavigationBarThemeData(
      height: CareLayout.navigation,
      backgroundColor: palette.deepOcean,
      surfaceTintColor: Colors.transparent,
      indicatorColor: Colors.white,
      elevation: 0,
      iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(
          color: states.contains(WidgetState.selected)
              ? AppColors.medicalBlue
              : const Color(0xFFD9E8F4))),
      labelTextStyle: WidgetStateProperty.resolveWith((states) => TextStyle(
            fontFamily: 'OpenSans',
            color: states.contains(WidgetState.selected)
                ? Colors.white
                : const Color(0xFFD9E8F4),
            fontSize: 11,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w700
                : FontWeight.w500,
          )),
    ),
    navigationRailTheme: const NavigationRailThemeData(
      groupAlignment: -.78,
    ).copyWith(
      backgroundColor: palette.paper,
      indicatorColor: palette.mintWash,
      selectedIconTheme: IconThemeData(color: palette.petrol),
      unselectedIconTheme: IconThemeData(color: palette.inkSoft),
      selectedLabelTextStyle: TextStyle(
        fontFamily: 'OpenSans',
        color: palette.petrol,
        fontWeight: FontWeight.w700,
      ),
      unselectedLabelTextStyle:
          TextStyle(fontFamily: 'OpenSans', color: palette.inkSoft),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: palette.action,
        foregroundColor: palette.onAction,
        // 52dp: the smallest target a thumb hits reliably one-handed, which is
        // how this is actually held.
        minimumSize: const Size(64, CareLayout.action),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(CareRadius.pill)),
        textStyle: const TextStyle(
            fontFamily: 'OpenSans', fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: palette.surface,
      hintStyle: TextStyle(color: palette.inkSoft, fontSize: 15),
      labelStyle: TextStyle(color: palette.inkSoft, fontSize: 15),
      prefixIconColor: palette.inkSoft,
      suffixIconColor: palette.inkSoft,
      border: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(CareRadius.card)),
        borderSide: BorderSide(color: palette.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(CareRadius.card)),
        borderSide: BorderSide(color: palette.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(CareRadius.card)),
        borderSide: BorderSide(color: palette.petrol, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
    ),
    chipTheme: ChipThemeData(
        backgroundColor: palette.surface,
        selectedColor: palette.mintWash,
        checkmarkColor: palette.petrol,
        side: BorderSide(color: palette.line),
        labelStyle:
            TextStyle(fontFamily: 'OpenSans', color: palette.ink, fontSize: 14),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(CareRadius.pill)),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
    dialogTheme: DialogThemeData(
        backgroundColor: palette.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(CareRadius.pill))),
    bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: palette.surface,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(
            borderRadius:
                BorderRadius.vertical(top: Radius.circular(CareRadius.pill)))),
    snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: palette.deepOcean,
        contentTextStyle:
            const TextStyle(fontFamily: 'OpenSans', color: Colors.white),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(CareRadius.control))),
    progressIndicatorTheme: ProgressIndicatorThemeData(
        color: palette.petrol,
        linearTrackColor: palette.paperSunk,
        circularTrackColor: palette.paperSunk),
    cardTheme: CardThemeData(
      color: palette.surface,
      elevation: 0,
      shadowColor: palette.ink.withValues(alpha: .08),
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CareRadius.card)),
      margin: EdgeInsets.zero,
    ),
    dividerColor: palette.line,
  );
}

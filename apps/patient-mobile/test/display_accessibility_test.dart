import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/app_settings_screen.dart';
import 'package:a_health_patient/widgets/premium.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await AppPreferences.instance.load();
    await L.load();
  });
  test('accessibility choices survive an offline preference restore', () async {
    await AppPreferences.instance.setReduceMotion(true);
    await AppPreferences.instance.setSolidSurfaces(true);
    await AppPreferences.instance.setColorVision(ColorVisionMode.redGreen);
    final restored = AppPreferences();
    await restored.load();
    expect(restored.reduceMotion, isTrue);
    expect(restored.solidSurfaces, isTrue);
    expect(restored.colorVision, ColorVisionMode.redGreen);
  });
  test('unknown saved palette and motion values fall back safely', () async {
    FlutterSecureStorage.setMockInitialValues(
        {'ah_ui_color_vision': 'invalid', 'ah_ui_reduce_motion': 'invalid'});
    final restored = AppPreferences();
    await restored.load();
    expect(restored.colorVision, ColorVisionMode.standard);
    expect(restored.reduceMotion, isFalse);
  });
  test('all accessible palette variants preserve legible clinical text', () {
    double ratio(Color a, Color b) {
      final x = a.computeLuminance(), y = b.computeLuminance();
      return ((x > y ? x : y) + .05) / ((x < y ? x : y) + .05);
    }

    for (final dark in [false, true])
      for (final mode in ColorVisionMode.values) {
        final palette = AppPalette.accessible(
            dark ? AppPalette.dark : AppPalette.light, mode,
            darkMode: dark);
        for (final color in [
          palette.ink,
          palette.inkSoft,
          palette.clay,
          palette.amber
        ]) {
          expect(ratio(color, palette.surface), greaterThanOrEqualTo(4.5),
              reason: '$mode dark=$dark');
        }
      }
  });
  testWidgets(
      'settings save motion and palette without leaving the current route',
      (tester) async {
    await AppPreferences.instance.setLanguage('en');
    await tester.pumpWidget(ListenableBuilder(
        listenable: AppPreferences.instance,
        builder: (context, _) => MaterialApp(
            theme: buildTheme(),
            darkTheme: buildDarkTheme(),
            locale: AppPreferences.instance.locale,
            supportedLocales: const [Locale('sw'), Locale('en'), Locale('fr')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            home: const AppSettingsScreen())));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Reduce motion'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reduce motion'));
    await tester.pumpAndSettle();
    expect(AppPreferences.instance.reduceMotion, isTrue);
    await tester.ensureVisible(find.text('Red–green friendly'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Red–green friendly'));
    await tester.pumpAndSettle();
    expect(AppPreferences.instance.colorVision, ColorVisionMode.redGreen);
    expect(find.byType(AppSettingsScreen), findsOneWidget);
  });
  testWidgets(
      'solid surfaces remove backdrop blur and reduced motion disables press scaling',
      (tester) async {
    await AppPreferences.instance.setSolidSurfaces(true);
    await AppPreferences.instance.setReduceMotion(true);
    await tester.pumpWidget(MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
            body: PremiumBentoFrame(
                child: PremiumCard(
                    onTap: () {}, child: const Text('Care action'))))));
    await tester.pumpAndSettle();
    expect(find.byType(BackdropFilter), findsNothing);
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).duration,
        Duration.zero);
  });
  testWidgets(
      'device reduced motion keeps a pushed route visible without fade wrappers',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: buildTheme(),
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: true),
            child: child!),
        home: Builder(
            builder: (context) => Scaffold(
                body: TextButton(
                    onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                            builder: (_) => const Scaffold(
                                body: Text('Destination screen')))),
                    child: const Text('Continue'))))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));
    expect(find.text('Destination screen'), findsOneWidget);
    expect(
        find.ancestor(
            of: find.text('Destination screen'),
            matching: find.byType(FadeTransition)),
        findsNothing);
    await tester.pumpAndSettle();
  });
}

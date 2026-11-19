import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/facility_browser_screen.dart';
import 'package:a_health_patient/widgets/care_home.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await AppPreferences.instance.load();
    await AppPreferences.instance.setLanguage('en');
    await L.load();
  });
  testWidgets(
      'care actions fit compact and wide layouts with enlarged translated text',
      (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final width in [360.0, 390.0, 768.0, 1366.0]) {
      for (final dark in [false, true]) {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        await AppPreferences.instance.setLanguage('fr');
        var searched = false, emergency = false;
        await tester.pumpWidget(MaterialApp(
            theme: dark ? buildDarkTheme() : buildTheme(),
            home: MediaQuery(
                data: MediaQueryData(
                    size: Size(width, 900),
                    textScaler: const TextScaler.linear(1.3),
                    disableAnimations: true),
                child: Scaffold(
                    body: SingleChildScrollView(
                        child: Padding(
                            padding: const EdgeInsets.all(20),
                            child: Column(children: [
                              CareHomeActions(
                                  onFindCare: () => searched = true,
                                  onConsultation: () {},
                                  onEmergency: () => emergency = true),
                              const SizedBox(height: 24),
                              CareShortcuts(items: [
                                (
                                  icon: Icons.calendar_month,
                                  label: 'Rendez-vous',
                                  onTap: () {}
                                ),
                                (
                                  icon: Icons.medication,
                                  label: 'Médicaments et suivi',
                                  onTap: () {}
                                ),
                                (
                                  icon: Icons.science,
                                  label: 'Examens et résultats',
                                  onTap: () {}
                                ),
                                (
                                  icon: Icons.family_restroom,
                                  label: 'Famille et personnes à charge',
                                  onTap: () {}
                                ),
                              ]),
                            ])))))));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull,
            reason: 'width=$width dark=$dark');
        final search = find.byKey(const Key('care-search'));
        if (width < 720) {
          expect(
              tester.getTopLeft(find.text(L.tr('Dharura'))).dy, lessThan(900));
        }
        await tester.ensureVisible(search);
        await tester.tap(search);
        await tester.pumpAndSettle();
        expect(searched, isTrue);
        final urgent = find.text(L.tr('Dharura'));
        await tester.ensureVisible(urgent);
        await tester.tap(urgent);
        await tester.pumpAndSettle();
        expect(emergency, isTrue);
      }
    }
  });
  testWidgets(
      'facility search filters real supplied records and clears without refetching',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(MaterialApp(
        theme: buildTheme(),
        home: FacilityBrowserScreen(loadFacilities: () async {
          loads++;
          return [
            {'id': 'test-one', 'name': 'Test Clinic', 'location': 'Arusha'},
            {'id': 'test-two', 'name': 'Test Hospital', 'location': 'Dodoma'},
          ];
        })));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'dodoma');
    await tester.pumpAndSettle();
    expect(find.text('Test Hospital'), findsOneWidget);
    expect(find.text('Test Clinic'), findsNothing);
    await tester.enterText(find.byType(TextField), 'unknown');
    await tester.pumpAndSettle();
    expect(find.text('No matching facilities. Try another name or location.'),
        findsOneWidget);
    await tester.tap(find.byTooltip('Clear search'));
    await tester.pumpAndSettle();
    expect(find.text('Test Clinic'), findsOneWidget);
    expect(loads, 1);
  });
}

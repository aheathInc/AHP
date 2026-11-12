import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/config.dart';
import 'package:a_health_patient/core/emergency.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/emergency_screen.dart';

class _LiveHttpOverrides extends HttpOverrides {}

class _TestStore extends EmergencyRecoveryStore {
  @override
  Future<Map<String, dynamic>?> load(String? owner) async => null;
  @override
  Future<void> save(String? owner, Map<String, dynamic> value) async {}
}

class _RecordingRepository extends EmergencyRepository {
  Map<String, dynamic>? received;
  @override
  Future<Map<String, dynamic>> report(Map<String, dynamic> body) async =>
      received = await super.report(body);
}

void main() {
  final path = Platform.environment['AHP_EMERGENCY_FIXTURE'];
  testWidgets(
      'real patient UI reports one incident and confirms receipt without claiming dispatch',
      (tester) async {
    await HttpOverrides.runWithHttpOverrides(() async {
      await tester.runAsync(() async {
        expect(
            Config.baseUrlFor('/emergency-requests'), 'http://127.0.0.1:4010');
        final fixture = jsonDecode(File(path!).readAsStringSync()) as Map;
        final patient = fixture['patient'] as Map;
        FlutterSecureStorage.setMockInitialValues({});
        Api.connectivityProbeForTesting = () async => true;
        await Session.save(
            accessToken: patient['access_token'] as String,
            refreshToken: patient['refresh_token'] as String,
            user: Map<String, dynamic>.from(patient['user'] as Map));
        final repo = _RecordingRepository();
        await tester.pumpWidget(MaterialApp(
            home: EmergencyScreen(
                repository: repo,
                recoveryStore: _TestStore(),
                locate: () async => Position.fromMap({
                      'latitude': -6.8,
                      'longitude': 39.28,
                      'accuracy': 12.0,
                      'timestamp': DateTime.now().millisecondsSinceEpoch
                    }),
                openDialer: (_) async => throw StateError(
                    'Acceptance tests must not call emergency numbers'))));
        Future<void> settle() async {
          await tester.pump();
          await Future<void>.delayed(const Duration(milliseconds: 500));
          await tester.pump();
        }

        await settle();
        await tester.ensureVisible(find.byKey(const Key('emergency-gps')));
        await tester.tap(find.byKey(const Key('emergency-gps')));
        await settle();
        await tester
            .ensureVisible(find.text('Ongeza maelezo ya tukio (hiari)'));
        await tester.tap(find.text('Ongeza maelezo ya tukio (hiari)'));
        await settle();
        final description =
            find.widgetWithText(TextField, 'Nini kimetokea? (hiari)');
        await tester.scrollUntilVisible(description, 250,
            scrollable: find.byType(Scrollable).first);
        await tester.enterText(description, fixture['marker'] as String);
        await tester.ensureVisible(find.byKey(const Key('emergency-submit')));
        await tester.tap(find.byKey(const Key('emergency-submit')));
        for (var attempt = 0;
            attempt < 30 && repo.received == null;
            attempt++) {
          await settle();
        }
        expect(repo.received?['status'], 'reported');
        expect(find.text('Imepokelewa na mfumo'), findsOneWidget);
        expect(
            find.text(
                'Dispatcher bado hajathibitisha kupokea ombi hili. Usidhani ambulance imetumwa.'),
            findsOneWidget);
        fixture['requestId'] = repo.received!['id'];
        File(path).writeAsStringSync(jsonEncode(fixture));
        await tester.pumpWidget(const SizedBox());
        Api.connectivityProbeForTesting = null;
      });
    }, _LiveHttpOverrides());
  }, skip: path == null);
}

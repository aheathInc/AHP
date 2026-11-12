import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/config.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/appointments_screen.dart';

class _LiveHttpOverrides extends HttpOverrides {}

void main() {
  final fixturePath = Platform.environment['AHP_COMMUNICATION_FIXTURE'];
  testWidgets('patient UI reschedules a real booking shared with staff web',
      (tester) async {
    await HttpOverrides.runWithHttpOverrides(() async {
      await tester.runAsync(() async {
        expect(Config.baseUrlFor('/auth/otp/request'), 'http://127.0.0.1:4001');
        final state = jsonDecode(File(fixturePath!).readAsStringSync()) as Map;
        final patient = state['patient'] as Map;
        final appointment = state['appointment'] as Map;
        final target = state['target'] as Map;
        FlutterSecureStorage.setMockInitialValues({});
        final challenge = await Api.post('/auth/otp/request',
            {'phone_number': patient['phone'], 'channel': 'sms'});
        expect(challenge['dev_code'], isA<String>());
        final session = await Api.post('/auth/otp/verify', {
          'challenge_id': challenge['challenge_id'],
          'code': challenge['dev_code'],
          'device_id': 'live-communication-widget'
        });
        await Session.save(
            accessToken: session['access_token'] as String,
            refreshToken: session['refresh_token'] as String,
            user: Map<String, dynamic>.from(session['user'] as Map));
        Future<void> settle() async {
          await tester.pump();
          await Future<void>.delayed(const Duration(seconds: 2));
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 500));
        }

        await tester.pumpWidget(
            MaterialApp(theme: buildTheme(), home: const AppointmentsScreen()));
        await settle();
        expect(find.text('Badilisha muda'), findsOneWidget);
        await tester.ensureVisible(find.text('Badilisha muda'));
        await tester.tap(find.text('Badilisha muda'));
        await settle();
        final option = find.byKey(ValueKey('reschedule-slot-${target['id']}'));
        expect(option, findsOneWidget);
        await tester.ensureVisible(option);
        await tester.tap(option);
        await tester.pump();
        await tester.ensureVisible(find.text('Endelea kuthibitisha'));
        await tester.tap(find.text('Endelea kuthibitisha'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));
        expect(find.text('Thibitisha muda mpya'), findsOneWidget);
        final before = await Api.get('/appointments/${appointment['id']}');
        expect(before['slot_id'], appointment['slot_id']);
        await tester.tap(find.text('Thibitisha mabadiliko'));
        await settle();
        await settle();
        expect(find.text('Muda mpya wa miadi umethibitishwa na seva.'),
            findsOneWidget);
        final after = await Api.get('/appointments/${appointment['id']}');
        expect(after['slot_id'], target['id']);
        expect(after['version'], (appointment['version'] as int) + 1);
        final evidence = {
          'realOtpLogin': true,
          'realPatientUi': true,
          'appointmentId': after['id'],
          'slotMatches': true,
          'version': after['version']
        };
        File('${File(fixturePath).parent.path}/live-logs/patient-communication.json')
            .writeAsStringSync(jsonEncode(evidence));
        await tester.pumpWidget(const SizedBox());
      });
    }, _LiveHttpOverrides());
  }, skip: fixturePath == null);
}

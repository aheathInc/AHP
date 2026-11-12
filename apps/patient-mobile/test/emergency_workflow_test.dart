import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:a_health_patient/core/emergency.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/emergency_screen.dart';
import 'package:a_health_patient/screens/login_screen.dart';
import 'package:a_health_patient/screens/security_screen.dart';

const requestId = '11111111-1111-4111-8111-111111111111';

class FakeEmergency extends EmergencyRepository {
  bool connected = true, fail = false, committed = false, readFail = false;
  int reads = 0, recoveries = 0;
  final reports = <Map<String, dynamic>>[];
  Completer<Map<String, dynamic>>? pending;
  Map<String, dynamic> receipt = {
    'id': requestId,
    'status': 'reported',
    'version': 1
  };
  @override
  Future<bool> online() async => connected;
  @override
  Future<Map<String, dynamic>> report(Map<String, dynamic> body) async {
    reports.add(Map<String, dynamic>.from(body));
    if (fail) throw Exception('timeout');
    if (pending != null) return await pending!.future;
    return receipt;
  }

  @override
  Future<Map<String, dynamic>> get(String id) async {
    reads++;
    if (readFail) throw Exception('read unavailable');
    return receipt;
  }

  @override
  Future<Map<String, dynamic>> recover(String id) async {
    recoveries++;
    if (!committed) throw Exception('not recorded');
    return receipt;
  }
}

class FakeRecovery extends EmergencyRecoveryStore {
  Map<String, dynamic>? value;
  bool fail = false;
  @override
  Future<Map<String, dynamic>?> load(String? owner) async => value;
  @override
  Future<void> save(String? owner, Map<String, dynamic> v) async {
    if (fail) throw Exception('storage');
    value = v;
  }

  @override
  Future<void> clear(String? owner) async {
    value = null;
  }
}

Future<void> login(String id) => Session.save(
    accessToken: 'synthetic',
    refreshToken: 'synthetic',
    user: {'id': id, 'role': 'patient'});
Position position() => Position.fromMap({
      'latitude': -6.8,
      'longitude': 39.28,
      'accuracy': 12.0,
      'timestamp': DateTime.now().millisecondsSinceEpoch
    });
Future<void> open(WidgetTester tester, FakeEmergency api, FakeRecovery store,
    {Future<Position> Function()? locate,
    Future<bool> Function(Uri)? dialer}) async {
  await tester.pumpWidget(MaterialApp(
      home: EmergencyScreen(
          repository: api,
          recoveryStore: store,
          locate: locate ?? () async => position(),
          openDialer: dialer)));
  await tester.pumpAndSettle();
}

Future<void> gps(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const Key('emergency-gps')));
  await tester.tap(find.byKey(const Key('emergency-gps')));
  await tester.pumpAndSettle();
}

Future<void> submit(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const Key('emergency-submit')));
  await tester.tap(find.byKey(const Key('emergency-submit')));
  await tester.pumpAndSettle();
}

Future<void> close(WidgetTester tester) => tester.pumpWidget(const SizedBox());
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await login('patient-a');
  });
  testWidgets('112 dialer stays usable offline without creating a request',
      (tester) async {
    final api = FakeEmergency()..connected = false;
    Uri? opened;
    await open(tester, api, FakeRecovery(), dialer: (uri) async {
      opened = uri;
      return true;
    });
    await tester.tap(find.byKey(const Key('emergency-call-112')));
    await tester.pump();
    expect(opened.toString(), 'tel:112');
    expect(api.reports, isEmpty);
    expect(api.recoveries, 0);
    await close(tester);
  });
  testWidgets(
      'explicit GPS carries real accuracy/time and receipt distinguishes dispatcher acknowledgement',
      (tester) async {
    final api = FakeEmergency();
    final store = FakeRecovery();
    await open(tester, api, store);
    await gps(tester);
    await submit(tester);
    expect(api.reports.single['location'], {'lat': -6.8, 'lng': 39.28});
    expect(api.reports.single['location_source'], 'gps');
    expect(api.reports.single['location_accuracy_m'], 12);
    expect(api.reports.single['client_request_id'],
        matches(RegExp(r'^[a-f0-9-]{36}$')));
    expect(find.text('Imepokelewa na mfumo'), findsOneWidget);
    expect(
        find.text(
            'Dispatcher bado hajathibitisha kupokea ombi hili. Usidhani ambulance imetumwa.'),
        findsOneWidget);
    expect(store.value?['request_id'], requestId);
    await close(tester);
  });
  testWidgets(
      'offline draft is never automatically transmitted or put in the outbox',
      (tester) async {
    final api = FakeEmergency()..connected = false;
    await open(tester, api, FakeRecovery());
    await gps(tester);
    await submit(tester);
    expect(api.reports, isEmpty);
    expect(api.recoveries, 0);
    expect(find.text('Jaribu tena ombi lilelile'), findsOneWidget);
    await close(tester);
  });
  testWidgets(
      'a timed out request retries the same client id and exact payload',
      (tester) async {
    final api = FakeEmergency()..fail = true;
    await open(tester, api, FakeRecovery());
    await gps(tester);
    await submit(tester);
    expect(api.reports, hasLength(1));
    expect(find.text('Imepokelewa na mfumo'), findsNothing);
    api.fail = false;
    await submit(tester);
    expect(api.reports, hasLength(2));
    expect(api.reports[0], api.reports[1]);
    expect(find.text('Imepokelewa na mfumo'), findsOneWidget);
    await close(tester);
  });
  testWidgets(
      'timeout reports success only after authorized recovery confirms committed request',
      (tester) async {
    final api = FakeEmergency()
      ..fail = true
      ..committed = true;
    await open(tester, api, FakeRecovery());
    await gps(tester);
    await submit(tester);
    expect(api.recoveries, 1);
    expect(find.text('Imepokelewa na mfumo'), findsOneWidget);
    await close(tester);
  });
  testWidgets(
      'GPS denial offers map/manual and does not submit fake coordinates',
      (tester) async {
    final api = FakeEmergency();
    await open(tester, api, FakeRecovery(),
        locate: () async => throw Exception('permission denied'));
    await gps(tester);
    await submit(tester);
    expect(api.reports, isEmpty);
    expect(find.text('Chagua eneo kwenye ramani'), findsOneWidget);
    await close(tester);
  });
  testWidgets(
      'saved receipt restores through a fresh read without another POST',
      (tester) async {
    final api = FakeEmergency()
      ..receipt = {
        'id': requestId,
        'status': 'triaged',
        'acknowledged_at': DateTime.now().toUtc().toIso8601String(),
        'version': 2
      };
    final store = FakeRecovery()..value = {'request_id': requestId};
    await open(tester, api, store);
    expect(api.reads, 1);
    expect(api.reports, isEmpty);
    expect(find.text('Imepokelewa na dispatcher'), findsOneWidget);
    await close(tester);
  });
  testWidgets('storage failure does not suppress a confirmed emergency report',
      (tester) async {
    final api = FakeEmergency();
    await open(tester, api, FakeRecovery()..fail = true);
    await gps(tester);
    await submit(tester);
    expect(api.reports, hasLength(1));
    expect(find.text('Imepokelewa na mfumo'), findsOneWidget);
    expect(
        find.text(
            'Ombi limepokelewa lakini namba yake haikuhifadhiwa kwenye simu. Nakili namba ya ombi.'),
        findsOneWidget);
    await close(tester);
  });
  testWidgets('account switch clears PHI and ignores a late report result',
      (tester) async {
    final api = FakeEmergency()..pending = Completer<Map<String, dynamic>>();
    await open(tester, api, FakeRecovery());
    await gps(tester);
    await tester.ensureVisible(find.byKey(const Key('emergency-submit')));
    await tester.tap(find.byKey(const Key('emergency-submit')));
    await tester.pump();
    await login('patient-b');
    api.pending!.complete({'id': requestId, 'status': 'reported'});
    await tester.pumpAndSettle();
    expect(find.text('Imepokelewa na mfumo'), findsNothing);
    expect(find.byKey(const Key('emergency-submit')), findsNothing);
    expect(find.byKey(const Key('emergency-call-112')), findsOneWidget);
    await close(tester);
  });
  test(
      'recovery storage separates signed-in owners and does not persist anonymous drafts',
      () async {
    const store = EmergencyRecoveryStore();
    await store.save('patient-a', {'request_id': requestId});
    await login('patient-b');
    expect(await store.load('patient-b'), isNull);
    await store.save(null, {'request_id': requestId});
    expect(await store.load(null), isNull);
    expect((await store.load('patient-a'))?['request_id'], requestId);
  });
  testWidgets(
      'a saved receipt that cannot be read does not open a duplicate-report form',
      (tester) async {
    final api = FakeEmergency()..readFail = true;
    final store = FakeRecovery()..value = {'request_id': requestId};
    await open(tester, api, store);
    expect(api.reads, 1);
    expect(find.byKey(const Key('emergency-submit')), findsNothing);
    expect(find.byKey(const Key('emergency-call-112')), findsOneWidget);
    expect(api.reports, isEmpty);
    await close(tester);
  });
  testWidgets('SOS is accessible from login without account authentication',
      (tester) async {
    await Session.clear();
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
    await tester.pumpAndSettle();
    final sos = find.byKey(const Key('login-emergency-access'));
    await tester.ensureVisible(sos);
    await tester.tap(sos);
    await tester.pumpAndSettle();
    expect(find.byType(EmergencyScreen), findsOneWidget);
    expect(find.byKey(const Key('emergency-call-112')), findsOneWidget);
    await close(tester);
  });
  testWidgets('biometric lock preserves an enabled emergency dialer action',
      (tester) async {
    Session.locked.value = true;
    await tester.pumpWidget(const MaterialApp(home: BiometricLockScreen()));
    await tester.pumpAndSettle();
    final call = find.descendant(
        of: find.byKey(const Key('locked-emergency-call')),
        matching: find.byType(FilledButton));
    expect(tester.widget<FilledButton>(call).onPressed, isNotNull);
    Session.locked.value = false;
    await close(tester);
  });
}

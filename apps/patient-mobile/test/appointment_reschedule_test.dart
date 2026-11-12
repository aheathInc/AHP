import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/patient_care.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/appointment_reschedule_screen.dart';

final currentTime = DateTime.now().toUtc().add(const Duration(days: 2));
final replacementTime = currentTime.add(const Duration(days: 1));
Map<String, dynamic> appointment({String slot = 'old-slot', int version = 3}) =>
    {
      'id': 'appointment-1',
      'slot_id': slot,
      'version': version,
      'status': 'booked',
      'starts_at': (slot == 'new-slot' ? replacementTime : currentTime)
          .toIso8601String(),
      'duration_minutes': 30,
      'modality': 'chat'
    };
Map<String, dynamic> options() => {
      'appointment': appointment(),
      'clinician_name': 'Synthetic Clinician',
      'data': [
        {
          'id': 'new-slot',
          'starts_at': replacementTime.toIso8601String(),
          'duration_minutes': 30,
          'modality': 'chat'
        }
      ],
      'meta': {'next_cursor': null, 'has_more': false}
    };
Future<void> open(WidgetTester tester, PatientCareRepository repository,
    void Function(bool?) result) async {
  await tester.pumpWidget(MaterialApp(
      home: Builder(
          builder: (context) => Scaffold(
              body: TextButton(
                  onPressed: () async {
                    result(await Navigator.push<bool>(
                        context,
                        MaterialPageRoute(
                            builder: (_) => AppointmentRescheduleScreen(
                                appointmentId: 'appointment-1',
                                repository: repository))));
                  },
                  child: const Text('Open rescheduling'))))));
  await tester.tap(find.text('Open rescheduling'));
  await tester.pumpAndSettle();
}

Future<void> choose(WidgetTester tester) async {
  await tester
      .ensureVisible(find.byKey(const ValueKey('reschedule-slot-new-slot')));
  await tester.tap(find.byKey(const ValueKey('reschedule-slot-new-slot')));
  await tester.pump();
  await tester.ensureVisible(find.text('Endelea kuthibitisha'));
  await tester.tap(find.text('Endelea kuthibitisha'));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });
  test(
      'rescheduling uses an online POST with the exact version and stable operation key',
      () async {
    final calls = <Map<String, dynamic>>[];
    final repository = PatientCareRepository(
        post: (path, body, {idempotencyKey}) async {
          calls.add({'path': path, 'body': body, 'key': idempotencyKey});
          return appointment(slot: 'new-slot', version: 4);
        },
        durablePost: (
                {required opId,
                required path,
                required syncPath,
                pathParams,
                required body}) async =>
            throw StateError('must not queue rescheduling'));
    await repository.rescheduleAppointment('appointment-1',
        slotId: 'new-slot', baseVersion: 3, opId: 'same-operation');
    expect(calls.single, {
      'path': '/appointments/appointment-1/reschedule',
      'body': {'slot_id': 'new-slot', 'base_version': 3},
      'key': 'same-operation'
    });
  });
  test(
      'an unchanged or mismatched response cannot masquerade as a confirmed move',
      () async {
    final repository = PatientCareRepository(
        post: (path, body, {idempotencyKey}) async => appointment());
    await expectLater(
        repository.rescheduleAppointment('appointment-1',
            slotId: 'new-slot', baseVersion: 3, opId: 'op'),
        throwsFormatException);
  });
  test('malformed slot results fail before rendering a selectable time',
      () async {
    final repository = PatientCareRepository(
        get: (path, {query}) async => {
              ...options(),
              'data': [
                {'id': 'new-slot', 'starts_at': 'invalid'}
              ]
            });
    await expectLater(
        repository.rescheduleOptions('appointment-1'), throwsFormatException);
  });
  testWidgets(
      'requires explicit confirmation and leaves the booking untouched when dismissed',
      (tester) async {
    var writes = 0;
    bool? result;
    final repository = PatientCareRepository(
        get: (path, {query}) async => options(),
        post: (path, body, {idempotencyKey}) async {
          writes++;
          return appointment(slot: 'new-slot', version: 4);
        });
    await open(tester, repository, (r) => result = r);
    await choose(tester);
    expect(find.text('Thibitisha muda mpya'), findsOneWidget);
    expect(writes, 0);
    await tester.tap(find.text('Rudi'));
    await tester.pumpAndSettle();
    expect(writes, 0);
    expect(result, isNull);
  });
  testWidgets('confirmed server response closes the picker with success',
      (tester) async {
    bool? result;
    final repository = PatientCareRepository(
        get: (path, {query}) async => options(),
        post: (path, body, {idempotencyKey}) async =>
            appointment(slot: 'new-slot', version: 4));
    await open(tester, repository, (r) => result = r);
    await choose(tester);
    await tester.tap(find.text('Thibitisha mabadiliko'));
    await tester.pumpAndSettle();
    expect(result, true);
    expect(find.text('Open rescheduling'), findsOneWidget);
  });
  testWidgets(
      'a timeout resolves as success only after a persisted matching booking is read',
      (tester) async {
    bool? result;
    final repository = PatientCareRepository(
        get: (path, {query}) async => path.endsWith('/reschedule-options')
            ? options()
            : appointment(slot: 'new-slot', version: 4),
        post: (path, body, {idempotencyKey}) async =>
            throw ApiException(0, 'NETWORK', 'Synthetic timeout'));
    await open(tester, repository, (r) => result = r);
    await choose(tester);
    await tester.tap(find.text('Thibitisha mabadiliko'));
    await tester.pumpAndSettle();
    expect(result, true);
  });
  testWidgets(
      'unconfirmed network failures expose retry and never display success',
      (tester) async {
    bool? result;
    final repository = PatientCareRepository(
        get: (path, {query}) async {
          if (path.endsWith('/reschedule-options')) return options();
          throw ApiException(0, 'NETWORK', 'Offline');
        },
        post: (path, body, {idempotencyKey}) async =>
            throw ApiException(0, 'NETWORK', 'Synthetic connection failed'));
    await open(tester, repository, (r) => result = r);
    await choose(tester);
    await tester.tap(find.text('Thibitisha mabadiliko'));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.text('Synthetic connection failed'), findsOneWidget);
  });
  testWidgets(
      'an account change closes confirmation and clears the old appointment without posting',
      (tester) async {
    var writes = 0;
    final repository = PatientCareRepository(
        get: (path, {query}) async => options(),
        post: (path, body, {idempotencyKey}) async {
          writes++;
          return appointment(slot: 'new-slot', version: 4);
        });
    await open(tester, repository, (_) {});
    await choose(tester);
    await Session.save(
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        user: {'id': 'synthetic-other-owner', 'role': 'patient'});
    await tester.pumpAndSettle();
    expect(writes, 0);
    expect(find.text('Thibitisha muda mpya'), findsNothing);
    expect(find.text('Synthetic Clinician'), findsNothing);
    expect(find.text('Account imebadilika. Fungua taarifa zako tena.'),
        findsOneWidget);
  });
  testWidgets(
      'a response arriving after an account change cannot announce success',
      (tester) async {
    bool? result;
    final response = Completer<Map<String, dynamic>>();
    final repository = PatientCareRepository(
        get: (path, {query}) async => options(),
        post: (path, body, {idempotencyKey}) => response.future);
    await open(tester, repository, (r) => result = r);
    await choose(tester);
    await tester.tap(find.text('Thibitisha mabadiliko'));
    await tester.pumpAndSettle();
    await Session.save(
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        user: {'id': 'synthetic-other-owner', 'role': 'patient'});
    await tester.pump();
    response.complete(appointment(slot: 'new-slot', version: 4));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.text('Synthetic Clinician'), findsNothing);
  });
  testWidgets(
      'a taken slot explains the conflict and requires a fresh selection',
      (tester) async {
    bool? result;
    final repository = PatientCareRepository(
        get: (path, {query}) async =>
            path.endsWith('/reschedule-options') ? options() : appointment(),
        post: (path, body, {idempotencyKey}) async =>
            throw ApiException(409, 'SLOT_UNAVAILABLE', 'Unavailable'));
    await open(tester, repository, (r) => result = r);
    await choose(tester);
    await tester.tap(find.text('Thibitisha mabadiliko'));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(
        find.text(
            'Nafasi hiyo haipatikani tena. Pakia nafasi upya uchague muda mwingine.'),
        findsOneWidget);
    expect(
        find.byKey(const ValueKey('reschedule-slot-new-slot')), findsNothing);
  });
}

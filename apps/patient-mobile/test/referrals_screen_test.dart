import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/screens/referrals_screen.dart';

class _SyntheticReferralDenialAdapter implements HttpClientAdapter {
  int requests = 0;
  String? requestedPath;
  bool authorizationHeaderPresent = false;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests++;
    requestedPath = options.path;
    authorizationHeaderPresent = options.headers.containsKey('Authorization');
    return ResponseBody.fromString(
      jsonEncode({
        'error': {
          'code': 'NOT_RESOURCE_OWNER',
          'message': 'Access denied.',
        },
      }),
      403,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  testWidgets(
      'account change clears an open referral screen and discards its pending response',
      (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    final pending = Completer<List<Map<String, dynamic>>>();
    await tester.pumpWidget(MaterialApp(
        home: ReferralsScreen(loadReferrals: () => pending.future)));
    await Session.save(
        accessToken: 'synthetic-token',
        refreshToken: 'synthetic-refresh',
        user: {'id': 'synthetic-new-patient', 'role': 'patient'});
    await tester.pumpAndSettle();
    pending.complete([
      {
        'id': 'previous-account-referral',
        'status': 'accepted',
        'destination': {
          'facility': {'name': 'Previous account destination'}
        }
      }
    ]);
    await tester.pumpAndSettle();
    expect(find.text('Previous account destination'), findsNothing);
    expect(find.textContaining('Akaunti imebadilika'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await Session.clear();
  });

  testWidgets('expanded referral fits a narrow screen with large text',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(2)),
            child: child!),
        home: ReferralsScreen(
            loadReferrals: () async => [
                  {
                    'id': 'synthetic-long-referral-reference',
                    'status': 'accepted',
                    'priority': 'urgent',
                    'purpose':
                        'Synthetic referral context with a long explanation',
                    'destination': {
                      'facility': {
                        'name': 'Synthetic receiving facility with a long name'
                      }
                    }
                  }
                ])));
    await tester.pumpAndSettle();
    final title=find.text('Synthetic receiving facility with a long name');
    await tester.scrollUntilVisible(title, 250, scrollable:find.byType(Scrollable).first);
    await Scrollable.ensureVisible(tester.element(title), alignment:0.1);
    await tester.pumpAndSettle();
    await tester.tap(title);
    await tester.pumpAndSettle();
    expect(find.text('Namba ya rufaa'),findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('ignores an older refresh that completes after a newer result',
      (tester) async {
    final first = Completer<List<Map<String, dynamic>>>();
    var calls = 0;
    await tester
        .pumpWidget(MaterialApp(home: ReferralsScreen(loadReferrals: () {
      calls++;
      return calls == 1
          ? first.future
          : Future.value([
              {
                'id': 'new-referral',
                'status': 'accepted',
                'purpose': 'New response',
                'destination': {
                  'facility': {'name': 'New destination'}
                }
              }
            ]);
    })));
    // A lifecycle resume starts a fresh request while the old request is pending.
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.text('New destination'), findsOneWidget);
    first.complete([
      {
        'id': 'old-referral',
        'status': 'submitted',
        'destination': {
          'facility': {'name': 'Old destination'}
        }
      }
    ]);
    await tester.pumpAndSettle();
    expect(find.text('New destination'), findsOneWidget);
    expect(find.text('Old destination'), findsNothing);
  });

  test(
      'rejects a partially malformed successful response rather than silently dropping rows',
      () {
    expect(
        () => ReferralsScreen.parseResponse({
              'data': [
                {'id': 'valid', 'status': 'submitted'},
                'broken'
              ]
            }),
        throwsA(isA<ApiException>()));
  });

  testWidgets(
      'active filter separates completed referrals and remains refreshable when empty',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ReferralsScreen(
            loadReferrals: () async => [
                  {
                    'id': 'closed-referral',
                    'status': 'completed',
                    'destination': {
                      'facility': {'name': 'Completed destination'}
                    }
                  }
                ])));
    await tester.pumpAndSettle();
    expect(find.text('Completed destination'), findsOneWidget);
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    expect(find.text('Completed destination'), findsNothing);
    expect(find.textContaining('Hakuna rufaa inayoendelea'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('shows submitted status as distinct from acceptance and care',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: ReferralsScreen(
          loadReferrals: () async => [
                {
                  'id': 'referral-test-1',
                  'status': 'submitted',
                  'purpose': 'Synthetic test referral',
                  'submitted_at': '2026-10-12T10:00:00.000Z',
                  'received_at': null,
                  'accepted_at': null,
                  'care_started_at': null,
                  'completed_at': null,
                  'source': {
                    'facility': {'name': 'Source clinic'}
                  },
                  'destination': {
                    'facility': {'name': 'Receiving clinic'}
                  },
                  'outcome': null,
                },
              ]),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Rufaa Zangu'), findsOneWidget);
    expect(find.text('Receiving clinic'), findsOneWidget);
    expect(
        find.textContaining('Imetumwa — kituo bado hakijathibitisha kupokea'),
        findsOneWidget);
    expect(find.textContaining('hakumaanishi imekubaliwa'), findsOneWidget);

    await tester.tap(find.byType(ExpansionTile));
    await tester.pumpAndSettle();
    expect(find.text('Source clinic'), findsOneWidget);
    expect(find.text('Kukubali'), findsNothing);
    expect(find.text('Huduma ilianza'), findsOneWidget);
  });

  testWidgets('shows the persisted completion outcome and patient instructions',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: ReferralsScreen(
          loadReferrals: () async => [
                {
                  'id': 'referral-test-2',
                  'status': 'completed',
                  'purpose': 'Synthetic test referral',
                  'submitted_at': '2026-10-12T10:00:00.000Z',
                  'received_at': '2026-10-12T10:05:00.000Z',
                  'accepted_at': '2026-10-12T10:10:00.000Z',
                  'care_started_at': '2026-10-12T10:15:00.000Z',
                  'completed_at': '2026-10-12T10:30:00.000Z',
                  'source': {
                    'facility': {'name': 'Source clinic'}
                  },
                  'destination': {
                    'facility': {'name': 'Receiving clinic'}
                  },
                  'outcome': {
                    'status': 'care_provided',
                    'follow_up_recommendation': 'Synthetic follow-up only',
                    'patient_instructions': 'Synthetic instruction only',
                  },
                },
              ]),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('Rufaa imekamilika'), findsOneWidget);
    await tester.tap(find.byType(ExpansionTile));
    await tester.pumpAndSettle();
    expect(find.text('Huduma imetolewa'), findsOneWidget);
    expect(find.text('Synthetic follow-up only'), findsOneWidget);
    expect(find.text('Synthetic instruction only'), findsOneWidget);
  });

  testWidgets('renders an authorized empty response as empty state',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: ReferralsScreen(loadReferrals: () async => []),
    ));
    await tester.pumpAndSettle();

    expect(find.textContaining('Bado hakuna rufaa'), findsOneWidget);
    expect(find.text('Rufaa hazikuweza kusomwa. Jaribu tena.'), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('keeps loading visible until the referral request completes',
      (tester) async {
    final response = Completer<List<Map<String, dynamic>>>();
    await tester.pumpWidget(MaterialApp(
      home: ReferralsScreen(loadReferrals: () => response.future),
    ));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.textContaining('Bado hakuna rufaa'), findsNothing);
    expect(find.text('Rufaa hazikuweza kusomwa. Jaribu tena.'), findsNothing);

    response.complete([]);
    await tester.pumpAndSettle();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.textContaining('Bado hakuna rufaa'), findsOneWidget);
  });

  testWidgets('does not present an API failure as an authorized empty list',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: ReferralsScreen(loadReferrals: () async {
        throw ApiException(
            503, 'SERVICE_UNAVAILABLE', 'Referral list request failed.');
      }),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Referral list request failed.'), findsOneWidget);
    expect(find.textContaining('Bado hakuna rufaa'), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byType(ExpansionTile), findsNothing);
  });

  testWidgets('retry reloads the referral list after a transient failure',
      (tester) async {
    var requests = 0;
    await tester.pumpWidget(MaterialApp(
      home: ReferralsScreen(loadReferrals: () async {
        requests++;
        if (requests == 1) {
          throw ApiException(
              503, 'SERVICE_UNAVAILABLE', 'Referral list request failed.');
        }
        return [];
      }),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Referral list request failed.'), findsOneWidget);
    expect(find.text('Jaribu tena'), findsOneWidget);
    expect(find.textContaining('Bado hakuna rufaa'), findsNothing);

    await tester.tap(find.text('Jaribu tena'));
    await tester.pumpAndSettle();
    expect(requests, 2);
    expect(find.textContaining('Bado hakuna rufaa'), findsOneWidget);
    expect(find.text('Referral list request failed.'), findsNothing);
  });

  test('rejects malformed success response rather than treating it as empty',
      () {
    expect(
      () => ReferralsScreen.parseResponse({'unexpected': 'shape'}),
      throwsA(isA<ApiException>()),
    );
  });

  testWidgets(
      'direct referral read handles the server non-owner denial without data',
      (tester) async {
    await tester.runAsync(() async {
      FlutterSecureStorage.setMockInitialValues({});
      await Session.save(
        accessToken: 'synthetic-patient-b-session',
        refreshToken: 'synthetic-patient-b-refresh',
        user: {'id': 'synthetic-patient-b', 'role': 'patient'},
      );

      final adapter = _SyntheticReferralDenialAdapter();
      final dio = Dio(BaseOptions(validateStatus: (_) => true))
        ..httpClientAdapter = adapter;
      Api.useDioForTesting(dio);
      try {
        ApiException? denial;
        try {
          await Api.get('/referrals/synthetic-patient-a-referral');
        } on ApiException catch (error) {
          denial = error;
        }

        expect(denial, isNotNull);
        expect(denial!.status, 403);
        expect(denial.code, 'NOT_RESOURCE_OWNER');
        expect(adapter.requests, 1);
        expect(
          adapter.requestedPath,
          endsWith('/referrals/synthetic-patient-a-referral'),
        );
        expect(adapter.authorizationHeaderPresent, isTrue);
      } finally {
        Api.useDioForTesting(null);
        await Session.clear();
      }
    });
  });

  testWidgets(
      'clears Patient A referral UI when a new Patient B session is mounted',
      (tester) async {
    const patientAId = 'synthetic-patient-a';
    const patientBId = 'synthetic-patient-b';
    const patientADestination = 'SYNTHETIC_PATIENT_A_DESTINATION';
    const patientAInstruction = 'SYNTHETIC_PATIENT_A_INSTRUCTION';
    const patientBDestination = 'SYNTHETIC_PATIENT_B_DESTINATION';

    Future<List<Map<String, dynamic>>> referralsForCurrentSession() async {
      final userId = await Session.userId();
      if (userId == patientAId) {
        return [
          {
            'id': 'synthetic-a-referral',
            'status': 'completed',
            'purpose': 'Synthetic Patient A fixture',
            'source': {
              'facility': {'name': 'Synthetic A source'}
            },
            'destination': {
              'facility': {'name': patientADestination}
            },
            'outcome': {'patient_instructions': patientAInstruction},
          },
        ];
      }
      if (userId == patientBId) {
        return [
          {
            'id': 'synthetic-b-referral',
            'status': 'submitted',
            'purpose': 'Synthetic Patient B fixture',
            'source': {
              'facility': {'name': 'Synthetic B source'}
            },
            'destination': {
              'facility': {'name': patientBDestination}
            },
            'outcome': null,
          },
        ];
      }
      return [];
    }

    await tester.runAsync(() async {
      FlutterSecureStorage.setMockInitialValues({});
      await Session.save(
        accessToken: 'synthetic-a-session',
        refreshToken: 'synthetic-a-refresh',
        user: {'id': patientAId, 'role': 'patient'},
      );

      await tester.pumpWidget(MaterialApp(
        home: ReferralsScreen(loadReferrals: referralsForCurrentSession),
      ));
      await tester.pumpAndSettle();
      expect(find.text(patientADestination), findsOneWidget);
      await tester.tap(find.byType(ExpansionTile));
      await tester.pumpAndSettle();
      expect(find.text(patientAInstruction), findsOneWidget);

      await Session.clear();
      expect(await Session.authenticated, isFalse);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await Session.save(
        accessToken: 'synthetic-b-session',
        refreshToken: 'synthetic-b-refresh',
        user: {'id': patientBId, 'role': 'patient'},
      );

      await tester.pumpWidget(MaterialApp(
        home: ReferralsScreen(loadReferrals: referralsForCurrentSession),
      ));
      await tester.pumpAndSettle();
      expect(find.text(patientBDestination), findsOneWidget);
      expect(find.text(patientADestination), findsNothing);
      expect(find.text(patientAInstruction), findsNothing);
      expect(find.byType(ExpansionTile), findsOneWidget);
    });
  });
}

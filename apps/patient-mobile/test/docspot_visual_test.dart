// Opt-in screenshots of actual production Flutter screens. All records are
// synthetic and the HTTP interceptor never permits external requests.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/core/db.dart';
import 'package:a_health_patient/core/desktop_database.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/core/patient_care.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/home_screen.dart';
import 'package:a_health_patient/screens/login_screen.dart';
import 'package:a_health_patient/screens/facility_browser_screen.dart';
import 'package:a_health_patient/screens/doctor_directory_screen.dart';
import 'package:a_health_patient/screens/appointments_screen.dart';
import 'package:a_health_patient/screens/appointment_reschedule_screen.dart';
import 'package:a_health_patient/screens/medication_followup_screen.dart';
import 'package:a_health_patient/screens/diagnostics_screen.dart';
import 'package:a_health_patient/screens/profile_screen.dart';
import 'package:a_health_patient/screens/messages_screen.dart';
import 'package:a_health_patient/screens/family_screen.dart';
import 'package:a_health_patient/screens/emergency_screen.dart';
import 'package:a_health_patient/screens/app_settings_screen.dart';
import 'package:a_health_patient/screens/payment_bills_screen.dart';
import 'package:a_health_patient/screens/new_consultation_screen.dart';
import 'package:a_health_patient/screens/privacy_consent_screen.dart';
import 'package:a_health_patient/screens/referrals_screen.dart';
import 'package:a_health_patient/screens/health_history_screen.dart';
import 'package:a_health_patient/screens/education_screen.dart';
import 'package:a_health_patient/screens/screening_screen.dart';
import 'package:a_health_patient/screens/vaccinations_screen.dart';
import 'package:a_health_patient/screens/feedback_screen.dart';
import 'package:a_health_patient/screens/insurance_payments_screen.dart';
import 'package:a_health_patient/screens/checkins_screen.dart';
import 'fixtures/profile_fixture.dart';
import 'fixtures/medication_fixture.dart';
import 'fixtures/messages_fixture.dart';

final _date = DateTime.utc(2027, 1, 21, 9, 15).toIso8601String();
final _clinicians = <Map<String, dynamic>>[
  {
    'id': 'synthetic-clinician',
    'full_name': 'Dr Amina · Demo',
    'specialty': 'General practice',
    'status': 'available',
    'queue_count': 2
  },
  {
    'id': 'synthetic-clinician-two',
    'full_name': 'Dr Juma · Demo',
    'specialty': 'Paediatrics',
    'status': 'busy',
    'queue_count': 3
  },
];
final _appointment = <String, dynamic>{
  'id': 'synthetic-appointment',
  'clinician_id': 'synthetic-clinician',
  'status': 'booked',
  'version': 1,
  'starts_at': _date,
  'modality': 'chat',
  'duration_minutes': 30
};
final _facilities = <Map<String, dynamic>>[
  {
    'id': 'synthetic-facility',
    'name': 'Demo Health Centre',
    'location': 'Dodoma, Tanzania'
  },
  {
    'id': 'synthetic-facility-two',
    'name': 'Demo Family Clinic',
    'location': 'Arusha, Tanzania'
  },
];
final _orders = <Map<String, dynamic>>[
  {
    'id': 'synthetic-order',
    'investigation_code': 'DEMO FULL BLOOD COUNT',
    'status': 'resulted',
    'facility_name': 'Demo laboratory',
    'ordered_at': '2026-11-17T08:00:00Z'
  }
];
final _report = <String, dynamic>{
  ..._orders.first,
  'released_by_name': 'Demo laboratory verifier',
  'specimen_reference': 'DEMO-001',
  'specimen_type': 'Blood',
  'resulted_at': '2026-11-17T10:00:00Z',
  'values': [
    {
      'analyte': 'Demo haemoglobin',
      'value': '13.5',
      'unit': 'g/dL',
      'reference_low': 12,
      'reference_high': 16,
      'flag': 'normal'
    }
  ]
};

dynamic _payload(String path) {
  if (path == '/consultations')
    return {
      'data': [
        {
          'id': 'synthetic-visit',
          'status': 'matched',
          'symptom_text': 'Demo follow-up consultation',
          'created_at': '2026-11-17T08:00:00Z'
        }
      ]
    };
  if (path.endsWith('/note'))
    return {
      'diagnosis_text': 'Demonstration only',
      'advice_text': 'Synthetic advice. Not medical guidance.'
    };
  if (path == '/facilities') return {'data': _facilities};
  if (path == '/clinicians') return {'data': _clinicians};
  if (path == '/users/me') return syntheticProfileAccount;
  if (path == '/patient-profiles/me')
    return {'id': 'synthetic-profile', ...syntheticPatientProfile};
  if (path == '/users/me/dependents')
    return {
      'data': [
        {
          'id': 'synthetic-member',
          'patient_profile_id': 'synthetic-member',
          'full_name': 'Demo family member',
          'relationship': 'child',
          'date_of_birth': '2018-02-10',
          'sex': 'female'
        }
      ]
    };
  if (path == '/families/me')
    return {
      'id': 'synthetic-family',
      'name': 'Demo family',
      'is_head': true,
      'members': [],
      'gp_clinician': _clinicians.first,
      'obgyn_clinician': null
    };
  if (path == '/appointments')
    return {
      'data': [_appointment]
    };
  if (path.endsWith('/reschedule-options'))
    return {
      'appointment': _appointment,
      'clinician_name': _clinicians.first['full_name'],
      'data': [
        {
          'id': 'synthetic-slot',
          'starts_at': DateTime.utc(2027, 1, 22, 9).toIso8601String(),
          'duration_minutes': 30,
          'modality': 'chat'
        }
      ],
      'meta': {'has_more': false, 'next_cursor': null}
    };
  if (path == '/consultations/options')
    return {
      'remote_fees': {'general_practice': 0, 'specialist': 0},
      'modes': ['remote', 'hospital'],
      'facilities': _facilities
    };
  if (path == '/payments/bills')
    return {
      'data': [
        {
          'id': 'synthetic-bill',
          'reference': 'DEMO-BILL',
          'title': 'Demo consultation',
          'amount': 15000,
          'currency': 'TZS',
          'status': 'due'
        }
      ]
    };
  if (path == '/payments/options')
    return {
      'environment': 'test',
      'providers': ['mpesa', 'tigo_pesa', 'airtel_money'],
      'requires_email': false
    };
  if (path == '/education/articles')
    return {
      'data': [
        {
          'slug': 'demo',
          'title': 'Demo health education',
          'summary':
              'Synthetic article preview for reviewing the education layout.',
          'topic': 'General care'
        }
      ]
    };
  if (path == '/education/topics')
    return {
      'data': [
        {'slug': 'general', 'name': 'General care'}
      ]
    };
  if (path == '/interop/my-history')
    return {
      'data': [
        {
          'id': 'synthetic-record',
          'category': 'consultation',
          'summary': 'Demo completed visit',
          'status': 'completed',
          'occurred_at': '2026-11-16T08:00:00Z',
          'source': {'type': 'ahp', 'name': 'Demo facility'},
          'details': {}
        }
      ]
    };
  return {'data': []};
}

void main() {
  testWidgets('render actual patient screen families for visual comparison',
      (tester) async {
    await tester.runAsync(() async {
      FlutterSecureStorage.setMockInitialValues({});
      await AppPreferences.instance.load();
      await AppPreferences.instance.setLanguage('en');
      await AppPreferences.instance.setReduceMotion(true);
      await L.load();
      final temp = await Directory.systemTemp.createTemp('ahealth-visual-');
      await initializeDesktopDatabase(directory: temp);
      await Session.save(
          accessToken: 'synthetic',
          refreshToken: 'synthetic',
          user: {
            ...syntheticProfileAccount,
            'patient_profile_id': 'synthetic-profile'
          });
      final fonts = FontLoader('OpenSans')
        ..addFont(
            rootBundle.load('assets/fonts/open-sans/OpenSans-Regular.ttf'))
        ..addFont(
            rootBundle.load('assets/fonts/open-sans/OpenSans-Semibold.ttf'))
        ..addFont(rootBundle.load('assets/fonts/open-sans/OpenSans-Bold.ttf'));
      await fonts.load();
      await (FontLoader('MaterialIcons')
            ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf')))
          .load();
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(
          const MethodChannel('dev.fluttercommunity.plus/connectivity'),
          (_) async => 'wifi');
      messenger.setMockMethodCallHandler(
          const MethodChannel('dev.fluttercommunity.plus/connectivity_status'),
          (_) async => null);
      Api.connectivityProbeForTesting = () async => true;
      final dio = Dio(BaseOptions(validateStatus: (_) => true));
      dio.interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
        if (request.method != 'GET') {
          handler.resolve(
              Response(requestOptions: request, statusCode: 403, data: {
            'error': {'message': 'Synthetic visual review forbids writes.'}
          }));
        } else {
          handler.resolve(Response(
              requestOptions: request,
              statusCode: 200,
              data: _payload(Uri.parse(request.path).path)));
        }
      }));
      Api.useDioForTesting(dio);
      final care =
          PatientCareRepository(get: (path, {query}) async => _payload(path));
      final pages = <String, Widget Function()>{
        'home': () => const HomeScreen(),
        'facilities': () =>
            FacilityBrowserScreen(loadFacilities: () async => _facilities),
        'clinicians': () => DoctorDirectoryScreen(
            facilityId: 'synthetic-facility',
            facilityName: 'Demo Health Centre',
            loadDoctors: () async => _clinicians),
        'appointments': () => AppointmentsScreen(repository: care),
        'reschedule': () => AppointmentRescheduleScreen(
            appointmentId: 'synthetic-appointment', repository: care),
        'medicines': () =>
            MedicationFollowupScreen(repository: MedicationFixture()),
        'diagnostics': () => DiagnosticsScreen(loadOrders: () async => _orders),
        'lab-report': () => DiagnosticDetailScreen(
            orderId: 'synthetic-order', loadOrder: (_) async => _report),
        'profile': () => ProfileScreen(repository: ProfileFixture()),
        'messages': () => MessagesScreen(repository: MessagesFixture()),
        'family': () => const FamilyScreen(),
        'emergency': () => const EmergencyScreen(),
        'settings': () => const AppSettingsScreen(),
        'bills': () => const PaymentBillsScreen(),
        'consultation': () => NewConsultationScreen(repository: care),
        'privacy': () => const PrivacyConsentScreen(),
        'referrals': () => ReferralsScreen(
            loadReferrals: () async => [
                  {
                    'id': 'synthetic-referral',
                    'status': 'accepted',
                    'reason': 'Synthetic referral review',
                    'destination': {
                      'facility': {'name': 'Demo receiving facility'}
                    }
                  }
                ]),
        'history': () => const HealthHistoryScreen(),
        'education': () => const EducationScreen(),
        'screening': () => const ScreeningScreen(),
        'vaccinations': () => const VaccinationsScreen(),
        'feedback': () => const FeedbackScreen(),
        'insurance': () => const InsurancePaymentsScreen(),
        'checkins': () => const CheckInsScreen(),
        'login': () => const LoginScreen(phoneSetup: true),
        'diagnostics-empty': () =>
            DiagnosticsScreen(loadOrders: () async => []),
        'diagnostics-error': () => DiagnosticsScreen(
            loadOrders: () async =>
                throw StateError('Synthetic service unavailable')),
      };
      final out = Directory('docs/docspot/screenshots');
      await out.create(recursive: true);
      final key = GlobalKey();
      final evidence = <Map<String, dynamic>>[];
      final errors = <String>[];
      final only = Platform.environment['AHP_DOCSPOT_ONLY'];
      for (final entry in pages.entries
          .where((e) => only == null || only.split(',').contains(e.key))) {
        final variants = [
          'home',
          'clinicians',
          'appointments',
          'medicines',
          'profile',
          'messages',
          'lab-report',
          'settings'
        ].contains(entry.key)
            ? ['phone', 'dark-large', 'wide']
            : ['phone'];
        for (final variant in variants) {
          final width = variant == 'wide' ? 1280.0 : 390.0;
          final dark = variant == 'dark-large';
          tester.view.physicalSize = Size(width, 844);
          tester.view.devicePixelRatio = 1;
          await tester.pumpWidget(const SizedBox.shrink());
          await tester.pump();
          await tester.pumpWidget(RepaintBoundary(
              key: key,
              child: MaterialApp(
                  debugShowCheckedModeBanner: false,
                  theme: dark ? buildDarkTheme() : buildTheme(),
                  locale: const Locale('en'),
                  supportedLocales: const [
                    Locale('en'),
                    Locale('sw'),
                    Locale('fr')
                  ],
                  localizationsDelegates: GlobalMaterialLocalizations.delegates,
                  builder: (context, child) => MediaQuery(
                      data: MediaQuery.of(context).copyWith(
                          textScaler: TextScaler.linear(dark ? 1.3 : 1),
                          disableAnimations: true),
                      child: Column(children: [
                        Material(
                            color: const Color(0xFF123B64),
                            child: SizedBox(
                                height: 22,
                                child: Center(
                                    child: Text(
                                        'SYNTHETIC UI REVIEW · ${entry.key}',
                                        textDirection: TextDirection.ltr,
                                        style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 10))))),
                        Expanded(child: child!)
                      ])),
                  home: entry.value())));
          for (var i = 0; i < 12; i++) {
            await tester.pump(const Duration(milliseconds: 80));
            await Future<void>.delayed(const Duration(milliseconds: 25));
          }
          if (entry.key == 'home') {
            for (var i = 0;
                i < 100 && find.text('Hello, Synthetic').evaluate().isEmpty;
                i++) {
              await Future<void>.delayed(const Duration(milliseconds: 50));
              await tester.pump(const Duration(milliseconds: 50));
            }
            expect(find.text('Hello, Synthetic'), findsOneWidget,
                reason:
                    'Home capture must show the loaded fixture, not an in-flight skeleton.');
          }
          Object? error;
          while ((error = tester.takeException()) != null) {
            errors.add('${entry.key}-$variant: $error');
          }
          final boundary =
              key.currentContext!.findRenderObject() as RenderRepaintBoundary;
          final screenshot = await boundary.toImage();
          final data =
              await screenshot.toByteData(format: ui.ImageByteFormat.png);
          final filename = '${entry.key}-$variant.png';
          await File('${out.path}/$filename')
              .writeAsBytes(data!.buffer.asUint8List());
          screenshot.dispose();
          evidence.add({
            'screen': entry.key,
            'variant': variant,
            'width': width,
            'file': filename,
            'source': 'Flutter native widget renderer, synthetic fixtures'
          });
        }
      }
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      if (only != null && await File('${out.path}/manifest.json').exists()) {
        final previous =
            jsonDecode(await File('${out.path}/manifest.json').readAsString())
                as List;
        evidence.insertAll(
            0,
            previous
                .where((entry) => !only.split(',').contains(entry['screen']))
                .map((entry) => Map<String, dynamic>.from(entry as Map)));
      }
      await File('${out.path}/manifest.json')
          .writeAsString(const JsonEncoder.withIndent('  ').convert(evidence));
      await File('${out.path}/render-errors.txt')
          .writeAsString(errors.join('\n\n'));
      await (await Db.instance).close();
      await temp.delete(recursive: true);
      Api.useDioForTesting(null);
      Api.connectivityProbeForTesting = null;
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
      expect(errors, isEmpty,
          reason: 'See docs/docspot/screenshots/render-errors.txt');
    });
  }, skip: Platform.environment['AHP_DOCSPOT_CAPTURE'] != '1');
}

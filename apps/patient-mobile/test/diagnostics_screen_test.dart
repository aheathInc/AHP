import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/screens/diagnostics_screen.dart';
import 'package:a_health_patient/core/session.dart';

void main() {
  testWidgets('API failure has retry and is not presented as an empty record',
      (tester) async {
    var calls = 0;
    await tester
        .pumpWidget(MaterialApp(home: DiagnosticsScreen(loadOrders: () async {
      if (calls++ == 0) throw Exception('Unavailable');
      return [];
    })));
    await tester.pumpAndSettle();
    expect(find.text('Hakuna kipimo kilichoagizwa kwenye rekodi zako.'),
        findsNothing);
    await tester.tap(find.text('Jaribu tena'));
    await tester.pumpAndSettle();
    expect(find.text('Hakuna kipimo kilichoagizwa kwenye rekodi zako.'),
        findsOneWidget);
  });
  testWidgets('unreleased findings are hidden even if a payload contains them',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: DiagnosticDetailScreen(
            orderId: 'synthetic',
            loadOrder: (_) async => {
                  'id': 'synthetic',
                  'status': 'collected',
                  'report_state': 'preliminary',
                  'investigation_code': 'SYNTHETIC TEST',
                  'narrative': 'Secret preliminary narrative',
                  'values': [
                    {'analyte': 'Unreleased analyte', 'value': '123'}
                  ]
                })));
    await tester.pumpAndSettle();
    expect(find.text('Unreleased analyte'), findsNothing);
    expect(find.text('Secret preliminary narrative'), findsNothing);
    expect(find.textContaining('bado hayajaidhinishwa'), findsOneWidget);
  });
  testWidgets(
      'released report shows provenance and does not label qualitative findings normal',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: DiagnosticDetailScreen(
            orderId: 'synthetic',
            loadOrder: (_) async => {
                  'id': 'synthetic',
                  'status': 'resulted',
                  'released_by_name': 'Synthetic verifier',
                  'investigation_code': 'SYNTHETIC TEST',
                  'values': [
                    {
                      'analyte': 'Qualitative result',
                      'value': 'Reactive',
                      'flag': 'not_assessed'
                    }
                  ]
                })));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Qualitative result'), 250,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Haijatathminiwa kiotomatiki'), findsOneWidget);
    expect(find.text('Ndani ya kiwango kilichotolewa'), findsNothing);
  });
  testWidgets('account change discards an in-flight laboratory report',
      (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    final pending = Completer<Map<String, dynamic>>();
    await tester.pumpWidget(MaterialApp(
        home: DiagnosticDetailScreen(
            orderId: 'old', loadOrder: (_) => pending.future)));
    await Session.save(
        accessToken: 'synthetic',
        refreshToken: 'synthetic',
        user: {'id': 'different', 'role': 'patient'});
    await tester.pumpAndSettle();
    pending.complete({
      'id': 'old',
      'status': 'resulted',
      'investigation_code': 'Previous patient private test'
    });
    await tester.pumpAndSettle();
    expect(find.text('Previous patient private test'), findsNothing);
    expect(find.textContaining('Akaunti imebadilika'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await Session.clear();
  });
  testWidgets('report fits a narrow screen with enlarged text', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(2)),
            child: child!),
        home: DiagnosticDetailScreen(
            orderId: 'synthetic-long-reference',
            loadOrder: (_) async => {
                  'id': 'synthetic-long-reference',
                  'status': 'resulted',
                  'investigation_code': 'SYNTHETIC COMPREHENSIVE REPORT',
                  'values': [
                    {
                      'analyte': 'Synthetic analyte with a long name',
                      'value': '42',
                      'unit': 'Synthetic unit',
                      'flag': 'not_assessed'
                    }
                  ]
                })));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
        find.text('Haijatathminiwa kiotomatiki'), 250,
        scrollable: find.byType(Scrollable).first);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}

import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/config.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/widgets/prescription_nearby_pharmacies.dart';

class _LiveHttpOverrides extends HttpOverrides {}

void main() {
  final fixturePath = Platform.environment['AHP_QR_FIXTURE'];
  testWidgets(
      'live facility stockout automatically displays the matching nearby pharmacy',
      (tester) async {
    await HttpOverrides.runWithHttpOverrides(() async {
      await tester.runAsync(() async {
        expect(Config.baseUrlFor('/prescriptions/x/fulfillment'),
            'http://127.0.0.1:4011');
        final fixture =
            jsonDecode(File(fixturePath!).readAsStringSync()) as Map;
        final token = fixture['patientToken'] as String;
        final claims = jsonDecode(utf8.decode(
            base64Url.decode(base64Url.normalize(token.split('.')[1])))) as Map;
        FlutterSecureStorage.setMockInitialValues({});
        await Session.save(
            accessToken: token,
            refreshToken: 'unused-live-test',
            user: {'id': claims['sub'], 'role': 'patient'});
        final fulfillment = Map<String, dynamic>.from(await Api.get(
            '/prescriptions/${fixture['prescriptionId']}/fulfillment') as Map);
        expect(
            ((fulfillment['facility_pharmacy'] as Map)['items'] as List)
                .first['availability'],
            'unavailable');
        await tester.pumpWidget(MaterialApp(
            home: Scaffold(
                body: SingleChildScrollView(
                    child: PrescriptionNearbyPharmacies(
                        fulfillment: fulfillment,
                        latitude: -6.8,
                        longitude: 39.28)))));
        for (var attempt = 0;
            attempt < 20 &&
                find
                    .textContaining('AHP Synthetic Nearby Pharmacy')
                    .evaluate()
                    .isEmpty;
            attempt++) {
          await tester.pump();
          await Future<void>.delayed(const Duration(milliseconds: 500));
          await tester.pump();
        }
        expect(find.textContaining('AHP Synthetic Nearby Pharmacy'),
            findsOneWidget);
        expect(find.textContaining('DIFFERENT STRENGTH'), findsNothing);
        expect(find.textContaining('Zilizopo: 20'), findsOneWidget);
        await tester.pumpWidget(const SizedBox());
      });
    }, _LiveHttpOverrides());
  }, skip: fixturePath == null);
}

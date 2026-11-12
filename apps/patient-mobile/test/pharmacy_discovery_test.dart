import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/patient_care.dart';
import 'package:a_health_patient/core/prescription_pharmacy.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/widgets/prescription_nearby_pharmacies.dart';

Map<String, dynamic> fulfillment(
        {String availability = 'unavailable',
        String status = 'active',
        int remaining = 10}) =>
    {
      'status': status,
      'fulfilment_status': remaining == 0 ? 'complete' : 'not_dispensed',
      'facility_pharmacy': {
        'id': 'facility-pharmacy',
        'items': [
          {'prescription_item_id': 'item', 'availability': availability}
        ]
      },
      'items': [
        {
          'id': 'item',
          'medication_name': 'Synthetic medicine 100mg',
          'quantity_remaining': remaining
        }
      ]
    };
Map<String, dynamic> stock(String id, double distance,
        {String name = 'Synthetic medicine 100mg',
        bool fresh = true,
        String status = 'available'}) =>
    {
      'pharmacy': {
        'id': id,
        'name': id,
        'is_verified': true,
        'distance_km': distance,
        'location': {'lat': -6.8, 'lng': 39.2}
      },
      'medication_name': name,
      'inventory_fresh': fresh,
      'quantity_on_hand': 20,
      'fulfillment_status': status
    };
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  test(
      'only unresolved facility stock and positive active quantities require discovery',
      () {
    expect(pharmacyShortfalls(fulfillment()).length, 1);
    expect(
        pharmacyShortfalls(fulfillment(availability: 'partially_available'))
            .length,
        1);
    expect(pharmacyShortfalls(fulfillment(availability: 'unknown')).length, 1);
    expect(pharmacyShortfalls(fulfillment(availability: 'available')), isEmpty);
    expect(pharmacyShortfalls(fulfillment(status: 'discontinued')), isEmpty);
    expect(pharmacyShortfalls(fulfillment(remaining: 0)), isEmpty);
    expect(
        pharmacyShortfalls({...fulfillment(), 'fulfilment_status': 'expired'}),
        isEmpty);
  });
  test(
      'recommendations exclude other strengths, unknown/stale stock and facility, ordered nearest first',
      () {
    final rows = [
      stock('far', 4),
      stock('near', 1),
      stock('near', 2),
      stock('stale', 0.1, fresh: false),
      stock('different', 0.2, name: 'Synthetic medicine 200mg'),
      stock('unknown', 0.3, status: 'unknown'),
      stock('facility-pharmacy', 0.0)
    ];
    expect(
        confirmedNearbyPharmacies(
                rows, 'Synthetic medicine 100mg', 'facility-pharmacy')
            .map((r) => (r['pharmacy'] as Map)['id']),
        ['near', 'far']);
  });
  testWidgets(
      'saved location automatically searches exact drug and remaining quantity',
      (tester) async {
    final queries = <Map<String, dynamic>?>[];
    final repository = PatientCareRepository(get: (path, {query}) async {
      queries.add(query);
      return {
        'data': [stock('Near pharmacy', 1)]
      };
    });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: PrescriptionNearbyPharmacies(
                    fulfillment: fulfillment(),
                    latitude: -6.8,
                    longitude: 39.2,
                    repository: repository)))));
    await tester.pumpAndSettle();
    expect(queries.single?['exact_match'], 'true');
    expect(queries.single?['required_quantity'], 10);
    expect(queries.single?['lat'], -6.8);
    expect(find.text('Near pharmacy • 1.0 km'), findsOneWidget);
  });
  testWidgets('no location does not fetch or invent a distance',
      (tester) async {
    var calls = 0;
    final repository = PatientCareRepository(get: (path, {query}) async {
      calls++;
      return {'data': []};
    });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: PrescriptionNearbyPharmacies(
                fulfillment: fulfillment(), repository: repository))));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.text('Ruhusu location ili kuona maduka yaliyo karibu nawe.'),
        findsOneWidget);
  });
  testWidgets(
      'search failure stays retryable and account switch discards late results',
      (tester) async {
    var fail = true;
    final pending = Completer<dynamic>();
    final repository = PatientCareRepository(get: (path, {query}) async {
      if (fail) throw Exception('offline');
      return pending.future;
    });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: PrescriptionNearbyPharmacies(
                    fulfillment: fulfillment(),
                    latitude: -6.8,
                    longitude: 39.2,
                    repository: repository)))));
    await tester.pumpAndSettle();
    expect(find.text('Utafutaji haujafaulu. Angalia intaneti na ujaribu tena.'),
        findsOneWidget);
    fail = false;
    await tester.ensureVisible(find.text('Sasisha pharmacy za karibu'));
    await tester.tap(find.text('Sasisha pharmacy za karibu'));
    await tester.pump();
    await Session.save(
        accessToken: 'synthetic',
        refreshToken: 'synthetic',
        user: {'id': 'other-patient', 'role': 'patient'});
    pending.complete({
      'data': [stock('Old account pharmacy', 1)]
    });
    await tester.pumpAndSettle();
    expect(find.text('Old account pharmacy • 1.0 km'), findsNothing);
    expect(find.text('Pharmacy za karibu kwa dawa zilizobaki'), findsNothing);
  });
}

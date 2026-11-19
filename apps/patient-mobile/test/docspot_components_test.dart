import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/doctor_directory_screen.dart';
import 'package:a_health_patient/widgets/patient_ui.dart';
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
      'doctor filters use supplied specialties and unknown availability cannot join a queue',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: buildTheme(),
        home: DoctorDirectoryScreen(
            facilityId: 'synthetic',
            facilityName: 'Synthetic facility',
            loadDoctors: () async => [
                  {
                    'id': 'a',
                    'full_name': 'Synthetic Amina',
                    'specialty': 'General practice',
                    'status': 'available'
                  },
                  {
                    'id': 'b',
                    'full_name': 'Synthetic Juma',
                    'specialty': 'Paediatrics',
                    'status': 'off_duty'
                  },
                  {
                    'id': 'c',
                    'full_name': 'Synthetic Neema',
                    'specialty': 'Paediatrics'
                  },
                ])));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'Join the queue'), findsOneWidget);
    await tester.tap(find.widgetWithText(ChoiceChip, 'General practice'));
    await tester.pumpAndSettle();
    expect(find.text('Synthetic Juma'), findsNothing);
    expect(find.text('Synthetic Amina'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'no such clinician');
    await tester.pumpAndSettle();
    expect(
        find.text('No matching doctors. Try another search.'), findsOneWidget);
    await tester.tap(find.byTooltip('Clear search'));
    await tester.pumpAndSettle();
    expect(find.text('Synthetic Amina'), findsOneWidget);
  });
  testWidgets(
      'appointment actions stay distinct from opening a record and metadata survives large text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var opened = 0, rescheduled = 0;
    await tester.pumpWidget(MaterialApp(
        theme: buildDarkTheme(),
        home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
            child: Scaffold(
                body: SingleChildScrollView(
                    child: PatientAppointmentCard(
              name: 'Synthetic clinician with a long name',
              specialty: 'Family medicine',
              startsAt: '2027-01-21T09:15:00Z',
              status: 'Server status: booked',
              modality: 'chat',
              onTap: () => opened++,
              actions: [
                OutlinedButton(
                    onPressed: () => rescheduled++,
                    child: const Text('Reschedule'))
              ],
            ))))));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Server status: booked'), findsOneWidget);
    await tester.tap(find.text('Reschedule'));
    await tester.pumpAndSettle();
    expect(rescheduled, 1);
    expect(opened, 0);
    await tester.tap(find.text('Synthetic clinician with a long name'));
    expect(opened, 1);
  });
}

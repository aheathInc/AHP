import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/widgets/service_directory.dart';
import 'package:a_health_patient/core/theme.dart';

void main() {
  testWidgets(
      'service search keeps emergency available and routes only selected destinations',
      (tester) async {
    Widget? opened;
    const family = Scaffold(body: Text('Family destination'));
    await tester.pumpWidget(MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
            body: SingleChildScrollView(
                child: ServiceDirectory(
                    sections: const [
              (
                title: 'Care',
                items: [
                  (
                    icon: Icons.calendar_month,
                    label: 'Appointments',
                    screen: SizedBox()
                  ),
                  (
                    icon: Icons.family_restroom,
                    label: 'Family care',
                    screen: family
                  )
                ]
              ),
              (
                title: 'Support',
                items: [
                  (icon: Icons.receipt, label: 'Payments', screen: SizedBox())
                ]
              )
            ],
                    emergency: TextButton(
                        onPressed: () {}, child: const Text('Emergency')),
                    onOpen: (page) => opened = page)))));
    await tester.enterText(find.byType(TextField), 'family');
    await tester.pump();
    expect(find.text('Family care'), findsOneWidget);
    expect(find.text('Appointments'), findsNothing);
    expect(find.text('Emergency'), findsOneWidget);
    expect(opened, isNull);
    await tester.tap(find.text('Family care'));
    expect(identical(opened, family), isTrue);
    await tester.enterText(find.byType(TextField), 'no-match');
    await tester.pump();
    expect(
        find.text('No matching services. Try another word.'), findsOneWidget);
    expect(find.text('Emergency'), findsOneWidget);
    await tester.tap(find.byTooltip('Clear search'));
    await tester.pump();
    expect(find.text('Appointments'), findsOneWidget);
    expect(find.text('Payments'), findsOneWidget);
  });
  testWidgets('service groups reflow and remain usable at larger text scale',
      (tester) async {
    tester.view.physicalSize = const Size(1024, 768);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        theme: buildTheme(),
        home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
            child: Scaffold(
                body: SingleChildScrollView(
                    child: ServiceDirectory(sections: const [
              (
                title: 'Care',
                items: [
                  (
                    icon: Icons.family_restroom,
                    label: 'Family care and dependants',
                    screen: SizedBox()
                  )
                ]
              ),
              (
                title: 'Support',
                items: [
                  (
                    icon: Icons.receipt,
                    label: 'Payments and receipts',
                    screen: SizedBox()
                  )
                ]
              )
            ], emergency: const Text('Emergency'), onOpen: (_) {}))))));
    expect(tester.takeException(), isNull);
    expect(find.text('Payments and receipts'), findsOneWidget);
  });
}

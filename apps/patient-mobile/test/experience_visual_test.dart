import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/widgets/common.dart';
import 'package:a_health_patient/widgets/service_directory.dart';

void main() {
  testWidgets('capture native directory at phone and expanded window sizes',
      (tester) async {
    final key = GlobalKey();
    await tester.runAsync(() async {
      FlutterSecureStorage.setMockInitialValues({});
      await AppPreferences.instance.load();
      await AppPreferences.instance.setLanguage('en');
      await L.load();
      final font = FontLoader('Roboto')
        ..addFont(Future.value(ByteData.sublistView(await File(
                '/home/kali/.local/flutter-sdk/engine/src/flutter/txt/third_party/fonts/Roboto-Regular.ttf')
            .readAsBytes())));
      await font.load();
      final icons = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await icons.load();
      await Directory('/home/kali/AHP/.local/evidence').create(recursive: true);
      for (final size in [
        (name: 'phone', width: 390.0, height: 844.0, dark: false, scale: 1.0),
        (
          name: 'phone-dark-large-text',
          width: 390.0,
          height: 844.0,
          dark: true,
          scale: 1.3
        ),
        (
          name: 'expanded',
          width: 1024.0,
          height: 768.0,
          dark: false,
          scale: 1.3
        )
      ]) {
        tester.view.physicalSize = Size(size.width, size.height);
        tester.view.devicePixelRatio = 1;
        final theme = size.dark ? buildDarkTheme() : buildTheme();
        await tester.pumpWidget(RepaintBoundary(
            key: key,
            child: MaterialApp(
                debugShowCheckedModeBanner: false,
                theme: theme.copyWith(
                    textTheme: theme.textTheme.apply(fontFamily: 'Roboto'),
                    primaryTextTheme:
                        theme.primaryTextTheme.apply(fontFamily: 'Roboto')),
                home: MediaQuery(
                    data: MediaQueryData(
                        size: Size(size.width, size.height),
                        textScaler: TextScaler.linear(size.scale)),
                    child: Scaffold(
                        appBar: AppBar(title: const Text('Services')),
                        body: SingleChildScrollView(
                            padding: const EdgeInsets.all(20),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const WorkspaceIntro(
                                      title: 'All services',
                                      description:
                                          'Find the care or support you need.'),
                                  ServiceDirectory(
                                      sections: const [
                                        (
                                          title: 'Care & follow-up',
                                          items: [
                                            (
                                              icon: Icons.calendar_month,
                                              label: 'Appointments',
                                              screen: SizedBox()
                                            ),
                                            (
                                              icon: Icons.medication_outlined,
                                              label: 'Medicines and reminders',
                                              screen: SizedBox()
                                            ),
                                            (
                                              icon: Icons.biotech,
                                              label: 'Tests and results',
                                              screen: SizedBox()
                                            )
                                          ]
                                        ),
                                        (
                                          title: 'Family & support',
                                          items: [
                                            (
                                              icon: Icons.family_restroom,
                                              label: 'Family and dependants',
                                              screen: SizedBox()
                                            ),
                                            (
                                              icon: Icons.receipt_long,
                                              label: 'Bills and receipts',
                                              screen: SizedBox()
                                            )
                                          ]
                                        )
                                      ],
                                      emergency: ListTile(
                                          leading: Icon(
                                              Icons.warning_amber_rounded,
                                              color: (size.dark
                                                      ? AppPalette.dark
                                                      : AppPalette.light)
                                                  .clay),
                                          title: const Text('Emergency'),
                                          trailing:
                                              const Icon(Icons.chevron_right)),
                                      onOpen: (_) {})
                                ])))))));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final boundary =
            key.currentContext!.findRenderObject() as RenderRepaintBoundary;
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await File(
                '/home/kali/AHP/.local/evidence/experience-services-${size.name}.png')
            .writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      }
      await tester.pumpWidget(const SizedBox.shrink());
    });
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  }, skip: Platform.environment['AHP_EXPERIENCE_CAPTURE'] != '1');
}

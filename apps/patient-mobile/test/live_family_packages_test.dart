import 'dart:io';
import 'dart:convert';
import 'dart:ui' as ui;
import 'package:flutter/services.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/app_preferences.dart';
import 'package:a_health_patient/core/l10n.dart';
import 'package:a_health_patient/screens/family_screen.dart';
import 'package:a_health_patient/widgets/common.dart';

class _LiveHttp extends HttpOverrides {}

void main() {
  final file = Platform.environment['AHP_FAMILY_PACKAGE_FIXTURE'];
  testWidgets('live family membership and package request without payment',
      (tester) async {
    final f =
        jsonDecode(File(file!).readAsStringSync()) as Map<String, dynamic>;
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final boundary = GlobalKey();
    Future<void> pause() async {
      await tester.pump(const Duration(milliseconds: 400));
      await Future<void>.delayed(const Duration(seconds: 3));
      await tester.pump(const Duration(milliseconds: 400));
    }

    Future<void> capture(String name) async {
      final b =
          boundary.currentContext!.findRenderObject() as RenderRepaintBoundary;
      final image = await b.toImage();
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      await Directory('/home/kali/AHP/.local/evidence').create(recursive: true);
      await File('/home/kali/AHP/.local/evidence/$name.png')
          .writeAsBytes(data!.buffer.asUint8List());
      image.dispose();
    }

    await HttpOverrides.runWithHttpOverrides(() async {
      await tester.runAsync(() async {
        final fonts = FontLoader('Roboto');
        for (final file in [
          '/home/kali/.local/flutter-sdk/engine/src/flutter/txt/third_party/fonts/Roboto-Regular.ttf',
          '/home/kali/.local/flutter-sdk/bin/cache/dart-sdk/bin/resources/devtools/assets/fonts/Roboto/Roboto-Bold.ttf'
        ]) {
          fonts.addFont(Future.value(
              ByteData.sublistView(await File(file).readAsBytes())));
        }
        await fonts.load();
        final icons = FontLoader('MaterialIcons')
          ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
        await icons.load();
        FlutterSecureStorage.setMockInitialValues({});
        await AppPreferences.instance.load();
        await AppPreferences.instance.setLanguage('en');
        await L.load();
        Api.connectivityProbeForTesting = () async => true;
        await Session.save(
            accessToken: f['session']['access_token'],
            refreshToken: f['session']['refresh_token'],
            user: {
              'id': f['patient']['id'],
              'role': 'patient',
              'full_name': f['patient']['name'],
              'patient_profile_id': f['patient']['profileId']
            });
        final appTheme = buildTheme();
        final filledStyle = appTheme.filledButtonTheme.style!;
        final filledText = filledStyle.textStyle!.resolve({})!;
        await tester.pumpWidget(RepaintBoundary(
            key: boundary,
            child: MaterialApp(
                debugShowCheckedModeBanner: false,
                theme: appTheme.copyWith(
                    textTheme: appTheme.textTheme.apply(fontFamily: "Roboto"),
                    primaryTextTheme:
                        appTheme.primaryTextTheme.apply(fontFamily: "Roboto"),
                    filledButtonTheme: FilledButtonThemeData(
                        style: filledStyle.copyWith(
                            textStyle: WidgetStatePropertyAll(
                                filledText.copyWith(fontFamily: "Roboto"))))),
                home: const FamilyScreen())));
        await pause();
        expect(find.text(f['child']['name']), findsOneWidget);
        if (find.text('Link to family').evaluate().isNotEmpty) {
          await tester.tap(find.text('Link to family'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Link to family').last);
          await pause();
        }
        final family = await Api.get('/families/me');
        expect(
            (family['members'] as List)
                .where((x) => x['patient_profile_id'] == f['child']['id'])
                .length,
            1);
        expect(family['gp_clinician']['id'], f['gp']['profileId']);
        expect(family['obgyn_clinician']['id'], f['obgyn']['profileId']);
        await tester.scrollUntilVisible(
            find.text('View subscription packages'), -300,
            scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        await capture('family-mobile');
        await tester.tap(find.text('View subscription packages'));
        await pause();
        await tester.scrollUntilVisible(
            find.text('SYNTHETIC Basic acceptance package'), 300,
            scrollable: find.byType(Scrollable).last);
        await tester.pumpAndSettle();
        await capture('family-packages-mobile');
        await tester.scrollUntilVisible(
            find.descendant(
                of: find.ancestor(
                    of: find.text('SYNTHETIC Basic acceptance package'),
                    matching: find.byType(Panel)),
                matching: find.text('Request this package')),
            250,
            scrollable: find.byType(Scrollable).last);
        await tester.pumpAndSettle();
        await tester.tap(find.descendant(
            of: find.ancestor(
                of: find.text('SYNTHETIC Basic acceptance package'),
                matching: find.byType(Panel)),
            matching: find.text('Request this package')));
        await tester.pumpAndSettle();
        expect(find.text('Confirm request'), findsOneWidget);
        await tester.tap(find.text('Confirm request'));
        await pause();
        final history = await Api.get(
            '/families/${f['family']['id']}/subscription-requests',
            query: {'status': 'all'});
        expect((history['data'] as List).length, 1);
        expect(history['data'][0]['status'], 'pending');
        expect(history['data'][0]['terms']['price_minor'], 1250000);
        expect((await Api.get('/families/me'))['subscription_tier'], 'none');
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        Api.connectivityProbeForTesting = null;
      });
    }, _LiveHttp());
  }, skip: file == null, timeout: const Timeout(Duration(minutes: 3)));
}

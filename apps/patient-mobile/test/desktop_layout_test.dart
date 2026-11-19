import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/widgets/common.dart';

void main() {
  testWidgets('workspace actions have finite widths on desktop and phone',
      (tester) async {
    for (final width in [1280.0, 390.0]) {
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1;
      var tapped = false;
      await tester.pumpWidget(MaterialApp(
          theme: buildTheme(),
          home: Scaffold(
            body: WorkspaceIntro(
                title: 'Patient workspace',
                description: 'Find the right care service.',
                action: FilledButton.icon(
                    onPressed: () {
                      tapped = true;
                    },
                    icon: const Icon(Icons.search),
                    label: const Text('Find facility'))),
          )));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final size = tester.getSize(find.byType(FilledButton));
      expect(size.width.isFinite, isTrue);
      expect(size.height, greaterThanOrEqualTo(52));
      await tester.tap(find.text('Find facility'));
      await tester.pumpAndSettle();
      expect(tapped, isTrue);
    }
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

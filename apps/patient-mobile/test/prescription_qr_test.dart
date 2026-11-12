import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:a_health_patient/widgets/prescription_handoff_qr.dart';

void main() {
  testWidgets('QR is readable on a white background in dark mode',
      (tester) async {
    final reference =
        Platform.environment['AHP_QR_REFERENCE'] ?? ('aB_9-' * 8 + 'abc');
    final key = GlobalKey();
    await tester.pumpWidget(MaterialApp(
        theme: ThemeData.dark(),
        home: Scaffold(
            body: Center(
                child: RepaintBoundary(
                    key: key,
                    child: SizedBox(
                        width: 280,
                        height: 330,
                        child:
                            PrescriptionHandoffQr(reference: reference)))))));
    await tester.pumpAndSettle();
    final qr = tester.widget<QrImageView>(find.byType(QrImageView));
    expect(qr.backgroundColor, Colors.white);
    expect(qr.padding, const EdgeInsets.all(24));
    final output = Platform.environment['AHP_QR_PNG'];
    if (output != null) {
      await tester.runAsync(() async {
        final boundary =
            key.currentContext!.findRenderObject() as RenderRepaintBoundary;
        final image = await boundary.toImage(pixelRatio: 2);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        await File(output).writeAsBytes(data!.buffer.asUint8List());
        image.dispose();
      });
    }
  });
  testWidgets('malformed references are not rendered as QR', (tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: PrescriptionHandoffQr(reference: 'https://example.com')));
    expect(find.byType(QrImageView), findsNothing);
  });
}

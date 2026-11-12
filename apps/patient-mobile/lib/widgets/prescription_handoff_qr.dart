import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../core/l10n.dart';

/// Encodes only the existing opaque reference. Authorization stays on the server.
class PrescriptionHandoffQr extends StatelessWidget {
  const PrescriptionHandoffQr({super.key, required this.reference});
  final String reference;

  @override
  Widget build(BuildContext context) {
    if (!RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(reference)) {
      return const SizedBox.shrink();
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SizedBox(height: 12),
      Text(L.tr('Onyesha QR hii kwa mfamasia aliyeidhinishwa.')),
      const SizedBox(height: 8),
      Semantics(
        label: L.tr('QR ya reference salama ya pharmacy'),
        image: true,
        child: ExcludeSemantics(
          child: SizedBox(
              width: 240,
              height: 240,
              child: QrImageView(
                data: reference,
                backgroundColor: Colors.white,
                padding: const EdgeInsets.all(24),
                errorCorrectionLevel: QrErrorCorrectLevel.H,
                eyeStyle: const QrEyeStyle(
                    eyeShape: QrEyeShape.square, color: Colors.black),
                dataModuleStyle: const QrDataModuleStyle(
                    dataModuleShape: QrDataModuleShape.square,
                    color: Colors.black),
              )),
        ),
      ),
    ]);
  }
}

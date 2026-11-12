import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/l10n.dart';

/// Opens the dialer only; it never assumes a connected call.
class EmergencyCallButton extends StatelessWidget {
  const EmergencyCallButton({super.key, this.openDialer, this.compact = false});
  final Future<bool> Function(Uri)? openDialer;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    Future<void> open() async {
      final uri = Uri(scheme: 'tel', path: '112');
      try {
        final opened = await (openDialer?.call(uri) ??
            launchUrl(uri, mode: LaunchMode.externalApplication));
        if (!opened) throw StateError('No dialer');
      } catch (_) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(L.tr(
                  'Kipiga simu hakikufunguka. Piga 112 moja kwa moja kwenye simu yako.'))));
        }
      }
    }

    final label = L.tr('Piga 112 — Dharura / Polisi');
    if (compact) {
      return Tooltip(
          message: label,
          child: TextButton.icon(
              onPressed: open,
              icon: const Icon(Icons.phone),
              label: const Text('112'),
              style: TextButton.styleFrom(
                  minimumSize: const Size(48, 48),
                  foregroundColor: Theme.of(context).colorScheme.error)));
    }
    return FilledButton.icon(
        onPressed: open,
        icon: const Icon(Icons.phone),
        label: Text(label),
        style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(56),
            backgroundColor: Theme.of(context).colorScheme.error));
  }
}

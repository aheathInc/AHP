import 'package:flutter/material.dart';
import '../core/theme.dart';
import 'patient_ui.dart';

/// Profile surfaces share the same flat, appearance-aware card as clinical UI.
class ProfileCard extends StatelessWidget {
  const ProfileCard(
      {super.key,
      required this.child,
      this.onTap,
      this.padding = const EdgeInsets.all(20),
      this.emphasis = false});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final bool emphasis;
  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final p = AppPalette.of(context);
    return PatientSurface(
        onTap: onTap,
        padding: padding,
        color: emphasis ? p.deepOcean : p.surface,
        child: child);
  }
}

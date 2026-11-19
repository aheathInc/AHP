import 'dart:ui' as ui;
import 'patient_ui.dart';
import '../core/app_preferences.dart';
import '../core/l10n.dart';

import 'package:flutter/material.dart';

import '../core/theme.dart';

/// A-Health's patient-facing visual layer. These widgets present supplied
/// content and callbacks; they do not invent clinical state or API responses.
class PremiumCard extends StatefulWidget {
  const PremiumCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(18),
    this.background,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final Color? background;

  @override
  State<PremiumCard> createState() => _PremiumCardState();
}

/// A quiet shared surface for related patient actions.
class PremiumBentoFrame extends StatelessWidget {
  const PremiumBentoFrame({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(10),
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final palette = AppPalette.of(context);
    final solid = AppPreferences.instance.solidSurfaces ||
        AppPreferences.instance.colorVision == ColorVisionMode.highContrast ||
        (MediaQuery.maybeOf(context)?.highContrast ?? false);
    final panel = Container(
      padding: padding,
      decoration: BoxDecoration(
          color: palette.surface.withValues(alpha: solid ? 1 : .90),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: palette.line)),
      child: child,
    );
    if (solid) return panel;
    return ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: BackdropFilter(
            filter: ui.ImageFilter.blur(sigmaX: 8, sigmaY: 8), child: panel));
  }
}

class _PremiumCardState extends State<PremiumCard> {
  @override
  Widget build(BuildContext context) => PatientSurface(
      onTap: widget.onTap,
      padding: widget.padding,
      color: widget.background,
      child: widget.child);
}

/// Compatibility wrapper for a high-emphasis operational summary.
/// Flat brand colour replaces the former decorative gradient and animation.
class PremiumAuroraHero extends StatefulWidget {
  const PremiumAuroraHero({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(24),
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  State<PremiumAuroraHero> createState() => _PremiumAuroraHeroState();
}

class _PremiumAuroraHeroState extends State<PremiumAuroraHero> {
  @override
  Widget build(BuildContext context) => PatientSurface(
      color: AppPalette.of(context).deepOcean,
      padding: widget.padding,
      child: widget.child);
}

class PremiumHeroButton extends StatefulWidget {
  const PremiumHeroButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon = Icons.arrow_forward_rounded,
  });

  final String label;
  final VoidCallback onPressed;
  final IconData icon;

  @override
  State<PremiumHeroButton> createState() => _PremiumHeroButtonState();
}

class _PremiumHeroButtonState extends State<PremiumHeroButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final palette = AppPalette.of(context);
    final reduceMotion =
        (MediaQuery.maybeOf(context)?.disableAnimations ?? false) ||
            AppPreferences.instance.reduceMotion;
    return AnimatedScale(
      scale: _pressed ? .98 : 1,
      duration:
          reduceMotion ? Duration.zero : const Duration(milliseconds: 130),
      child: Material(
        color: palette.surface,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: widget.onPressed,
          onHighlightChanged: (pressed) => setState(() => _pressed = pressed),
          borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    widget.label,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: palette.petrol,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Icon(widget.icon, color: palette.petrol, size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class PremiumSectionHeading extends StatelessWidget {
  const PremiumSectionHeading(
    this.title, {
    super.key,
    this.action,
    this.onAction,
  });

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              L.tr(title),
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
          if (action != null && onAction != null)
            TextButton(onPressed: onAction, child: Text(action!)),
        ],
      ),
    );
  }
}

class PremiumAction extends StatelessWidget {
  const PremiumAction({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.iconColor,
    this.iconBackground,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final Color? iconColor;
  final Color? iconBackground;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final palette = AppPalette.of(context);
    return PremiumCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: iconBackground ?? palette.mintWash,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: iconColor ?? palette.petrol, size: 23),
          ),
          const SizedBox(height: 14),
          Text(L.tr(title), style: Theme.of(context).textTheme.titleSmall),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(subtitle!, style: Theme.of(context).textTheme.bodySmall),
          ],
        ],
      ),
    );
  }
}

class PremiumLinkRow extends StatelessWidget {
  const PremiumLinkRow({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.iconColor,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final palette = AppPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: PremiumCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        onTap: onTap,
        child: Row(
          children: [
            Container(
              height: 44,
              width: 44,
              decoration: BoxDecoration(
                color: palette.mintWash,
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(icon, color: iconColor ?? palette.petrol),
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    L.tr(title),
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      subtitle!,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(Icons.chevron_right_rounded, color: palette.inkSoft),
          ],
        ),
      ),
    );
  }
}

class PremiumStatus extends StatelessWidget {
  const PremiumStatus(this.label, {super.key, this.urgent = false});

  final String label;
  final bool urgent;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Semantics(
      container: true,
      label: label,
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: urgent
                ? AppPalette.of(context).urgentWash
                : AppPalette.of(context).paperSunk,
            borderRadius: BorderRadius.circular(100),
          ),
          child: Text(
            L.tr(label),
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: urgent
                  ? AppPalette.of(context).clay
                  : AppPalette.of(context).ink,
            ),
          ),
        ),
      ),
    );
  }
}

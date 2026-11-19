import 'package:flutter/material.dart';
import '../core/l10n.dart';
import '../core/theme.dart';
import '../core/design_tokens.dart';
import 'premium.dart';

/// Patient tasks only: no illustrative appointments, health scores or alerts.
class CareHomeActions extends StatelessWidget {
  const CareHomeActions(
      {super.key,
      required this.onFindCare,
      required this.onConsultation,
      required this.onEmergency});
  final VoidCallback onFindCare, onConsultation, onEmergency;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Material(
          color: p.surface,
          borderRadius: BorderRadius.circular(CareRadius.pill),
          child: InkWell(
              key: const Key('care-search'),
              borderRadius: BorderRadius.circular(CareRadius.pill),
              onTap: onFindCare,
              child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
                  child: Row(children: [
                    Icon(Icons.search_rounded, color: p.inkSoft),
                    const SizedBox(width: 12),
                    Expanded(
                        child: Text(L.tr('Tafuta daktari au kituo'),
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(color: p.inkSoft))),
                    Icon(Icons.arrow_forward_rounded,
                        size: 20, color: p.petrol),
                  ])))),
      const SizedBox(height: 12),
      CareEmergencyLink(onTap: onEmergency),
    ]);
  }
}

class CareShortcuts extends StatelessWidget {
  const CareShortcuts({super.key, required this.items});
  final List<({IconData icon, String label, VoidCallback onTap})> items;
  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return LayoutBuilder(builder: (context, size) {
      final largeText = MediaQuery.textScalerOf(context).scale(1) > 1.15;
      final columns =
          size.maxWidth >= 900 ? 6 : (size.maxWidth < 340 || largeText ? 2 : 3);
      Widget tile(int i) => PremiumCard(
          onTap: items[i].onTap,
          padding: const EdgeInsets.all(10),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                    color: p.mintWash,
                    borderRadius: BorderRadius.circular(CareRadius.control)),
                child: Icon(items[i].icon,
                    color: p.petrol, size: CareLayout.categoryIcon)),
            const SizedBox(height: 12),
            Text(items[i].label,
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontSize: 13, height: 1.4, letterSpacing: 0)),
          ]));
      return Column(children: [
        for (var row = 0; row < items.length; row += columns) ...[
          if (row > 0) const SizedBox(height: 12),
          IntrinsicHeight(
              child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                for (var col = 0; col < columns; col++) ...[
                  if (col > 0) const SizedBox(width: 10),
                  Expanded(
                      child: row + col < items.length
                          ? ConstrainedBox(
                              constraints: const BoxConstraints(minHeight: 122),
                              child: tile(row + col))
                          : const SizedBox()),
                ],
              ])),
        ]
      ]);
    });
  }
}

/// One grouped surface, separated rows: easier to scan than stacked cards.
class CareLinkGroup extends StatelessWidget {
  const CareLinkGroup({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => PremiumCard(
      padding: EdgeInsets.zero,
      child: Column(children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const Divider(height: 1, indent: 58, endIndent: 18),
          children[i],
        ]
      ]));
}

class CareLink extends StatelessWidget {
  const CareLink(
      {super.key,
      required this.icon,
      required this.title,
      required this.onTap,
      this.subtitle});
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 5),
        minVerticalPadding: 14,
        leading: Icon(icon, color: p.petrol, size: 23),
        title: Text(title, style: Theme.of(context).textTheme.titleSmall),
        subtitle: subtitle == null
            ? null
            : Text(subtitle!, style: Theme.of(context).textTheme.bodySmall),
        trailing: Icon(Icons.chevron_right_rounded, color: p.inkSoft, size: 20),
        onTap: onTap);
  }
}

/// Urgent access remains ahead of the search panel at compact widths.
class CareEmergencyLink extends StatelessWidget {
  const CareEmergencyLink({super.key, required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Material(
        color: p.urgentWash,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: onTap,
            child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(children: [
                  Icon(Icons.emergency_outlined, color: p.clay),
                  const SizedBox(width: 12),
                  Expanded(
                      child: Text(L.tr('Dharura'),
                          style: TextStyle(
                              color: p.clay, fontWeight: FontWeight.w700))),
                  Icon(Icons.arrow_forward_rounded, color: p.clay, size: 20),
                ]))));
  }
}

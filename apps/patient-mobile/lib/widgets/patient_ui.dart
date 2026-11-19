import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/app_preferences.dart';
import '../core/design_tokens.dart';
import '../core/l10n.dart';
import '../core/theme.dart';

class PatientSurface extends StatefulWidget {
  const PatientSurface(
      {super.key,
      required this.child,
      this.onTap,
      this.padding = const EdgeInsets.all(CareSpace.lg),
      this.color,
      this.outline});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final Color? color, outline;
  @override
  State<PatientSurface> createState() => _PatientSurfaceState();
}

class _PatientSurfaceState extends State<PatientSurface> {
  bool _pressed = false;
  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final reduced = AppPreferences.instance.reduceMotion ||
        MediaQuery.disableAnimationsOf(context);
    final high =
        AppPreferences.instance.colorVision == ColorVisionMode.highContrast ||
            MediaQuery.highContrastOf(context);
    return AnimatedScale(
        scale: _pressed && widget.onTap != null ? .985 : 1,
        duration: reduced ? Duration.zero : CareMotion.press,
        curve: CareMotion.curve,
        child: Material(
            color: widget.color ?? p.surface,
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(CareRadius.card),
                side: high || widget.outline != null
                    ? BorderSide(color: widget.outline ?? p.line)
                    : BorderSide.none),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
                onTap: widget.onTap,
                onHighlightChanged: widget.onTap == null
                    ? null
                    : (value) => setState(() => _pressed = value),
                child: Padding(padding: widget.padding, child: widget.child))));
  }
}

/// Keep every existing route and Scaffold behavior while sharing a reading width.
/// Map and call canvases intentionally keep their original full-width Scaffold.
class PatientScaffold extends StatelessWidget {
  const PatientScaffold(
      {super.key,
      this.appBar,
      this.body,
      this.bottomNavigationBar,
      this.floatingActionButton,
      this.backgroundColor,
      this.resizeToAvoidBottomInset,
      this.bottomSheet,
      this.extendBody = false,
      this.extendBodyBehindAppBar = false});
  final PreferredSizeWidget? appBar;
  final Widget? body, bottomNavigationBar, floatingActionButton, bottomSheet;
  final Color? backgroundColor;
  final bool? resizeToAvoidBottomInset;
  final bool extendBody, extendBodyBehindAppBar;
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: appBar,
      backgroundColor: backgroundColor,
      resizeToAvoidBottomInset: resizeToAvoidBottomInset,
      bottomNavigationBar: bottomNavigationBar,
      floatingActionButton: floatingActionButton,
      bottomSheet: bottomSheet,
      extendBody: extendBody,
      extendBodyBehindAppBar: extendBodyBehindAppBar,
      body: body == null
          ? null
          : SafeArea(
              top: appBar == null,
              bottom: true,
              child: Center(
                  child: ConstrainedBox(
                      constraints:
                          const BoxConstraints(maxWidth: CareLayout.reading),
                      child: SizedBox.expand(child: body)))));
}

class PatientAvatar extends StatelessWidget {
  const PatientAvatar(
      {super.key, required this.name, this.imageUrl, this.size = 52});
  final String name;
  final String? imageUrl;
  final double size;
  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final words =
        name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    final initials =
        words.take(2).map((w) => w.characters.first).join().toUpperCase();
    final fallback = Center(
        child: initials.isEmpty
            ? Icon(Icons.person_outline_rounded, color: p.petrol)
            : Text(initials,
                style: TextStyle(
                    color: p.petrol,
                    fontWeight: FontWeight.w700,
                    fontSize: size * .28)));
    final uri = Uri.tryParse(imageUrl ?? '');
    return ExcludeSemantics(
        child: Container(
            width: size,
            height: size,
            clipBehavior: Clip.antiAlias,
            decoration:
                BoxDecoration(shape: BoxShape.circle, color: p.mintWash),
            child: uri != null && ['http', 'https'].contains(uri.scheme)
                ? Image.network(uri.toString(),
                    fit: BoxFit.cover, errorBuilder: (_, __, ___) => fallback)
                : fallback));
  }
}

class PatientStatus extends StatelessWidget {
  const PatientStatus(this.label, {super.key, this.attention = false});
  final String label;
  final bool attention;
  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(attention ? Icons.info_outline_rounded : Icons.circle_outlined,
          size: 14, color: attention ? p.amber : p.petrol),
      const SizedBox(width: 6),
      Flexible(
          child: Text(label,
              style: TextStyle(
                  color: attention ? p.amber : p.petrol,
                  fontSize: 13,
                  fontWeight: FontWeight.w600))),
    ]);
  }
}

class ClinicianIdentityCard extends StatelessWidget {
  const ClinicianIdentityCard(
      {super.key,
      required this.name,
      required this.specialty,
      this.status,
      this.queueLabel,
      this.action,
      this.onTap});
  final String name, specialty;
  final String? status, queueLabel;
  final Widget? action;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => PatientSurface(
      onTap: onTap,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          PatientAvatar(name: name),
          const SizedBox(width: CareSpace.md),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(name, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(specialty, style: Theme.of(context).textTheme.bodySmall),
                if (status != null) ...[
                  const SizedBox(height: 8),
                  PatientStatus(status!)
                ],
              ])),
          if (onTap != null) const Icon(Icons.arrow_forward_rounded, size: 20),
        ]),
        if (queueLabel != null) ...[
          const SizedBox(height: 16),
          Row(children: [
            Icon(Icons.people_outline_rounded,
                size: 20, color: AppPalette.of(context).inkSoft),
            const SizedBox(width: 8),
            Expanded(
                child: Text(queueLabel!,
                    style: Theme.of(context).textTheme.bodySmall))
          ])
        ],
        if (action != null) ...[const SizedBox(height: 16), action!],
      ]));
}

class PatientAppointmentCard extends StatelessWidget {
  const PatientAppointmentCard(
      {super.key,
      required this.name,
      required this.status,
      this.specialty,
      this.startsAt,
      this.modality,
      this.onTap,
      this.actions = const []});
  final String name, status;
  final String? specialty, startsAt, modality;
  final VoidCallback? onTap;
  final List<Widget> actions;
  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final date = DateTime.tryParse(startsAt ?? '')?.toLocal();
    final locale = Localizations.localeOf(context).languageCode;
    return PatientSurface(
        onTap: onTap,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            PatientAvatar(name: name),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(name, style: Theme.of(context).textTheme.titleMedium),
                  if (specialty?.isNotEmpty == true)
                    Text(specialty!,
                        style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 8),
                  PatientStatus(status),
                ])),
            if (onTap != null)
              Icon(Icons.chevron_right_rounded, color: p.inkSoft),
          ]),
          const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Divider(height: 1)),
          Wrap(spacing: 24, runSpacing: 12, children: [
            _fact(
                context,
                Icons.calendar_month_outlined,
                L.tr('Date'),
                date == null
                    ? L.tr('Muda haujulikani')
                    : DateFormat('d MMM y', locale).format(date)),
            _fact(
                context,
                Icons.schedule_rounded,
                L.tr('Time'),
                date == null
                    ? '—'
                    : '${DateFormat('HH:mm', locale).format(date)} (${date.timeZoneName})'),
            if (modality?.isNotEmpty == true)
              _fact(context, Icons.videocam_outlined, L.tr('Consultation'),
                  modality!),
          ]),
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 4, children: actions)
          ],
        ]));
  }

  Widget _fact(
          BuildContext context, IconData icon, String label, String value) =>
      Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, color: AppPalette.of(context).inkSoft, size: 20),
        const SizedBox(width: 8),
        Flexible(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          Text(value, style: Theme.of(context).textTheme.titleSmall),
        ])),
      ]);
}

import '../widgets/patient_ui.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/care_continuity.dart' show newCareRequestKey;
import 'package:intl/intl.dart';
import '../core/l10n.dart';
import '../core/app_preferences.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class FamilyPackagesScreen extends StatefulWidget {
  final Map<String, dynamic>? family;
  const FamilyPackagesScreen({super.key, required this.family});
  @override
  State<FamilyPackagesScreen> createState() => _FamilyPackagesScreenState();
}

class _FamilyPackagesScreenState extends State<FamilyPackagesScreen> {
  List<Map<String, dynamic>> _plans = [], _requests = [];
  String? _error, _notice, _cursor, _reference, _signature;
  bool _loading = true, _busy = false;
  int _epoch = 0;
  Map<String, dynamic>? _family;
  @override
  void initState() {
    super.initState();
    _family = widget.family;
    _load();
  }

  @override
  void dispose() {
    _epoch++;
    super.dispose();
  }

  List<Map<String, dynamic>> _rows(dynamic value) {
    if (value is! Map || value['data'] is! List) {
      throw const FormatException('Invalid package response');
    }
    return (value['data'] as List)
        .whereType<Map>()
        .map((x) => Map<String, dynamic>.from(x))
        .toList();
  }

  Future<void> _load() async {
    final epoch = ++_epoch;
    setState(() => _loading = true);
    try {
      final plans = _rows(await Api.get('/families/plans'));
      final currentFamily = widget.family == null
          ? null
          : Map<String, dynamic>.from(
              await Api.get('/families/${widget.family!["id"]}') as Map);
      dynamic history;
      if (widget.family != null) {
        history = await Api.get(
            '/families/${widget.family!['id']}/subscription-requests',
            query: {'status': 'all', 'limit': 25});
      }
      if (!mounted || epoch != _epoch) return;
      setState(() {
        _family = currentFamily;
        _plans = plans;
        _requests = history == null ? [] : _rows(history);
        _cursor = history?['meta']?['next_cursor'] as String?;
        _error = null;
        _loading = false;
      });
    } catch (_) {
      if (mounted && epoch == _epoch) {
        setState(() {
          _family = null;
          _plans = [];
          _requests = [];
          _cursor = null;
          _loading = false;
          _error = L
              .tr('Family packages could not be verified. Pull down to retry.');
        });
      }
    }
  }

  Future<void> _more() async {
    if (_busy || _cursor == null) return;
    setState(() => _busy = true);
    try {
      final r = await Api.get(
          '/families/${_family!['id']}/subscription-requests',
          query: {'status': 'all', 'limit': 25, 'cursor': _cursor});
      if (!mounted) return;
      setState(() {
        final known = _requests.map((x) => x['id']).toSet();
        _requests.addAll(_rows(r).where((x) => !known.contains(x['id'])));
        _cursor = r['meta']?['next_cursor'] as String?;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error = L.tr('Request history could not be loaded.'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _request(Map<String, dynamic> plan) async {
    if (_busy || _family?['is_head'] != true) return;
    final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
                title: Text(L.tr('Review package request')),
                content: SingleChildScrollView(
                    child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text('${plan['name']} · ${_price(plan)}'),
                      const SizedBox(height: 12),
                      Text(L.tr('Included services'),
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      ...(plan['benefits'] as List? ?? []).map((x) => Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text('• $x'))),
                      const SizedBox(height: 16),
                      Text(L.tr('Exclusions & conditions'),
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      ...(plan['exclusions'] as List? ?? []).map((x) => Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text('• $x'))),
                      const SizedBox(height: 16),
                      Text(L.tr(
                          'I have reviewed the published benefits, exclusions and billing period. This sends a request for staff review; it does not charge me or confirm payment.'))
                    ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: Text(L.tr('Cancel'))),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: Text(L.tr('Confirm request')))
                ]));
    if (confirmed != true || !mounted) return;
    final signature = '${plan['tier']}:${plan['version']}';
    if (_signature != signature) {
      _signature = signature;
      _reference = newCareRequestKey();
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Api.post('/families/${_family!['id']}/subscription-requests', {
        'tier': plan['tier'],
        'plan_version': plan['version'],
        'client_request_id': _reference,
        'terms_confirmed': true
      });
      if (!mounted) return;
      setState(() {
        _notice = L.tr(
            'Package request recorded. Staff will review it; no payment was collected.');
        _reference = null;
        _signature = null;
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _error = e.status == 409
            ? L.tr(
                'The package or request has changed. Refresh and review the latest terms.')
            : L.tr(
                'Request could not be confirmed. Retry the same package to reuse its reference.'));
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = L.tr(
            'Request could not be confirmed. Retry the same package to reuse its reference.'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _tier(dynamic value) => switch (value) {
        'none' => L.tr('No package'),
        'family_basic' => 'Family Basic',
        'family_plus' => 'Family Plus',
        _ => L.tr('No family linked')
      };
  String _date(dynamic value) {
    final parsed = DateTime.tryParse('$value');
    return parsed == null
        ? '—'
        : DateFormat.yMMMd().add_Hm().format(parsed.toLocal());
  }

  String _price(Map<String, dynamic> p) {
    final value = p['price_minor'];
    if (value is! num) return L.tr('Price not published');
    return '${p['currency']} ${NumberFormat('#,##0.##', AppPreferences.instance.language).format(value / 100)} / ${p['billing_period'] == 'annual' ? L.tr('year') : L.tr('month')}';
  }

  Widget _planCard(Map<String, dynamic> p, bool pending) {
    final assigned = _family?['subscription_tier'] == p['tier'];
    final benefits = (p['benefits'] as List? ?? []).map((x) => '$x').toList();
    final exclusions =
        (p['exclusions'] as List? ?? []).map((x) => '$x').toList();
    final open = p['accepting_requests'] == true;
    final palette = AppPalette.of(context);
    return Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
            child: Semantics(
                header: true,
                child: Text('${p['name']}',
                    style: Theme.of(context).textTheme.titleLarge))),
        const SizedBox(width: 12),
        Icon(
            assigned
                ? Icons.check_circle_outline
                : Icons.workspace_premium_outlined,
            color: palette.petrol)
      ]),
      const SizedBox(height: 12),
      Text(_price(p), style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      Text(
          assigned
              ? L.tr('Currently assigned')
              : open
                  ? L.tr('Requests open')
                  : L.tr('Requests closed'),
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: palette.inkSoft)),
      const SizedBox(height: 16),
      if (benefits.isEmpty)
        Text(L.tr('Benefits have not been published.'),
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: palette.inkSoft)),
      ...benefits.take(2).map((x) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(Icons.check, size: 18, color: palette.petrol),
            const SizedBox(width: 8),
            Expanded(child: Text(x))
          ]))),
      ExpansionTile(
          tilePadding: EdgeInsets.zero,
          childrenPadding: const EdgeInsets.only(bottom: 16),
          title: Text(L.tr('Package details')),
          children: [
            Align(
                alignment: Alignment.centerLeft,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${p['description']}'),
                      const SizedBox(height: 16),
                      Text(L.tr('Included services'),
                          style: Theme.of(context).textTheme.titleSmall),
                      ...benefits.map((x) => Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text('• $x'))),
                      const SizedBox(height: 16),
                      Text(L.tr('Exclusions & conditions'),
                          style: Theme.of(context).textTheme.titleSmall),
                      ...exclusions.map((x) => Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text('• $x')))
                    ]))
          ]),
      if (_family?['is_head'] == true) ...[
        const SizedBox(height: 8),
        SizedBox(
            width: double.infinity,
            child: FilledButton(
                onPressed: _busy || _loading || pending || !open || assigned
                    ? null
                    : () => _request(p),
                child: Text(assigned
                    ? L.tr('Currently assigned')
                    : L.tr('Request this package'))))
      ],
    ]));
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final pending = _requests.any((x) => x['status'] == 'pending');
    return PatientScaffold(
        appBar: AppBar(title: Text(L.tr('Family packages'))),
        body: RefreshIndicator(
            onRefresh: _busy ? () async {} : _load,
            child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(20),
                children: [
                  WorkspaceIntro(
                      title: L.tr('Choose care for your family'),
                      description: L.tr(
                          'Compare services, prices and conditions. Requests are reviewed before a package is assigned.')),
                  Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                          color: AppPalette.of(context).mintWash,
                          borderRadius: BorderRadius.circular(12)),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(L.tr('Your current package'),
                                style: Theme.of(context).textTheme.bodySmall),
                            const SizedBox(height: 4),
                            Text(_tier(_family?['subscription_tier']),
                                style: Theme.of(context).textTheme.titleMedium),
                            if (pending) ...[
                              const SizedBox(height: 8),
                              Text(
                                  L.tr('A package request is awaiting review.'))
                            ]
                          ])),
                  const SizedBox(height: 20),
                  if (_error != null) Notice(_error!),
                  if (_notice != null)
                    Semantics(
                        liveRegion: true,
                        child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            child: Text(_notice!))),
                  if (_loading) const LoadingContent(),
                  if (!_loading && _error == null && _plans.isEmpty)
                    Empty(L.tr('No packages are published.')),
                  if (!_loading)
                    LayoutBuilder(builder: (context, size) {
                      final columns = size.maxWidth >= 840 ? 2 : 1;
                      final width =
                          (size.maxWidth - (columns - 1) * 16) / columns;
                      return Wrap(
                          spacing: 16,
                          runSpacing: 16,
                          children: _plans
                              .map((p) => SizedBox(
                                  width: width, child: _planCard(p, pending)))
                              .toList());
                    }),
                  const SizedBox(height: 16),
                  Text(L.tr('Requests do not collect payment.'),
                      style: Theme.of(context).textTheme.bodySmall),
                  if (_family == null)
                    Text(L.tr(
                        'Create or join your family before requesting a package.')),
                  if (_family != null && _family?['is_head'] != true)
                    Text(L.tr(
                        'Only the family head can request a package change.')),
                  if (_family != null) ...[
                    const SizedBox(height: 28),
                    SectionTitle(L.tr('Package request history')),
                    if (_requests.isEmpty && !_loading)
                      Text(L.tr('No package requests yet.'),
                          style: Theme.of(context)
                              .textTheme
                              .bodyMedium
                              ?.copyWith(
                                  color: AppPalette.of(context).inkSoft)),
                    ..._requests.map((r) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Panel(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                              Text(_tier(r['tier']),
                                  style:
                                      Theme.of(context).textTheme.titleMedium),
                              const SizedBox(height: 8),
                              Text(L.tr('${r['status']}'),
                                  style: Theme.of(context)
                                      .textTheme
                                      .bodyMedium
                                      ?.copyWith(fontWeight: FontWeight.w600)),
                              Text(_date(r['created_at']),
                                  style: Theme.of(context).textTheme.bodySmall),
                              if (r['review_note'] != null) ...[
                                const SizedBox(height: 8),
                                Text('${r['review_note']}')
                              ]
                            ])))),
                    if (_cursor != null)
                      OutlinedButton(
                          onPressed: _busy ? null : _more,
                          child: Text(L.tr('Load more requests')))
                  ],
                ])));
  }
}

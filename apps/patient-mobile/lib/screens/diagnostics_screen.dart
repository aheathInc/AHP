import '../widgets/patient_ui.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/l10n.dart';
import '../core/patient_care.dart';
import '../core/session.dart';
import '../widgets/common.dart';

String diagnosticStatus(Map<String, dynamic> order) =>
    L.tr(order['report_state'] == 'preliminary'
        ? 'Matokeo yanapitiwa kabla ya kutolewa'
        : switch (order['status']) {
            'ordered' => 'Inasubiri sampuli',
            'scheduled' => 'Kipimo kimepangwa',
            'collected' => 'Sampuli imepokelewa',
            'resulted' => 'Matokeo yametolewa — yanasubiri daktari',
            'acknowledged' => 'Daktari amethibitisha kupokea',
            'cancelled' => 'Kipimo kimeghairiwa',
            _ => 'Hali haijulikani'
          });
String diagnosticDate(dynamic value) {
  final date = DateTime.tryParse(value is String ? value : '');
  return date == null
      ? '—'
      : DateFormat('d MMM yyyy, HH:mm').format(date.toLocal());
}

class DiagnosticsScreen extends StatefulWidget {
  const DiagnosticsScreen({super.key, this.loadOrders, this.loadOrder});
  final Future<List<Map<String, dynamic>>> Function()? loadOrders;
  final Future<Map<String, dynamic>> Function(String)? loadOrder;
  @override
  State<DiagnosticsScreen> createState() => _DiagnosticsScreenState();
}

class _DiagnosticsScreenState extends State<DiagnosticsScreen>
    with WidgetsBindingObserver {
  List<Map<String, dynamic>> _orders = [];
  String? _error;
  bool _loading = true;
  int _revision = 0;
  @override
  void initState() {
    super.initState();
    Session.identityChanges.addListener(_identity);
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
  }

  void _identity() {
    _revision++;
    if (mounted) {
      setState(() {
        _orders = [];
        _loading = false;
        _error = L.tr('Akaunti imebadilika. Sasisha taarifa za vipimo.');
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_load());
  }

  @override
  void dispose() {
    _revision++;
    Session.identityChanges.removeListener(_identity);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _load() async {
    final revision = ++_revision;
    setState(() {
      _loading = true;
      _error = null;
      _orders = [];
    });
    try {
      final rows = await (widget.loadOrders?.call() ??
          PatientCareRepository().investigationOrders());
      if (!mounted || revision != _revision) return;
      setState(() {
        _orders = rows;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || revision != _revision) return;
      setState(() {
        _loading = false;
        _error = e is ApiException
            ? e.message
            : L.tr('Imeshindikana kupakia majibu.');
      });
    }
  }

  @override
  Widget build(BuildContext context) => PatientScaffold(
      appBar: AppBar(title: Text(L.tr('Vipimo na majibu')), actions: [
        IconButton(
            tooltip: L.tr('Sasisha'),
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh))
      ]),
      body: CarePageBody(
          child: RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  children: [
                    WorkspaceIntro(
                        title: L.tr('Vipimo na majibu'),
                        description: L
                            .tr('Track lab orders and view released results.')),
                    if (_loading)
                      const Center(
                          child: Padding(
                              padding: EdgeInsets.all(32),
                              child: CircularProgressIndicator()))
                    else if (_error != null) ...[
                      Notice(_error!),
                      TextButton(
                          onPressed: _load, child: Text(L.tr('Jaribu tena')))
                    ] else if (_orders.isEmpty)
                      Empty(L.tr(
                          'Hakuna kipimo kilichoagizwa kwenye rekodi zako.'))
                    else
                      ..._orders.map((order) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Card(
                              child: ListTile(
                                  contentPadding: const EdgeInsets.all(16),
                                  title: Text(
                                      order['investigation_code'] as String? ??
                                          L.tr('Kipimo')),
                                  subtitle: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(diagnosticStatus(order)),
                                        const SizedBox(height: 6),
                                        Text(
                                            order['facility_name'] as String? ??
                                                L.tr('Kituo hakijaainishwa')),
                                        Text(
                                            diagnosticDate(order['ordered_at']))
                                      ]),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: () => Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                          builder: (_) =>
                                              DiagnosticDetailScreen(
                                                  orderId:
                                                      order['id'] as String,
                                                  loadOrder:
                                                      widget.loadOrder))))))),
                  ]))));
}

class DiagnosticDetailScreen extends StatefulWidget {
  const DiagnosticDetailScreen(
      {super.key, required this.orderId, this.loadOrder});
  final String orderId;
  final Future<Map<String, dynamic>> Function(String)? loadOrder;
  @override
  State<DiagnosticDetailScreen> createState() => _DiagnosticDetailScreenState();
}

class _DiagnosticDetailScreenState extends State<DiagnosticDetailScreen> {
  Map<String, dynamic>? _order;
  String? _error;
  bool _loading = true;
  int _revision = 0;
  @override
  void initState() {
    super.initState();
    Session.identityChanges.addListener(_identity);
    unawaited(_load());
  }

  void _identity() {
    _revision++;
    if (mounted) {
      setState(() {
        _order = null;
        _loading = false;
        _error = L.tr('Akaunti imebadilika. Sasisha taarifa za vipimo.');
      });
    }
  }

  @override
  void dispose() {
    _revision++;
    Session.identityChanges.removeListener(_identity);
    super.dispose();
  }

  Future<void> _load() async {
    final revision = ++_revision;
    setState(() {
      _order = null;
      _loading = true;
      _error = null;
    });
    try {
      final order = await (widget.loadOrder?.call(widget.orderId) ??
          PatientCareRepository().investigationOrder(widget.orderId));
      if (!mounted || revision != _revision) return;
      setState(() {
        _order = order;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || revision != _revision) return;
      setState(() {
        _loading = false;
        _error = e is ApiException
            ? e.message
            : L.tr('Imeshindikana kupakia kipimo.');
      });
    }
  }

  String flag(String value) => L.tr(switch (value) {
        'critical_low' => 'Chini sana — wasiliana na daktari',
        'critical_high' => 'Juu sana — wasiliana na daktari',
        'low' => 'Chini ya kiwango cha rejea',
        'high' => 'Juu ya kiwango cha rejea',
        'normal' => 'Ndani ya kiwango kilichotolewa',
        _ => 'Haijatathminiwa kiotomatiki'
      });
  Widget detail(String label, dynamic value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(L.tr(label), style: Theme.of(context).textTheme.bodySmall),
        SelectableText(value?.toString() ?? '—')
      ]));
  @override
  Widget build(BuildContext context) {
    final order = _order;
    final finalReport =
        order != null && ['resulted', 'acknowledged'].contains(order['status']);
    return PatientScaffold(
        appBar: AppBar(title: Text(L.tr('Maelezo ya kipimo')), actions: [
          IconButton(
              tooltip: L.tr('Sasisha'),
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh))
        ]),
        body: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  if (_loading)
                    const Center(child: CircularProgressIndicator())
                  else if (_error != null) ...[
                    Notice(_error!),
                    TextButton(
                        onPressed: _load, child: Text(L.tr('Jaribu tena')))
                  ] else if (order != null) ...[
                    PatientSurface(
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                          Text(
                              order['investigation_code'] as String? ??
                                  L.tr('Kipimo'),
                              style: Theme.of(context).textTheme.headlineSmall),
                          const SizedBox(height: 8),
                          PatientStatus(diagnosticStatus(order)),
                          const Divider(),
                          detail('Namba ya ombi la kipimo', order['id']),
                          detail('Maabara', order['facility_name']),
                          detail(
                              'Namba ya sampuli', order['specimen_reference']),
                          detail('Aina ya sampuli', order['specimen_type']),
                          detail('Sampuli ilikusanywa',
                              diagnosticDate(order['collected_at'])),
                          detail('Sampuli ilipokelewa',
                              diagnosticDate(order['received_at'])),
                        ])),
                    const SizedBox(height: 16),
                    if (!finalReport)
                      Notice(L.tr(
                          'Matokeo bado hayajaidhinishwa kutolewa. Rudi baadaye au wasiliana na kituo chako.'))
                    else ...[
                      if (order['is_critical'] == true)
                        Notice(L.tr(
                            'Ripoti ina matokeo yaliyowekwa alama ya hatari. Wasiliana na daktari wako bila kuchelewa.')),
                      detail('Matokeo yalitolewa',
                          diagnosticDate(order['resulted_at'])),
                      detail(
                          'Aliyeidhinisha ripoti', order['released_by_name']),
                      const Divider(),
                      ...((order['values'] as List? ?? []).whereType<Map>().map(
                          (v) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              child: PatientSurface(
                                  child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                    Text(v['analyte']?.toString() ?? '',
                                        style: Theme.of(context)
                                            .textTheme
                                            .titleMedium),
                                    SelectableText(
                                        '${v['value'] ?? '—'} ${v['unit'] ?? ''}'),
                                    Text(L.tr('Kiwango cha rejea: {0}–{1}', [
                                      v['reference_low'] ?? '—',
                                      v['reference_high'] ?? '—'
                                    ])),
                                    Text(flag(v['flag']?.toString() ?? ''))
                                  ]))))),
                      if (order['narrative'] is String)
                        detail('Maelezo ya matokeo', order['narrative']),
                      Notice(L.tr(
                          'Matokeo yanahitaji kutafsiriwa na daktari pamoja na hali yako ya afya.')),
                    ],
                  ]
                ])));
  }
}

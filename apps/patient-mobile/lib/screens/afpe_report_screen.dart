import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/phone.dart';
import '../core/app_preferences.dart';
import '../core/l10n.dart';
import '../widgets/common.dart';

class AfpeReportScreen extends StatefulWidget {
  const AfpeReportScreen({super.key, required this.cycleId});
  final String cycleId;
  @override
  State<AfpeReportScreen> createState() => _AfpeReportScreenState();
}

class _AfpeReportScreenState extends State<AfpeReportScreen> {
  Map<String, dynamic>? _report;
  String? _error;
  late final int _identity;
  bool get _sameOwner => _identity == Session.identityChanges.value;
  void _identityChanged() {
    if (mounted && !_sameOwner) {
      setState(() {
        _report = null;
        _error = L.tr('Account imebadilika. Fungua taarifa zako tena.');
      });
    }
  }

  @override
  void dispose() {
    Session.identityChanges.removeListener(_identityChanged);
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _identity = Session.identityChanges.value;
    Session.identityChanges.addListener(_identityChanged);
    _load();
  }

  Future<void> _load() async {
    if (!_sameOwner) return;
    setState(() {
      _error = null;
    });
    try {
      final report = Map<String, dynamic>.from(
          await Api.get('/care-continuity/cycles/${widget.cycleId}/afpe'));
      if (mounted && _sameOwner) setState(() => _report = report);
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            L.tr('Ripoti haipatikani. Unganisha intaneti na ujaribu tena.'));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = (_report?['assessments'] as List?) ?? [];
    final latest = rows.isEmpty ? null : rows.first as Map;
    final score = latest?['score'] as num?;
    final band = latest?['band'] as String? ?? 'incomplete';
    final color = switch (band) {
      'red' => Colors.red.shade700,
      'yellow' => Colors.orange.shade800,
      'green' => Colors.green.shade700,
      _ => Theme.of(context).colorScheme.onSurface
    };
    final language = AppPreferences.instance.language == 'sw' ? 'sw' : 'en';
    return Scaffold(
        appBar: AppBar(title: Text(L.tr('Mwenendo wa afya yangu'))),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          if (_error != null) ...[
            Notice(_error!),
            TextButton(onPressed: _load, child: Text(L.tr('Jaribu tena')))
          ] else if (_report == null)
            const Center(child: CircularProgressIndicator())
          else if (_report!['plan'] == null)
            Text(L.tr('Mpango wa ufuatiliaji wa afya haujawekwa.'))
          else ...[
            Text(L.tr(
                'Alama za utafiti za AFPE zinahitaji uthibitisho wa kliniki kabla ya kutumiwa kuamua matibabu.')),
            const SizedBox(height: 24),
            Center(
                child: Semantics(
                    label:
                        '${L.tr('Alama ya ufuatiliaji')}: ${score ?? L.tr('Taarifa hazitoshi')}',
                    child: SizedBox(
                        width: 160,
                        height: 160,
                        child: Stack(alignment: Alignment.center, children: [
                          SizedBox.expand(
                              child: CircularProgressIndicator(
                                  value: score == null ? 0 : score / 100,
                                  strokeWidth: 12,
                                  color: color,
                                  backgroundColor: Theme.of(context)
                                      .colorScheme
                                      .surfaceContainerHighest)),
                          Text(score == null ? '—' : '${score.round()}/100',
                              style:
                                  Theme.of(context).textTheme.headlineMedium),
                        ])))),
            const SizedBox(height: 20),
            if (latest != null)
              Text((latest['patient_report'] as Map)[language] as String,
                  style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 16),
            Text(L.tr('Dozi zilizothibitishwa mfululizo: {0}',
                [_report!['adherence_streak'] ?? 0])),
            if (latest != null && (latest['missing'] as List).isNotEmpty)
              Text(L.tr(
                  'Baadhi ya vipimo au uthibitisho wa dozi haujapatikana. Alama haijakamilika.')),
            const SizedBox(height: 24),
            DropdownButtonFormField<String>(
              initialValue:
                  (_report!['plan'] as Map)['fallback_channel'] as String? ??
                      'none',
              decoration: InputDecoration(
                  labelText: L.tr('Njia ya ziada ya ufuatiliaji')),
              items: [
                DropdownMenuItem(
                    value: 'none', child: Text(L.tr('Ndani ya app pekee'))),
                const DropdownMenuItem(value: 'sms', child: Text('SMS')),
                const DropdownMenuItem(
                    value: 'whatsapp', child: Text('WhatsApp'))
              ],
              onChanged: _report!['messaging_available'] != true
                  ? null
                  : (value) async {
                      if (value == null) return;
                      try {
                        await Api.post(
                            '/care-continuity/cycles/${widget.cycleId}/afpe/preferences',
                            {'fallback_channel': value},
                            idempotencyKey: newOpId());
                        await _load();
                      } catch (_) {
                        if (mounted) {
                          setState(() => _error =
                              L.tr('Mabadiliko hayajahifadhiwa. Jaribu tena.'));
                        }
                      }
                    },
            ),
            if (_report!['messaging_available'] != true)
              Text(L.tr(
                  'SMS na WhatsApp bado hazijawezeshwa. Ufuatiliaji ndani ya app unapatikana.')),
            Text(L.tr(
                'Ukichagua SMS au WhatsApp unakubali kupokea ufuatiliaji kwenye namba yako iliyosajiliwa. Ujumbe unaweza kuonekana kwa mwenye simu.')),
            Text(L.tr('Historia ya ufuatiliaji'),
                style: Theme.of(context).textTheme.titleLarge),
            ...rows.map((raw) {
              final r = raw as Map;
              return ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('${r['score'] ?? '—'}/100'),
                  subtitle: Text(DateFormat('d MMM, HH:mm').format(
                      DateTime.parse(r['created_at'] as String).toLocal())),
                  trailing: Text(L.tr(r['band'] as String)));
            }),
          ],
        ]));
  }
}

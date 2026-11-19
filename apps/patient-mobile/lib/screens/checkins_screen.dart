import '../widgets/patient_ui.dart';
import '../core/l10n.dart';
import '../core/app_preferences.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/outbox.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// Scheduled check-ins (FR-FU-02). Answers outside the clinician's thresholds
/// are flagged as a deviation by the server — never here. A client that
/// decided what counted as concerning could be tricked into staying quiet.
class CheckInsScreen extends StatefulWidget {
  const CheckInsScreen({super.key});
  @override
  State<CheckInsScreen> createState() => _CheckInsScreenState();
}

class _CheckInsScreenState extends State<CheckInsScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  bool _online = true;
  String? _error;
  Map<String, String> _syncStates = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final ownerId = await Session.userId();
    final syncStates = ownerId == null
        ? <String, String>{}
        : await Outbox.checkInSyncStates(ownerId);
    final online = await Api.online;
    if (!online) {
      if (mounted) {
        setState(() {
          _items = [];
          _syncStates = syncStates;
          _online = false;
          _error = null;
          _loading = false;
        });
      }
      return;
    }
    try {
      final data = await Api.get(
        '/check-ins',
        query: {'limit': 50, 'status': 'due'},
      );
      final items =
          ((data['data'] as List?) ?? []).cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() {
        _items = items
            .map(
              (item) => {
                ...item,
                if (syncStates[item['id']] != null)
                  '_local_sync_status': syncStates[item['id']],
              },
            )
            .toList();
        _syncStates = syncStates;
        _online = true;
        _error = null;
        _loading = false;
      });
    } catch (_) {
      if (mounted)
        setState(() {
          _items = [];
          _syncStates = syncStates;
          _online = false;
          _error = null;
          _loading = false;
        });
    }
  }

  Future<void> _open(Map<String, dynamic> checkIn) async {
    final localStatus = checkIn['_local_sync_status'] as String?;
    if (localStatus == 'queued' || localStatus == 'sending') return;
    if (!_online) {
      setState(
        () => _error = L.tr(
            'ONLINE REQUIRED: unganisha intaneti kabla ya kujibu swali hili.'),
      );
      return;
    }
    final answered = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _CheckInForm(checkIn: checkIn)),
    );
    if (answered == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return PatientScaffold(
      appBar: AppBar(title: Text(S.checkIns)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (!_online) ...[
                  Notice(
                    L.tr(
                        'Hakuna mtandao. Maswali ya follow-up hayajahifadhiwa kwa matumizi offline.'),
                    tone: NoticeTone.attention,
                  ),
                  if (_syncStates.values.any(
                    (status) => status == 'queued' || status == 'sending',
                  ))
                    Notice(
                      L.tr(
                          'Pending sync: jibu la follow-up linasubiri uthibitisho wa seva.'),
                      tone: NoticeTone.attention,
                    ),
                  if (_syncStates.values.any((status) => status == 'failed'))
                    Notice(
                      L.tr('Jibu la awali linahitaji kuangaliwa mtandaoni.'),
                      tone: NoticeTone.attention,
                    ),
                  const SizedBox(height: 16),
                ],
                if (_error != null) ...[
                  Notice(_error!),
                  const SizedBox(height: 16),
                ],
                if (_items.isEmpty)
                  Empty(
                    _online
                        ? L.tr(
                            'Huna swali linalosubiri jibu. Hii ni habari njema.')
                        : L.tr(
                            'Hakuna swali la follow-up lililohifadhiwa kwenye kifaa hiki.'),
                  )
                else
                  ..._items.map((c) {
                    final at = DateTime.tryParse(
                      c['scheduled_at'] as String? ?? '',
                    );
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Panel(
                        accent: AppPalette.of(context).amber,
                        onTap: c['_local_sync_status'] == 'queued' ||
                                c['_local_sync_status'] == 'sending'
                            ? null
                            : () => _open(c),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              L.tr('Daktari anataka kujua hali yako'),
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            if (c['_local_sync_status'] == 'queued' ||
                                c['_local_sync_status'] == 'sending')
                              Text(
                                L.tr(
                                    'Pending sync — jibu halijathibitishwa na seva.'),
                              ),
                            if (c['_local_sync_status'] == 'failed')
                              Text(
                                L.tr(
                                    'Jibu la awali halikuthibitishwa; unganisha intaneti kabla ya kujibu tena.'),
                              ),
                            if (at != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                DateFormat('d MMM, HH:mm').format(at.toLocal()),
                                style: TextStyle(
                                  color: AppPalette.of(context).inkSoft,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    );
                  }),
              ],
            ),
    );
  }
}

class _CheckInForm extends StatefulWidget {
  const _CheckInForm({required this.checkIn});
  final Map<String, dynamic> checkIn;

  @override
  State<_CheckInForm> createState() => _CheckInFormState();
}

class _CheckInFormState extends State<_CheckInForm> {
  int _feeling = 3;
  final _note = TextEditingController();
  final _temperature = TextEditingController();
  bool? _chestPain;
  bool? _severeBleeding;
  bool? _difficultyBreathing;
  bool _busy = false;
  String? _message;
  bool _submitted = false;
  bool _queued = false;
  bool _urgent = false;
  double? _symptomSeverity;
  String? _assistantPrompt;
  bool _assistantBusy = false;
  final _sideEffects = TextEditingController();
  final Map<String, TextEditingController> _vitals = {};
  bool get _afpe => (widget.checkIn['questions'] as List? ?? [])
      .any((q) => q is Map && q['afpe'] == true);
  @override
  void initState() {
    super.initState();
    for (final q in widget.checkIn['questions'] as List? ?? []) {
      if (q is Map && q['afpe'] == true) {
        for (final key in q['vital_keys'] as List? ?? []) {
          if (key != 'temperature_c') {
            _vitals[key as String] = TextEditingController();
          }
        }
      }
    }
  }

  @override
  void dispose() {
    _note.dispose();
    _temperature.dispose();
    _sideEffects.dispose();
    for (final c in _vitals.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_chestPain == null ||
        _severeBleeding == null ||
        _difficultyBreathing == null) {
      setState(() => _message =
          L.tr('Jibu maswali yote ya dalili za hatari kabla ya kutuma.'));
      return;
    }
    if (_afpe && _symptomSeverity == null) {
      setState(
          () => _message = L.tr('Chagua ukali wa dalili kabla ya kutuma.'));
      return;
    }
    final temperatureText = _temperature.text.trim();
    final temperature = temperatureText.isEmpty
        ? null
        : double.tryParse(temperatureText.replaceAll(',', '.'));
    if (temperatureText.isNotEmpty &&
        (temperature == null || temperature < 30 || temperature > 45)) {
      setState(() => _message =
          L.tr('Weka joto sahihi kwa °C, au acha wazi ikiwa hujalipima.'));
      return;
    }
    if (_vitals.values.any((c) =>
        c.text.trim().isNotEmpty &&
        double.tryParse(c.text.trim().replaceAll(',', '.')) == null)) {
      setState(() => _message =
          L.tr('Weka vipimo kwa namba au acha wazi ikiwa hujapima.'));
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    final id = widget.checkIn['id'] as String;
    try {
      final result = await Api.postDurable(
        opId: newOpId(),
        path: '/check-ins/$id/respond',
        syncPath: '/check-ins/{check_in_id}/respond',
        pathParams: {'check_in_id': id},
        body: {
          'responses': {
            if (_afpe)
              'afpe': {
                'symptom_severity': _symptomSeverity,
                'side_effects': _sideEffects.text,
                'vitals': {
                  if (temperature != null) 'temperature_c': temperature,
                  for (final e in _vitals.entries)
                    if (e.value.text.trim().isNotEmpty)
                      e.key: double.parse(
                          e.value.text.trim().replaceAll(',', '.')),
                },
              },
            'feeling': _feeling,
            'note': _note.text,
            'chest_pain': _chestPain,
            'severe_bleeding': _severeBleeding,
            'difficulty_breathing': _difficultyBreathing,
            if (temperature != null) 'temperature_c': temperature,
          },
          'channel': 'app',
          'client_created_at': DateTime.now().toIso8601String(),
        },
      );
      if (!mounted) return;
      final status = result is Map ? result['status'] as String? : null;
      final urgent = result is Map && result['urgent_care_required'] == true;
      setState(() {
        _submitted = true;
        _urgent = urgent;
        _message = urgent
            ? L.tr(
                'Dalili ya hatari imeripotiwa na imewekewa alama kwa mapitio ya kliniki. Tafuta huduma ya dharura sasa; usisubiri ujumbe mwingine wa follow-up.')
            : status == null
                ? L.tr('Jibu limehifadhiwa na seva.')
                : L.tr("Jibu limehifadhiwa na seva. Hali: {0}", [status]);
        _busy = false;
      });
    } on Queued {
      setState(() {
        _queued = true;
        _message = L.tr(
            'Pending sync: jibu lipo kwenye simu tu na halijathibitishwa na seva.');
        _busy = false;
      });
    } on ApiException catch (e) {
      setState(() {
        _message = e.message;
        _busy = false;
      });
    } catch (_) {
      setState(() {
        _message = S.errorGeneric;
        _busy = false;
      });
    }
  }

  Future<void> _askAssistant() async {
    setState(() => _assistantBusy = true);
    try {
      final result = await Api.post(
          '/care-continuity/check-ins/${widget.checkIn['id']}/conversation',
          {
            'text': _note.text,
            'language': AppPreferences.instance.language == 'sw' ? 'sw' : 'en',
          },
          idempotencyKey: newOpId());
      if (mounted) {
        setState(() {
          _assistantPrompt = result['question'] as String;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _assistantPrompt =
            L.tr('Msaidizi hapatikani. Endelea kujibu maswali hapa chini.'));
      }
    } finally {
      if (mounted) setState(() => _assistantBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    const labels = [
      'Vibaya sana',
      'Vibaya',
      'Wastani',
      'Vizuri',
      'Vizuri sana',
    ];
    return PatientScaffold(
      appBar: AppBar(title: Text(L.tr('Hali yako'))),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Notice(
              L.tr(
                  'Ikiwa una maumivu ya kifua, shida ya kupumua, damu nyingi, homa kali au hali inazidi kuwa mbaya, tafuta huduma ya dharura sasa.'),
              tone: NoticeTone.problem),
          const SizedBox(height: 12),
          if (_submitted || _queued) ...[
            Notice(
              _message ?? L.tr('Jibu limehifadhiwa na seva.'),
              tone: NoticeTone.attention,
            ),
            if (_urgent) ...[
              const SizedBox(height: 12),
              Notice(
                L.tr(
                    'Ikiwa una maumivu ya kifua, shida ya kupumua, damu nyingi, homa kali au hali inazidi kuwa mbaya, tafuta huduma ya dharura sasa.'),
                tone: NoticeTone.problem,
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(_submitted || _queued),
              child: Text(L.tr('Funga')),
            ),
          ] else ...[
            Text(
              L.tr('Unajisikiaje leo?'),
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 16),
            ...List.generate(5, (i) {
              final value = i + 1;
              final selected = _feeling == value;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: InkWell(
                  onTap: () => setState(() => _feeling = value),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 16,
                    ),
                    decoration: BoxDecoration(
                      color: selected
                          ? AppPalette.of(context).petrol
                          : Colors.white,
                      border: Border.all(
                        color: selected
                            ? AppPalette.of(context).petrol
                            : AppPalette.of(context).line,
                      ),
                    ),
                    child: Text(
                      labels[i],
                      style: TextStyle(
                        fontSize: 17,
                        color: selected
                            ? Colors.white
                            : AppPalette.of(context).ink,
                      ),
                    ),
                  ),
                ),
              );
            }),
            const SizedBox(height: 16),
            Text(L.tr('Dalili za hatari'),
                style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(
                L.tr(
                    'Chagua Ndiyo au Hapana kwa kila swali. Jibu la Ndiyo litawekewa alama kwa mapitio ya kliniki.'),
                style: TextStyle(color: AppPalette.of(context).inkSoft)),
            _redFlagQuestion(L.tr('Una maumivu ya kifua?'), _chestPain,
                (v) => setState(() => _chestPain = v)),
            _redFlagQuestion(L.tr('Una damu nyingi au kutokwa damu sana?'),
                _severeBleeding, (v) => setState(() => _severeBleeding = v)),
            _redFlagQuestion(
                L.tr('Una shida kubwa ya kupumua?'),
                _difficultyBreathing,
                (v) => setState(() => _difficultyBreathing = v)),
            const SizedBox(height: 8),
            TextField(
              controller: _temperature,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                  labelText: L.tr('Joto la mwili °C (hiari)'),
                  hintText: L.tr('Mfano: 37.5')),
            ),
            const SizedBox(height: 20),
            if (_afpe) ...[
              if (_assistantPrompt != null)
                Notice(_assistantPrompt!, tone: NoticeTone.attention),
              OutlinedButton(
                  onPressed: _assistantBusy ? null : _askAssistant,
                  child: Text(L.tr('Msaidizi wa ufuatiliaji'))),
              Text(L.tr('Ukali wa dalili (0 hakuna, 10 kali zaidi): {0}',
                  [_symptomSeverity?.round() ?? '—'])),
              Slider(
                  value: _symptomSeverity ?? 0,
                  min: 0,
                  max: 10,
                  divisions: 10,
                  label: '${_symptomSeverity?.round() ?? 0}',
                  onChanged: (v) => setState(() => _symptomSeverity = v)),
              TextField(
                  controller: _sideEffects,
                  maxLines: 2,
                  decoration: InputDecoration(
                      labelText: L.tr('Madhara ya dawa uliyoona (hiari)'))),
              ..._vitals.entries.map((e) => TextField(
                  controller: e.value,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                      labelText: L.tr({
                            'systolic': 'Shinikizo la damu systolic (mmHg)',
                            'diastolic': 'Shinikizo la damu diastolic (mmHg)',
                            'glucose_mmol_l': 'Sukari ya damu (mmol/L)',
                            'spo2': 'Oksijeni kwenye damu (%)'
                          }[e.key] ??
                          e.key)))),
              const SizedBox(height: 16),
            ],
            Text(
              L.tr('Kuna kitu kingine unataka daktari ajue?'),
              style: const TextStyle(fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            TextField(controller: _note, maxLines: 3),
            if (_message != null) ...[
              const SizedBox(height: 16),
              Notice(_message!, tone: NoticeTone.attention),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'Inatuma...' : S.send),
            ),
          ],
        ],
      ),
    );
  }

  Widget _redFlagQuestion(
          String question, bool? value, ValueChanged<bool> onChanged) =>
      Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(question),
          const SizedBox(height: 4),
          Wrap(spacing: 8, children: [
            ChoiceChip(
                label: Text(L.tr('Ndiyo')),
                selected: value == true,
                onSelected: (_) => onChanged(true)),
            ChoiceChip(
                label: Text(L.tr('Hapana')),
                selected: value == false,
                onSelected: (_) => onChanged(false)),
          ]),
        ]),
      );
}

import '../widgets/patient_ui.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:intl/intl.dart';
import '../core/emergency.dart';
import '../core/l10n.dart';
import '../core/patient_experience.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../widgets/common.dart';
import '../widgets/emergency_call_button.dart';
import 'emergency_location_picker.dart';

const _categories = [
  ('other', 'Nyingine / sijui'),
  ('medical', 'Ugonjwa wa ghafla'),
  ('trauma', 'Jeraha au kuvuja damu'),
  ('road_traffic', 'Ajali ya barabarani'),
  ('obstetric', 'Uzazi'),
  ('fire', 'Moto')
];
const _active = {'reported', 'triaged', 'dispatched', 'en_route', 'arrived'};
String emergencyStatusLabel(String status) => L.tr(switch (status) {
      'reported' => 'Imepokelewa na mfumo',
      'triaged' => 'Imepokelewa na dispatcher',
      'dispatched' => 'Gari limepangiwa',
      'en_route' => 'Safari imeripotiwa kuanza',
      'arrived' => 'Kufika eneo la tukio kumeripotiwa',
      'resolved' => 'Tukio limefungwa',
      'cancelled' => 'Ombi limefutwa',
      _ => 'Hali haijulikani'
    });

class EmergencyScreen extends StatefulWidget {
  const EmergencyScreen(
      {super.key,
      this.repository,
      this.recoveryStore,
      this.locate,
      this.openDialer});
  final EmergencyRepository? repository;
  final EmergencyRecoveryStore? recoveryStore;
  final Future<Position> Function()? locate;
  final Future<bool> Function(Uri)? openDialer;
  @override
  State<EmergencyScreen> createState() => _EmergencyScreenState();
}

class _EmergencyScreenState extends State<EmergencyScreen>
    with WidgetsBindingObserver {
  late final EmergencyRepository _repository;
  late final EmergencyRecoveryStore _store;
  late final int _identity;
  final _latitude = TextEditingController(),
      _longitude = TextEditingController(),
      _landmark = TextEditingController(),
      _phone = TextEditingController(),
      _description = TextEditingController(),
      _lookupId = TextEditingController();
  Map<String, dynamic>? _request, _pending;
  String? _owner, _error, _unverifiedReceiptId;
  String _category = 'other', _source = 'manual';
  double? _accuracy;
  DateTime? _captured, _checked;
  bool _busy = false,
      _locating = false,
      _refreshing = false,
      _restoring = true,
      _foreground = true;
  Timer? _timer;
  bool get _sameOwner => _identity == Session.identityChanges.value;
  bool get _current => mounted && _sameOwner;
  @override
  void initState() {
    super.initState();
    _repository = widget.repository ?? EmergencyRepository();
    _store = widget.recoveryStore ?? const EmergencyRecoveryStore();
    _identity = Session.identityChanges.value;
    Session.identityChanges.addListener(_ownerChanged);
    WidgetsBinding.instance.addObserver(this);
    _restore();
  }

  void _ownerChanged() {
    if (!mounted || _sameOwner) return;
    _timer?.cancel();
    setState(() {
      _request = null;
      _unverifiedReceiptId = null;
      _pending = null;
      _owner = null;
      _checked = null;
      _captured = null;
      _accuracy = null;
      _busy = false;
      _locating = false;
      _restoring = false;
      for (final field in [
        _latitude,
        _longitude,
        _landmark,
        _phone,
        _description,
        _lookupId
      ]) {
        field.clear();
      }
      _error = L.tr('Account imebadilika. Fungua taarifa zako tena.');
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    Session.identityChanges.removeListener(_ownerChanged);
    WidgetsBinding.instance.removeObserver(this);
    for (final field in [
      _latitude,
      _longitude,
      _landmark,
      _phone,
      _description,
      _lookupId
    ]) {
      field.dispose();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (!_foreground) {
      _timer?.cancel();
    } else if (_current) {
      _refresh();
      _poll();
    }
  }

  void _poll() {
    _timer?.cancel();
    if (_foreground &&
        _current &&
        _request != null &&
        _active.contains(_request!['status'])) {
      _timer = Timer.periodic(const Duration(seconds: 10), (_) => _refresh());
    }
  }

  Future<void> _restore() async {
    try {
      final owner = await Session.userId();
      final saved = await _store.load(owner);
      final user = await Session.user();
      if (!_current) return;
      _owner = owner;
      if (user?['phone_number'] is String) {
        _phone.text = user!['phone_number'] as String;
      }
      if (saved != null) {
        _pending = saved['pending'] is Map
            ? Map<String, dynamic>.from(saved['pending'] as Map)
            : null;
        if (saved['request_id'] is String) {
          _unverifiedReceiptId = saved['request_id'] as String;
          _lookupId.text = saved['request_id'] as String;
          await _refresh(id: saved['request_id'] as String);
        } else if (_pending?['client_request_id'] is String) {
          try {
            final found = await _repository
                .recover(_pending!['client_request_id'] as String);
            if (_current) await _accept(found);
          } catch (_) {
            if (_current) {
              setState(() => _error = L.tr(
                  'Ombi la awali halijathibitishwa. Jaribu kutuma tena ombi lilelile; usianzishe ombi jipya.'));
            }
          }
        }
      }
    } catch (_) {
      if (_current) {
        setState(() => _error = L.tr(
            'Hali iliyohifadhiwa haikuweza kufunguliwa. Tumia namba ya ombi au piga 112.'));
      }
    } finally {
      if (_current) setState(() => _restoring = false);
    }
  }

  Future<void> _accept(Map<String, dynamic> response) async {
    final id = response['id'];
    if (id is! String || !RegExp(r'^[0-9a-fA-F-]{36}$').hasMatch(id)) {
      throw const FormatException('Invalid emergency receipt');
    }
    bool persisted = true;
    try {
      await _store.save(_owner, {'request_id': id});
    } catch (_) {
      persisted = false;
    }
    if (!_current) return;
    setState(() {
      _request = response;
      _unverifiedReceiptId = null;
      _pending = null;
      _lookupId.text = id;
      _checked = DateTime.now();
      _error = persisted
          ? null
          : L.tr(
              'Ombi limepokelewa lakini namba yake haikuhifadhiwa kwenye simu. Nakili namba ya ombi.');
    });
    _poll();
  }

  Future<void> _refresh({String? id}) async {
    final key = id ?? _request?['id'] as String?;
    if (key == null || _busy || _refreshing || !_current) return;
    _refreshing = true;
    try {
      final response = await _repository.get(key);
      if (_current) await _accept(response);
    } catch (_) {
      if (_current) {
        setState(() => _error = L.tr(
            'Hali haijasasishwa. Taarifa iliyo hapa inaweza kuwa ya zamani; piga 112 ikiwa unahitaji msaada sasa.'));
      }
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _locate() async {
    if (_locating || _busy || _pending != null || !_current) return;
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      Position position;
      if (widget.locate != null) {
        position = await widget.locate!();
      } else {
        if (!await Geolocator.isLocationServiceEnabled()) {
          throw StateError('Location disabled');
        }
        var permission = await Geolocator.checkPermission();
        if (!_current) return;
        if (permission == LocationPermission.denied) {
          permission = await Geolocator.requestPermission();
        }
        if (!_current) return;
        if (permission == LocationPermission.denied ||
            permission == LocationPermission.deniedForever) {
          throw StateError('Permission denied');
        }
        position = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
                accuracy: LocationAccuracy.high,
                timeLimit: Duration(seconds: 20)));
      }
      if (!_current) return;
      if (!isValidEmergencyCoordinates(position.latitude, position.longitude)) {
        throw StateError('Invalid position');
      }
      setState(() {
        _latitude.text = position.latitude.toString();
        _longitude.text = position.longitude.toString();
        _source = 'gps';
        _accuracy = position.accuracy.isFinite && position.accuracy >= 0
            ? position.accuracy
            : null;
        _captured = position.timestamp;
      });
    } catch (_) {
      if (_current) {
        setState(() => _error = L.tr(
            'GPS haikupatikana. Washa location na ruhusa yake, chagua eneo kwenye ramani, au piga 112.'));
      }
    } finally {
      if (_current) setState(() => _locating = false);
    }
  }

  Future<void> _pickLocation() async {
    final selected = await Navigator.push<Map<String, double>>(context,
        MaterialPageRoute(builder: (_) => const EmergencyLocationPicker()));
    if (selected == null || !_current) return;
    setState(() {
      _latitude.text = selected['lat'].toString();
      _longitude.text = selected['lng'].toString();
      _source = 'manual';
      _accuracy = null;
      _captured = DateTime.now();
    });
  }

  void _manual(String _) {
    setState(() {
      _source = 'manual';
      _accuracy = null;
      _captured = null;
    });
  }

  Future<void> _report() async {
    if (_busy || !_current) return;
    if (_pending == null) {
      final lat = double.tryParse(_latitude.text),
          lng = double.tryParse(_longitude.text);
      if (!isValidEmergencyCoordinates(lat, lng)) {
        setState(() => _error =
            L.tr('Chagua eneo la tukio kwa GPS, ramani au koordineti halali.'));
        return;
      }
      final rawPhone = _phone.text.trim();
      final phone = rawPhone.startsWith('+') &&
              RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(rawPhone)
          ? rawPhone
          : toE164(rawPhone);
      if (rawPhone.isNotEmpty && phone == null) {
        setState(() => _error = L.tr('Weka namba ya simu inayoweza kupigiwa.'));
        return;
      }
      _pending = {
        ...emergencyRequestBody(
            category: _category, latitude: lat!, longitude: lng!),
        'client_request_id': emergencyOperationId(),
        'location_source': _source,
        if (_accuracy != null) 'location_accuracy_m': _accuracy,
        if (_captured != null)
          'location_captured_at': _captured!.toUtc().toIso8601String(),
        if (_landmark.text.trim().isNotEmpty) 'landmark': _landmark.text.trim(),
        if (_description.text.trim().isNotEmpty)
          'description': _description.text.trim(),
        if (phone != null) 'reporter_phone': phone,
      };
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final payload = Map<String, dynamic>.from(_pending!);
    bool attempted = false;
    try {
      try {
        await _store.save(_owner, {'pending': payload});
      } catch (_) {
        /* A local storage failure must not block an emergency report. */
      }
      if (!_sameOwner) return;
      if (!await _repository.online()) throw const SocketOffline();
      attempted = true;
      final receipt = await _repository.report(payload);
      if (_sameOwner) await _accept(receipt);
    } catch (_) {
      if (attempted && _sameOwner && _owner != null) {
        try {
          final found =
              await _repository.recover(payload['client_request_id'] as String);
          if (_sameOwner) await _accept(found);
          return;
        } catch (_) {}
      }
      if (_current) {
        setState(() => _error = L.tr(
            'Ombi halijathibitishwa; hakuna uthibitisho wa msaada kutumwa. Piga 112 au jaribu tena ombi lilelile ukiwa na intaneti.'));
      }
    } finally {
      if (_current) setState(() => _busy = false);
    }
  }

  Future<void> _lookup() async {
    if (!RegExp(r'^[0-9a-fA-F-]{36}$').hasMatch(_lookupId.text.trim())) {
      setState(() => _error = L.tr('Weka namba halali ya ombi.'));
      return;
    }
    await _refresh(id: _lookupId.text.trim());
  }

  String _date(dynamic raw) {
    final d = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    return d == null
        ? '—'
        : '${DateFormat('d MMM y, HH:mm:ss').format(d)} (${d.timeZoneName})';
  }

  @override
  Widget build(BuildContext context) {
    final request = _request;
    return PatientScaffold(
        appBar: AppBar(title: Text(L.tr('Dharura / SOS')), actions: [
          EmergencyCallButton(
              key: const Key('emergency-appbar-call'),
              compact: true,
              openDialer: widget.openDialer)
        ]),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          Text(L.tr('Msaada wa dharura Tanzania'),
              style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          EmergencyCallButton(
              key: const Key('emergency-call-112'),
              openDialer: widget.openDialer),
          const SizedBox(height: 8),
          Text(L.tr(
              'Simu haitegemei intaneti ya app. Kitufe kinafungua kipiga simu; hakithibitishi kwamba simu imeunganishwa.')),
          const SizedBox(height: 16),
          Notice(
              L.tr(
                  'Ombi la AHP linahitaji intaneti na timu ya dispatch inayofanya kazi. Kupokelewa na mfumo hakumaanishi gari limeanza safari.'),
              tone: NoticeTone.attention),
          if (_error != null)
            Semantics(
                liveRegion: true,
                child: Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Notice(_error!))),
          if (_restoring)
            const Padding(
                padding: EdgeInsets.all(16), child: LinearProgressIndicator()),
          if (request != null) ...[
            const SizedBox(height: 20),
            SectionTitle(L.tr('Ombi lako')),
            Semantics(
                liveRegion: true,
                child: Text(emergencyStatusLabel(request['status'] as String),
                    style: Theme.of(context).textTheme.titleLarge)),
            if (request['status'] == 'reported')
              Text(L.tr(
                  'Dispatcher bado hajathibitisha kupokea ombi hili. Usidhani ambulance imetumwa.')),
            if (request['status'] == 'dispatched')
              Text(
                  L.tr('Gari limepangiwa; kuanza safari bado hakujaripotiwa.')),
            SelectableText(L.tr('Namba ya ombi: {0}', [request['id']])),
            if (_checked != null)
              Text(L.tr(
                  'Hali ilisomwa: {0}', [_date(_checked!.toIso8601String())])),
            if (request['acknowledged_at'] != null)
              Text(L.tr('Dispatcher amepokea: {0}',
                  [_date(request['acknowledged_at'])])),
            if (request['response_unit'] is Map)
              Text(L.tr('Gari lililopangiwa: {0}',
                  [(request['response_unit'] as Map)['call_sign']])),
            if (request['destination_facility'] is Map)
              Text(L.tr('Kituo cha kupokea: {0}',
                  [(request['destination_facility'] as Map)['name']])),
            if ((request['response_unit'] as Map?)?['location_updated_at'] !=
                null)
              Text(L.tr('Taarifa ya eneo la gari: {0}', [
                _date((request['response_unit'] as Map)['location_updated_at'])
              ])),
            if ((request['response_unit'] as Map?)?['location_is_stale'] ==
                true)
              Text(L.tr(
                  'Eneo la gari halijasasishwa; halionyeshi mahali gari lilipo sasa.')),
            for (final event
                in (request['timeline'] as List? ?? []).whereType<Map>())
              Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                      '${emergencyStatusLabel(event['status'] as String)} • ${_date(event['occurred_at'])}')),
            OutlinedButton.icon(
                onPressed: _busy ? null : () => _refresh(),
                icon: const Icon(Icons.refresh),
                label: Text(L.tr('Soma hali tena'))),
            if (!_active.contains(request['status']))
              TextButton(
                  onPressed: () async {
                    await _store.clear(_owner);
                    if (_current) {
                      setState(() {
                        _request = null;
                        _pending = null;
                        _error = null;
                        _lookupId.clear();
                      });
                    }
                  },
                  child: Text(L.tr('Anza ombi jipya'))),
          ] else if (_sameOwner &&
              !_restoring &&
              _unverifiedReceiptId != null) ...[
            const SizedBox(height: 16),
            SelectableText(L.tr('Namba ya ombi: {0}', [_unverifiedReceiptId])),
            Text(L.tr(
                'Ombi lililohifadhiwa linasubiri kusomwa. Soma hali yake kabla ya kuanzisha ombi jipya.')),
            OutlinedButton(
                onPressed: () => _refresh(id: _unverifiedReceiptId),
                child: Text(L.tr('Soma hali tena'))),
          ] else if (_sameOwner && !_restoring) ...[
            const SizedBox(height: 20),
            SectionTitle(L.tr('Tuma ombi kwa timu ya AHP')),
            if (_pending == null) ...[
              DropdownButtonFormField<String>(
                  isExpanded: true,
                  initialValue: _category,
                  decoration: InputDecoration(labelText: L.tr('Aina ya tukio')),
                  items: _categories
                      .map((item) => DropdownMenuItem(
                          value: item.$1, child: Text(L.tr(item.$2))))
                      .toList(),
                  onChanged: _busy
                      ? null
                      : (value) =>
                          setState(() => _category = value ?? 'other')),
              const SizedBox(height: 12),
              Wrap(spacing: 12, runSpacing: 8, children: [
                OutlinedButton.icon(
                    key: const Key('emergency-gps'),
                    onPressed: _busy || _locating ? null : _locate,
                    icon: const Icon(Icons.my_location),
                    label: Text(_locating
                        ? L.tr('Inatafuta eneo…')
                        : L.tr('Tumia GPS ya simu'))),
                TextButton.icon(
                    onPressed: _busy || _locating ? null : _pickLocation,
                    icon: const Icon(Icons.map_outlined),
                    label: Text(L.tr('Chagua eneo kwenye ramani'))),
              ]),
              if (isValidEmergencyCoordinates(double.tryParse(_latitude.text),
                  double.tryParse(_longitude.text))) ...[
                Text(L.tr('Eneo la tukio: {0}, {1}',
                    [_latitude.text, _longitude.text])),
                if (_accuracy != null)
                  Text(L.tr('Usahihi wa GPS: takriban mita {0}',
                      [_accuracy!.round()])),
                if (_captured != null)
                  Text(L.tr('Eneo lilipatikana: {0}',
                      [_date(_captured!.toIso8601String())])),
              ],
            ] else
              Text(L.tr(
                  'Ombi la awali linasubiri uthibitisho. Kutuma tena kunatumia namba ileile ili kuepuka matukio yaliyorudiwa.')),
            const SizedBox(height: 12),
            FilledButton.icon(
                key: const Key('emergency-submit'),
                onPressed: _busy || _locating ? null : _report,
                icon: _busy
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.send),
                label: Text(_busy
                    ? L.tr('Inatuma…')
                    : _pending == null
                        ? L.tr('Tuma ombi')
                        : L.tr('Jaribu tena ombi lilelile'))),
            if (_pending == null) ...[
              ExpansionTile(
                  title: Text(L.tr('Weka koordineti mwenyewe')),
                  children: [
                    TextField(
                        key: const Key('emergency-latitude'),
                        controller: _latitude,
                        onChanged: _manual,
                        enabled: !_busy,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true, signed: true),
                        decoration:
                            InputDecoration(labelText: L.tr('Latitudo'))),
                    TextField(
                        key: const Key('emergency-longitude'),
                        controller: _longitude,
                        onChanged: _manual,
                        enabled: !_busy,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true, signed: true),
                        decoration:
                            InputDecoration(labelText: L.tr('Longitudo'))),
                  ]),
              ExpansionTile(
                  title: Text(L.tr('Ongeza maelezo ya tukio (hiari)')),
                  children: [
                    TextField(
                        controller: _landmark,
                        enabled: !_busy,
                        maxLength: 500,
                        decoration: InputDecoration(
                            labelText: L.tr(
                                'Alama ya eneo / namna ya kufika (hiari)'))),
                    TextField(
                        controller: _phone,
                        enabled: !_busy,
                        keyboardType: TextInputType.phone,
                        decoration: InputDecoration(
                            labelText: L.tr('Namba ya kupigiwa (hiari)'))),
                    TextField(
                        controller: _description,
                        enabled: !_busy,
                        maxLength: 2000,
                        minLines: 2,
                        maxLines: 4,
                        decoration: InputDecoration(
                            labelText: L.tr('Nini kimetokea? (hiari)'))),
                  ]),
            ],
          ],
          if (_sameOwner) ...[
            const SizedBox(height: 24),
            SectionTitle(L.tr('Angalia ombi lililopo')),
            TextField(
                key: const Key('emergency-request-id'),
                controller: _lookupId,
                decoration: InputDecoration(labelText: L.tr('Namba ya ombi'))),
            OutlinedButton.icon(
                onPressed: _busy ? null : _lookup,
                icon: const Icon(Icons.search),
                label: Text(L.tr('Angalia hali'))),
          ],
        ]));
  }
}

class SocketOffline implements Exception {
  const SocketOffline();
}

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/l10n.dart';
import '../core/patient_care.dart';
import '../core/prescription_pharmacy.dart';
import '../core/session.dart';

class PrescriptionNearbyPharmacies extends StatefulWidget {
  const PrescriptionNearbyPharmacies(
      {super.key,
      required this.fulfillment,
      this.latitude,
      this.longitude,
      this.repository});
  final Map<String, dynamic> fulfillment;
  final double? latitude, longitude;
  final PatientCareRepository? repository;
  @override
  State<PrescriptionNearbyPharmacies> createState() =>
      _PrescriptionNearbyPharmaciesState();
}

class _PrescriptionNearbyPharmaciesState
    extends State<PrescriptionNearbyPharmacies> {
  late final int _identity;
  late final PatientCareRepository _care;
  final _results = <String, List<Map<String, dynamic>>>{};
  final _errors = <String>{};
  bool _busy = false, _searched = false;
  String? _locationError;
  double? _lat, _lng;
  int _generation = 0, _radius = 15;
  bool get _current => mounted && _identity == Session.identityChanges.value;
  List<Map<String, dynamic>> get _items =>
      pharmacyShortfalls(widget.fulfillment);

  @override
  void initState() {
    super.initState();
    _identity = Session.identityChanges.value;
    _care = widget.repository ?? PatientCareRepository();
    _lat = widget.latitude;
    _lng = widget.longitude;
    Session.identityChanges.addListener(_ownerChanged);
    if (_validLocation && _items.isNotEmpty) _search();
  }

  bool get _validLocation =>
      _lat != null &&
      _lng != null &&
      _lat!.isFinite &&
      _lng!.isFinite &&
      _lat!.abs() <= 90 &&
      _lng!.abs() <= 180;

  void _ownerChanged() {
    if (!_current && mounted) {
      _generation++;
      setState(() {
        _results.clear();
        _errors.clear();
        _lat = null;
        _lng = null;
        _busy = false;
      });
    }
  }

  @override
  void dispose() {
    _generation++;
    Session.identityChanges.removeListener(_ownerChanged);
    super.dispose();
  }

  Future<void> _search() async {
    if (!_current || !_validLocation || _busy) return;
    final generation = ++_generation;
    setState(() {
      _busy = true;
      _results.clear();
      _errors.clear();
      _locationError = null;
      _searched = false;
    });
    final facility = widget.fulfillment['facility_pharmacy'];
    try {
      // Bound the request rate; each item searches its exact prescribed name.
      for (final item in _items) {
        if (!_current || generation != _generation) return;
        final id = item['id'] as String,
            name = item['medication_name'] as String;
        try {
          final rows = await _care.medicationAvailability(
              name: name,
              latitude: _lat!,
              longitude: _lng!,
              radiusKm: _radius.toDouble(),
              requiredQuantity: item['quantity_remaining'] as int,
              exactMatch: true);
          if (!_current || generation != _generation) return;
          setState(() => _results[id] = confirmedNearbyPharmacies(rows, name,
                  facility is Map ? facility['id'] as String? : null)
              .take(3)
              .toList());
        } catch (_) {
          if (!_current || generation != _generation) return;
          setState(() => _errors.add(id));
        }
      }
      if (_current && generation == _generation) {
        setState(() => _searched = true);
      }
    } finally {
      if (_current && generation == _generation) setState(() => _busy = false);
    }
  }

  Future<void> _locate() async {
    if (_busy || !_current) return;
    setState(() {
      _busy = true;
      _locationError = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw StateError('location disabled');
      }
      var permission = await Geolocator.checkPermission();
      if (!_current) return;
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (!_current) return;
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw StateError('permission denied');
      }
      final position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.medium,
              timeLimit: Duration(seconds: 20)));
      if (!_current) return;
      _lat = position.latitude;
      _lng = position.longitude;
    } catch (_) {
      if (_current) {
        setState(() => _locationError = L.tr(
            'Location haikupatikana. Washa location na ruhusa yake, kisha jaribu tena. Unaweza pia kutafuta kwa eneo uliloweka hapa chini.'));
      }
    } finally {
      if (_current) setState(() => _busy = false);
    }
    if (_current && _validLocation) await _search();
  }

  Future<void> _directions(Map pharmacy) async {
    final location = pharmacy['location'];
    if (location is! Map ||
        location['lat'] is! num ||
        location['lng'] is! num) {
      return;
    }
    final uri = Uri.https('www.google.com', '/maps/dir/',
        {'api': '1', 'destination': '${location['lat']},${location['lng']}'});
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw StateError('map unavailable');
      }
    } catch (_) {
      if (_current) {
        setState(() => _locationError =
            L.tr('Ramani haikufunguka. Tumia jina la pharmacy kutafuta njia.'));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_current || _items.isEmpty) return const SizedBox.shrink();
    return Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(L.tr('Pharmacy za karibu kwa dawa zilizobaki'),
              style: Theme.of(context).textTheme.titleMedium),
          Text(L.tr(
              'Dawa haipo, haitoshi au hali yake haijathibitishwa kwenye duka la kituo. Matokeo ni kwa dawa iliyoandikwa pekee; si mbadala wa dawa.')),
          if (!_validLocation)
            Text(L.tr('Ruhusu location ili kuona maduka yaliyo karibu nawe.')),
          if (_validLocation)
            Text(L.tr('Ndani ya kilomita {0} kutoka eneo {1}.', [
              _radius,
              widget.latitude == _lat && widget.longitude == _lng
                  ? L.tr('lililohifadhiwa')
                  : L.tr('la simu yako')
            ])),
          TextButton.icon(
              onPressed: _busy ? null : _locate,
              icon: const Icon(Icons.my_location),
              label: Text(L.tr('Tumia location ya simu'))),
          if (_busy)
            const Padding(
                padding: EdgeInsets.all(8), child: LinearProgressIndicator()),
          if (_locationError != null)
            Text(_locationError!,
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
          for (final item in _items) ...[
            if (_searched ||
                _results.containsKey(item['id']) ||
                _errors.contains(item['id'])) ...[
              const SizedBox(height: 10),
              Text(
                  '${item['medication_name']} • ${L.tr('Kiasi kilichobaki: {0}', [
                        item['quantity_remaining']
                      ])}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              if (_errors.contains(item['id']))
                Text(L.tr(
                    'Utafutaji haujafaulu. Angalia intaneti na ujaribu tena.')),
              if (!_errors.contains(item['id']) &&
                  (_results[item['id']] ?? []).isEmpty)
                Text(L.tr(
                    'Hakuna pharmacy yenye stock iliyothibitishwa kwa umbali huu. Hii haimaanishi kuwa dawa haipo kila mahali.')),
              for (final row
                  in _results[item['id']] ?? <Map<String, dynamic>>[])
                ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                        '${(row['pharmacy'] as Map)['name']} • ${NumberFormat('0.0').format((row['pharmacy'] as Map)['distance_km'])} km'),
                    subtitle: Text('${L.tr('Zilizopo: {0}', [
                          row['quantity_on_hand']
                        ])} • ${row['fulfillment_status'] == 'available' ? L.tr('Kiasi kinatosha') : L.tr('Kiasi hakitoshi chote')}'),
                    trailing: IconButton(
                        tooltip: L.tr('Fungua njia kwenye ramani'),
                        icon: const Icon(Icons.directions),
                        onPressed: () => _directions(row['pharmacy'] as Map))),
            ],
          ],
          if (_searched)
            Text(L.tr(
                'Stock haijahifadhiwa kwa ajili yako. Thibitisha upatikanaji na pharmacy kabla ya kwenda.')),
          if (_validLocation)
            Wrap(spacing: 12, children: [
              TextButton(
                  onPressed: _busy ? null : _search,
                  child: Text(L.tr('Sasisha pharmacy za karibu'))),
              if (_radius == 15)
                TextButton(
                    onPressed: _busy
                        ? null
                        : () {
                            _radius = 50;
                            _search();
                          },
                    child: Text(L.tr('Tafuta hadi kilomita 50'))),
            ]),
        ]));
  }
}

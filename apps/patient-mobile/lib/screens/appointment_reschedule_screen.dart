import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/l10n.dart';
import '../core/patient_care.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../widgets/common.dart';

class AppointmentRescheduleScreen extends StatefulWidget {
  const AppointmentRescheduleScreen(
      {super.key, required this.appointmentId, this.repository});
  final String appointmentId;
  final PatientCareRepository? repository;
  @override
  State<AppointmentRescheduleScreen> createState() =>
      _AppointmentRescheduleScreenState();
}

class _AppointmentRescheduleScreenState
    extends State<AppointmentRescheduleScreen> {
  late final PatientCareRepository _care;
  late final int _identity;
  Map<String, dynamic>? _appointment, _selected;
  List<Map<String, dynamic>> _slots = [];
  String? _next, _error, _key, _clinicianName;
  bool _loading = true, _busy = false, _confirming = false;
  int _generation = 0;
  bool get _sameOwner => _identity == Session.identityChanges.value;
  @override
  void initState() {
    super.initState();
    _care = widget.repository ?? PatientCareRepository();
    _identity = Session.identityChanges.value;
    Session.identityChanges.addListener(_ownerChanged);
    _load();
  }

  @override
  void dispose() {
    _generation++;
    Session.identityChanges.removeListener(_ownerChanged);
    super.dispose();
  }

  void _ownerChanged() {
    if (!mounted || _sameOwner) return;
    _generation++;
    if (_confirming) {
      _confirming = false;
      Navigator.of(context).pop(false);
    }
    setState(() {
      _appointment = null;
      _selected = null;
      _slots = [];
      _error = L.tr('Account imebadilika. Fungua taarifa zako tena.');
      _loading = false;
    });
  }

  String _date(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    return date == null
        ? L.tr('Muda haujulikani')
        : '${DateFormat('EEE d MMM y, HH:mm').format(date)} (${date.timeZoneName})';
  }

  Future<void> _load({bool more = false}) async {
    if (!_sameOwner || _busy) return;
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      if (!more) {
        _slots = [];
        _selected = null;
        _key = null;
        _appointment = null;
        _next = null;
      }
    });
    try {
      final result = await _care.rescheduleOptions(widget.appointmentId,
          cursor: more ? _next : null);
      if (!mounted || generation != _generation || !_sameOwner) return;
      final appointment =
          Map<String, dynamic>.from(result['appointment'] as Map);
      final rows = (result['data'] as List)
          .map((r) => Map<String, dynamic>.from(r as Map))
          .toList();
      final meta = result['meta'] as Map;
      if (appointment['id'] != widget.appointmentId ||
          appointment['version'] is! int ||
          appointment['status'] != 'booked' ||
          meta['has_more'] is! bool) {
        throw const FormatException('Invalid appointment options.');
      }
      if (more && _appointment?['version'] != appointment['version']) {
        throw ApiException(
            409,
            'VERSION_CONFLICT',
            L.tr(
                'Miadi imebadilika. Pakia taarifa upya kabla ya kuchagua muda.'));
      }
      if (meta['has_more'] == true &&
          (meta['next_cursor'] is! String || meta['next_cursor'] == _next)) {
        throw const FormatException('Invalid appointment cursor.');
      }
      setState(() {
        _appointment = appointment;
        _clinicianName = result['clinician_name'] as String?;
        _slots = more
            ? <String, Map<String, dynamic>>{
                for (final r in _slots) r['id'] as String: r,
                for (final r in rows) r['id'] as String: r
              }.values.toList()
            : rows;
        _next = meta['has_more'] == true ? meta['next_cursor'] as String : null;
      });
    } catch (e) {
      if (mounted && generation == _generation && _sameOwner) {
        setState(() {
          _error = e is ApiException
              ? e.message
              : L.tr('Nafasi hazikupatikana. Pakia taarifa upya.');
          _selected = null;
          _appointment = null;
          _slots = [];
          _next = null;
        });
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  String _failure(Object error) {
    if (error is ApiException &&
        (error.code == 'SLOT_UNAVAILABLE' || error.code == 'SLOT_IN_PAST')) {
      return L.tr(
          'Nafasi hiyo haipatikani tena. Pakia nafasi upya uchague muda mwingine.');
    }
    if (error is ApiException && error.code == 'VERSION_CONFLICT') {
      return L
          .tr('Miadi imebadilika. Pakia taarifa upya kabla ya kuchagua muda.');
    }
    return error is ApiException
        ? error.message
        : L.tr(
            'Mabadiliko hayajathibitishwa. Pakia miadi upya kuangalia muda uliopo kabla ya kujaribu tena.');
  }

  Future<void> _submit() async {
    if (_confirming ||
        _busy ||
        _loading ||
        !_sameOwner ||
        _selected == null ||
        _appointment == null) {
      return;
    }
    final selected = _selected!, appointment = _appointment!;
    _confirming = true;
    final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
              scrollable: true,
              title: Text(L.tr('Thibitisha muda mpya')),
              content: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(L.tr('Muda wa sasa: {0}',
                        [_date(appointment['starts_at'])])),
                    const SizedBox(height: 12),
                    Text(
                        L.tr('Muda mpya: {0}', [_date(selected['starts_at'])])),
                    const SizedBox(height: 12),
                    Text(L.tr(
                        'Muda wa zamani utaachiliwa baada ya muda mpya kuthibitishwa na seva.')),
                  ]),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: Text(L.tr('Rudi'))),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: Text(L.tr('Thibitisha mabadiliko')))
              ],
            ));
    _confirming = false;
    if (confirmed != true || !mounted || !_sameOwner) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    _key ??= newOpId();
    try {
      final updated = await _care.rescheduleAppointment(widget.appointmentId,
          slotId: selected['id'] as String,
          baseVersion: appointment['version'] as int,
          opId: _key!);
      if (!DateTime.parse(updated['starts_at'] as String)
          .isAtSameMomentAs(DateTime.parse(selected['starts_at'] as String))) {
        throw const FormatException('Appointment time mismatch.');
      }
      if (mounted && _sameOwner) Navigator.pop(context, true);
    } catch (e) {
      // A timeout can follow a committed change. Read persisted state before reporting failure.
      try {
        final current = await _care.appointment(widget.appointmentId);
        if (current['slot_id'] == selected['id'] &&
            DateTime.tryParse(current['starts_at']?.toString() ?? '')
                    ?.isAtSameMomentAs(
                        DateTime.parse(selected['starts_at'] as String)) ==
                true &&
            current['status'] == 'booked' &&
            current['version'] is int &&
            (current['version'] as int) > (appointment['version'] as int)) {
          if (mounted && _sameOwner) Navigator.pop(context, true);
          return;
        }
      } catch (_) {/* The UI must retain the unconfirmed state. */}
      if (mounted && _sameOwner) {
        setState(() {
          _error = _failure(e);
          _selected = null;
          _appointment = null;
          _slots = [];
          _next = null;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
      canPop: !_busy,
      child: Scaffold(
        appBar: AppBar(title: Text(L.tr('Badilisha muda wa miadi'))),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          if (_error != null) ...[Notice(_error!), const SizedBox(height: 12)],
          if (_appointment != null) ...[
            Text(_clinicianName ?? L.tr('Daktari wako'),
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
                L.tr('Muda wa sasa: {0}', [_date(_appointment!['starts_at'])])),
            Text(L
                .tr('Daktari, njia ya huduma na muda wa huduma havibadiliki.')),
            const SizedBox(height: 20),
            Text(L.tr('Chagua muda mpya'),
                style: Theme.of(context).textTheme.titleMedium),
          ],
          if (_loading)
            const Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: CircularProgressIndicator())),
          ..._slots.map((slot) {
            final selected = _selected?['id'] == slot['id'];
            final enabled = !_busy && !_loading && _sameOwner;
            return Semantics(
              key: ValueKey('reschedule-slot-${slot['id']}'),
              checked: selected,
              inMutuallyExclusiveGroup: true,
              child: ListTile(
                selected: selected,
                enabled: enabled,
                leading: Icon(selected
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked),
                title: Text(_date(slot['starts_at'])),
                subtitle: Text(L
                    .tr('Muda wa huduma: {0} min', [slot['duration_minutes']])),
                onTap: enabled
                    ? () => setState(() {
                          _selected = slot;
                          _key = null;
                        })
                    : null,
              ),
            );
          }),
          if (!_loading &&
              _error == null &&
              _appointment != null &&
              _slots.isEmpty)
            Text(L.tr(
                'Hakuna nafasi nyingine inayolingana ndani ya siku 90. Miadi yako ya sasa bado ipo.')),
          if (_next != null)
            OutlinedButton(
                onPressed: _loading || _busy ? null : () => _load(more: true),
                child: Text(L.tr('Onyesha nafasi zaidi'))),
          const SizedBox(height: 16),
          FilledButton(
              onPressed: _selected == null || _loading || _busy || !_sameOwner
                  ? null
                  : _submit,
              child: Text(_busy
                  ? L.tr('Inathibitisha muda mpya…')
                  : L.tr('Endelea kuthibitisha'))),
          TextButton(
              onPressed:
                  _busy || _loading || !_sameOwner ? null : () => _load(),
              child: Text(L.tr('Pakia nafasi upya'))),
          Text(L.tr(
              'Kubadilisha muda kunahitaji intaneti. Nafasi iliyochaguliwa haijahifadhiwa hadi seva ithibitishe.')),
        ]),
      ));
}

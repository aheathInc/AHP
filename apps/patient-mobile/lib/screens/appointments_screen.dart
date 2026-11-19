import '../widgets/patient_ui.dart';
import 'appointment_reschedule_screen.dart';
import '../core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/patient_care.dart';
import '../core/phone.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

String _appointmentDate(String? raw) {
  final date = DateTime.tryParse(raw ?? '')?.toLocal();
  return date == null
      ? L.tr('Muda haujulikani')
      : '${DateFormat('EEE d MMM y, HH:mm').format(date)} (${date.timeZoneName})';
}

class AppointmentsScreen extends StatefulWidget {
  const AppointmentsScreen({super.key, this.repository});
  final PatientCareRepository? repository;
  @override
  State<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends State<AppointmentsScreen> {
  late final _care = widget.repository ?? PatientCareRepository();
  List<Map<String, dynamic>> _appointments = [];
  List<Map<String, dynamic>> _clinicians = [];
  String? _error;
  bool _loading = true, _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final values = await Future.wait([
        _care.appointments(),
        _care.clinicians(),
      ]);
      if (!mounted) return;
      setState(() {
        _appointments = values[0] as List<Map<String, dynamic>>;
        _clinicians = ((values[1] as Map)['data'] as List? ?? [])
            .cast<Map<String, dynamic>>();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted)
        setState(() {
          _error = e is ApiException
              ? e.message
              : L.tr('Imeshindikana kupakia miadi.');
          _loading = false;
        });
    }
  }

  Future<void> _book(Map<String, dynamic> clinician) async {
    if (_busy) return;
    setState(() => _busy = true);
    final now = DateTime.now();
    List<Map<String, dynamic>> slots;
    try {
      slots = await _care.slots(
        clinician['id'] as String,
        now,
        now.add(const Duration(days: 30)),
      );
    } catch (e) {
      if (mounted)
        setState(() {
          _busy = false;
          _error =
              e is ApiException ? e.message : L.tr('Nafasi hazikupatikana.');
        });
      return;
    }
    if (!mounted) return;
    if (slots.isEmpty) {
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content:
              Text(L.tr('Hakuna nafasi zinazopatikana kwa siku 30 zijazo.')),
        ),
      );
      return;
    }
    final selected = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              title: Text(L.tr('Chagua muda')),
              subtitle: Text(L.tr('Nafasi hizi zimetolewa na daktari.')),
            ),
            ...slots.map(
              (s) => ListTile(
                leading:
                    Icon(Icons.schedule, color: AppPalette.of(context).petrol),
                title: Text(_date(s['starts_at'] as String?)),
                subtitle: Text(
                  L.tr("{0} min • {1}",
                      [s['duration_minutes'] ?? '', s['modality'] ?? '']),
                ),
                onTap: () => Navigator.pop(context, s),
              ),
            ),
          ],
        ),
      ),
    );
    if (selected == null || !mounted) {
      if (mounted) setState(() => _busy = false);
      return;
    }
    try {
      await _care.bookAppointment(
        opId: newOpId(),
        slotId: selected['id'] as String,
      );
      await _load();
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(L.tr('Miadi imehifadhiwa na seva.'))),
        );
    } on ApiException catch (e) {
      if (mounted)
        setState(
          () => _error = e.code == 'SLOT_UNAVAILABLE'
              ? L.tr('Nafasi hiyo imechukuliwa. Chagua nafasi nyingine.')
              : e.message,
        );
    } catch (e) {
      if (mounted)
        setState(
          () => _error =
              L.tr('Miadi haikuhifadhiwa. Hakuna ombi lililowekwa foleni.'),
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(Map<String, dynamic> appointment) async {
    if (_busy) return;
    setState(() => _busy = true);
    final id = appointment['id'] as String;
    final key = newOpId();
    try {
      await _care.cancelAppointment(id,
          opId: key, baseVersion: appointment['version'] as int?);
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = L.tr('Miadi haikughairiwa.'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reschedule(Map<String, dynamic> appointment) async {
    if (_busy) return;
    setState(() => _busy = true);
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => AppointmentRescheduleScreen(
            appointmentId: appointment['id'] as String)));
    if (!mounted) return;
    await _load();
    if (mounted) {
      setState(() => _busy = false);
      if (changed == true)
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(L.tr('Muda mpya wa miadi umethibitishwa na seva.'))));
    }
  }

  String _date(String? raw) => _appointmentDate(raw);

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return PatientScaffold(
      appBar: AppBar(title: Text(L.tr('Miadi'))),
      body: CarePageBody(
          child: _loading
              ? const SingleChildScrollView(child: LoadingContent())
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (_error != null) Notice(_error!),
                      WorkspaceIntro(
                          title: L.tr('Miadi yangu'),
                          description:
                              L.tr('Appointments and available clinicians.')),
                      if (_appointments.isEmpty && _error == null)
                        Empty(L.tr('Huna miadi iliyohifadhiwa.')),
                      ..._appointments.map((a) {
                        final clinician = _clinicians
                            .where((c) => c['id'] == a['clinician_id'])
                            .firstOrNull;
                        return Padding(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: PatientAppointmentCard(
                                name: clinician?['full_name'] as String? ??
                                    L.tr('Daktari wako'),
                                specialty: clinician?['specialty'] as String?,
                                startsAt: a['starts_at'] as String?,
                                modality: a['modality'] as String?,
                                status: L.tr('Hali: {0}',
                                    [a['status'] ?? 'haijulikani']),
                                onTap: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                        builder: (_) => AppointmentDetailScreen(
                                            appointmentId: a['id'] as String))),
                                actions: [
                                  if (a['status'] == 'booked' &&
                                      DateTime.tryParse(
                                                  a['starts_at'] as String? ??
                                                      '')
                                              ?.isAfter(DateTime.now()) ==
                                          true)
                                    OutlinedButton.icon(
                                        onPressed:
                                            _busy ? null : () => _reschedule(a),
                                        icon: const Icon(
                                            Icons.edit_calendar_outlined,
                                            size: 18),
                                        label: Text(L.tr('Badilisha muda'))),
                                  if (a['status'] == 'booked')
                                    TextButton(
                                        onPressed:
                                            _busy ? null : () => _cancel(a),
                                        child: Text(L.tr('Ghairi miadi'))),
                                ]));
                      }),
                      const SizedBox(height: 18),
                      SectionTitle(L.tr('Chagua daktari na muda')),
                      if (_clinicians.isEmpty)
                        Empty(L
                            .tr('Hakuna madaktari waliothibitishwa kwa sasa.')),
                      ..._clinicians.map((c) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: ClinicianIdentityCard(
                              name:
                                  c['full_name'] as String? ?? L.tr('Daktari'),
                              specialty: c['specialty'] as String? ??
                                  L.tr('Huduma ya jumla'),
                              status: c['status'] as String?,
                              onTap: _busy ? null : () => _book(c)))),
                    ],
                  ),
                )),
    );
  }
}

class AppointmentDetailScreen extends StatefulWidget {
  const AppointmentDetailScreen({super.key, required this.appointmentId});
  final String appointmentId;
  @override
  State<AppointmentDetailScreen> createState() =>
      _AppointmentDetailScreenState();
}

class _AppointmentDetailScreenState extends State<AppointmentDetailScreen> {
  Map<String, dynamic>? _appointment;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final value = await PatientCareRepository().appointment(
        widget.appointmentId,
      );
      if (mounted)
        setState(() {
          _appointment = value;
          _error = null;
        });
    } catch (e) {
      if (mounted)
        setState(
          () => _error =
              e is ApiException ? e.message : L.tr('Miadi haikupatikana.'),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return PatientScaffold(
      appBar: AppBar(title: Text(L.tr('Maelezo ya miadi'))),
      body: _appointment == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Notice(_error!),
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  _appointment!['status'] as String? ??
                      L.tr('Hali haijulikani'),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(_appointmentDate(_appointment!['starts_at'] as String?)),
                Text(
                  L.tr("Muda wa huduma: {0} min",
                      [_appointment!['duration_minutes'] ?? '—']),
                ),
                Text(L.tr("Njia: {0}", [_appointment!['modality'] ?? '—'])),
                if (_appointment!['status'] == 'booked' &&
                    DateTime.tryParse(
                                _appointment!['starts_at'] as String? ?? '')
                            ?.isAfter(DateTime.now()) ==
                        true)
                  OutlinedButton.icon(
                      onPressed: () async {
                        await Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => AppointmentRescheduleScreen(
                                appointmentId: widget.appointmentId)));
                        if (mounted) await _load();
                      },
                      icon: const Icon(Icons.edit_calendar),
                      label: Text(L.tr('Badilisha muda'))),
                if (_error != null) Notice(_error!),
                if (_appointment!['reason'] != null)
                  Text(L.tr("Sababu: {0}", [_appointment!['reason']])),
                if (_appointment!['cancelled_reason'] != null)
                  Text(
                    L.tr("Sababu ya kughairi: {0}",
                        [_appointment!['cancelled_reason']]),
                  ),
              ],
            ),
    );
  }
}

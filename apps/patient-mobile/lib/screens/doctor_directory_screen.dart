import '../widgets/patient_ui.dart';
import '../core/l10n.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/strings.dart';
import '../widgets/common.dart';
import 'new_consultation_screen.dart';

class DoctorDirectoryScreen extends StatefulWidget {
  const DoctorDirectoryScreen(
      {super.key,
      required this.facilityId,
      required this.facilityName,
      this.loadDoctors});
  final Future<List<Map<String, dynamic>>> Function()? loadDoctors;
  final String facilityId;
  final String facilityName;

  @override
  State<DoctorDirectoryScreen> createState() => _DoctorDirectoryScreenState();
}

class _DoctorDirectoryScreenState extends State<DoctorDirectoryScreen> {
  List<Map<String, dynamic>> _doctors = [];
  bool _loading = true;
  String? _error;
  String _query = '';
  String? _specialty;
  final _search = TextEditingController();
  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = widget.loadDoctors != null
          ? await widget.loadDoctors!()
          : (((await Api.get('/clinicians',
                          query: {'facility_id': widget.facilityId}))['data']
                      as List?) ??
                  [])
              .cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() {
        _doctors = rows;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (mounted)
        setState(() {
          _error = S.errorGeneric;
          _loading = false;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final term = _query.trim().toLowerCase();
    final specialties = _doctors
        .map((d) => d['specialty'])
        .whereType<String>()
        .where((s) => s.isNotEmpty)
        .toSet()
        .toList()
      ..sort();
    final visible = _doctors
        .where((d) =>
            (_specialty == null || d['specialty'] == _specialty) &&
            (term.isEmpty ||
                '${d['full_name']} ${d['specialty'] ?? ''}'
                    .toLowerCase()
                    .contains(term)))
        .toList();
    return PatientScaffold(
        appBar: AppBar(title: Text(widget.facilityName)),
        body: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(20),
                children: [
                  WorkspaceIntro(
                      title: L.tr('Chagua daktari na muda'),
                      description: widget.facilityName),
                  TextField(
                      controller: _search,
                      decoration: InputDecoration(
                          labelText: L.tr('Search doctors or specialties'),
                          prefixIcon: const Icon(Icons.search_rounded),
                          suffixIcon: _query.isEmpty
                              ? null
                              : IconButton(
                                  tooltip: L.tr('Clear search'),
                                  icon: const Icon(Icons.close_rounded),
                                  onPressed: () {
                                    _search.clear();
                                    setState(() => _query = '');
                                  })),
                      onChanged: (value) => setState(() => _query = value)),
                  if (specialties.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      ChoiceChip(
                          label: Text(L.tr('All')),
                          selected: _specialty == null,
                          onSelected: (_) => setState(() => _specialty = null)),
                      for (final specialty in specialties)
                        ChoiceChip(
                            label: Text(specialty),
                            selected: _specialty == specialty,
                            onSelected: (selected) => setState(() =>
                                _specialty = selected ? specialty : null)),
                    ])
                  ],
                  const SizedBox(height: 24),
                  if (_loading)
                    const LoadingContent()
                  else if (_error != null) ...[
                    Notice(_error!),
                    TextButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: Text(L.tr('Jaribu tena')))
                  ] else if (visible.isEmpty)
                    Empty(L.tr(_doctors.isEmpty
                        ? 'Hakuna madaktari waliopo kwa sasa.'
                        : 'No matching doctors. Try another search.'))
                  else
                    for (final d in visible)
                      Padding(
                          padding: const EdgeInsets.only(bottom: 16),
                          child: ClinicianIdentityCard(
                              name: d['full_name'] as String,
                              specialty: d['specialty'] as String? ??
                                  L.tr('Daktari wa kawaida'),
                              status: _statusLabel(
                                  d['status'] as String? ?? 'off_duty'),
                              queueLabel: L.tr('Foleni: {0} wagonjwa',
                                  [(d['queue_count'] as num?)?.toInt() ?? 0]),
                              action: (d['status'] as String? ?? 'off_duty') ==
                                      'off_duty'
                                  ? null
                                  : FilledButton(
                                      onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                                          builder: (_) => NewConsultationScreen(
                                              clinicianId: d['id'] as String,
                                              clinicianName:
                                                  d['full_name'] as String?,
                                              clinicianSpecialty:
                                                  d['specialty'] as String?,
                                              facilityId: widget.facilityId,
                                              facilityName: widget.facilityName))),
                                      child: Text(L.tr('Jiunge kwenye Foleni'))))),
                ])));
  }

  String _statusLabel(String value) => switch (value) {
        'available' => L.tr('Yupo'),
        'busy' => L.tr('Ana mgonjwa'),
        _ => L.tr('Hayupo'),
      };
}

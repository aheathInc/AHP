import '../widgets/patient_ui.dart';
import '../core/l10n.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/care_home.dart';
import '../widgets/premium.dart';
import 'doctor_directory_screen.dart';

String facilityLocationLabel(Map<String, dynamic> facility) {
  final location = facility['location'];

  if (location is Map) {
    final lat = location['lat'];
    final lng = location['lng'];
    if (lat != null && lng != null) {
      return L.tr("Lat {0}, Lng {1}", [lat, lng]);
    }
  }

  if (location is String && location.trim().isNotEmpty) {
    return location;
  }

  return L.tr('Eneo halijulikani');
}

class FacilityBrowserScreen extends StatefulWidget {
  const FacilityBrowserScreen({super.key, this.loadFacilities});
  final Future<List<Map<String, dynamic>>> Function()? loadFacilities;

  @override
  State<FacilityBrowserScreen> createState() => _FacilityBrowserScreenState();
}

class _FacilityBrowserScreenState extends State<FacilityBrowserScreen> {
  List<Map<String, dynamic>> _facilities = [];
  bool _loading = true;
  String? _error;
  final _search = TextEditingController();
  String _query = '';

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
      final rows = widget.loadFacilities != null
          ? await widget.loadFacilities!()
          : (((await Api.get('/facilities'))['data'] as List?) ?? [])
              .cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() {
        _facilities = rows;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = S.errorGeneric;
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final palette = AppPalette.of(context);
    final query = _query.trim().toLowerCase();
    final visible = _facilities
        .where((f) =>
            query.isEmpty ||
            '${f['name']} ${facilityLocationLabel(f)}'
                .toLowerCase()
                .contains(query))
        .toList();
    return PatientScaffold(
      appBar: AppBar(title: Text(L.tr('Tafuta Kituo'))),
      body: CarePageBody(
          child: RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(20),
                  children: [
                    WorkspaceIntro(
                        title: L.tr('Tafuta daktari au kituo'),
                        description: L.tr(
                            'Angalia foleni na daktari aliyepo kabla ya kwenda.')),
                    TextField(
                        controller: _search,
                        onChanged: (value) => setState(() => _query = value),
                        decoration: InputDecoration(
                            labelText: L.tr('Search facilities'),
                            prefixIcon: const Icon(Icons.search_rounded),
                            suffixIcon: _query.isEmpty
                                ? null
                                : IconButton(
                                    tooltip: L.tr('Clear search'),
                                    icon: const Icon(Icons.close_rounded),
                                    onPressed: () {
                                      _search.clear();
                                      setState(() => _query = '');
                                    }))),
                    const SizedBox(height: 24),
                    if (_loading)
                      const LoadingContent()
                    else if (_error != null) ...[
                      Notice(_error!),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                          onPressed: _load,
                          icon: const Icon(Icons.refresh),
                          label: Text(L.tr('Jaribu tena'))),
                    ] else if (visible.isEmpty)
                      Empty(L.tr(query.isEmpty
                          ? 'No facilities are available.'
                          : 'No matching facilities. Try another name or location.'))
                    else ...[
                      PremiumSectionHeading(
                          L.tr('Facilities ({0})', [visible.length])),
                      CareLinkGroup(children: [
                        for (final f in visible)
                          CareLink(
                              icon: Icons.local_hospital_outlined,
                              title: f['name'] as String,
                              subtitle: facilityLocationLabel(f),
                              onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                      builder: (_) => DoctorDirectoryScreen(
                                          facilityId: f['id'] as String,
                                          facilityName: f['name'] as String)))),
                      ]),
                      const SizedBox(height: 12),
                      Text(L.tr('Select a facility to view its clinicians.'),
                          style:
                              TextStyle(color: palette.inkSoft, fontSize: 14)),
                    ],
                  ]))),
    );
  }
}

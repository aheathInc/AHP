import '../widgets/brand_logo.dart';
import '../core/design_tokens.dart';
import '../widgets/care_home.dart';
import 'app_settings_screen.dart';
import '../core/l10n.dart';
import 'patient_community_screen.dart';
import 'feedback_tracking_screen.dart';
import 'pharmacy_map_screen.dart';

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/db.dart';
import '../core/outbox.dart';
import '../core/patient_care.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/service_directory.dart';
import '../widgets/consultation_call_action.dart';
import '../widgets/premium.dart';
import 'appointments_screen.dart';
import 'assistant_screen.dart';
import 'care_continuity_screen.dart';
import 'checkins_screen.dart';
import 'consultation_detail_screen.dart';
import 'consultation_call_screen.dart';
import 'diagnostics_screen.dart';
import 'education_screen.dart';
import 'emergency_screen.dart';
import 'facility_browser_screen.dart';
import 'family_screen.dart';
import 'feedback_screen.dart';
import 'front_desk_screen.dart';
import 'health_history_screen.dart';
import 'insurance_payments_screen.dart';
import 'payment_bills_screen.dart';
import 'login_screen.dart';
import 'new_consultation_screen.dart';
import 'privacy_consent_screen.dart';
import 'profile_screen.dart';
import 'messages_screen.dart';
import 'medication_followup_screen.dart';
import 'referrals_screen.dart';
import 'screening_screen.dart';
import 'vaccinations_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const _destinations = <_Destination>[
    _Destination('Nyumbani', Icons.home_outlined, Icons.home_rounded),
    _Destination('Huduma', Icons.grid_view_outlined, Icons.grid_view_rounded),
    _Destination('Rekodi', Icons.folder_open_outlined, Icons.folder_rounded),
    _Destination(
      'Ujumbe',
      Icons.chat_bubble_outline,
      Icons.chat_bubble_rounded,
    ),
    _Destination('Wasifu', Icons.person_outline_rounded, Icons.person_rounded),
  ];

  List<Map<String, dynamic>> _active = [];
  List<Map<String, dynamic>> _recent = [];
  int _pending = 0;
  int _failed = 0;
  int _retryableFailed = 0;
  int _selectedIndex = 0;
  bool _online = true;
  bool _loading = true;
  String? _name;
  StreamSubscription<ConnectivityResult>? _connectivitySubscription;

  @override
  void initState() {
    super.initState();
    _connectivitySubscription = Connectivity().onConnectivityChanged.listen((
      result,
    ) {
      final connected = result != ConnectivityResult.none;
      if (!mounted) return;
      setState(() => _online = connected);
      if (connected) _load();
    });
    _load();
  }

  Future<void> _load() async {
    final user = await Session.user();
    final ownerId = user?['id'] as String?;
    var online = await Api.online;
    await Api.flushOutbox();
    final pending = ownerId == null ? 0 : await Outbox.pendingCount(ownerId);
    final failed = ownerId == null ? 0 : await Outbox.failedCount(ownerId);
    final retryableFailed =
        ownerId == null ? 0 : await Outbox.retryableFailedCount(ownerId);

    List<Map<String, dynamic>> consultations = [];
    if (online) {
      try {
        final data = await Api.get('/consultations', query: {'limit': 20});
        consultations =
            ((data['data'] as List?) ?? []).cast<Map<String, dynamic>>();
        // Keep the most recent advice available when the patient loses signal.
        if (ownerId != null) await _cacheNotes(ownerId);
      } catch (_) {
        // Wi-Fi can be available while the API is not. Treat that as offline.
        online = false;
      }
    }

    if (!mounted) return;
    setState(() {
      _name = user?['full_name'] as String?;
      final groups = partitionConsultations(consultations);
      _active = groups.active;
      _recent = groups.recent;
      _pending = pending;
      _failed = failed;
      _retryableFailed = retryableFailed;
      _online = online;
      _loading = false;
    });
  }

  Future<void> _cacheNotes(String ownerId) async {
    try {
      final data = await Api.get(
        '/consultations',
        query: {'limit': 5, 'status': 'completed'},
      );
      final rows = <Map<String, Object?>>[];
      var complete = true;
      for (final raw in ((data['data'] as List?) ?? [])) {
        final consultation = raw as Map<String, dynamic>;
        try {
          final note = await Api.get(
            '/consultations/${consultation['id']}/note',
          );
          rows.add({
            'id': consultation['id'] as String,
            'diagnosis_text': note['diagnosis_text'],
            'advice_text': note['advice_text'],
            'red_flags': (note['red_flags_discussed'] as List?)?.join('\n'),
            'created_at':
                note['signed_at'] as String? ?? consultation['created_at'],
          });
        } on ApiException {
          complete = false;
        }
      }
      if (complete) await Db.cacheNotes(ownerId, rows);
    } catch (_) {
      // Refreshing the offline cache is best effort and must not block home.
    }
  }

  Future<void> _signOut() async {
    try {
      await Api.post('/auth/logout', {});
    } catch (_) {
      // Clear local credentials even when the network is unavailable.
    } finally {
      await Session.clear();
    }
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  Future<void> _retrySync() async {
    final ownerId = await Session.userId();
    if (ownerId == null) return;
    await Outbox.retryFailed(ownerId);
    await Api.flushOutbox();
    await _load();
  }

  @override
  void dispose() {
    _connectivitySubscription?.cancel();
    super.dispose();
  }

  void _go(Widget screen) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => screen))
        .then((_) => _load());
  }

  void _select(int index) => setState(() => _selectedIndex = index);

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final expanded = MediaQuery.sizeOf(context).width >= 840;
    return Scaffold(
      appBar: expanded || _selectedIndex == 4 || _selectedIndex == 3
          ? null
          : AppBar(
              toolbarHeight: 72,
              title: const BrandLogo(width: 160, height: 44),
              actions: [
                IconButton(
                    tooltip: L.tr('Display & accessibility'),
                    onPressed: () => _go(const AppSettingsScreen()),
                    icon: const Icon(Icons.tune_rounded)),
                Padding(
                    padding: const EdgeInsets.only(right: 16, left: 4),
                    child: IconButton.filledTonal(
                        tooltip: S.profile,
                        onPressed: () => _select(4),
                        icon: const Icon(Icons.person_outline_rounded))),
              ],
            ),
      body: SafeArea(
          top: expanded,
          bottom: false,
          child: expanded
              ? Row(children: [
                  _desktopNavigation(),
                  Expanded(
                      child: Center(
                          child: ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 1180),
                              child: _selectedPage()))),
                ])
              : _selectedPage()),
      bottomNavigationBar: expanded
          ? null
          : SafeArea(
              top: false,
              child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                  child: ClipRRect(
                      borderRadius: BorderRadius.circular(CareRadius.pill),
                      child: NavigationBar(
                        selectedIndex: _selectedIndex,
                        onDestinationSelected: _select,
                        destinations: [
                          for (final destination in _destinations)
                            NavigationDestination(
                              icon: Icon(destination.icon),
                              selectedIcon: Icon(destination.selectedIcon),
                              label: L.tr(destination.label),
                            ),
                        ],
                      )))),
    );
  }

  Widget _desktopNavigation() {
    final palette = AppPalette.of(context);
    return Container(
      width: 224,
      decoration:
          BoxDecoration(border: Border(right: BorderSide(color: palette.line))),
      child: Material(
          color: palette.surface,
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Padding(
                padding: EdgeInsets.fromLTRB(24, 30, 24, 26),
                child: BrandLogo(width: 166, height: 48)),
            Expanded(
                child: SingleChildScrollView(
                    child: Column(children: [
              for (var i = 0; i < _destinations.length; i++)
                Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                    child: Material(
                        color: _selectedIndex == i
                            ? palette.mintWash
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(12),
                        child: ListTile(
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12)),
                            selected: _selectedIndex == i,
                            selectedColor: palette.petrol,
                            leading: Icon(_selectedIndex == i
                                ? _destinations[i].selectedIcon
                                : _destinations[i].icon),
                            title: Text(L.tr(_destinations[i].label),
                                style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: _selectedIndex == i
                                        ? FontWeight.w700
                                        : FontWeight.w500)),
                            onTap: () => _select(i)))),
            ]))),
            const Divider(indent: 20, endIndent: 20),
            ListTile(
                leading: const Icon(Icons.tune_rounded),
                title: Text(L.tr('Settings'),
                    style: const TextStyle(fontSize: 14)),
                onTap: () => _go(const AppSettingsScreen())),
            ListTile(
                leading: const Icon(Icons.logout_rounded),
                title: Text(S.signOut, style: const TextStyle(fontSize: 14)),
                onTap: _signOut),
            const SizedBox(height: 20),
          ])),
    );
  }

  Widget _selectedPage() {
    if (_selectedIndex == 3) return const MessagesScreen();
    if (_selectedIndex == 4) return const ProfileScreen();
    final page = switch (_selectedIndex) {
      1 => _servicesPage(),
      2 => _recordsPage(),
      _ => _homePage(),
    };
    return RefreshIndicator(onRefresh: _load, child: page);
  }

  Widget _listPage(List<Widget> children) => ListView(
        key: ValueKey(_selectedIndex),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(
            MediaQuery.sizeOf(context).width >= 840 ? 36 : 20,
            MediaQuery.sizeOf(context).width >= 840 ? 32 : 12,
            MediaQuery.sizeOf(context).width >= 840 ? 36 : 20,
            32),
        children: children,
      );

  List<Widget> _syncNotices() => [
        if (!_online) ...[
          Notice(
            L.tr(
              'Hakuna mtandao. Unaweza kusoma dawa na ushauri uliohifadhiwa; mabadiliko salama yakihifadhiwa yataonyesha Pending sync hadi seva ithibitishe.',
            ),
            tone: NoticeTone.attention,
          ),
          const SizedBox(height: 12),
        ],
        if (_pending > 0) ...[
          Notice(
            L.tr("Pending sync: majibu {0} bado hayajathibitishwa na seva.", [
              _pending,
            ]),
            tone: NoticeTone.attention,
          ),
          const SizedBox(height: 12),
        ],
        if (_failed > 0) ...[
          Notice(
            L.tr(
              "{0} mabadiliko yanahitaji kuangaliwa mtandaoni. Hayatajaribiwa tena kiotomatiki.",
              [_failed],
            ),
            tone: NoticeTone.attention,
          ),
          if (_retryableFailed > 0)
            OutlinedButton.icon(
              onPressed: _online ? _retrySync : null,
              icon: const Icon(Icons.sync),
              label: Text(
                L.tr("Jaribu tena usawazishaji ({0})", [_retryableFailed]),
              ),
            ),
          const SizedBox(height: 12),
        ],
      ];

  Widget _homePage() => _listPage([
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(
                    _name == null || _name!.trim().isEmpty
                        ? L.tr('Nyumbani')
                        : L.tr('Habari, {0}', [_name!.trim().split(' ').first]),
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 6),
                Text(L.tr('Your care, in one place.'),
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: AppPalette.of(context).inkSoft)),
              ])),
          if (MediaQuery.sizeOf(context).width >= 1000)
            OutlinedButton.icon(
                onPressed: () => _go(const AppointmentsScreen()),
                icon: const Icon(Icons.calendar_month_outlined, size: 19),
                label: Text(L.tr('Miadi'))),
        ]),
        const SizedBox(height: 20),
        ..._syncNotices(),
        CareHomeActions(
            onFindCare: () => _go(const FacilityBrowserScreen()),
            onConsultation: () => _go(const NewConsultationScreen()),
            onEmergency: () => _go(const EmergencyScreen())),
        const SizedBox(height: 24),
        PremiumSectionHeading(L.tr('Huduma zako'),
            action: L.tr('Huduma zote'), onAction: () => _select(1)),
        CareShortcuts(items: [
          (
            icon: Icons.medical_services_outlined,
            label: S.homeGetHelp,
            onTap: () => _go(const NewConsultationScreen())
          ),
          (
            icon: Icons.calendar_month_outlined,
            label: L.tr('Miadi'),
            onTap: () => _go(const AppointmentsScreen())
          ),
          (
            icon: Icons.medication_outlined,
            label: S.medications,
            onTap: () => _go(const MedicationFollowupScreen())
          ),
          (
            icon: Icons.biotech_outlined,
            label: L.tr('Vipimo na majibu'),
            onTap: () => _go(const DiagnosticsScreen())
          ),
          (
            icon: Icons.family_restroom_outlined,
            label: L.tr('Familia na wategemezi'),
            onTap: () => _go(const FamilyScreen())
          ),
          (
            icon: Icons.grid_view_outlined,
            label: L.tr('Huduma zote'),
            onTap: () => _select(1)
          ),
        ]),
        const SizedBox(height: 24),
        LayoutBuilder(builder: (context, size) {
          final visits =
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            PremiumSectionHeading(L.tr('Matibabu yanayoendelea')),
            _consultationsSummary(_active, active: true),
            if (_recent.isNotEmpty) ...[
              const SizedBox(height: 12),
              PremiumSectionHeading(L.tr('Matibabu ya hivi karibuni'),
                  action: L.tr('Rekodi'), onAction: () => _select(2)),
              ..._recent.take(3).map(_consultationCard),
            ],
          ]);
          final support =
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            PremiumSectionHeading(L.tr('Continue your care')),
            CareLinkGroup(children: [
              CareLink(
                  icon: Icons.chat_bubble_outline_rounded,
                  title: L.tr('Mazungumzo kuhusu ziara'),
                  onTap: () => _select(3)),
              CareLink(
                  icon: Icons.alt_route_rounded,
                  title: L.tr('Rufaa Zangu'),
                  onTap: () => _go(const ReferralsScreen())),
              CareLink(
                  icon: Icons.map_outlined,
                  title: L.tr('Pharmacy karibu nami'),
                  onTap: () => _go(const PharmacyMapScreen())),
            ]),
          ]);
          if (size.maxWidth < 780) {
            return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [visits, const SizedBox(height: 20), support]);
          }
          return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(flex: 6, child: visits),
            const SizedBox(width: 24),
            Expanded(flex: 4, child: support),
          ]);
        }),
      ]);

  Widget _consultationsSummary(
    List<Map<String, dynamic>> consultations, {
    required bool active,
  }) {
    if (_loading) {
      return const LoadingContent(rows: 1);
    }
    if (consultations.isEmpty) {
      if (!_online) {
        return Empty(L.tr('Hali ya ziara haiwezi kuthibitishwa bila mtandao.'));
      }
      return PremiumCard(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Icons.medical_information_outlined,
            color: AppPalette.of(context).petrol, size: 28),
        const SizedBox(height: 16),
        Text(active ? S.homeNothing : L.tr('Hakuna ziara za hivi karibuni.'),
            style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 12),
        TextButton.icon(
            onPressed: () => _go(const NewConsultationScreen()),
            icon: const Icon(Icons.add_rounded),
            label: Text(L.tr('Anzisha ombi jipya'))),
      ]));
    }
    return Column(
      children:
          consultations.take(active ? 5 : 10).map(_consultationCard).toList(),
    );
  }

  Widget _consultationCard(Map<String, dynamic> consultation) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: PremiumCard(
          onTap: () =>
              _go(ConsultationDetailScreen(consultation: consultation)),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.medical_information_outlined,
                    color: AppPalette.of(context).petrol,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          (consultation['symptom_text'] as String?) ??
                              L.tr('Ombi la matibabu'),
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                        const SizedBox(height: 4),
                        PremiumStatus(
                          consultationStatusLabel(
                            consultation['status'] as String? ?? 'pending',
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.chevron_right_rounded,
                    color: AppPalette.of(context).inkSoft,
                  ),
                ],
              ),
              ConsultationCallAction(
                consultation: consultation,
                onJoin: () => _go(
                  ConsultationCallScreen(
                    consultationId: consultation['id'] as String,
                    video: consultation['modality'] == 'video',
                  ),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _servicesPage() {
    final sections = <({
      String title,
      List<({IconData icon, String label, Widget screen})> items
    })>[
      (
        title: L.tr('Anza au tafuta huduma'),
        items: [
          (
            icon: Icons.search,
            label: L.tr('Tafuta daktari au kituo'),
            screen: const FacilityBrowserScreen()
          ),
          (
            icon: Icons.medical_services_outlined,
            label: S.homeGetHelp,
            screen: const NewConsultationScreen()
          ),
          (
            icon: Icons.map_outlined,
            label: L.tr('Pharmacy karibu nami'),
            screen: const PharmacyMapScreen()
          ),
        ]
      ),
      (
        title: L.tr('Matibabu na ufuatiliaji'),
        items: [
          (
            icon: Icons.calendar_month_outlined,
            label: L.tr('Miadi'),
            screen: const AppointmentsScreen()
          ),
          (
            icon: Icons.local_hospital_outlined,
            label: L.tr('Huduma hospitalini'),
            screen: const FrontDeskScreen()
          ),
          (
            icon: Icons.notifications_active_outlined,
            label: L.tr('Ufuatiliaji wangu'),
            screen: const CareContinuityScreen()
          ),
          (
            icon: Icons.alt_route_rounded,
            label: L.tr('Rufaa Zangu'),
            screen: const ReferralsScreen()
          ),
          (
            icon: Icons.biotech_outlined,
            label: L.tr('Vipimo na majibu'),
            screen: const DiagnosticsScreen()
          ),
          (
            icon: Icons.medication_outlined,
            label: S.medications,
            screen: const MedicationFollowupScreen()
          ),
          (
            icon: Icons.checklist_rtl_outlined,
            label: S.checkIns,
            screen: const CheckInsScreen()
          ),
        ]
      ),
      (
        title: L.tr('Prevention'),
        items: [
          (
            icon: Icons.favorite_outline_rounded,
            label: S.screening,
            screen: const ScreeningScreen()
          ),
          (
            icon: Icons.vaccines_outlined,
            label: S.vaccinations,
            screen: const VaccinationsScreen()
          ),
          (
            icon: Icons.menu_book_outlined,
            label: L.tr('Elimu ya afya'),
            screen: const EducationScreen()
          ),
        ]
      ),
      (
        title: L.tr('Familia na taarifa'),
        items: [
          (
            icon: Icons.family_restroom_rounded,
            label: L.tr('Familia na wategemezi'),
            screen: const FamilyScreen()
          ),
          (
            icon: Icons.groups_outlined,
            label: L.tr('Community ya afya'),
            screen: const PatientCommunityScreen()
          ),
          (
            icon: Icons.auto_awesome_outlined,
            label: L.tr('Msaidizi wa A-Health'),
            screen: const AssistantScreen()
          ),
          (
            icon: Icons.history_rounded,
            label: L.tr('Historia Yangu ya Afya'),
            screen: const HealthHistoryScreen()
          ),
        ]
      ),
      (
        title: L.tr('Account & support'),
        items: [
          (
            icon: Icons.privacy_tip_outlined,
            label: L.tr('Faragha na ruhusa'),
            screen: const PrivacyConsentScreen()
          ),
          (
            icon: Icons.feedback_outlined,
            label: L.tr('Maoni na malalamiko'),
            screen: const FeedbackScreen()
          ),
          (
            icon: Icons.track_changes,
            label: L.tr('Fuatilia feedback'),
            screen: const FeedbackTrackingScreen()
          ),
          (
            icon: Icons.account_balance_wallet_outlined,
            label: L.tr('Bima na malipo'),
            screen: const InsurancePaymentsScreen()
          ),
          (
            icon: Icons.receipt_long_outlined,
            label: L.tr('Bili na risiti'),
            screen: const PaymentBillsScreen()
          ),
          (
            icon: Icons.person_outline_rounded,
            label: S.profile,
            screen: const ProfileScreen()
          ),
        ]
      ),
    ];
    return _listPage([
      ..._syncNotices(),
      WorkspaceIntro(
          title: L.tr('Huduma zote'),
          description: L.tr('Find the care or support you need.')),
      ServiceDirectory(
          sections: sections,
          onOpen: _go,
          emergency:
              CareEmergencyLink(onTap: () => _go(const EmergencyScreen()))),
    ]);
  }

  Widget _recordsPage() => _listPage([
        ..._syncNotices(),
        WorkspaceIntro(
            title: L.tr('Rekodi za afya'),
            description:
                L.tr('Mahali pamoja pa historia, dawa, vipimo na ziara zako.'),
            action: OutlinedButton.icon(
                onPressed: () => _go(const HealthHistoryScreen()),
                icon: const Icon(Icons.history),
                label: Text(L.tr('Fungua historia ya afya')))),
        PremiumSectionHeading(L.tr('Fungua rekodi')),
        LayoutBuilder(
          builder: (context, constraints) {
            final items = [
              PremiumAction(
                icon: Icons.history_rounded,
                title: L.tr('Historia ya afya'),
                subtitle: L.tr('Matukio na taarifa zako'),
                onTap: () => _go(const HealthHistoryScreen()),
              ),
              PremiumAction(
                icon: Icons.medication_outlined,
                title: S.medications,
                subtitle: L.tr('Ratiba na ufuatiliaji'),
                onTap: () => _go(const MedicationFollowupScreen()),
              ),
              PremiumAction(
                icon: Icons.biotech_outlined,
                title: L.tr('Vipimo na majibu'),
                subtitle: L.tr('Matokeo yaliyowasilishwa'),
                onTap: () => _go(const DiagnosticsScreen()),
              ),
            ];
            if (constraints.maxWidth < 560) {
              return Column(
                children: [
                  for (var i = 0; i < items.length; i++) ...[
                    items[i],
                    if (i < items.length - 1) const SizedBox(height: 10),
                  ],
                ],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < items.length; i++) ...[
                  Expanded(child: items[i]),
                  if (i < items.length - 1) const SizedBox(width: 10),
                ],
              ],
            );
          },
        ),
        const SizedBox(height: 18),
        PremiumSectionHeading(L.tr('Ziara zinazoendelea')),
        _consultationsSummary(_active, active: true),
        if (_recent.isNotEmpty) ...[
          const SizedBox(height: 8),
          PremiumSectionHeading(
            L.tr('Ziara za hivi karibuni'),
            action: L.tr('Historia ya afya'),
            onAction: () => _go(const HealthHistoryScreen()),
          ),
          ..._recent.take(5).map(_consultationCard),
        ],
      ]);
}

class _Destination {
  const _Destination(this.label, this.icon, this.selectedIcon);
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

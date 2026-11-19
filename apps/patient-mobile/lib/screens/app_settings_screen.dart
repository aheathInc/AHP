import '../widgets/patient_ui.dart';
import 'package:flutter/material.dart';
import '../core/app_preferences.dart';
import '../core/l10n.dart';
import '../core/theme.dart';
import '../widgets/profile_card.dart';

class AppSettingsScreen extends StatefulWidget {
  const AppSettingsScreen({super.key});
  @override
  State<AppSettingsScreen> createState() => _AppSettingsScreenState();
}

class _AppSettingsScreenState extends State<AppSettingsScreen> {
  bool _saving = false;
  String? _error;
  Future<void> _save(Future<void> Function() action) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await action();
    } catch (_) {
      if (mounted) {
        setState(
            () => _error = L.tr('Mipangilio haijahifadhiwa. Jaribu tena.'));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final prefs = AppPreferences.instance;
    return ListenableBuilder(
        listenable: prefs,
        builder: (context, _) => PatientScaffold(
              appBar: AppBar(title: Text(L.tr('Lugha na mwonekano'))),
              body: ListView(padding: const EdgeInsets.all(20), children: [
                Center(
                    child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 640),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(L.tr('Lugha ya app'),
                                  style:
                                      Theme.of(context).textTheme.titleMedium),
                              const SizedBox(height: 8),
                              Text(
                                  L.tr(
                                      'Chagua lugha unayopenda kutumia kwenye menyu na maelekezo ya app.'),
                                  style: TextStyle(
                                      color: AppPalette.of(context).inkSoft)),
                              const SizedBox(height: 16),
                              ProfileCard(
                                  padding: EdgeInsets.zero,
                                  child: RadioGroup<String>(
                                      groupValue: prefs.language,
                                      onChanged: (value) {
                                        if (!_saving && value != null) {
                                          _save(() => prefs.setLanguage(value));
                                        }
                                      },
                                      child: Column(children: [
                                        for (final entry in const {
                                          'sw': 'Kiswahili',
                                          'en': 'English',
                                          'fr': 'Français'
                                        }.entries)
                                          RadioListTile<String>(
                                              value: entry.key,
                                              title: Text(L.tr(entry.value)),
                                              enabled: !_saving),
                                      ]))),
                              const SizedBox(height: 28),
                              Text(L.tr('Mwonekano'),
                                  style:
                                      Theme.of(context).textTheme.titleMedium),
                              const SizedBox(height: 16),
                              ProfileCard(
                                  padding: EdgeInsets.zero,
                                  child: RadioGroup<ThemeMode>(
                                      groupValue: prefs.themeMode,
                                      onChanged: (value) {
                                        if (!_saving && value != null) {
                                          _save(() => prefs.setTheme(value));
                                        }
                                      },
                                      child: Column(children: [
                                        RadioListTile<ThemeMode>(
                                            value: ThemeMode.system,
                                            title: Text(L.tr(
                                                'Fuata mipangilio ya simu')),
                                            secondary: const Icon(
                                                Icons.brightness_auto_outlined),
                                            enabled: !_saving),
                                        RadioListTile<ThemeMode>(
                                            value: ThemeMode.light,
                                            title: Text(L.tr('Light mode')),
                                            secondary: const Icon(
                                                Icons.light_mode_outlined),
                                            enabled: !_saving),
                                        RadioListTile<ThemeMode>(
                                            value: ThemeMode.dark,
                                            title: Text(L.tr('Dark mode')),
                                            secondary: const Icon(
                                                Icons.dark_mode_outlined),
                                            enabled: !_saving),
                                      ]))),
                              const SizedBox(height: 28),
                              Text(L.tr('Ufikivu'),
                                  style:
                                      Theme.of(context).textTheme.titleMedium),
                              const SizedBox(height: 12),
                              ProfileCard(
                                  padding: EdgeInsets.zero,
                                  child: Column(children: [
                                    SwitchListTile.adaptive(
                                        title: Text(L.tr('Punguza mwendo')),
                                        subtitle: Text(L.tr(
                                            'Zima uhuishaji usio wa lazima. Chaguo la simu linaheshimiwa pia.')),
                                        value: prefs.reduceMotion,
                                        onChanged: _saving
                                            ? null
                                            : (value) => _save(() =>
                                                prefs.setReduceMotion(value))),
                                    SwitchListTile.adaptive(
                                        title:
                                            Text(L.tr('Nyuso zisizo na uwazi')),
                                        subtitle: Text(L.tr(
                                            'Punguza uwazi na ukungu wa mandharinyuma.')),
                                        value: prefs.solidSurfaces,
                                        onChanged: _saving
                                            ? null
                                            : (value) => _save(() =>
                                                prefs.setSolidSurfaces(value))),
                                  ])),
                              const SizedBox(height: 20),
                              Text(L.tr('Mwonekano wa rangi'),
                                  style:
                                      Theme.of(context).textTheme.titleMedium),
                              const SizedBox(height: 8),
                              Text(
                                  L.tr(
                                      'Lebo na alama zinaendelea kueleza hali. Picha na nyaraka za kitabibu hazibadilishwi.'),
                                  style: TextStyle(
                                      color: AppPalette.of(context).inkSoft)),
                              const SizedBox(height: 12),
                              ProfileCard(
                                  padding: EdgeInsets.zero,
                                  child: RadioGroup<ColorVisionMode>(
                                      groupValue: prefs.colorVision,
                                      onChanged: (value) {
                                        if (!_saving && value != null) {
                                          _save(() =>
                                              prefs.setColorVision(value));
                                        }
                                      },
                                      child: Column(children: [
                                        for (final entry in const {
                                          ColorVisionMode.standard:
                                              'Rangi za kawaida',
                                          ColorVisionMode.redGreen:
                                              'Rafiki kwa wekundu na kijani',
                                          ColorVisionMode.blueYellow:
                                              'Rafiki kwa bluu na manjano',
                                          ColorVisionMode.highContrast:
                                              'Utofauti mkubwa wa rangi',
                                        }.entries)
                                          RadioListTile<ColorVisionMode>(
                                              value: entry.key,
                                              title: Text(L.tr(entry.value)),
                                              enabled: !_saving),
                                      ]))),
                              const SizedBox(height: 20),
                              Text(
                                  L.tr(
                                      'Chaguo lako linahifadhiwa kwenye simu hii na linafanya kazi bila intaneti.'),
                                  style: TextStyle(
                                      color: AppPalette.of(context).inkSoft)),
                              if (_saving)
                                const Padding(
                                    padding: EdgeInsets.only(top: 16),
                                    child: LinearProgressIndicator()),
                              if (_error != null)
                                Padding(
                                    padding: const EdgeInsets.only(top: 16),
                                    child: Text(L.tr(_error!),
                                        style: TextStyle(
                                            color:
                                                AppPalette.of(context).clay))),
                            ]))),
              ]),
            ));
  }
}

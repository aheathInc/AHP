import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:intl/intl.dart';
import 'package:intl/date_symbol_data_local.dart';

enum ColorVisionMode { standard, redGreen, blueYellow, highContrast }

/// Device preferences work offline and do not contain patient records.
class AppPreferences extends ChangeNotifier {
  AppPreferences({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
                aOptions: AndroidOptions(encryptedSharedPreferences: true));
  static final instance = AppPreferences();
  static const languages = ['sw', 'en', 'fr'];
  final FlutterSecureStorage _storage;
  String _language = 'sw';
  ThemeMode _theme = ThemeMode.system;
  bool _reduceMotion = false;
  bool _solidSurfaces = false;
  ColorVisionMode _colorVision = ColorVisionMode.standard;
  bool get reduceMotion => _reduceMotion;
  bool get solidSurfaces => _solidSurfaces;
  ColorVisionMode get colorVision => _colorVision;
  String get language => _language;
  Locale get locale => Locale(_language);
  ThemeMode get themeMode => _theme;
  Future<void> load() async {
    await initializeDateFormatting();
    final language = await _storage.read(key: 'ah_ui_language');
    final theme = await _storage.read(key: 'ah_ui_theme');
    _language = languages.contains(language) ? language! : 'sw';
    Intl.defaultLocale = _language;
    _theme = ThemeMode.values.where((v) => v.name == theme).firstOrNull ??
        ThemeMode.system;
    _reduceMotion = await _storage.read(key: 'ah_ui_reduce_motion') == 'true';
    _solidSurfaces = await _storage.read(key: 'ah_ui_solid_surfaces') == 'true';
    final vision = await _storage.read(key: 'ah_ui_color_vision');
    _colorVision = ColorVisionMode.values
            .where((value) => value.name == vision)
            .firstOrNull ??
        ColorVisionMode.standard;
    notifyListeners();
  }

  Future<void> setReduceMotion(bool value) async {
    await _storage.write(key: 'ah_ui_reduce_motion', value: value.toString());
    _reduceMotion = value;
    notifyListeners();
  }

  Future<void> setSolidSurfaces(bool value) async {
    await _storage.write(key: 'ah_ui_solid_surfaces', value: value.toString());
    _solidSurfaces = value;
    notifyListeners();
  }

  Future<void> setColorVision(ColorVisionMode value) async {
    await _storage.write(key: 'ah_ui_color_vision', value: value.name);
    _colorVision = value;
    notifyListeners();
  }

  Future<void> setLanguage(String value) async {
    if (!languages.contains(value)) throw ArgumentError.value(value);
    await _storage.write(key: 'ah_ui_language', value: value);
    _language = value;
    Intl.defaultLocale = value;
    notifyListeners();
  }

  Future<void> setTheme(ThemeMode value) async {
    await _storage.write(key: 'ah_ui_theme', value: value.name);
    _theme = value;
    notifyListeners();
  }
}

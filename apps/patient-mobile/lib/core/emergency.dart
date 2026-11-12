import 'dart:convert';
import 'dart:math';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api.dart';
import 'session.dart';
import 'patient_experience.dart';

String emergencyOperationId() {
  final bytes = List<int>.generate(16, (_) => Random.secure().nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

class EmergencyRepository {
  Future<bool> online() => Api.online;
  Future<Map<String, dynamic>> report(Map<String, dynamic> body) async =>
      emergencyRequestFromJson(await Api.post('/emergency-requests', body,
          idempotencyKey: emergencyOperationId()));
  Future<Map<String, dynamic>> get(String id) async =>
      emergencyRequestFromJson(await Api.get('/emergency-requests/$id'));
  Future<Map<String, dynamic>> recover(String clientId) async =>
      emergencyRequestFromJson(
          await Api.get('/emergency-requests/by-client-id/$clientId'));
}

/// Sensitive drafts live only in the authenticated owner's platform keystore.
/// They are never an automatic offline outbox: retries require a user action.
class EmergencyRecoveryStore {
  const EmergencyRecoveryStore();
  static const _storage = FlutterSecureStorage(
      aOptions: AndroidOptions(encryptedSharedPreferences: true));
  Future<Map<String, dynamic>?> load(String? owner) async {
    if (owner == null) return null;
    final value = await _storage.read(key: 'ah_emergency_$owner');
    if (value == null) return null;
    try {
      return Map<String, dynamic>.from(jsonDecode(value) as Map);
    } catch (_) {
      return null;
    }
  }

  Future<void> save(String? owner, Map<String, dynamic> value) async {
    if (owner != null && owner == await Session.userId()) {
      await _storage.write(
          key: 'ah_emergency_$owner', value: jsonEncode(value));
    }
  }

  Future<void> clear(String? owner) async {
    if (owner != null) await _storage.delete(key: 'ah_emergency_$owner');
  }
}

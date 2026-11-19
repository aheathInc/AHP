import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart'
    show sqfliteFfiInit, databaseFactoryFfi;

/// Mobile platforms keep their native driver. Desktop uses the same schema and
/// owner-scoped cache in a private per-user application-data directory.
Future<void> initializeDesktopDatabase({Directory? directory}) async {
  if (!Platform.isLinux && !Platform.isWindows) return;
  final configured = Platform
      .environment[Platform.isWindows ? 'LOCALAPPDATA' : 'XDG_DATA_HOME'];
  final home =
      Platform.environment[Platform.isWindows ? 'USERPROFILE' : 'HOME'];
  if (directory == null &&
      (configured == null || !p.isAbsolute(configured)) &&
      (home == null || !p.isAbsolute(home))) {
    throw StateError('A private application-data directory is required.');
  }
  final target = directory ??
      Directory(p.join(
        configured != null && p.isAbsolute(configured)
            ? configured
            : p.join(home!, '.local', 'share'),
        'a-health',
        'databases',
      ));
  await target.create(recursive: true);
  if (Platform.isLinux) {
    final permissions = await Process.run('chmod', ['700', target.path]);
    if (permissions.exitCode != 0) {
      throw StateError('Could not secure the desktop cache directory.');
    }
  }
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;
  await databaseFactory.setDatabasesPath(target.path);
}

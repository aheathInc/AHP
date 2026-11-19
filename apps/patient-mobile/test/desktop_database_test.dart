import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';
import 'package:a_health_patient/core/desktop_database.dart';

void main() {
  test('desktop cache initializes and persists in a private directory',
      () async {
    final directory = await Directory.systemTemp.createTemp('ahealth-db-test-');
    try {
      await initializeDesktopDatabase(directory: directory);
      expect(await getDatabasesPath(), directory.path);
      expect((await directory.stat()).mode & 0x3f, 0);
      final path = '${directory.path}/test.db';
      var db = await openDatabase(path);
      await db.execute('CREATE TABLE cache (value TEXT)');
      await db.insert('cache', {'value': 'persisted'});
      await db.close();
      db = await openDatabase(path);
      expect((await db.query('cache')).single['value'], 'persisted');
      await db.close();
    } finally {
      await directory.delete(recursive: true);
    }
  });
}

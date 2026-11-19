import 'package:flutter/material.dart';

/// Human Care UI dimensions. Values are logical pixels and allow text growth.
abstract final class CareSpace {
  static const xxs = 4.0, xs = 8.0, sm = 12.0, md = 16.0;
  static const lg = 20.0, xl = 24.0, xxl = 32.0, section = 40.0;
}

abstract final class CareRadius {
  static const control = 12.0, card = 20.0, group = 24.0, pill = 28.0;
}

abstract final class CareLayout {
  static const compact = 600.0, expanded = 840.0, reading = 960.0;
  static const target = 48.0, action = 52.0, search = 56.0, navigation = 80.0;
  static const icon = 24.0, categoryIcon = 28.0, metadataIcon = 20.0;
}

abstract final class CareMotion {
  static const press = Duration(milliseconds: 140);
  static const selection = Duration(milliseconds: 200);
  static const curve = Curves.easeOutCubic;
}

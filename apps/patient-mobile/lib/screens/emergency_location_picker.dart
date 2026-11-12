import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/l10n.dart';

/// The initial country viewport is not an incident location. A pin requires a tap.
class EmergencyLocationPicker extends StatefulWidget {
  const EmergencyLocationPicker({super.key});
  @override
  State<EmergencyLocationPicker> createState() =>
      _EmergencyLocationPickerState();
}

class _EmergencyLocationPickerState extends State<EmergencyLocationPicker> {
  LatLng? _selected;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(L.tr('Chagua eneo la tukio'))),
        body: Column(children: [
          Padding(
              padding: const EdgeInsets.all(16),
              child: Text(L.tr(
                  'Gusa ramani kuweka alama mahali tukio lilipo. Eneo halijachaguliwa mpaka uliweke mwenyewe.'))),
          Expanded(
              child: FlutterMap(
                  options: MapOptions(
                      initialCenter: const LatLng(-6.369, 34.888),
                      initialZoom: 5,
                      onTap: (_, point) => setState(() => _selected = point)),
                  children: [
                TileLayer(
                    urlTemplate:
                        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'com.example.a_health_patient'),
                if (_selected != null)
                  MarkerLayer(markers: [
                    Marker(
                        point: _selected!,
                        child: Icon(Icons.location_pin,
                            color: Theme.of(context).colorScheme.error,
                            size: 44))
                  ]),
                RichAttributionWidget(attributions: [
                  TextSourceAttribution('OpenStreetMap contributors',
                      onTap: () => launchUrl(
                          Uri.parse('https://www.openstreetmap.org/copyright')))
                ]),
              ])),
          SafeArea(
              top: false,
              child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton(
                      onPressed: _selected == null
                          ? null
                          : () => Navigator.pop(context, {
                                'lat': _selected!.latitude,
                                'lng': _selected!.longitude
                              }),
                      child: Text(L.tr('Thibitisha eneo hili'))))),
        ]),
      );
}

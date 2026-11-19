import 'package:flutter/material.dart';
import '../core/l10n.dart';
import 'common.dart';
import 'premium.dart';
import 'care_home.dart';

typedef ServiceEntry = ({IconData icon, String label, Widget screen});
typedef ServiceGroup = ({String title, List<ServiceEntry> items});

/// The same authorized destinations, grouped and searchable without API calls.
class ServiceDirectory extends StatefulWidget {
  const ServiceDirectory(
      {super.key,
      required this.sections,
      required this.emergency,
      required this.onOpen});
  final List<ServiceGroup> sections;
  final Widget emergency;
  final ValueChanged<Widget> onOpen;
  @override
  State<ServiceDirectory> createState() => _ServiceDirectoryState();
}

class _ServiceDirectoryState extends State<ServiceDirectory> {
  final controller = TextEditingController();
  String query = '';
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final term = query.trim().toLowerCase();
    final filtered = widget.sections
        .map((section) => (
              title: section.title,
              items: section.items
                  .where((entry) =>
                      term.isEmpty ||
                      entry.label.toLowerCase().contains(term) ||
                      section.title.toLowerCase().contains(term))
                  .toList()
            ))
        .where((section) => section.items.isNotEmpty)
        .toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      TextField(
          controller: controller,
          decoration: InputDecoration(
              labelText: L.tr('Search services'),
              prefixIcon: const Icon(Icons.search),
              hintText: L.tr('Appointments, family, medicines…'),
              suffixIcon: query.isEmpty
                  ? null
                  : IconButton(
                      tooltip: L.tr('Clear search'),
                      onPressed: () {
                        controller.clear();
                        setState(() => query = '');
                      },
                      icon: const Icon(Icons.close))),
          onChanged: (value) => setState(() => query = value)),
      const SizedBox(height: 16),
      widget.emergency,
      if (filtered.isEmpty)
        Empty(L.tr('No matching services. Try another word.')),
      LayoutBuilder(builder: (context, size) {
        final columns = size.maxWidth >= 720 ? 2 : 1;
        final width = (size.maxWidth - (columns - 1) * 24) / columns;
        return Wrap(
            spacing: 24,
            runSpacing: 8,
            children: filtered
                .map((section) => SizedBox(
                    width: width,
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(height: 20),
                          PremiumSectionHeading(section.title),
                          CareLinkGroup(
                              children: section.items
                                  .map((entry) => CareLink(
                                      icon: entry.icon,
                                      title: entry.label,
                                      onTap: () => widget.onOpen(entry.screen)))
                                  .toList())
                        ])))
                .toList());
      }),
    ]);
  }
}

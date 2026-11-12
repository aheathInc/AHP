/// Only current, quantified remaining items need pharmacy recommendations.
List<Map<String, dynamic>> pharmacyShortfalls(
    Map<String, dynamic> fulfillment) {
  if (fulfillment['status'] != 'active' ||
      !{'not_dispensed', 'partial'}
          .contains(fulfillment['fulfilment_status'])) {
    return [];
  }
  final facility = fulfillment['facility_pharmacy'];
  final facilityRows = facility is Map ? facility['items'] : null;
  final availability = <Object?, Object?>{
    if (facilityRows is List)
      for (final row in facilityRows.whereType<Map>())
        row['prescription_item_id']: row['availability']
  };
  final rows = fulfillment['items'];
  if (rows is! List) return [];
  return rows
      .whereType<Map>()
      .where((item) {
        final remaining = item['quantity_remaining'];
        return item['id'] is String &&
            remaining is int &&
            remaining > 0 &&
            item['medication_name'] is String &&
            (item['medication_name'] as String).trim().isNotEmpty &&
            availability[item['id']] != 'available';
      })
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
}

/// Unknown/stale stock and different drug names are never recommendations.
List<Map<String, dynamic>> confirmedNearbyPharmacies(
    List<Map<String, dynamic>> rows, String medicine, String? facilityId) {
  final result = rows.where((row) {
    final pharmacy = row['pharmacy'];
    if (pharmacy is! Map ||
        pharmacy['id'] is! String ||
        pharmacy['id'] == facilityId ||
        pharmacy['is_verified'] != true) {
      return false;
    }
    final distance = pharmacy['distance_km'];
    final quantity = row['quantity_on_hand'];
    return distance is num &&
        distance.isFinite &&
        distance >= 0 &&
        quantity is num &&
        quantity > 0 &&
        row['inventory_fresh'] == true &&
        {'available', 'partially_available'}
            .contains(row['fulfillment_status']) &&
        row['medication_name'] is String &&
        (row['medication_name'] as String).trim().toLowerCase() ==
            medicine.trim().toLowerCase();
  }).toList();
  result.sort((a, b) => ((a['pharmacy'] as Map)['distance_km'] as num)
      .compareTo((b['pharmacy'] as Map)['distance_km'] as num));
  final seen = <Object?>{};
  return result
      .where((row) => seen.add((row['pharmacy'] as Map)['id']))
      .toList();
}

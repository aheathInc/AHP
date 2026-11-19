import 'l10n.dart';

/// Patient-facing copy only. API enum values stay unchanged in form state.
String patientOptionLabel(String value) => L.tr(const {
      'clinician': 'Doctor',
      'facility': 'Healthcare facility',
      'researcher': 'Researcher',
      'emergency_responder': 'Emergency responder',
      'full_history': 'Full health history',
      'current_thread': 'This care conversation only',
      'medications_only': 'Medicines only',
      'investigations_only': 'Tests and results only',
      'emergency_minimum': 'Essential emergency information',
      'clinical_care': 'Clinical care',
      'misconduct': 'Staff conduct',
      'medication_error': 'Medication error',
      'delayed_response': 'Delayed response',
      'data_privacy': 'Data privacy',
      'ai_error': 'AI assistant error',
      'other': 'Other',
    }[value] ??
    value.replaceAll('_', ' '));

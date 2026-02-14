export const patientProfile = {
  id: "PT-20240312",
  name: "Michael Thompson",
  age: 58,
  gender: "Male",
  primaryDiagnosis: "Osteoarthritis of the right knee",
  surgicalHistory: [
    {
      procedure: "Total Right Knee Replacement (TKR)",
      date: "2026-01-28",
      surgeon: "Dr. Sarah Chen",
      hospital: "St. Mary's General Hospital",
      notes: "Uneventful surgery. Cemented prosthesis implanted.",
    },
  ],
  medications: [
    { name: "Acetaminophen", dosage: "500mg", frequency: "Every 6 hours as needed" },
    { name: "Celecoxib", dosage: "200mg", frequency: "Once daily" },
    { name: "Enoxaparin", dosage: "40mg SC", frequency: "Once daily for 14 days (blood clot prevention)" },
    { name: "Lisinopril", dosage: "10mg", frequency: "Once daily (blood pressure)" },
  ],
  allergies: ["Penicillin (rash)", "Latex (mild irritation)"],
  vitalSigns: {
    bloodPressure: "132/84 mmHg",
    heartRate: "76 bpm",
    temperature: "36.8°C",
    weight: "88 kg",
    height: "178 cm",
  },
  postOpInstructions: [
    "Perform prescribed physical therapy exercises 3 times daily",
    "Keep surgical wound clean and dry",
    "Use ice packs for 20 minutes every 2-3 hours to reduce swelling",
    "Use walker or crutches for ambulation",
    "Elevate leg when sitting or lying down",
    "Report any signs of infection: increased redness, warmth, drainage, or fever above 38.3°C",
  ],
  nextAppointment: "2026-02-21",
  emergencyContact: {
    name: "Linda Thompson (Wife)",
    phone: "+1-555-0192",
  },
};

export function getPatientContext(): string {
  const p = patientProfile;
  return `
PATIENT PROFILE:
- Name: ${p.name}, Age: ${p.age}, Gender: ${p.gender}
- Patient ID: ${p.id}
- Primary Diagnosis: ${p.primaryDiagnosis}

SURGICAL HISTORY:
${p.surgicalHistory.map((s) => `- ${s.procedure} on ${s.date} by ${s.surgeon} at ${s.hospital}. ${s.notes}`).join("\n")}

CURRENT MEDICATIONS:
${p.medications.map((m) => `- ${m.name} ${m.dosage} — ${m.frequency}`).join("\n")}

ALLERGIES: ${p.allergies.join(", ")}

VITAL SIGNS (Last Recorded):
- BP: ${p.vitalSigns.bloodPressure}, HR: ${p.vitalSigns.heartRate}, Temp: ${p.vitalSigns.temperature}

POST-OP INSTRUCTIONS:
${p.postOpInstructions.map((i) => `- ${i}`).join("\n")}

NEXT APPOINTMENT: ${p.nextAppointment}
  `.trim();
}

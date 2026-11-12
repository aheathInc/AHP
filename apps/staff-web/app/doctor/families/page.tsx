import { requireRole } from "@/lib/roles";
import { FamilyWorkspace } from "@/components/FamilyWorkspace";
export default async function FamiliesPage() {
  await requireRole(["clinician"]);
  return <FamilyWorkspace />;
}

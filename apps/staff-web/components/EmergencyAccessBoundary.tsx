"use client";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
export function EmergencyAccessBoundary({
  ownerId,
  children,
}: {
  ownerId: string;
  children: ReactNode;
}) {
  const { data: session, status } = useSession();
  if (
    status !== "authenticated" ||
    session?.user?.id !== ownerId ||
    !["dispatcher", "platform_admin"].includes(session.user?.role ?? "")
  )
    return (
      <p role="status" className="p-6">
        Dispatcher session changed. Reopen the emergency workspace after signing
        in.
      </p>
    );
  return <>{children}</>;
}

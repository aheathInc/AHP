import {
  prisma,
  type Prisma,
  type CommunityNotificationMode,
} from "@a-health/database";
import {
  appendAudit,
  conflict,
  cursorArgs,
  forbidden,
  notFound,
  toCursorPage,
  unprocessable,
} from "@a-health/http";
export interface Caller {
  sub: string;
  role: string;
  cpid?: string;
}
export interface Meta {
  ip?: string | null;
  requestId?: string | null;
}
type Db = Prisma.TransactionClient;
export async function currentNetworkClinician(caller: Caller, db: Db = prisma) {
  if (caller.role !== "clinician" || !caller.cpid)
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "An active verified clinician account is required.",
    );
  const actor = await db.clinicianProfile.findFirst({
    where: {
      id: caller.cpid,
      userId: caller.sub,
      verificationStatus: "verified",
      user: { status: "active", role: "clinician" },
    },
  });
  if (!actor)
    throw forbidden(
      "CLINICIAN_NOT_VERIFIED",
      "An active verified clinician account is required.",
    );
  return actor;
}
async function requireMember(
  communityId: string,
  caller: Caller,
  db: Db = prisma,
) {
  const actor = await currentNetworkClinician(caller, db);
  const member = await db.communityMembership.findUnique({
    where: { communityId_clinicianId: { communityId, clinicianId: actor.id } },
    include: { community: true },
  });
  if (!member || !member.community.isActive)
    throw forbidden(
      "GROUP_MEMBERSHIP_REQUIRED",
      "Join this active professional group to read or contribute.",
    );
  return member;
}
const authorInclude = {
  author: { select: { user: { select: { fullName: true } } } },
} as const;
function serialiseDiscussion(d: {
  id: string;
  communityId: string;
  title: string;
  body: string;
  authorClinicianId: string;
  isCaseDiscussion: boolean;
  replyCount: number;
  createdAt: Date;
  version: number;
  hiddenAt?: Date | null;
  author?: { user: { fullName: string | null } };
}) {
  return {
    id: d.id,
    community_id: d.communityId,
    title: d.hiddenAt ? "Discussion unavailable" : d.title,
    body: d.hiddenAt
      ? "This discussion was withdrawn or hidden after moderation."
      : d.body,
    moderation_status: d.hiddenAt ? "hidden" : "visible",
    author_clinician_id: d.authorClinicianId,
    author_name: d.author?.user.fullName ?? "Clinician",
    is_case_discussion: d.isCaseDiscussion,
    care_thread_id: null,
    reply_count: d.replyCount,
    created_at: d.createdAt.toISOString(),
    version: d.version,
  };
}
function serialiseReply(r: {
  id: string;
  discussionId: string;
  body: string;
  authorClinicianId: string;
  createdAt: Date;
  parentReplyId: string | null;
  hiddenAt?: Date | null;
  version?: number;
  author?: { user: { fullName: string | null } };
}) {
  return {
    id: r.id,
    discussion_id: r.discussionId,
    parent_reply_id: r.parentReplyId,
    body: r.hiddenAt
      ? "This reply was withdrawn or hidden after moderation."
      : r.body,
    moderation_status: r.hiddenAt ? "hidden" : "visible",
    version: r.version ?? 1,
    author_clinician_id: r.authorClinicianId,
    author_name: r.author?.user.fullName ?? "Clinician",
    created_at: r.createdAt.toISOString(),
  };
}
export async function listCommunities(caller: Caller) {
  const actor = await currentNetworkClinician(caller);
  const rows = await prisma.community.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { memberships: true } },
      memberships: { where: { clinicianId: actor.id } },
    },
    orderBy: { name: "asc" },
  });
  return {
    data: rows.map((c) => ({
      id: c.id,
      name: c.name,
      specialty: c.specialty,
      description: c.description,
      member_count: c._count.memberships,
      is_member: !!c.memberships.length,
      notification_mode: c.memberships[0]?.notificationMode ?? null,
    })),
  };
}
export async function joinCommunity(
  id: string,
  caller: Caller,
  notificationMode: CommunityNotificationMode = "replies",
  meta: Meta = {},
) {
  return prisma.$transaction(async (tx) => {
    const actor = await currentNetworkClinician(caller, tx);
    const group = await tx.community.findUnique({ where: { id } });
    if (!group?.isActive) throw notFound("Active group not found");
    const row = await tx.communityMembership.upsert({
      where: {
        communityId_clinicianId: { communityId: id, clinicianId: actor.id },
      },
      create: { communityId: id, clinicianId: actor.id, notificationMode },
      update: { notificationMode },
    });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.membership_saved",
        entityType: "communities",
        entityId: id,
        metadata: { notificationMode },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return {
      community_id: id,
      is_member: true,
      notification_mode: row.notificationMode,
    };
  });
}
export async function leaveCommunity(
  id: string,
  caller: Caller,
  meta: Meta = {},
) {
  return prisma.$transaction(async (tx) => {
    const actor = await currentNetworkClinician(caller, tx);
    await tx.communityMembership.deleteMany({
      where: { communityId: id, clinicianId: actor.id },
    });
    await tx.professionalNotification.deleteMany({
      where: {
        recipientClinicianId: actor.id,
        discussion: { communityId: id },
      },
    });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.membership_ended",
        entityType: "communities",
        entityId: id,
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return { community_id: id, is_member: false };
  });
}
export async function listDiscussions(
  caller: Caller,
  query: {
    community_id?: string;
    cursor?: string;
    limit: number;
    q?: string;
    view?: string;
  },
) {
  const actor = await currentNetworkClinician(caller);
  if (query.community_id) await requireMember(query.community_id, caller);
  const rows = await prisma.discussion.findMany({
    where: {
      hiddenAt: null,
      ...(query.view === "mine"
        ? { authorClinicianId: actor.id }
        : query.view === "unanswered"
          ? { replyCount: 0 }
          : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { body: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(query.community_id ? { communityId: query.community_id } : {}),
      community: {
        isActive: true,
        memberships: { some: { clinicianId: actor.id } },
      },
    },
    include: authorInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(query.cursor, query.limit),
  });
  const page = toCursorPage(rows, query.limit, serialiseDiscussion);
  return {
    ...page,
    data: page.data as ReturnType<typeof serialiseDiscussion>[],
  };
}
export async function listReplies(
  discussionId: string,
  caller: Caller,
  query: { cursor?: string; limit: number },
) {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
  });
  if (!discussion) throw notFound("Discussion not found");
  await requireMember(discussion.communityId, caller);
  if (discussion.hiddenAt)
    throw conflict(
      "STATE_TRANSITION_INVALID",
      "This discussion is no longer available",
    );
  const rows = await prisma.discussionReply.findMany({
    where: { discussionId },
    include: authorInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...cursorArgs(query.cursor, query.limit),
  });
  const page = toCursorPage(rows, query.limit, serialiseReply);
  return { ...page, data: page.data as ReturnType<typeof serialiseReply>[] };
}
export async function getDiscussion(discussionId: string, caller: Caller) {
  const d = await prisma.discussion.findUnique({
    where: { id: discussionId },
    include: { ...authorInclude, community: { select: { name: true } } },
  });
  if (!d) throw notFound("Discussion not found");
  await requireMember(d.communityId, caller);
  const replies = d.hiddenAt
    ? { data: [], meta: { next_cursor: null } }
    : await listReplies(discussionId, caller, { limit: 50 });
  return {
    ...serialiseDiscussion(d),
    community_name: d.community.name,
    viewer_clinician_id: caller.cpid,
    replies: replies.data,
    replies_meta: replies.meta,
  };
}
async function notify(
  tx: Db,
  discussion: { id: string; communityId: string; authorClinicianId: string },
  sender: string,
  reply?: { id: string; parentReplyId: string | null },
) {
  const participants = new Set([discussion.authorClinicianId]);
  if (reply) {
    const authors = await tx.discussionReply.findMany({
      where: { discussionId: discussion.id },
      select: { authorClinicianId: true },
      distinct: ["authorClinicianId"],
    });
    authors.forEach((a) => participants.add(a.authorClinicianId));
  }
  const members = await tx.communityMembership.findMany({
    where: {
      communityId: discussion.communityId,
      clinicianId: { not: sender },
      notificationMode: { not: "muted" },
      clinician: {
        verificationStatus: "verified",
        user: { status: "active", role: "clinician" },
      },
    },
  });
  const recipients = members.filter(
    (m) =>
      m.notificationMode === "all" ||
      (!!reply && participants.has(m.clinicianId)),
  );
  if (recipients.length)
    await tx.professionalNotification.createMany({
      data: recipients.map((m) => ({
        recipientClinicianId: m.clinicianId,
        discussionId: discussion.id,
        replyId: reply?.id ?? null,
        kind: reply ? "reply" : "new_post",
        dedupeKey: `${reply?.id ?? discussion.id}:${m.clinicianId}`,
      })),
      skipDuplicates: true,
    });
}
export async function createDiscussion(
  caller: Caller,
  input: {
    community_id: string;
    title: string;
    body: string;
    client_request_id?: string;
    is_case_discussion?: boolean;
    care_thread_id?: string;
  },
  meta: Meta,
) {
  return prisma.$transaction(async (tx) => {
    const member = await requireMember(input.community_id, caller, tx);
    if (input.client_request_id) {
      const key = `post:${member.clinicianId}:${input.client_request_id}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text AS locked`;
      const existing = await tx.discussion.findFirst({
        where: {
          authorClinicianId: member.clinicianId,
          clientRequestId: input.client_request_id,
        },
        include: authorInclude,
      });
      if (existing) {
        if (
          existing.communityId !== input.community_id ||
          existing.title !== input.title.trim() ||
          existing.body !== input.body.trim() ||
          existing.isCaseDiscussion !== !!input.is_case_discussion ||
          existing.careThreadId !==
            (input.is_case_discussion ? (input.care_thread_id ?? null) : null)
        )
          throw conflict(
            "IDEMPOTENCY_KEY_CONFLICT",
            "This discussion reference is already used for different content",
          );
        return serialiseDiscussion(existing);
      }
    }
    if (input.is_case_discussion) {
      if (!input.care_thread_id)
        throw unprocessable(
          "care_thread_id is required for a case discussion",
          "care_thread_id",
        );
      const thread = await tx.careThread.findFirst({
        where: {
          id: input.care_thread_id,
          OR: [
            { primaryClinicianId: caller.cpid },
            { consultations: { some: { assignedClinicianId: caller.cpid } } },
          ],
        },
      });
      if (!thread)
        throw forbidden(
          "NOT_RESOURCE_OWNER",
          "You may discuss only an assigned care thread, without patient identifiers.",
        );
    }
    const d = await tx.discussion.create({
      data: {
        clientRequestId: input.client_request_id,
        communityId: member.communityId,
        authorClinicianId: member.clinicianId,
        title: input.title.trim(),
        body: input.body.trim(),
        isCaseDiscussion: !!input.is_case_discussion,
        careThreadId: input.is_case_discussion ? input.care_thread_id : null,
      },
      include: authorInclude,
    });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.discussion_created",
        entityType: "discussions",
        entityId: d.id,
        metadata: { communityId: d.communityId },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    await notify(tx, d, member.clinicianId);
    return serialiseDiscussion(d);
  });
}
export async function replyToDiscussion(
  discussionId: string,
  caller: Caller,
  body: string,
  meta: Meta,
  parentReplyId?: string,
  clientReplyId?: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM discussions WHERE id=${discussionId}::uuid FOR UPDATE`;
    const d = await tx.discussion.findUnique({ where: { id: discussionId } });
    if (!d) throw notFound("Discussion not found");
    const member = await requireMember(d.communityId, caller, tx);
    if (d.hiddenAt)
      throw conflict(
        "STATE_TRANSITION_INVALID",
        "This discussion is no longer available",
      );
    if (clientReplyId) {
      const previous = await tx.discussionReply.findFirst({
        where: {
          discussionId,
          authorClinicianId: member.clinicianId,
          clientReplyId,
        },
        include: authorInclude,
      });
      if (previous) {
        if (previous.hiddenAt)
          throw conflict(
            "STATE_TRANSITION_INVALID",
            "This reply is no longer available",
          );
        if (
          previous.body !== body.trim() ||
          previous.parentReplyId !== (parentReplyId ?? null)
        )
          throw conflict(
            "IDEMPOTENCY_KEY_CONFLICT",
            "This reply reference is already used",
          );
        return serialiseReply(previous);
      }
    }
    let parent = parentReplyId,
      depth = 0;
    while (parent) {
      if (++depth > 8)
        throw unprocessable(
          "This thread has reached eight reply levels. Reply to an earlier message.",
        );
      const row = await tx.discussionReply.findUnique({
        where: { id: parent },
      });
      if (!row || row.discussionId !== discussionId)
        throw unprocessable(
          "The parent reply must belong to this discussion.",
          "parent_reply_id",
        );
      parent = row.parentReplyId ?? undefined;
    }
    const reply = await tx.discussionReply.create({
      data: {
        clientReplyId,
        discussionId,
        authorClinicianId: member.clinicianId,
        body: body.trim(),
        parentReplyId: parentReplyId ?? null,
      },
      include: authorInclude,
    });
    await tx.discussion.update({
      where: { id: discussionId },
      data: { replyCount: { increment: 1 }, version: { increment: 1 } },
    });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.reply_posted",
        entityType: "discussion_replies",
        entityId: reply.id,
        metadata: { discussionId, parentReplyId: parentReplyId ?? null },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    await notify(tx, d, member.clinicianId, reply);
    return serialiseReply(reply);
  });
}
export async function listNotifications(
  caller: Caller,
  query: { cursor?: string; limit: number } = { limit: 50 },
) {
  const actor = await currentNetworkClinician(caller);
  const where = {
    recipientClinicianId: actor.id,
    discussion: {
      hiddenAt: null,
      community: {
        isActive: true,
        memberships: { some: { clinicianId: actor.id } },
      },
    },
  };
  const [rows, unread] = await Promise.all([
    prisma.professionalNotification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorArgs(query.cursor, query.limit),
      include: {
        discussion: {
          select: {
            id: true,
            title: true,
            community: { select: { name: true } },
          },
        },
      },
    }),
    prisma.professionalNotification.count({
      where: { ...where, readAt: null },
    }),
  ]);
  const page = toCursorPage(rows, query.limit, (n) => ({
    id: n.id,
    kind: n.kind,
    discussion_id: n.discussionId,
    title: n.discussion.title,
    group_name: n.discussion.community.name,
    read_at: n.readAt?.toISOString() ?? null,
    created_at: n.createdAt.toISOString(),
    href: `/doctor/network/${n.discussionId}#replies`,
  }));
  return {
    ...page,
    unread_count: unread,
    data: page.data as {
      id: string;
      kind: string;
      discussion_id: string;
      title: string;
      group_name: string;
      read_at: string | null;
      created_at: string;
      href: string;
    }[],
  };
}
export async function markNotificationRead(id: string, caller: Caller) {
  const actor = await currentNetworkClinician(caller);
  const changed = await prisma.professionalNotification.updateMany({
    where: {
      id,
      recipientClinicianId: actor.id,
      discussion: {
        hiddenAt: null,
        community: {
          isActive: true,
          memberships: { some: { clinicianId: actor.id } },
        },
      },
    },
    data: { readAt: new Date() },
  });
  if (!changed.count) throw notFound("Notification not found");
  return { read: true };
}

export async function reportContent(
  discussionId: string,
  caller: Caller,
  input: { category: string; reply_id?: string },
  meta: Meta,
) {
  return prisma.$transaction(async (tx) => {
    const post = await tx.discussion.findUnique({
      where: { id: discussionId },
    });
    if (!post) throw notFound("Discussion not found");
    const member = await requireMember(post.communityId, caller, tx);
    if (
      input.reply_id &&
      !(await tx.discussionReply.count({
        where: { id: input.reply_id, discussionId },
      }))
    )
      throw unprocessable("Reply does not belong to this discussion");
    const target = input.reply_id ?? "post",
      key = `report:${discussionId}:${member.clinicianId}:${target}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text AS locked`;
    const existing = await tx.professionalContentReport.findFirst({
      where: {
        discussionId,
        reporterClinicianId: member.clinicianId,
        targetKey: target,
      },
    });
    if (existing) return { id: existing.id, status: existing.status };
    const report = await tx.professionalContentReport.create({
      data: {
        discussionId,
        replyId: input.reply_id,
        targetKey: target,
        reporterClinicianId: member.clinicianId,
        category: input.category,
      },
    });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.content_reported",
        entityType: "professional_content_reports",
        entityId: report.id,
        metadata: { discussionId, category: input.category },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return { id: report.id, status: report.status };
  });
}
export async function withdrawContent(
  discussionId: string,
  caller: Caller,
  input: { base_version: number; reply_id?: string },
  meta: Meta,
) {
  return prisma.$transaction(async (tx) => {
    const actor = await currentNetworkClinician(caller, tx);
    await tx.$queryRaw`SELECT id FROM discussions WHERE id=${discussionId}::uuid FOR UPDATE`;
    const post = await tx.discussion.findUnique({
      where: { id: discussionId },
    });
    if (!post) throw notFound("Discussion not found");
    const target = input.reply_id
      ? await tx.discussionReply.findFirst({
          where: { id: input.reply_id, discussionId },
        })
      : post;
    if (!target || target.authorClinicianId !== actor.id)
      throw forbidden(
        "NOT_RESOURCE_OWNER",
        "Only the author may withdraw this contribution",
      );
    if (target.version !== input.base_version)
      throw conflict(
        "VERSION_CONFLICT",
        "Contribution changed. Refresh before withdrawing",
      );
    if (target.hiddenAt)
      return { id: target.id, hidden: true, version: target.version };
    const data = {
      hiddenAt: new Date(),
      moderatedByUserId: caller.sub,
      version: { increment: 1 },
    };
    const updated = input.reply_id
      ? await tx.discussionReply.update({ where: { id: target.id }, data })
      : await tx.discussion.update({ where: { id: discussionId }, data });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.contribution_withdrawn",
        entityType: input.reply_id ? "discussion_replies" : "discussions",
        entityId: target.id,
        metadata: { discussionId },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return { id: updated.id, hidden: true, version: updated.version };
  });
}
async function moderator(caller: Caller, db: Db) {
  if (
    caller.role !== "platform_admin" ||
    !(await db.user.count({
      where: { id: caller.sub, role: "platform_admin", status: "active" },
    }))
  )
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "An active platform administrator is required for moderation",
    );
}
export async function listContentReports(
  caller: Caller,
  query: { status: string; cursor?: string; limit: number },
  meta: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await moderator(caller, tx);
    const rows = await tx.professionalContentReport.findMany({
      where:
        query.status === "open"
          ? { status: "open" }
          : query.status === "reviewed"
            ? { status: { not: "open" } }
            : {},
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...cursorArgs(query.cursor, query.limit),
      include: {
        discussion: {
          include: { community: { select: { name: true } }, ...authorInclude },
        },
      },
    });
    const data = [];
    for (const row of rows) {
      const reply = row.replyId
        ? await tx.discussionReply.findFirst({
            where: { id: row.replyId, discussionId: row.discussionId },
            include: authorInclude,
          })
        : null;
      data.push({
        id: row.id,
        discussionId: row.discussionId,
        replyId: row.replyId,
        category: row.category,
        status: row.status,
        version: row.version,
        created_at: row.createdAt.toISOString(),
        reviewed_at: row.reviewedAt?.toISOString() ?? null,
        group_name: row.discussion.community.name,
        title: row.discussion.title,
        body: row.replyId
          ? (reply?.body ?? "Reply unavailable")
          : row.discussion.body,
        hidden: !!(row.replyId ? reply?.hiddenAt : row.discussion.hiddenAt),
        reporter_clinician_id: row.reporterClinicianId,
      });
    }
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.moderation_queue_viewed",
        entityType: "professional_content_reports",
        metadata: { count: Math.min(rows.length, query.limit) },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    const page=toCursorPage(data, query.limit);return {...page,data:page.data as typeof data};
  });
}
export async function reviewContentReport(
  id: string,
  caller: Caller,
  input: { base_version: number; action: "hide" | "dismiss" },
  meta: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await moderator(caller, tx);
    await tx.$queryRaw`SELECT id FROM professional_content_reports WHERE id=${id}::uuid FOR UPDATE`;
    const report = await tx.professionalContentReport.findUnique({
      where: { id },
    });
    if (!report) throw notFound("Report not found");
    if (report.version !== input.base_version || report.status !== "open")
      throw conflict(
        "VERSION_CONFLICT",
        "Report already reviewed or changed. Refresh the queue",
      );
    await tx.$queryRaw`SELECT id FROM discussions WHERE id=${report.discussionId}::uuid FOR UPDATE`;
    if (input.action === "hide") {
      const data = {
        hiddenAt: new Date(),
        moderatedByUserId: caller.sub,
        version: { increment: 1 },
      };
      if (report.replyId)
        await tx.discussionReply.update({
          where: { id: report.replyId },
          data,
        });
      else
        await tx.discussion.update({
          where: { id: report.discussionId },
          data,
        });
    }
    const updated = await tx.professionalContentReport.update({
      where: { id },
      data: {
        status: input.action === "hide" ? "hidden" : "dismissed",
        reviewerUserId: caller.sub,
        reviewedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "network.content_report_reviewed",
        entityType: "professional_content_reports",
        entityId: id,
        metadata: {
          decision: updated.status,
          discussionId: report.discussionId,
        },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return { id, status: updated.status, version: updated.version };
  });
}

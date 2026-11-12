import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "@a-health/database";
import {
  assertIsolatedLocalTestTarget,
  verifyLocalTestIdentity,
} from "@a-health/database/test-safety";
import type { AppError } from "@a-health/http";
import * as discussions from "../services/discussion.service.js";
import * as opinions from "../services/secondOpinion.service.js";
import { createDiscussionSchema, replySchema } from "../types/network.types.js";

const testTarget = assertIsolatedLocalTestTarget(process.env);

before(async () => {
  await verifyLocalTestIdentity(prisma, testTarget);
});

const meta = { ip: "127.0.0.1", requestId: "test" };
const users: string[] = [];
const clinicians: string[] = [];
const communityIds: string[] = [];
const threadIds: string[] = [];
const discussionIds: string[] = [];
const opinionIds: string[] = [];

after(async () => {
  for (const id of opinionIds) {
    await prisma.secondOpinion.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of discussionIds) {
    await prisma.discussionReply
      .deleteMany({ where: { discussionId: id } })
      .catch(() => undefined);
    await prisma.discussion.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of communityIds) {
    await prisma.community.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile
      .delete({ where: { id } })
      .catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile
      .deleteMany({ where: { userId: id } })
      .catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makeClinician() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: `${randomUUID()}@test.local`,
      role: "clinician",
      status: "active",
      fullName: "Network Clinician",
    },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: {
      userId: user.id,
      licenseNumber: `TEST-${randomUUID().slice(0, 12)}`,
      specialty: "general_practice",
      verificationStatus: "verified",
    },
  });
  clinicians.push(profile.id);
  return { sub: user.id, role: "clinician", cpid: profile.id };
}

async function makeCommunity() {
  const community = await prisma.community.create({
    data: {
      name: `Test Community ${randomUUID().slice(0, 8)}`,
      specialty: "general_practice",
    },
  });
  communityIds.push(community.id);
  return community;
}

async function makeThread() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: "patient",
      status: "active",
      fullName: "Thread Patient",
    },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({
    data: { userId: user.id, fullName: "Thread Patient" },
  });
  const thread = await prisma.careThread.create({
    data: { patientProfileId: profile.id },
  });
  threadIds.push(thread.id);
  return thread;
}

describe("discussions", () => {
  it("creates and reads a discussion with its replies", async () => {
    const clinician = await makeClinician();
    const community = await makeCommunity();
    await discussions.joinCommunity(community.id, clinician);

    const discussion = await discussions.createDiscussion(
      clinician,
      {
        community_id: community.id,
        title: "Test",
        body: "A question about dosing.",
      },
      meta,
    );
    discussionIds.push(discussion.id);

    await discussions.replyToDiscussion(
      discussion.id,
      clinician,
      "Try this approach.",
      meta,
    );

    const fetched = await discussions.getDiscussion(discussion.id, clinician);
    assert.equal(fetched.reply_count, 1);
    assert.equal(fetched.replies.length, 1);
  });

  it("requires a care_thread_id for a case discussion", async () => {
    const clinician = await makeClinician();
    const community = await makeCommunity();
    await discussions.joinCommunity(community.id, clinician);

    await assert.rejects(() =>
      discussions.createDiscussion(
        clinician,
        {
          community_id: community.id,
          title: "Case",
          body: "x",
          is_case_discussion: true,
        },
        meta,
      ),
    );
  });

  it("never exposes patient identity through a case discussion", async () => {
    const clinician = await makeClinician();
    const community = await makeCommunity();
    await discussions.joinCommunity(community.id, clinician);
    const thread = await makeThread();
    await prisma.careThread.update({
      where: { id: thread.id },
      data: { primaryClinicianId: clinician.cpid },
    });

    const discussion = await discussions.createDiscussion(
      clinician,
      {
        community_id: community.id,
        title: "Case",
        body: "De-identified question.",
        is_case_discussion: true,
        care_thread_id: thread.id,
      },
      meta,
    );
    discussionIds.push(discussion.id);

    assert.ok(!("patient" in discussion));
    assert.ok(!("patient_name" in discussion));
  });

  it("refuses a non-clinician creating a discussion", async () => {
    const community = await makeCommunity();
    await assert.rejects(
      () =>
        discussions.createDiscussion(
          { sub: randomUUID(), role: "patient" },
          { community_id: community.id, title: "x", body: "y" },
          meta,
        ),
      (e: AppError) => e.code === "ROLE_NOT_PERMITTED",
    );
  });
});

describe("second opinions", () => {
  it("requests, claims, and answers a second opinion", async () => {
    const requester = await makeClinician();
    const specialist = await makeClinician();
    const thread = await makeThread();

    const opinion = await opinions.requestSecondOpinion(
      requester,
      {
        care_thread_id: thread.id,
        specialty: "dermatology",
        question: "Is this concerning?",
      },
      meta,
    );
    opinionIds.push(opinion.id);
    assert.equal(opinion.status, "open");

    const claimed = await opinions.claimSecondOpinion(
      opinion.id,
      specialist,
      meta,
    );
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.answered_by_id, specialist.cpid);

    const answered = await opinions.answerSecondOpinion(
      opinion.id,
      specialist,
      "Benign, monitor.",
      meta,
    );
    assert.equal(answered.status, "answered");
    assert.ok(answered.answered_at);
  });

  it("refuses a second claim on an already-claimed opinion", async () => {
    const requester = await makeClinician();
    const first = await makeClinician();
    const second = await makeClinician();
    const thread = await makeThread();

    const opinion = await opinions.requestSecondOpinion(
      requester,
      {
        care_thread_id: thread.id,
        specialty: "internal_medicine",
        question: "q",
      },
      meta,
    );
    opinionIds.push(opinion.id);
    await opinions.claimSecondOpinion(opinion.id, first, meta);

    await assert.rejects(
      () => opinions.claimSecondOpinion(opinion.id, second, meta),
      (e: AppError) => e.code === "STATE_TRANSITION_INVALID",
    );
  });

  it("refuses an answer from someone other than the claimant", async () => {
    const requester = await makeClinician();
    const claimant = await makeClinician();
    const stranger = await makeClinician();
    const thread = await makeThread();

    const opinion = await opinions.requestSecondOpinion(
      requester,
      { care_thread_id: thread.id, specialty: "psychiatry", question: "q" },
      meta,
    );
    opinionIds.push(opinion.id);
    await opinions.claimSecondOpinion(opinion.id, claimant, meta);

    await assert.rejects(
      () => opinions.answerSecondOpinion(opinion.id, stranger, "answer", meta),
      (e: AppError) => e.code === "NOT_RESOURCE_OWNER",
    );
  });

  it("refuses answering an opinion that is still open", async () => {
    const requester = await makeClinician();
    const thread = await makeThread();
    const opinion = await opinions.requestSecondOpinion(
      requester,
      { care_thread_id: thread.id, specialty: "oncology", question: "q" },
      meta,
    );
    opinionIds.push(opinion.id);

    await assert.rejects(
      () => opinions.answerSecondOpinion(opinion.id, requester, "answer", meta),
      (e: AppError) => e.code === "STATE_TRANSITION_INVALID",
    );
  });
});

it("threads replies within one group discussion and notifies only eligible recipients", async () => {
  const author = await makeClinician(),
    responder = await makeClinician(),
    observer = await makeClinician(),
    muted = await makeClinician(),
    outsider = await makeClinician();
  const group = await makeCommunity();
  for (const c of [author, responder])
    await discussions.joinCommunity(group.id, c);
  await discussions.joinCommunity(group.id, observer, "all");
  await discussions.joinCommunity(group.id, muted, "muted");
  const d = await discussions.createDiscussion(
    author,
    {
      community_id: group.id,
      title: "Clinical discussion",
      body: "Synthetic question",
    },
    meta,
  );
  discussionIds.push(d.id);
  assert.equal((await discussions.listNotifications(observer)).unread_count, 1);
  assert.equal(
    (await discussions.listNotifications(responder)).unread_count,
    0,
  );
  await assert.rejects(() => discussions.getDiscussion(d.id, outsider));
  await assert.rejects(() =>
    discussions.replyToDiscussion(d.id, outsider, "Denied", meta),
  );
  const first = await discussions.replyToDiscussion(
    d.id,
    responder,
    "First response",
    meta,
  );
  const nested = await discussions.replyToDiscussion(
    d.id,
    author,
    "Response to first",
    meta,
    first.id,
  );
  const root = await discussions.replyToDiscussion(
    d.id,
    observer,
    "Separate group-wide response",
    meta,
  );
  const fetched = await discussions.getDiscussion(d.id, author);
  assert.equal(
    fetched.replies.find((r) => r.id === nested.id)?.parent_reply_id,
    first.id,
  );
  assert.equal(
    fetched.replies.find((r) => r.id === root.id)?.parent_reply_id,
    null,
  );
  assert.equal((await discussions.listNotifications(muted)).unread_count, 0);
  assert.equal((await discussions.listNotifications(outsider)).unread_count, 0);
  const notices = await discussions.listNotifications(author);
  assert.equal(notices.unread_count, 2);
  await assert.rejects(() =>
    discussions.markNotificationRead(notices.data[0]!.id, responder),
  );
  await discussions.markNotificationRead(notices.data[0]!.id, author);
  assert.equal((await discussions.listNotifications(author)).unread_count, 1);
  const other = await discussions.createDiscussion(
    author,
    { community_id: group.id, title: "Separate discussion", body: "Separate" },
    meta,
  );
  discussionIds.push(other.id);
  await assert.rejects(() =>
    discussions.replyToDiscussion(
      other.id,
      author,
      "Wrong thread",
      meta,
      first.id,
    ),
  );
  await assert.rejects(() =>
    prisma.discussionReply.create({
      data: {
        discussionId: other.id,
        authorClinicianId: author.cpid,
        body: "Direct wrong parent",
        parentReplyId: first.id,
      },
    }),
  );
  const page = await discussions.listReplies(d.id, author, { limit: 1 });
  assert.equal(page.data.length, 1);
  assert.ok(page.meta.next_cursor);
  const next = await discussions.listReplies(d.id, author, {
    limit: 1,
    cursor: page.meta.next_cursor!,
  });
  assert.notEqual(next.data[0]?.id, page.data[0]?.id);
  await discussions.leaveCommunity(group.id, responder);
  await assert.rejects(() => discussions.getDiscussion(d.id, responder));
  assert.equal(
    (await discussions.listNotifications(responder)).unread_count,
    0,
  );
  await prisma.user.update({
    where: { id: author.sub },
    data: { status: "suspended" },
  });
  await assert.rejects(() => discussions.listCommunities(author));
  await assert.rejects(() => discussions.getDiscussion(d.id, author));
});

it("uses durable post and reply keys without duplicating counts, audits or notifications", async () => {
  const author = await makeClinician(),
    responder = await makeClinician(),
    group = await makeCommunity();
  await discussions.joinCommunity(group.id, author);
  await discussions.joinCommunity(group.id, responder, "all");
  const key = randomUUID(),
    input = {
      community_id: group.id,
      title: "Synthetic durable subject",
      body: "Synthetic evidence question without patient data",
      client_request_id: key,
    };
  const posted = await Promise.all(
    [1, 2, 3].map(() => discussions.createDiscussion(author, input, meta)),
  );
  const post = posted[0];
  discussionIds.push(post.id);
  assert.equal(new Set(posted.map((row) => row.id)).size, 1);
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: post.id, action: "network.discussion_created" },
    }),
    1,
  );
  await assert.rejects(
    () =>
      discussions.createDiscussion(
        author,
        { ...input, body: "Different synthetic content" },
        meta,
      ),
    { code: "IDEMPOTENCY_KEY_CONFLICT" },
  );
  const replyKey = randomUUID(),
    responses = await Promise.all(
      [1, 2, 3].map(() =>
        discussions.replyToDiscussion(
          post.id,
          responder,
          "Synthetic referenced contribution",
          meta,
          undefined,
          replyKey,
        ),
      ),
    );
  assert.equal(new Set(responses.map((row) => row.id)).size, 1);
  assert.equal(
    (await discussions.getDiscussion(post.id, author)).reply_count,
    1,
  );
  await assert.rejects(
    () =>
      discussions.replyToDiscussion(
        post.id,
        responder,
        "Different response",
        meta,
        undefined,
        replyKey,
      ),
    { code: "IDEMPOTENCY_KEY_CONFLICT" },
  );
  assert.equal(
    (
      await discussions.listDiscussions(author, {
        limit: 1,
        q: "durable",
        view: "mine",
      })
    ).data[0].id,
    post.id,
  );
  assert.equal(
    (
      await discussions.listDiscussions(author, {
        limit: 1,
        q: "durable",
        view: "unanswered",
      })
    ).data.length,
    0,
  );
  await discussions.leaveCommunity(group.id, responder);
  await assert.rejects(() =>
    discussions.replyToDiscussion(
      post.id,
      responder,
      "Synthetic referenced contribution",
      meta,
      undefined,
      replyKey,
    ),
  );
});
async function moderatorActor() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10000000, 99999999)}`,
      role: "platform_admin",
      status: "active",
      fullName: "Synthetic network moderator",
    },
  });
  users.push(user.id);
  return { sub: user.id, role: "platform_admin" };
}
it("reports content once, restricts moderation and removes hidden text from every group surface", async () => {
  const author = await makeClinician(),
    reporter = await makeClinician(),
    outsider = await makeClinician(),
    admin = await moderatorActor(),
    group = await makeCommunity();
  for (const who of [author, reporter])
    await discussions.joinCommunity(group.id, who, "all");
  const key = randomUUID(),
    input = {
      community_id: group.id,
      title: "SYNTHETIC GOVERNANCE CANARY",
      body: "Synthetic reportable text; no real patient data",
      client_request_id: key,
    },
    post = await discussions.createDiscussion(author, input, meta);
  discussionIds.push(post.id);
  await assert.rejects(() =>
    discussions.reportContent(post.id, outsider, { category: "privacy" }, meta),
  );
  const reports = await Promise.all(
    [1, 2].map(() =>
      discussions.reportContent(
        post.id,
        reporter,
        { category: "privacy" },
        meta,
      ),
    ),
  );
  assert.equal(reports[0].id, reports[1].id);
  await assert.rejects(
    () =>
      discussions.listContentReports(
        reporter,
        { status: "open", limit: 25 },
        meta,
      ),
    { code: "ROLE_NOT_PERMITTED" },
  );
  const queue = await discussions.listContentReports(
    admin,
    { status: "open", limit: 25 },
    meta,
  );
  const report = queue.data.find(
    (row: { id: string }) => row.id === reports[0].id,
  )!;
  assert.ok(report);
  await discussions.reviewContentReport(
    report.id,
    admin,
    { base_version: 1, action: "hide" },
    meta,
  );
  await assert.rejects(
    () =>
      discussions.reviewContentReport(
        report.id,
        admin,
        { base_version: 1, action: "dismiss" },
        meta,
      ),
    { code: "VERSION_CONFLICT" },
  );
  const hidden = await discussions.getDiscussion(post.id, reporter);
  assert.equal(hidden.moderation_status, "hidden");
  assert.equal(JSON.stringify(hidden).includes(input.body), false);
  assert.equal(JSON.stringify(hidden).includes(input.title), false);
  assert.equal(
    (await discussions.listDiscussions(reporter, { limit: 25, q: "CANARY" }))
      .data.length,
    0,
  );
  assert.equal(
    (await discussions.listNotifications(reporter)).data.some(
      (row) => row.discussion_id === post.id,
    ),
    false,
  );
  const replay = await discussions.createDiscussion(author, input, meta);
  assert.equal(replay.moderation_status, "hidden");
  assert.equal(replay.body.includes(input.body), false);
  await assert.rejects(() =>
    discussions.listReplies(post.id, reporter, { limit: 25 }),
  );
  await assert.rejects(() =>
    discussions.replyToDiscussion(post.id, reporter, "New contribution", meta),
  );
  assert.equal(
    (await prisma.discussion.findUniqueOrThrow({ where: { id: post.id } }))
      .body,
    input.body,
  );
});
it("hides a reported reply, preserves thread history and permits an author privacy withdrawal after leaving", async () => {
  const author = await makeClinician(),
    reporter = await makeClinician(),
    admin = await moderatorActor(),
    group = await makeCommunity();
  for (const who of [author, reporter])
    await discussions.joinCommunity(group.id, who);
  const post = await discussions.createDiscussion(
    author,
    {
      community_id: group.id,
      title: "Synthetic reply moderation",
      body: "Safe original group question",
    },
    meta,
  );
  discussionIds.push(post.id);
  const key = randomUUID(),
    reply = await discussions.replyToDiscussion(
      post.id,
      author,
      "Synthetic reply to be hidden",
      meta,
      undefined,
      key,
    );
  const report = await discussions.reportContent(
    post.id,
    reporter,
    { category: "conduct", reply_id: reply.id },
    meta,
  );
  await discussions.reviewContentReport(
    report.id,
    admin,
    { base_version: 1, action: "hide" },
    meta,
  );
  const thread = await discussions.getDiscussion(post.id, reporter);
  assert.equal(thread.replies[0].moderation_status, "hidden");
  assert.equal(
    JSON.stringify(thread).includes("Synthetic reply to be hidden"),
    false,
  );
  await assert.rejects(() =>
    discussions.replyToDiscussion(
      post.id,
      author,
      "Synthetic reply to be hidden",
      meta,
      undefined,
      key,
    ),
  );
  await assert.rejects(
    () =>
      discussions.withdrawContent(
        post.id,
        reporter,
        { base_version: thread.version },
        meta,
      ),
    { code: "NOT_RESOURCE_OWNER" },
  );
  await discussions.leaveCommunity(group.id, author);
  await discussions.withdrawContent(
    post.id,
    author,
    { base_version: thread.version },
    meta,
  );
  assert.equal(
    (await discussions.getDiscussion(post.id, reporter)).moderation_status,
    "hidden",
  );
});
it("rolls back a moderation decision if its required audit cannot be written", async () => {
  const author = await makeClinician(),
    admin = await moderatorActor(),
    group = await makeCommunity();
  await discussions.joinCommunity(group.id, author);
  const post = await discussions.createDiscussion(
    author,
    {
      community_id: group.id,
      title: "Synthetic atomic moderation",
      body: "Retained original synthetic text",
    },
    meta,
  );
  discussionIds.push(post.id);
  const report = await discussions.reportContent(
    post.id,
    author,
    { category: "misinformation" },
    meta,
  );
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION reject_network_moderation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'network.content_report_reviewed' THEN RAISE EXCEPTION 'synthetic moderation audit failure'; END IF; RETURN NEW; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER reject_network_moderation_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_network_moderation_audit()`,
  );
  try {
    await assert.rejects(() =>
      discussions.reviewContentReport(
        report.id,
        admin,
        { base_version: 1, action: "hide" },
        meta,
      ),
    );
    assert.equal(
      (await prisma.discussion.findUniqueOrThrow({ where: { id: post.id } }))
        .hiddenAt,
      null,
    );
    assert.equal(
      (
        await prisma.professionalContentReport.findUniqueOrThrow({
          where: { id: report.id },
        })
      ).status,
      "open",
    );
  } finally {
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER reject_network_moderation_audit ON audit_logs",
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION reject_network_moderation_audit()",
    );
  }
  await discussions.reviewContentReport(
    report.id,
    admin,
    { base_version: 1, action: "dismiss" },
    meta,
  );
  assert.equal(
    (await discussions.getDiscussion(post.id, author)).moderation_status,
    "visible",
  );
});

it("requires deliberate confidentiality confirmation and durable UUIDs at the group HTTP contract", () => {
  const input = {
    community_id: randomUUID(),
    title: "Synthetic subject",
    body: "Synthetic professional content",
  };
  assert.equal(createDiscussionSchema.safeParse(input).success, false);
  assert.equal(
    createDiscussionSchema.safeParse({
      ...input,
      privacy_confirmed: false,
      client_request_id: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    createDiscussionSchema.safeParse({
      ...input,
      privacy_confirmed: true,
      client_request_id: randomUUID(),
    }).success,
    true,
  );
  assert.equal(
    replySchema.safeParse({ body: "Synthetic reply", privacy_confirmed: true })
      .success,
    false,
  );
  assert.equal(
    replySchema.safeParse({
      body: "Synthetic reply",
      privacy_confirmed: true,
      client_reply_id: randomUUID(),
    }).success,
    true,
  );
});

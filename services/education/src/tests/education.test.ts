import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "@a-health/database";
import {
  assertIsolatedLocalTestTarget,
  verifyLocalTestIdentity,
} from "@a-health/database/test-safety";
import type { AppError } from "@a-health/http";
import * as education from "../services/education.service.js";

const target = assertIsolatedLocalTestTarget();

const meta = { ip: "127.0.0.1", requestId: "test" };
const admin = { sub: randomUUID(), role: "platform_admin" };
const clinician = { sub: randomUUID(), role: "clinician" };
const topicSlugs: string[] = [];
const articleKeys: { slug: string; language: string }[] = [];
before(async () => {
  await verifyLocalTestIdentity(prisma, target);
  for (const actor of [admin, clinician])
    await prisma.user.create({
      data: {
        id: actor.sub,
        role: actor.role as "clinician" | "platform_admin",
        status: "active",
        phoneNumber: `+2557${randomInt(10000000, 99999999)}`,
        fullName: "Synthetic education author",
      },
    });
  await prisma.clinicianProfile.create({
    data: {
      userId: clinician.sub,
      licenseNumber: randomUUID(),
      specialty: "general_practice",
      verificationStatus: "verified",
    },
  });
});

after(async () => {
  for (const { slug, language } of articleKeys) {
    await prisma.educationArticle
      .deleteMany({ where: { slug, language: language as never } })
      .catch(() => undefined);
  }
  for (const slug of topicSlugs) {
    await prisma.educationTopic
      .delete({ where: { slug } })
      .catch(() => undefined);
  }
  await prisma.clinicianProfile.deleteMany({
    where: { userId: clinician.sub },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [admin.sub, clinician.sub] } },
  });
  await prisma.$disconnect();
});

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function makeTopic() {
  const slug = uniqueSlug("topic");
  const topic = await education.createTopic(
    admin,
    { slug, name: "Test Topic", category: "prevention" },
    meta,
  );
  topicSlugs.push(slug);
  return topic;
}

describe("topics", () => {
  it("creates a topic as admin", async () => {
    const topic = await makeTopic();
    assert.equal(topic.category, "prevention");
  });

  it("refuses a non-admin creating a topic", async () => {
    await assert.rejects(
      () =>
        education.createTopic(
          clinician,
          { slug: uniqueSlug("t"), name: "x", category: "nutrition" },
          meta,
        ),
      (e: AppError) => e.code === "ROLE_NOT_PERMITTED",
    );
  });

  it("refuses a duplicate slug", async () => {
    const topic = await makeTopic();
    await assert.rejects(
      () =>
        education.createTopic(
          admin,
          { slug: topic.slug, name: "dup", category: "nutrition" },
          meta,
        ),
      (e: AppError) => e.code === "DUPLICATE_RESOURCE",
    );
  });
});

describe("articles", () => {
  it("drafts are not visible until published", async () => {
    const topic = await makeTopic();
    const slug = uniqueSlug("article");
    await education.createArticle(
      clinician,
      {
        topic_slug: topic.slug,
        slug,
        title: "Draft",
        summary: "s",
        language: "sw",
      },
      meta,
    );
    articleKeys.push({ slug, language: "sw" });

    await assert.rejects(
      () => education.getArticle(slug, "sw"),
      (e: AppError) => e.code === "NOT_FOUND",
    );
  });

  it("becomes visible after publishing, with the reviewer stamped", async () => {
    const topic = await makeTopic();
    const slug = uniqueSlug("article");
    await education.createArticle(
      clinician,
      {
        topic_slug: topic.slug,
        slug,
        title: "Published",
        summary: "s",
        language: "sw",
      },
      meta,
    );
    articleKeys.push({ slug, language: "sw" });

    const published = await education.publishArticle(
      slug,
      "sw",
      clinician,
      meta,
    );
    assert.equal(published.reviewed_by_id, clinician.sub);

    const fetched = await education.getArticle(slug, "sw");
    assert.equal(fetched.slug, slug);
  });

  it("refuses publishing the same article twice", async () => {
    const topic = await makeTopic();
    const slug = uniqueSlug("article");
    await education.createArticle(
      clinician,
      {
        topic_slug: topic.slug,
        slug,
        title: "X",
        summary: "s",
        language: "sw",
      },
      meta,
    );
    articleKeys.push({ slug, language: "sw" });
    await education.publishArticle(slug, "sw", clinician, meta);

    await assert.rejects(
      () => education.publishArticle(slug, "sw", clinician, meta),
      (e: AppError) => e.code === "STATE_TRANSITION_INVALID",
    );
  });

  it("falls back to Swahili when the requested language is missing", async () => {
    const topic = await makeTopic();
    const slug = uniqueSlug("article");
    await education.createArticle(
      clinician,
      {
        topic_slug: topic.slug,
        slug,
        title: "Kiswahili",
        summary: "s",
        language: "sw",
      },
      meta,
    );
    articleKeys.push({ slug, language: "sw" });
    await education.publishArticle(slug, "sw", clinician, meta);

    const fetched = await education.getArticle(slug, "fr");
    assert.equal(fetched.language, "sw");
  });

  it("lists only published articles for a topic", async () => {
    const topic = await makeTopic();
    const publishedSlug = uniqueSlug("pub");
    const draftSlug = uniqueSlug("draft");
    await education.createArticle(
      clinician,
      {
        topic_slug: topic.slug,
        slug: publishedSlug,
        title: "P",
        summary: "s",
        language: "sw",
      },
      meta,
    );
    articleKeys.push({ slug: publishedSlug, language: "sw" });
    await education.publishArticle(publishedSlug, "sw", clinician, meta);
    await education.createArticle(
      clinician,
      {
        topic_slug: topic.slug,
        slug: draftSlug,
        title: "D",
        summary: "s",
        language: "sw",
      },
      meta,
    );
    articleKeys.push({ slug: draftSlug, language: "sw" });

    const result = await education.listArticles({
      topic_slug: topic.slug,
      limit: 25,
    });
    const slugs = (result.data as { slug: string }[]).map((a) => a.slug);
    assert.ok(slugs.includes(publishedSlug));
    assert.ok(!slugs.includes(draftSlug));
  });
});

it("inactive and unverified authors cannot manage education content", async () => {
  await prisma.user.update({
    where: { id: admin.sub },
    data: { status: "suspended" },
  });
  try {
    await assert.rejects(
      () =>
        education.createTopic(
          admin,
          {
            slug: uniqueSlug("blocked"),
            name: "Blocked",
            category: "prevention",
          },
          meta,
        ),
      (error: AppError) => error.code === "ROLE_NOT_PERMITTED",
    );
  } finally {
    await prisma.user.update({
      where: { id: admin.sub },
      data: { status: "active" },
    });
  }
  await prisma.clinicianProfile.update({
    where: { userId: clinician.sub },
    data: { verificationStatus: "pending" },
  });
  try {
    await assert.rejects(
      () =>
        education.createArticle(
          clinician,
          {
            topic_slug: uniqueSlug("absent"),
            slug: uniqueSlug("blocked"),
            title: "Blocked",
            summary: "Synthetic",
            language: "sw",
          },
          meta,
        ),
      (error: AppError) => error.code === "ROLE_NOT_PERMITTED",
    );
  } finally {
    await prisma.clinicianProfile.update({
      where: { userId: clinician.sub },
      data: { verificationStatus: "verified" },
    });
  }
});

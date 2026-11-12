import { referralActionSchema } from "../types/referral.types.js";
import type { NextFunction, Request, Response } from "express";
import { forbidden, pathParam } from "@a-health/http";
import * as discussions from "../services/discussion.service.js";
import * as opinions from "../services/secondOpinion.service.js";
import * as collaborations from "../services/collaboration.service.js";
import * as referrals from "../services/referral.service.js";
import {
  answerSchema,
  createDiscussionSchema,
  listDiscussionsQuery,
  listSecondOpinionsQuery,
  replySchema,
  requestSecondOpinionSchema,
  membershipSchema,
  reportContentSchema,
  withdrawContentSchema,
  moderationQuery,
  moderationDecisionSchema,
} from "../types/network.types.js";
import {
  collaborationMessageSchema,
  collaborationActionSchema,
  consultationIdQuery,
  listCollaborationsQuery,
  listMessagesQuery,
  requestCollaborationSchema,
} from "../types/collaboration.types.js";
import {
  completeReferralSchema,
  createReferralSchema,
  declineReferralSchema,
  referralAuthorizationsQuery,
  referralMessageSchema,
} from "../types/referral.types.js";

const caller = (req: Request) => ({
  sub: req.auth!.sub,
  role: req.auth!.role,
  cpid: req.auth!.cpid,
  ppid: req.auth!.ppid,
});
const meta = (req: Request, res: Response) => ({
  ip: req.ip ?? null,
  requestId: (res.locals.requestId as string) ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req, res));
    } catch (err) {
      next(err);
    }
  };

export const listCommunities = handle((req) =>
  discussions.listCommunities(caller(req)),
);
export const joinCommunity = handle((req, res) =>
  discussions.joinCommunity(
    pathParam(req, "community_id"),
    caller(req),
    membershipSchema.parse(req.body).notification_mode,
    meta(req, res),
  ),
);
export const leaveCommunity = handle((req, res) =>
  discussions.leaveCommunity(
    pathParam(req, "community_id"),
    caller(req),
    meta(req, res),
  ),
);
export const listNetworkNotifications = handle((req, res) =>
  discussions.listNotifications(
    caller(req),
    listMessagesQuery.parse(req.query),
  ),
);
export const readNetworkNotification = handle((req) =>
  discussions.markNotificationRead(
    pathParam(req, "notification_id"),
    caller(req),
  ),
);
export const listDiscussionReplies = handle((req) =>
  discussions.listReplies(
    pathParam(req, "discussion_id"),
    caller(req),
    listMessagesQuery.parse(req.query),
  ),
);

export const listDiscussions = handle((req) =>
  discussions.listDiscussions(
    caller(req),
    listDiscussionsQuery.parse(req.query),
  ),
);

export const getDiscussion = handle((req) =>
  discussions.getDiscussion(pathParam(req, "discussion_id"), caller(req)),
);

export const createDiscussion = handle(
  (req, res) =>
    discussions.createDiscussion(
      caller(req),
      createDiscussionSchema.parse(req.body),
      meta(req, res),
    ),
  201,
);

export const reply = handle((req, res) => {
  const input = replySchema.parse(req.body);
  return discussions.replyToDiscussion(
    pathParam(req, "discussion_id"),
    caller(req),
    input.body,
    meta(req, res),
    input.parent_reply_id,
    input.client_reply_id,
  );
}, 201);

export const requestSecondOpinion = handle(
  (req, res) =>
    opinions.requestSecondOpinion(
      caller(req),
      requestSecondOpinionSchema.parse(req.body),
      meta(req, res),
    ),
  201,
);

export const listSecondOpinions = handle((req) =>
  opinions.listSecondOpinions(listSecondOpinionsQuery.parse(req.query)),
);

export const claimSecondOpinion = handle((req, res) =>
  opinions.claimSecondOpinion(
    pathParam(req, "second_opinion_id"),
    caller(req),
    meta(req, res),
  ),
);

export const answerSecondOpinion = handle((req, res) => {
  const input = answerSchema.parse(req.body);
  return opinions.answerSecondOpinion(
    pathParam(req, "second_opinion_id"),
    caller(req),
    input.answer,
    meta(req, res),
  );
});

export const listCollaborativeCases = handle((req) =>
  collaborations.listCollaborativeCases(
    caller(req),
    listCollaborationsQuery.parse(req.query),
  ),
);

export const listEligibleCollaborators = handle((req) => {
  const query = consultationIdQuery.parse(req.query);
  return collaborations.listEligibleClinicians(
    query.consultation_id,
    caller(req),
  );
});

export const listCollaborations = handle((req) =>
  collaborations.listCollaborations(
    caller(req),
    listCollaborationsQuery.parse(req.query),
  ),
);

export const requestCollaboration = handle(
  (req, res) =>
    collaborations.requestCollaboration(
      caller(req),
      requestCollaborationSchema.parse(req.body),
      meta(req, res),
    ),
  201,
);

export const getCollaboration = handle((req) =>
  collaborations.getCollaboration(
    pathParam(req, "collaboration_id"),
    caller(req),
  ),
);

export const acceptCollaboration = handle((req, res) =>
  collaborations.acceptCollaboration(
    pathParam(req, "collaboration_id"),
    caller(req),
    meta(req, res),
    collaborationActionSchema.parse(req.body ?? {}).base_version,
  ),
);

export const declineCollaboration = handle((req, res) =>
  collaborations.declineCollaboration(
    pathParam(req, "collaboration_id"),
    caller(req),
    meta(req, res),
    collaborationActionSchema.parse(req.body ?? {}).base_version,
  ),
);

export const revokeCollaboration = handle((req, res) =>
  collaborations.revokeCollaboration(
    pathParam(req, "collaboration_id"),
    caller(req),
    meta(req, res),
    collaborationActionSchema.parse(req.body ?? {}).base_version,
  ),
);

export const getSharedCase = handle((req, res) =>
  collaborations.getSharedCase(
    pathParam(req, "collaboration_id"),
    caller(req),
    meta(req, res),
  ),
);

export const listCollaborationMessages = handle((req, res) =>
  collaborations.listCollaborationMessages(
    pathParam(req, "collaboration_id"),
    caller(req),
    listMessagesQuery.parse(req.query),
    meta(req, res),
  ),
);

export const createCollaborationMessage = handle((req, res) => {
  const input = collaborationMessageSchema.parse(req.body);
  return collaborations.createCollaborationMessage(
    pathParam(req, "collaboration_id"),
    caller(req),
    input.body,
    meta(req, res),
    input.client_message_id,
  );
}, 201);

export const listReferralCases = handle((req) =>
  referrals.listReferralCases(caller(req)),
);
export const listReferralAuthorizations = handle((req) =>
  referrals.listReferralAuthorizations(
    referralAuthorizationsQuery.parse(req.query).consultation_id,
    caller(req),
  ),
);
export const listPatientReferrals = handle((req) =>
  referrals.listPatientReferrals(caller(req)),
);
export const listSourceReferrals = handle((req) =>
  referrals.listSourceReferrals(caller(req)),
);
export const listInboxReferrals = handle((req) =>
  referrals.listInboxReferrals(caller(req)),
);
export const createReferral = handle(
  (req, res) =>
    referrals.createReferral(
      caller(req),
      createReferralSchema.parse(req.body),
      meta(req, res),
    ),
  201,
);
export const getReferral = handle((req, res) =>
  referrals.getReferral(
    pathParam(req, "referral_id"),
    caller(req),
    meta(req, res),
  ),
);
export const getReferralSummary = handle((req, res) =>
  referrals.getReferralSummary(
    pathParam(req, "referral_id"),
    caller(req),
    meta(req, res),
  ),
);
export const submitReferral = handle((req, res) =>
  referrals.submitReferral(
    pathParam(req, "referral_id"),
    caller(req),
    meta(req, res),
    referralActionSchema.parse(req.body ?? {}).base_version,
  ),
);
export const receiveReferral = handle((req, res) =>
  referrals.receiveReferral(
    pathParam(req, "referral_id"),
    caller(req),
    meta(req, res),
    referralActionSchema.parse(req.body ?? {}).base_version,
  ),
);
export const acceptReferral = handle((req, res) =>
  referrals.acceptReferral(
    pathParam(req, "referral_id"),
    caller(req),
    meta(req, res),
    referralActionSchema.parse(req.body ?? {}).base_version,
  ),
);
export const declineReferral = handle((req, res) => {
  const input = declineReferralSchema.parse(req.body);
  return referrals.declineReferral(
    pathParam(req, "referral_id"),
    caller(req),
    input.reason,
    meta(req, res),
    input.base_version,
  );
});
export const startReferralCare = handle((req, res) =>
  referrals.startReferralCare(
    pathParam(req, "referral_id"),
    caller(req),
    meta(req, res),
    referralActionSchema.parse(req.body ?? {}).base_version,
  ),
);
export const completeReferral = handle((req, res) =>
  referrals.completeReferral(
    pathParam(req, "referral_id"),
    caller(req),
    completeReferralSchema.parse(req.body),
    meta(req, res),
  ),
);
export const cancelReferral = handle((req, res) =>
  referrals.cancelReferral(
    pathParam(req, "referral_id"),
    caller(req),
    meta(req, res),
    referralActionSchema.parse(req.body ?? {}).base_version,
  ),
);

export const listReferralMessages = handle((req, res) =>
  referrals.listReferralMessages(
    pathParam(req, "referral_id"),
    caller(req),
    listMessagesQuery.parse(req.query),
    meta(req, res),
  ),
);
export const createReferralMessage = handle(
  (req, res) =>
    referrals.createReferralMessage(
      pathParam(req, "referral_id"),
      caller(req),
      referralMessageSchema.parse(req.body),
      meta(req, res),
    ),
  201,
);

export async function checkCollaborationWriteAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    await collaborations.assertCollaborationWriteAccess(
      pathParam(req, "collaboration_id"),
      caller(req),
    );
    next();
  } catch (error) {
    next(error);
  }
}

export async function checkCollaborationRequestAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const input = requestCollaborationSchema.parse(req.body);
    const eligible = await collaborations.listEligibleClinicians(
      input.consultation_id,
      caller(req),
    );
    if (
      !eligible.data.some(
        (row) => row.clinician_id === input.invited_clinician_id,
      )
    )
      throw forbidden(
        "PATIENT_CONSENT_REQUIRED",
        "The patient must authorize this named clinician for this care thread",
      );
    next();
  } catch (error) {
    next(error);
  }
}

export const reportNetworkContent = handle(
  (req, res) =>
    discussions.reportContent(
      pathParam(req, "discussion_id"),
      caller(req),
      reportContentSchema.parse(req.body),
      meta(req, res),
    ),
  201,
);
export const withdrawNetworkContent = handle((req, res) =>
  discussions.withdrawContent(
    pathParam(req, "discussion_id"),
    caller(req),
    withdrawContentSchema.parse(req.body),
    meta(req, res),
  ),
);
export const listNetworkContentReports = handle((req, res) =>
  discussions.listContentReports(
    caller(req),
    moderationQuery.parse(req.query),
    meta(req, res),
  ),
);
export const reviewNetworkContentReport = handle((req, res) =>
  discussions.reviewContentReport(
    pathParam(req, "report_id"),
    caller(req),
    moderationDecisionSchema.parse(req.body),
    meta(req, res),
  ),
);

import { billingState } from "@/lib/server/billing";
import { assertClipFeature } from "@/lib/server/clip-access";
import { HttpError, readJson, userRoute } from "@/lib/server/http";
import { claimSeatFor, inviteMember, inviteSchema, removeMember, removeMemberSchema, teamMembers, TEAM_SEATS } from "@/lib/server/teams";

/*
 * The Team plan's members. The owner invites up to TEAM_SEATS addresses; each person works in
 * their own account, on their own projects, drawing on the owner's minutes (teams.ts).
 *
 * Reading is open to any account, so the billing page can show both sides: the owner's list,
 * and (for a member) that their plan comes from a team. Inviting needs the Team plan.
 */

export const GET = userRoute(async (_req, { userId }) => {
  // Visiting Plan & billing is when someone invited before they had an account takes their seat.
  const owner = await claimSeatFor(userId).catch(() => null);
  const state = await billingState(userId);
  return Response.json({ seats: TEAM_SEATS, members: await teamMembers(userId), onTeam: Boolean(owner) && state.shared });
});

export const POST = userRoute(
  async (req, { userId }) => {
    await assertClipFeature(userId, "team");
    const input = await readJson(req, inviteSchema);
    const state = await billingState(userId);
    // A seat on someone else's team isn't a team of one's own.
    if (state.shared) throw new HttpError(409, "on_a_team", "You’re on someone else’s team, so you can’t start one.");
    return Response.json({ seats: TEAM_SEATS, members: await inviteMember(userId, input.email) });
  },
  { rate: { bucket: "team-invite", limit: 30, windowMs: 60 * 60_000 } },
);

export const DELETE = userRoute(async (req, { userId }) => {
  const input = await readJson(req, removeMemberSchema);
  return Response.json({ seats: TEAM_SEATS, members: await removeMember(userId, input.email) });
});

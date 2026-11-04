import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import {
  isUuid,
  legacyStaffRoleKeys,
  parseContract,
  teamGroupInputSchema,
  teamMessageInputSchema,
  teamPersonInputSchema,
} from "@bjh/contracts";
import type { TeamKey } from "@bjh/contracts";
import { financeRoles } from "../auth/auth.guards";
import {
  STAFF_AUTH_DIRECTORY,
  staffDisplayName,
} from "../auth/staff-admin.port";
import type { StaffAuthDirectory } from "../auth/staff-admin.port";
import {
  DatabasePort,
  JobScope,
  StaffRoleKey,
  TeamConversationRecord,
  TeamMessageRecord,
  TeamTag,
  TeamTagTargets,
} from "../database/database.port";

/** Which team channels a person is in, from their staff roles. The super admin is in all. */
export function teamsFor(roles: StaffRoleKey[]): TeamKey[] {
  if (roles.includes("super_admin")) {
    return ["sales", "customer_service", "operations", "finance"];
  }
  const teams = new Set<TeamKey>();
  for (const role of roles) {
    if (role === "sales_rep") teams.add("sales");
    if (role === "customer_service_rep") teams.add("customer_service");
    if (role === "finance_rep") teams.add("finance");
    if (
      role === "import_rep" ||
      role === "export_rep" ||
      (legacyStaffRoleKeys as readonly string[]).includes(role)
    ) {
      teams.add("operations");
    }
  }
  return [...teams];
}

/** The person using the chat, with the access they bring to it. */
export interface TeamActor {
  userId: string;
  roles: StaffRoleKey[];
  scope: JobScope;
}

/** A tag as one reader sees it: a label and a link only as far as their access allows. */
export interface ShownTag {
  kind: TeamTag["kind"];
  id: string;
  label: string;
  /** Null when the reader cannot open it. */
  href: string | null;
}

export interface ShownMessage {
  id: string;
  authorUserId: string | null;
  /** The author's name; null for a message the system posted. */
  authorName: string | null;
  /** Written by the person reading it. */
  mine: boolean;
  body: string;
  tags: ShownTag[];
  createdAt: string;
}

const PAGE = 100;

/** Seen this recently counts as online: the menu badge asks every 30 seconds. */
const ONLINE_WITHIN_MS = 75_000;

/**
 * Internal team chat (Evans, 2026-11-02): direct messages, groups and one
 * channel per team, for staff only. A message may tag people, jobs, invoices
 * and documents; each reader sees a tag only as far as their own access
 * allows, so customer service sees an invoice by number, never its amount, and
 * a job outside someone's service lines shows as one they cannot open. Messages
 * are kept as sent.
 */
@Injectable()
export class TeamChatService implements OnModuleInit {
  private readonly logger = new Logger(TeamChatService.name);
  /**
   * When each person last had BJH open (Evans, 2026-11-04). Kept in memory:
   * no migration, and a restart only clears "last seen" until people's next
   * request. With more than one API instance each would know only its own.
   */
  private readonly lastSeen = new Map<string, number>();

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(STAFF_AUTH_DIRECTORY) private readonly auth: StaffAuthDirectory,
  ) {}

  /** The migration creates the four team channels; this restores any that are missing. */
  async onModuleInit() {
    await this.database.ensureTeamChannels();
  }

  /** Everyone with a staff role: who can be messaged, added or mentioned. */
  async people(viewerId: string): Promise<
    Array<{
      userId: string;
      name: string;
      teams: TeamKey[];
      you: boolean;
      online: boolean;
      lastSeen: string | null;
    }>
  > {
    this.lastSeen.set(viewerId, Date.now());
    const now = Date.now();
    const rolesByUser = await this.staffRoles();
    const names = await this.names([...rolesByUser.keys()]);
    return [...rolesByUser.entries()]
      .map(([userId, roles]) => ({
        userId,
        name: names.get(userId) ?? "Staff member",
        teams: teamsFor(roles),
        you: userId === viewerId,
        online: now - (this.lastSeen.get(userId) ?? 0) <= ONLINE_WITHIN_MS,
        lastSeen: this.lastSeen.has(userId)
          ? new Date(this.lastSeen.get(userId)!).toISOString()
          : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async conversations(actor: TeamActor) {
    const rows = await this.database.listTeamConversations(
      actor.userId,
      teamsFor(actor.roles),
    );
    const names = await this.names(
      rows.flatMap((row) => [
        ...row.memberIds,
        ...(row.lastMessage?.authorUserId
          ? [row.lastMessage.authorUserId]
          : []),
      ]),
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      teamKey: row.teamKey,
      title: this.title(row, actor.userId, names),
      /** The other person in a direct chat; null otherwise. */
      personId:
        row.kind === "direct"
          ? (row.memberIds.find((id) => id !== actor.userId) ?? null)
          : null,
      memberCount: row.memberIds.length,
      lastMessage: row.lastMessage
        ? {
            body: row.lastMessage.body,
            authorName: row.lastMessage.authorUserId
              ? (names.get(row.lastMessage.authorUserId) ?? null)
              : null,
            mine: row.lastMessage.authorUserId === actor.userId,
            createdAt: row.lastMessage.createdAt,
          }
        : null,
      unread: row.unread,
    }));
  }

  /** Total unread across everything the person is in, for the menu badge. */
  async unread(actor: TeamActor): Promise<{ unread: number }> {
    this.lastSeen.set(actor.userId, Date.now());
    const rows = await this.database.listTeamConversations(
      actor.userId,
      teamsFor(actor.roles),
    );
    return { unread: rows.reduce((sum, row) => sum + row.unread, 0) };
  }

  /** Opening a conversation shows its newest messages and marks it read. */
  async open(actor: TeamActor, id: string, before: unknown) {
    const conversation = await this.accessible(actor, id);
    if (
      before !== undefined &&
      (typeof before !== "string" || Number.isNaN(Date.parse(before)))
    ) {
      throw new BadRequestException("before must be a date and time");
    }
    const messages = await this.database.listTeamMessages(
      conversation.id,
      (before as string | undefined) ?? null,
      PAGE,
    );
    if (before === undefined) {
      await this.database.markTeamConversationRead(
        conversation.id,
        actor.userId,
      );
    }
    const names = await this.names(conversation.memberIds);
    return {
      id: conversation.id,
      kind: conversation.kind,
      teamKey: conversation.teamKey,
      title: this.title(conversation, actor.userId, names),
      members: conversation.memberIds.map((userId) => ({
        userId,
        name: names.get(userId) ?? "Staff member",
      })),
      messages: await this.show(messages, actor),
      hasEarlier: messages.length === PAGE,
    };
  }

  async send(
    actor: TeamActor,
    id: string,
    input: unknown,
  ): Promise<ShownMessage> {
    const conversation = await this.accessible(actor, id);
    const parsed = parseContract(teamMessageInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const tags = this.unique(parsed.data.tags);
    await this.checkTagsVisible(tags, actor.scope);
    const saved = await this.database.addTeamMessage({
      conversationId: conversation.id,
      authorUserId: actor.userId,
      body: parsed.data.body,
      tags,
    });
    await this.database.markTeamConversationRead(conversation.id, actor.userId);
    const [shown] = await this.show([saved], actor);
    return shown;
  }

  /** The one direct conversation with another staff member. */
  async direct(actor: TeamActor, input: unknown) {
    const parsed = parseContract(teamPersonInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { userId } = parsed.data;
    if (userId === actor.userId) {
      throw new BadRequestException("Choose someone other than yourself");
    }
    await this.requireStaff([userId]);
    const conversation = await this.database.findOrCreateDirectConversation(
      actor.userId,
      userId,
      actor.userId,
    );
    return { id: conversation.id };
  }

  async createGroup(actor: TeamActor, input: unknown) {
    const parsed = parseContract(teamGroupInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const members = [...new Set(parsed.data.memberIds)].filter(
      (userId) => userId !== actor.userId,
    );
    await this.requireStaff(members);
    const group = await this.database.createTeamGroup(
      parsed.data.title,
      members,
      actor.userId,
    );
    return { id: group.id };
  }

  /** Any member of a group may add another staff member. */
  async addMember(actor: TeamActor, id: string, input: unknown) {
    const conversation = await this.accessible(actor, id);
    if (conversation.kind !== "group") {
      throw new ConflictException("People can be added to groups only");
    }
    const parsed = parseContract(teamPersonInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    await this.requireStaff([parsed.data.userId]);
    await this.database.addTeamConversationMember(
      conversation.id,
      parsed.data.userId,
      actor.userId,
    );
    return { added: true };
  }

  async leave(actor: TeamActor, id: string) {
    const conversation = await this.accessible(actor, id);
    if (conversation.kind !== "group") {
      throw new ConflictException("Only a group can be left");
    }
    await this.database.leaveTeamConversation(conversation.id, actor.userId);
    return { left: true };
  }

  /** What `#term` can tag: jobs, invoices and documents the person may see. */
  async searchTags(actor: TeamActor, term: unknown) {
    const text = typeof term === "string" ? term.trim() : "";
    if (text.length < 2) return [];
    const found = await this.database.searchTeamTagTargets(
      text.slice(0, 60),
      actor.scope,
    );
    return this.showTargets(found, actor.roles);
  }

  /**
   * Posts a message from the system to a team channel, for example "invoice
   * accepted" to Finance. A failure is logged, never thrown: the action that
   * caused it has already happened.
   */
  async postToTeam(teamKey: TeamKey, body: string, tags: TeamTag[]) {
    try {
      const channel = await this.database.findTeamChannel(teamKey);
      await this.database.addTeamMessage({
        conversationId: channel.id,
        authorUserId: null,
        body,
        tags,
      });
    } catch (error) {
      this.logger.error(
        `Could not post to the ${teamKey} channel: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The conversation, if the person may use it; 404 otherwise, so others' chats stay unknown. */
  private async accessible(
    actor: TeamActor,
    id: string,
  ): Promise<TeamConversationRecord> {
    const conversation = isUuid(id)
      ? await this.database.findTeamConversation(id)
      : null;
    const allowed =
      conversation &&
      (conversation.kind === "team"
        ? teamsFor(actor.roles).includes(conversation.teamKey!)
        : conversation.memberIds.includes(actor.userId));
    if (!allowed) throw new NotFoundException("Conversation was not found");
    return conversation;
  }

  private title(
    conversation: TeamConversationRecord,
    viewerId: string,
    names: Map<string, string>,
  ): string {
    if (conversation.kind !== "direct") return conversation.title ?? "Group";
    const other = conversation.memberIds.find((id) => id !== viewerId);
    return (other && names.get(other)) || "Staff member";
  }

  /** A sender may tag only people on the staff and things they can open themselves. */
  private async checkTagsVisible(tags: TeamTag[], scope: JobScope) {
    const ids = this.byKind(tags);
    const users = tags
      .filter((tag) => tag.kind === "user")
      .map((tag) => tag.id);
    if (users.length) await this.requireStaff(users);
    const visible = await this.database.findTeamTagTargets(ids, scope);
    const missing =
      ids.jobIds.length > visible.jobs.length ||
      ids.invoiceIds.length > visible.invoices.length ||
      ids.documentIds.length > visible.documents.length;
    if (missing) {
      throw new BadRequestException(
        "You can only tag what you can open yourself",
      );
    }
  }

  /** Messages with author names and their tags as this reader may see them. */
  private async show(
    messages: TeamMessageRecord[],
    actor: TeamActor,
  ): Promise<ShownMessage[]> {
    const tags = messages.flatMap((message) => message.tags);
    const visible = await this.database.findTeamTagTargets(
      this.byKind(tags),
      actor.scope,
    );
    const names = await this.names([
      ...messages.flatMap((message) =>
        message.authorUserId ? [message.authorUserId] : [],
      ),
      ...tags.filter((tag) => tag.kind === "user").map((tag) => tag.id),
    ]);
    const shown = new Map(
      this.showTargets(visible, actor.roles).map((tag) => [
        `${tag.kind}:${tag.id}`,
        tag,
      ]),
    );
    const hidden: Record<TeamTag["kind"], string> = {
      user: "Staff member",
      job: "A job you can't open",
      invoice: "An invoice you can't open",
      document: "A document you can't open",
    };
    return messages.map((message) => ({
      id: message.id,
      authorUserId: message.authorUserId,
      authorName: message.authorUserId
        ? (names.get(message.authorUserId) ?? null)
        : null,
      mine: message.authorUserId === actor.userId,
      body: message.body,
      tags: message.tags.map(
        (tag) =>
          shown.get(`${tag.kind}:${tag.id}`) ??
          (tag.kind === "user"
            ? {
                ...tag,
                label: names.get(tag.id) ?? hidden.user,
                href: null,
              }
            : { ...tag, label: hidden[tag.kind], href: null }),
      ),
      createdAt: message.createdAt,
    }));
  }

  /** Labels and links: an invoice opens the Money tab for finance, the job's overview for others. */
  private showTargets(
    targets: TeamTagTargets,
    roles: StaffRoleKey[],
  ): ShownTag[] {
    const finance = roles.some((role) => financeRoles.includes(role));
    return [
      ...targets.jobs.map((job) => ({
        kind: "job" as const,
        id: job.id,
        label: job.fileNumber,
        href: `/jobs/${job.id}`,
      })),
      ...targets.invoices.map((invoice) => ({
        kind: "invoice" as const,
        id: invoice.id,
        label:
          invoice.status === "void"
            ? `${invoice.invoiceNumber} (void)`
            : invoice.invoiceNumber,
        href: finance
          ? `/finance/jobs/${invoice.jobId}`
          : `/jobs/${invoice.jobId}`,
      })),
      ...targets.documents.map((document) => ({
        kind: "document" as const,
        id: document.id,
        label: document.label,
        href: document.jobId
          ? `/jobs/${document.jobId}/documents`
          : "/documents",
      })),
    ];
  }

  private byKind(tags: TeamTag[]) {
    const of = (kind: TeamTag["kind"]) =>
      tags.filter((tag) => tag.kind === kind).map((tag) => tag.id);
    return {
      jobIds: [...new Set(of("job"))],
      invoiceIds: [...new Set(of("invoice"))],
      documentIds: [...new Set(of("document"))],
    };
  }

  private unique(tags: TeamTag[]): TeamTag[] {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = `${tag.kind}:${tag.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Active staff roles per person. */
  private async staffRoles(): Promise<Map<string, StaffRoleKey[]>> {
    const byUser = new Map<string, StaffRoleKey[]>();
    for (const assignment of await this.database.listStaffRoleAssignments()) {
      if (assignment.revokedAt) continue;
      byUser.set(assignment.userId, [
        ...(byUser.get(assignment.userId) ?? []),
        assignment.roleKey,
      ]);
    }
    return byUser;
  }

  private async requireStaff(userIds: string[]) {
    if (userIds.length === 0) return;
    const staff = await this.staffRoles();
    if (userIds.some((userId) => !staff.has(userId))) {
      throw new BadRequestException("Only staff members can be chosen");
    }
  }

  /** Display names (never emails) for staff accounts that still exist. */
  private async names(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    const users = await Promise.all(unique.map((id) => this.auth.getUser(id)));
    return new Map(
      unique.flatMap((id, index) =>
        users[index] ? [[id, staffDisplayName(users[index])] as const] : [],
      ),
    );
  }
}

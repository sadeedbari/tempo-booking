"use client";
import { useState, useTransition } from "react";
import { Check, Copy, Mail, UserPlus } from "lucide-react";
import { PageHeader, Avatar, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { List } from "@/components/ui/list";
import { useToast } from "@/components/ui/toast";
import { PALETTE } from "@/lib/utils";
import { UpgradeNotice } from "@/components/app/upgrade-notice";
import type { UpgradeOffer } from "@/lib/billing";
import type { Invitation, Membership } from "@/lib/types";
import { addTeamMember, inviteMember, removeMember, revokeInvite, updateMember } from "../actions";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Staff" } as const;
const ROLE_TONE = { owner: "purple", admin: "blue", member: "gray" } as const;

export function TeamView({
  slug, members, me, isAdmin, invites, emails,
}: {
  slug: string; members: Membership[]; me: Membership; isAdmin: boolean; invites: Invitation[]; emails: Record<string, string>;
}) {
  const [editing, setEditing] = useState<Membership | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const invitedIds = new Set(invites.map((i) => i.member_id).filter(Boolean) as string[]);

  const copyInvite = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`);
    toast("Invite link copied");
  };

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who works here, and what they can do. Team members don't have to sign in."
        actions={isAdmin && <Button pill onClick={() => setAdding(true)}><UserPlus className="size-4" /> Add team member</Button>}
      />
      <div className="max-w-3xl space-y-8">
        <List header={`${members.length} member${members.length === 1 ? "" : "s"}`} footer="Owners and admins manage services, settings and the team. Staff manage bookings and their own hours. People added without a login are managed by an owner or admin.">
          {members.map((m) => (
            <button
              key={m.id}
              disabled={!isAdmin && m.id !== me.id}
              onClick={() => setEditing(m)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition enabled:hover:bg-surface-2"
            >
              <Avatar name={m.display_name} color={m.color} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate text-[15px] font-medium">
                  {m.display_name || "Unnamed"} {m.id === me.id && <span className="text-[13px] font-normal text-label-3">(you)</span>}
                </div>
                <div className="truncate text-[13px] text-label-2">{m.title || (m.user_id ? emails[m.user_id] : m.email) || ""}</div>
              </div>
              {!m.user_id && (invitedIds.has(m.id) ? <Badge tone="orange">Invited</Badge> : <Badge>No login</Badge>)}
              {!m.bookable && <Badge>Not bookable</Badge>}
              <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
            </button>
          ))}
        </List>

        {isAdmin && invites.length > 0 && (
          <List header="Pending invitations">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-label-3"><Mail className="size-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px]">{i.email}</div>
                  <div className="text-[13px] text-label-2">{ROLE_LABEL[i.role]} · expires {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(i.expires_at))}</div>
                </div>
                <Button size="sm" variant="gray" onClick={() => copyInvite(i.token)}><Copy className="size-3.5" /> Link</Button>
                <Button size="sm" variant="plain" className="text-red hover:bg-red-soft" disabled={pending}
                  onClick={() => start(async () => { const r = await revokeInvite(slug, i.id); toast(r.error ?? "Invitation revoked", r.error ? "error" : "success"); })}>
                  Revoke
                </Button>
              </div>
            ))}
          </List>
        )}
      </div>

      <AddMemberSheet open={adding} onClose={() => setAdding(false)} slug={slug} onCopy={copyInvite} />
      {editing && <MemberSheet slug={slug} member={editing} me={me} isAdmin={isAdmin} onClose={() => setEditing(null)} onCopy={copyInvite} />}
    </>
  );
}

function AddMemberSheet({ open, onClose, slug, onCopy }: { open: boolean; onClose: () => void; slug: string; onCopy: (t: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [offer, setOffer] = useState<UpgradeOffer | undefined>();
  const [lastForm, setLastForm] = useState<FormData | null>(null);
  const toast = useToast();

  const close = () => { setToken(null); setError(null); setOffer(undefined); setInvite(false); onClose(); };
  const run = (fd: FormData) => start(async () => {
    setLastForm(fd);
    const r = await addTeamMember(slug, fd);
    if (r.error) { setOffer(r.upgrade); return setError(r.error); }
    setError(null);
    setOffer(undefined);
    if (r.id) setToken(r.id);
    else { toast("Team member added"); close(); }
  });

  return (
    <Sheet open={open} onClose={close} title="Add a team member" subtitle="They don't need to sign in. You manage their hours and bookings for them.">
      {token ? (
        <div className="space-y-4 text-center animate-pop">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-[color-mix(in_srgb,var(--green)_15%,transparent)] text-green"><Check className="size-7" strokeWidth={3} /></div>
          <p className="text-[15px] text-label-2">Added, and an invitation was sent. You can also share the link directly.</p>
          <Button variant="tinted" className="w-full" onClick={() => onCopy(token)}><Copy className="size-4" /> Copy invite link</Button>
          <Button variant="gray" className="w-full" onClick={() => { setToken(null); setInvite(false); }}>Add someone else</Button>
        </div>
      ) : (
        <form
          action={run}
          className="space-y-4"
        >
          <Field label="Name"><Input name="name" placeholder="Jane Appleseed" required autoFocus /></Field>
          <Field label="Title" hint="Optional. Shown on your booking page, e.g. Senior Stylist."><Input name="title" /></Field>
          <Field label="Email" hint="Optional. Only needed if you want to invite them to sign in."><Input name="email" type="email" placeholder="name@company.com" /></Field>

          <div className="flex items-center justify-between gap-4 rounded-[12px] bg-surface-2 px-4 py-3">
            <div>
              <div className="text-[15px] font-medium">Invite them to sign in</div>
              <div className="text-[13px] text-label-2">Sends an email with a link. Leave off to just add them.</div>
            </div>
            <Switch name="invite" checked={invite} onChange={setInvite} label="Invite them to sign in" />
          </div>
          {invite && (
            <Field label="Role" hint="Admins can change services, settings and the team.">
              <Select name="role" defaultValue="member">
                <option value="member">Staff</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
          )}
          {error && <UpgradeNotice slug={slug} message={error} offer={offer} onUpgraded={() => lastForm && run(lastForm)} />}
          <Button type="submit" size="lg" pill className="w-full" loading={pending}>{invite ? "Add and send invitation" : "Add team member"}</Button>
        </form>
      )}
    </Sheet>
  );
}

function MemberSheet({ slug, member, me, isAdmin, onClose, onCopy }: { slug: string; member: Membership; me: Membership; isAdmin: boolean; onClose: () => void; onCopy: (t: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState(member.color);
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  const self = member.id === me.id;
  const noLogin = !member.user_id;
  const [invitePanel, setInvitePanel] = useState(false);
  const [inviteEmail, setInviteEmail] = useState(member.email ?? "");
  const [inviteRole, setInviteRole] = useState("member");
  const [sentToken, setSentToken] = useState<string | null>(null);
  const [offer, setOffer] = useState<UpgradeOffer | undefined>();
  const sendInvite = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("email", inviteEmail);
      fd.set("role", inviteRole);
      fd.set("member_id", member.id);
      const r = await inviteMember(slug, fd);
      if (r.error) { setOffer(r.upgrade); setError(r.error); } else { setError(null); setOffer(undefined); setSentToken(r.id!); }
    });

  return (
    <Sheet open onClose={onClose} title={self ? "Your profile" : member.display_name}>
      <form
        action={(fd) => {
          fd.set("color", color);
          start(async () => {
            const r = await updateMember(slug, fd);
            if (r.error) setError(r.error); else { toast("Saved"); onClose(); }
          });
        }}
        className="space-y-4"
      >
        <input type="hidden" name="id" value={member.id} />
        <div className="flex justify-center pb-2"><Avatar name={member.display_name} color={color} size={72} /></div>
        <Field label="Display name"><Input name="display_name" defaultValue={member.display_name} required /></Field>
        <Field label="Title" hint="Shown on your booking page, e.g. Senior Stylist."><Input name="title" defaultValue={member.title ?? ""} /></Field>
        {isAdmin && noLogin && (
          <Field label="Email" hint="Optional. Used only if you invite them to sign in later."><Input name="email" type="email" defaultValue={member.email ?? ""} placeholder="name@company.com" /></Field>
        )}
        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">Calendar colour</span>
          <div className="flex flex-wrap gap-2.5">
            {PALETTE.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} className="grid size-10 place-items-center sm:size-8 rounded-full" style={{ background: c }}>
                {color === c && <Check className="size-4 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
        {isAdmin && !noLogin && (
          <Field label="Role">
            <Select name="role" defaultValue={member.role} disabled={member.role === "owner" && me.role !== "owner"}>
              {me.role === "owner" && <option value="owner">Owner</option>}
              <option value="admin">Admin</option>
              <option value="member">Staff</option>
            </Select>
          </Field>
        )}
        <div className="flex items-center justify-between rounded-[12px] bg-surface-2 px-4 py-3">
          <div>
            <div className="text-[15px] font-medium">Takes bookings</div>
            <div className="text-[13px] text-label-2">Appears on the calendar and booking page.</div>
          </div>
          <Switch name="bookable" defaultChecked={member.bookable} />
        </div>

        {isAdmin && noLogin && (
          <div className="rounded-[12px] bg-surface-2 px-4 py-3">
            <div className="text-[15px] font-medium">Doesn&apos;t sign in</div>
            <div className="text-[13px] text-label-2">You manage their hours (Availability or Schedule) and bookings for them. They stay Staff.</div>
            {sentToken ? (
              <div className="mt-3 space-y-2">
                <p className="text-[13px] text-label-2">Invitation sent. Once they accept, they sign in as this same team member.</p>
                <Button type="button" size="sm" variant="tinted" onClick={() => onCopy(sentToken)}><Copy className="size-3.5" /> Copy invite link</Button>
              </div>
            ) : invitePanel ? (
              <div className="mt-3 space-y-3">
                <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@company.com" aria-label="Their email" />
                <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} aria-label="Role when they sign in">
                  <option value="member">Staff</option>
                  <option value="admin">Admin</option>
                </Select>
                <Button type="button" size="sm" disabled={pending} onClick={sendInvite}>
                  <Mail className="size-3.5" /> Send invitation
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="gray" className="mt-3" onClick={() => setInvitePanel(true)}><Mail className="size-3.5" /> Invite to sign in</Button>
            )}
          </div>
        )}

        {error && <UpgradeNotice slug={slug} message={error} offer={offer} onUpgraded={sendInvite} />}
        <div className="flex gap-2">
          {(isAdmin || self) && (
            <Button type="button" variant="destructive" disabled={pending}
              onClick={() => {
                if (!confirm) return setConfirm(true);
                start(async () => {
                  const r = await removeMember(slug, member.id);
                  if (r?.error) setError(r.error); else { toast("Removed"); onClose(); }
                });
              }}>
              {confirm ? "Tap to confirm" : self ? "Leave team" : "Remove"}
            </Button>
          )}
          <Button type="submit" className="flex-1" pill loading={pending}>Save</Button>
        </div>
      </form>
    </Sheet>
  );
}

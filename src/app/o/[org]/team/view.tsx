"use client";
import { useState, useTransition } from "react";
import { Check, Copy, Mail, UserPlus } from "lucide-react";
import { PageHeader, Avatar, Badge, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { List } from "@/components/ui/list";
import { useToast } from "@/components/ui/toast";
import { PALETTE } from "@/lib/utils";
import type { Invitation, Membership } from "@/lib/types";
import { inviteMember, removeMember, revokeInvite, updateMember } from "../actions";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Staff" } as const;
const ROLE_TONE = { owner: "purple", admin: "blue", member: "gray" } as const;

export function TeamView({
  slug, members, me, isAdmin, invites, emails,
}: {
  slug: string; members: Membership[]; me: Membership; isAdmin: boolean; invites: Invitation[]; emails: Record<string, string>;
}) {
  const [editing, setEditing] = useState<Membership | null>(null);
  const [inviting, setInviting] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();

  const copyInvite = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`);
    toast("Invite link copied");
  };

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who works here, and what they can do."
        actions={isAdmin && <Button pill onClick={() => setInviting(true)}><UserPlus className="size-4" /> Invite</Button>}
      />
      <div className="max-w-3xl space-y-8">
        <List header={`${members.length} member${members.length === 1 ? "" : "s"}`} footer="Owners and admins manage services, settings and the team. Staff manage bookings and their own hours.">
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
                <div className="truncate text-[13px] text-label-2">{m.title || emails[m.user_id] || ""}</div>
              </div>
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
                  <div className="text-[13px] text-label-2">{ROLE_LABEL[i.role]} · expires {new Date(i.expires_at).toLocaleDateString()}</div>
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

      <InviteSheet open={inviting} onClose={() => setInviting(false)} slug={slug} onCopy={copyInvite} />
      {editing && <MemberSheet slug={slug} member={editing} me={me} isAdmin={isAdmin} onClose={() => setEditing(null)} />}
    </>
  );
}

function InviteSheet({ open, onClose, slug, onCopy }: { open: boolean; onClose: () => void; slug: string; onCopy: (t: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const close = () => { setToken(null); setError(null); onClose(); };

  return (
    <Sheet open={open} onClose={close} title="Invite to your team" subtitle="They'll get an email with a link to join.">
      {token ? (
        <div className="space-y-4 text-center animate-pop">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-[color-mix(in_srgb,var(--green)_15%,transparent)] text-green"><Check className="size-7" strokeWidth={3} /></div>
          <p className="text-[15px] text-label-2">Invitation sent. You can also share the link directly.</p>
          <Button variant="tinted" className="w-full" onClick={() => onCopy(token)}><Copy className="size-4" /> Copy invite link</Button>
          <Button variant="gray" className="w-full" onClick={() => setToken(null)}>Invite someone else</Button>
        </div>
      ) : (
        <form
          action={(fd) => start(async () => {
            const r = await inviteMember(slug, fd);
            if (r.error) setError(r.error); else { setError(null); setToken(r.id!); }
          })}
          className="space-y-4"
        >
          <Field label="Email"><Input name="email" type="email" placeholder="name@company.com" required autoFocus /></Field>
          <Field label="Role" hint="Admins can change services, settings and the team.">
            <Select name="role" defaultValue="member">
              <option value="member">Staff</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          {error && <Notice>{error}</Notice>}
          <Button type="submit" size="lg" pill className="w-full" loading={pending}>Send invitation</Button>
        </form>
      )}
    </Sheet>
  );
}

function MemberSheet({ slug, member, me, isAdmin, onClose }: { slug: string; member: Membership; me: Membership; isAdmin: boolean; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState(member.color);
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  const self = member.id === me.id;

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
        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">Calendar colour</span>
          <div className="flex flex-wrap gap-2.5">
            {PALETTE.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} className="grid size-8 place-items-center rounded-full" style={{ background: c }}>
                {color === c && <Check className="size-4 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
        {isAdmin && (
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
        {error && <Notice>{error}</Notice>}
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

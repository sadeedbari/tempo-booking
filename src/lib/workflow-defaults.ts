/** The built-in workflows every business starts with. Pure data, so "Restore default" and first-time setup share it. */

export type Trigger = "booking_confirmed" | "booking_requested" | "booking_declined" | "booking_cancelled" | "booking_rescheduled" | "before_start" | "after_end" | "inquiry_received";
export type Channel = "email" | "sms";

export const TRIGGERS: { value: Trigger; label: string; timed: boolean }[] = [
  { value: "booking_confirmed", label: "A booking is confirmed", timed: false },
  { value: "booking_requested", label: "A booking request is received", timed: false },
  { value: "booking_declined", label: "A booking request is declined", timed: false },
  { value: "booking_cancelled", label: "A booking is cancelled", timed: false },
  { value: "booking_rescheduled", label: "A booking is rescheduled", timed: false },
  { value: "inquiry_received", label: "A website message is received", timed: false },
  { value: "before_start", label: "Before the appointment starts", timed: true },
  { value: "after_end", label: "After the appointment ends", timed: true },
];

export const isTimed = (t: Trigger) => t === "before_start" || t === "after_end";

const WHEN: Record<string, string> = {
  booking_confirmed: "When a booking is confirmed",
  booking_requested: "When a booking request is received",
  booking_declined: "When a booking request is declined",
  booking_cancelled: "When a booking is cancelled",
  booking_rescheduled: "When a booking is rescheduled",
  inquiry_received: "When a website message is received",
};

/** "24 hours before the appointment", "When a booking is confirmed", ... */
export function describeTrigger(t: Trigger, offsetMinutes: number): string {
  if (!isTimed(t)) return WHEN[t];
  const [n, unit] = offsetMinutes % 1440 === 0 ? [offsetMinutes / 1440, "day"] : offsetMinutes % 60 === 0 ? [offsetMinutes / 60, "hour"] : [offsetMinutes, "minute"];
  const amount = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return t === "before_start" ? `${amount} before the appointment` : `${amount} after the appointment ends`;
}

export interface StepDef {
  channel: Channel;
  subject: string;
  body: string;
}
export interface WorkflowDef {
  key: string; // marks a built-in workflow
  name: string;
  trigger: Trigger;
  offset_minutes: number;
  steps: StepDef[];
}

const DETAILS = `When: {{date_time}}
Service: {{service_name}} ({{duration}})
With: {{staff_name}}
Where: {{location}}
Price: {{price}}
Deposit: {{deposit}}
Spots: {{spots}}`;

export const DEFAULT_WORKFLOWS: WorkflowDef[] = [
  {
    key: "confirmed",
    name: "Booking confirmed",
    trigger: "booking_confirmed",
    offset_minutes: 0,
    steps: [
      {
        channel: "email",
        subject: "Confirmed: {{service_name}} with {{business_name}}",
        body: `Hi {{customer_first_name}},\n\nYou're booked. Here are the details:\n\n${DETAILS}\n\n{{series}}\n\n{{manage_button}}`,
      },
      { channel: "sms", subject: "", body: "{{business_name}}: Confirmed - {{service_name}}, {{date_time}}. Manage: {{manage_link}}" },
    ],
  },
  {
    key: "requested",
    name: "Request received",
    trigger: "booking_requested",
    offset_minutes: 0,
    steps: [
      {
        channel: "email",
        subject: "Request received: {{service_name}} with {{business_name}}",
        body: `Hi {{customer_first_name}},\n\nThanks for your request. {{business_name}} will review it and email you once it's confirmed.\n\n${DETAILS}\n\n{{manage_button}}`,
      },
    ],
  },
  {
    key: "declined",
    name: "Request declined",
    trigger: "booking_declined",
    offset_minutes: 0,
    steps: [
      {
        channel: "email",
        subject: "Update on your request with {{business_name}}",
        body: "Hi {{customer_first_name}},\n\nUnfortunately this time isn't available. Any deposit has been refunded. Please pick another time.\n\n{{booking_button}}",
      },
    ],
  },
  {
    key: "cancelled",
    name: "Booking cancelled",
    trigger: "booking_cancelled",
    offset_minutes: 0,
    steps: [
      {
        channel: "email",
        subject: "Cancelled: {{service_name}} with {{business_name}}",
        body: "Hi {{customer_first_name}},\n\nYour booking has been cancelled.\n\nWhen: {{date_time}}\nService: {{service_name}}\n\n{{booking_button}}",
      },
    ],
  },
  {
    key: "rescheduled",
    name: "Booking rescheduled",
    trigger: "booking_rescheduled",
    offset_minutes: 0,
    steps: [
      {
        channel: "email",
        subject: "Updated: {{service_name}} with {{business_name}}",
        body: `Hi {{customer_first_name}},\n\nYour booking has changed. Here are the new details:\n\n${DETAILS}\n\n{{manage_button}}`,
      },
    ],
  },
  {
    key: "inquiry",
    name: "Message received",
    trigger: "inquiry_received",
    offset_minutes: 0,
    steps: [
      {
        channel: "email",
        subject: "We received your message, {{customer_first_name}}",
        body: `Hi {{customer_first_name}},\n\nThank you for getting in touch. {{business_name}} has your message and will reply as soon as possible.\n\nYou asked about: {{service_name}}\nYour message: {{inquiry_message}}\n\nIf it's urgent, you can call us on {{business_phone}}.\n\n{{booking_button}}`,
      },
    ],
  },
  {
    key: "reminder",
    name: "Appointment reminder",
    trigger: "before_start",
    offset_minutes: 24 * 60,
    steps: [
      {
        channel: "email",
        subject: "Reminder: {{service_name}} at {{business_name}}",
        body: `Hi {{customer_first_name}},\n\nThis is a reminder of your upcoming appointment.\n\n${DETAILS}\n\n{{manage_button}}`,
      },
      { channel: "sms", subject: "", body: "{{business_name}}: Reminder - {{service_name}}, {{date_time}}. Manage: {{manage_link}}" },
    ],
  },
];

/** Starting points offered when creating a new workflow. */
export const STARTERS: { id: string; label: string; hint: string; trigger: Trigger; offset_minutes: number; name: string; steps: StepDef[] }[] = [
  {
    id: "second-reminder",
    label: "Second reminder",
    hint: "A short nudge a couple of hours before.",
    name: "Reminder: 2 hours before",
    trigger: "before_start",
    offset_minutes: 120,
    steps: [
      { channel: "sms", subject: "", body: "{{business_name}}: See you at {{time}} today for {{service_name}}. Manage: {{manage_link}}" },
    ],
  },
  {
    id: "thank-you",
    label: "Thank you after the appointment",
    hint: "Say thanks a couple of hours after they leave.",
    name: "Thank you",
    trigger: "after_end",
    offset_minutes: 120,
    steps: [
      {
        channel: "email",
        subject: "Thanks for visiting {{business_name}}",
        body: "Hi {{customer_first_name}},\n\nThanks for coming in for {{service_name}}. We hope to see you again soon.\n\n{{booking_button}}",
      },
    ],
  },
  {
    id: "custom",
    label: "Start from scratch",
    hint: "Pick your own trigger and write the message.",
    name: "New workflow",
    trigger: "booking_confirmed",
    offset_minutes: 0,
    steps: [{ channel: "email", subject: "", body: "Hi {{customer_first_name}},\n\n" }],
  },
];

/** A workflow as the editor works with it. */
export interface EditableStep {
  id?: string;
  channel: Channel;
  subject: string;
  body: string;
  enabled: boolean;
}
export interface EditableWorkflow {
  id?: string;
  name: string;
  trigger: Trigger;
  offset_minutes: number;
  active: boolean;
  all_services: boolean;
  service_ids: string[];
  default_key: string | null;
  steps: EditableStep[];
}

export const LIMITS = { workflows: 25, steps: 6, subject: 150, email: 3000, sms: 480, name: 80 } as const;
